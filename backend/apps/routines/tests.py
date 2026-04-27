import datetime as dt
from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.notifications.models import NotificationState

from .models import Routine, RoutineEntry, Stock, StockConsumption, StockGroup, StockLot
from .serializers import RoutineSerializer, StockLotSerializer, StockSerializer

User = get_user_model()


# ── Helpers ──────────────────────────────────────────────────────────────────


def make_user(username="user1", password="pass"):
    return User.objects.create_user(username=username, password=password)


def make_stock(user, name="Filter"):
    """Create a Stock without any lots (quantity=0 by default)."""
    return Stock.objects.create(user=user, name=name)


def make_lot(stock, quantity=10, expiry_date=None, lot_number=""):
    """Create a StockLot for a given stock."""
    return StockLot.objects.create(
        stock=stock,
        quantity=quantity,
        expiry_date=expiry_date,
        lot_number=lot_number,
    )


def make_routine(user, name="Oil change", interval_hours=24, stock=None, is_active=True):
    return Routine.objects.create(
        user=user,
        name=name,
        interval_hours=interval_hours,
        stock=stock,
        is_active=is_active,
    )


def make_entry(routine, offset_hours=0, notes=""):
    """Create a RoutineEntry at now + offset_hours."""
    entry = RoutineEntry.objects.create(routine=routine, notes=notes)
    if offset_hours:
        # Adjust created_at retroactively
        RoutineEntry.objects.filter(pk=entry.pk).update(created_at=timezone.now() + timedelta(hours=offset_hours))
        entry.refresh_from_db()
    return entry


def make_stock_group(user, name="Diabetes", display_order=0):
    return StockGroup.objects.create(user=user, name=name, display_order=display_order)


def make_stock_consumption(stock, quantity=1, notes=""):
    return StockConsumption.objects.create(stock=stock, quantity=quantity, notes=notes)


# ── StockGroup model ────────────────────────────────────────────────────────


class StockGroupModelTest(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_str(self):
        group = make_stock_group(self.user, name="Diabetes")
        self.assertEqual(str(group), "Diabetes")

    def test_ordering_by_display_order_then_name(self):
        make_stock_group(self.user, name="Zzz", display_order=0)
        make_stock_group(self.user, name="Aaa", display_order=1)
        make_stock_group(self.user, name="Mmm", display_order=0)
        names = list(StockGroup.objects.filter(user=self.user).values_list("name", flat=True))
        self.assertEqual(names, ["Mmm", "Zzz", "Aaa"])

    def test_unique_name_per_user(self):
        make_stock_group(self.user, name="Diabetes")
        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            make_stock_group(self.user, name="Diabetes")

    def test_same_name_different_user(self):
        other = make_user(username="other")
        make_stock_group(self.user, name="Diabetes")
        group2 = make_stock_group(other, name="Diabetes")
        self.assertEqual(group2.name, "Diabetes")


# ── Stock model ──────────────────────────────────────────────────────────────


class StockModelTest(TestCase):
    def setUp(self):
        self.user = make_user()
        self.stock = make_stock(self.user)
        make_lot(self.stock, quantity=10)

    def test_str(self):
        self.assertEqual(str(self.stock), "Filter (10)")

    def test_default_quantity_no_lots(self):
        s = Stock.objects.create(user=self.user, name="No lots")
        self.assertEqual(s.quantity, 0)

    def test_quantity_sums_all_lots(self):
        s = make_stock(self.user, name="Multi")
        make_lot(s, quantity=5)
        make_lot(s, quantity=3)
        self.assertEqual(s.quantity, 8)

    def test_ordering_by_name(self):
        Stock.objects.create(user=self.user, name="Zzz")
        Stock.objects.create(user=self.user, name="Aaa")
        names = list(Stock.objects.filter(user=self.user).values_list("name", flat=True))
        self.assertEqual(names, sorted(names))


# ── StockLot model ───────────────────────────────────────────────────────────


class StockLotModelTest(TestCase):
    def setUp(self):
        self.user = make_user()
        self.stock = make_stock(self.user)

    def test_str(self):
        lot = make_lot(self.stock, quantity=5, lot_number="LOT-A")
        self.assertIn("Filter", str(lot))
        self.assertIn("LOT-A", str(lot))
        self.assertIn("5", str(lot))

    def test_str_without_lot_number(self):
        lot = make_lot(self.stock, quantity=5)
        self.assertIn("Filter", str(lot))
        self.assertIn("5", str(lot))

    def test_negative_quantity_raises(self):
        from django.core.exceptions import ValidationError

        lot = StockLot(stock=self.stock, quantity=-1)
        with self.assertRaises(ValidationError):
            lot.full_clean()

    def test_fefo_ordering_expiry_before_no_expiry(self):
        """Lots with expiry_date come before lots without."""
        no_expiry = make_lot(self.stock, quantity=3)
        with_expiry = make_lot(self.stock, quantity=5, expiry_date=date.today() + timedelta(days=60))
        lots = list(self.stock.lots.all())
        self.assertEqual(lots[0], with_expiry)
        self.assertEqual(lots[1], no_expiry)

    def test_fefo_ordering_sooner_expiry_first(self):
        """Earlier expiry comes first."""
        late_lot = make_lot(self.stock, quantity=2, expiry_date=date.today() + timedelta(days=200))
        early_lot = make_lot(self.stock, quantity=2, expiry_date=date.today() + timedelta(days=30))
        lots = list(self.stock.lots.all())
        self.assertEqual(lots[0], early_lot)
        self.assertEqual(lots[1], late_lot)

    def test_lot_auto_deleted_when_quantity_reaches_zero(self):
        """Saving a lot with quantity=0 triggers post_save and deletes it."""
        lot = make_lot(self.stock, quantity=3)
        lot_id = lot.pk
        lot.quantity = 0
        lot.save(update_fields=["quantity"])
        self.assertFalse(StockLot.objects.filter(pk=lot_id).exists())

    def test_lot_not_deleted_when_quantity_positive(self):
        """Saving a lot with quantity>0 does not delete it."""
        lot = make_lot(self.stock, quantity=3)
        lot.quantity = 2
        lot.save(update_fields=["quantity"])
        self.assertTrue(StockLot.objects.filter(pk=lot.pk).exists())


# ── Routine model ────────────────────────────────────────────────────────────


class RoutineModelTest(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_str(self):
        r = make_routine(self.user, name="Daily check")
        self.assertEqual(str(r), "Daily check")

    def test_last_entry_none_when_no_entries(self):
        r = make_routine(self.user)
        self.assertIsNone(r.last_entry())

    def test_last_entry_returns_most_recent(self):
        r = make_routine(self.user)
        make_entry(r, offset_hours=-5)
        e2 = make_entry(r)
        self.assertEqual(r.last_entry(), e2)

    def test_next_due_at_none_when_never_logged(self):
        r = make_routine(self.user, interval_hours=24)
        self.assertIsNone(r.next_due_at())

    def test_next_due_at_calculated_from_last_entry(self):
        r = make_routine(self.user, interval_hours=24)
        entry = make_entry(r)
        expected = entry.created_at + timedelta(hours=24)
        self.assertAlmostEqual(
            r.next_due_at().timestamp(),
            expected.timestamp(),
            delta=1,
        )

    def test_is_due_true_when_never_logged(self):
        r = make_routine(self.user, interval_hours=24)
        self.assertTrue(r.is_due())

    def test_is_due_true_when_interval_elapsed(self):
        r = make_routine(self.user, interval_hours=1)
        make_entry(r, offset_hours=-2)  # entry 2 hours ago
        self.assertTrue(r.is_due())

    def test_is_due_false_when_interval_not_elapsed(self):
        r = make_routine(self.user, interval_hours=24)
        make_entry(r)  # entry just now
        self.assertFalse(r.is_due())

    def test_is_due_true_when_due_today_but_not_yet_overdue(self):
        """Routine due later today should appear as is_due=True."""
        # Pin to 10:00 UTC so entry at 05:00 → due at 13:00 (same day)
        fixed_now = dt.datetime(2026, 3, 4, 10, 0, tzinfo=dt.timezone.utc)
        with patch("django.utils.timezone.now", return_value=fixed_now):
            r = make_routine(self.user, interval_hours=8)
            make_entry(r, offset_hours=-5)
            self.assertTrue(r.is_due())
            self.assertFalse(r.is_overdue())

    def test_is_overdue_true_when_time_passed(self):
        r = make_routine(self.user, interval_hours=1)
        make_entry(r, offset_hours=-2)  # entry 2 hours ago → overdue 1 hour
        self.assertTrue(r.is_overdue())

    def test_is_overdue_false_when_time_not_passed(self):
        r = make_routine(self.user, interval_hours=8)
        make_entry(r, offset_hours=-5)  # due in 3 hours
        self.assertFalse(r.is_overdue())

    def test_is_overdue_true_when_never_logged(self):
        r = make_routine(self.user, interval_hours=24)
        self.assertTrue(r.is_overdue())

    def test_ordering_by_name(self):
        make_routine(self.user, name="Zzz")
        make_routine(self.user, name="Aaa")
        names = list(Routine.objects.filter(user=self.user).values_list("name", flat=True))
        self.assertEqual(names, sorted(names))


# ── RoutineEntry model ───────────────────────────────────────────────────────


class RoutineEntryModelTest(TestCase):
    def setUp(self):
        self.user = make_user()
        self.routine = make_routine(self.user, name="Test routine")

    def test_str(self):
        entry = make_entry(self.routine)
        expected = f"Test routine — {entry.created_at:%Y-%m-%d %H:%M}"
        self.assertEqual(str(entry), expected)

    def test_ordering_by_created_at_desc(self):
        e1 = make_entry(self.routine, offset_hours=-2)
        e2 = make_entry(self.routine)
        qs = list(RoutineEntry.objects.filter(routine=self.routine))
        self.assertEqual(qs[0], e2)  # most recent first
        self.assertEqual(qs[1], e1)


class StockAdminTest(TestCase):
    def test_total_quantity_display_returns_stock_quantity(self):
        from django.contrib.admin.sites import AdminSite

        from .admin import StockAdmin

        user = make_user()
        stock = make_stock(user)
        make_lot(stock, quantity=3)
        make_lot(stock, quantity=4)
        admin_inst = StockAdmin(Stock, AdminSite())
        self.assertEqual(admin_inst.total_quantity(stock), 7)


class ClientTimestampValidatorTest(TestCase):
    def test_client_timestamp_none_passes_through(self):
        # `ClientTimestampInputSerializer.validate_client_created_at`
        # short-circuits to None when the value is None.
        from .serializers import ClientTimestampInputSerializer

        s = ClientTimestampInputSerializer(data={"client_created_at": None})
        self.assertTrue(s.is_valid(), s.errors)
        self.assertIsNone(s.validated_data.get("client_created_at"))


# ── StockLotSerializer ───────────────────────────────────────────────────────


class StockLotSerializerTest(TestCase):
    def test_negative_quantity_invalid(self):
        s = StockLotSerializer(data={"quantity": -1, "lot_number": "X"})
        self.assertFalse(s.is_valid())
        self.assertIn("quantity", s.errors)

    def test_zero_quantity_valid(self):
        s = StockLotSerializer(data={"quantity": 0})
        self.assertTrue(s.is_valid())

    def test_positive_quantity_valid(self):
        s = StockLotSerializer(data={"quantity": 5, "expiry_date": "2027-01-01"})
        self.assertTrue(s.is_valid())

    def test_past_expiry_date_invalid(self):
        past = (date.today() - timedelta(days=1)).isoformat()
        s = StockLotSerializer(data={"quantity": 1, "expiry_date": past})
        self.assertFalse(s.is_valid())
        self.assertIn("expiry_date", s.errors)


# ── StockSerializer ──────────────────────────────────────────────────────────


class StockSerializerTest(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_quantity_reflects_lots_sum(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=4)
        make_lot(stock, quantity=6)
        data = StockSerializer(stock).data
        self.assertEqual(data["quantity"], 10)

    def test_quantity_zero_with_no_lots(self):
        stock = make_stock(self.user)
        data = StockSerializer(stock).data
        self.assertEqual(data["quantity"], 0)

    def test_lots_included_in_response(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5, lot_number="L1")
        data = StockSerializer(stock).data
        self.assertEqual(len(data["lots"]), 1)
        self.assertEqual(data["lots"][0]["lot_number"], "L1")

    def test_expiring_lots_contains_correct_lots(self):
        stock = make_stock(self.user)
        # T104: threshold dropped from 90 to 30 days. Was +60 (in window
        # under the old rule); now must be <= 30.
        expiring = make_lot(stock, quantity=2, expiry_date=date.today() + timedelta(days=20))
        make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=200))
        data = StockSerializer(stock).data
        self.assertEqual(len(data["expiring_lots"]), 1)
        self.assertEqual(data["expiring_lots"][0]["id"], expiring.id)

    def test_expiring_lots_excludes_zero_quantity(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=0, expiry_date=date.today() + timedelta(days=30))
        data = StockSerializer(stock).data
        self.assertEqual(len(data["expiring_lots"]), 0)

    # ── expiry_severity (T104) ─────────────────────────────────────────────

    def test_expiry_severity_ok_when_no_lots(self):
        stock = make_stock(self.user)
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "ok")

    def test_expiry_severity_ok_when_lot_no_expiry(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=10)  # no expiry_date
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "ok")

    def test_expiry_severity_ok_when_far_future(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=10, expiry_date=date.today() + timedelta(days=200))
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "ok")

    def test_expiry_severity_soon_when_within_30_days(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=10))
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "soon")

    def test_expiry_severity_ok_when_exactly_30_days(self):
        # Boundary: get_expiry_severity uses '< 30 days' (strict). Day 30
        # falls into 'ok' for that method. NB: _expiring_lots uses '<= 30'
        # (inclusive) — discrepancy is intentional; the array can include
        # a +30d lot that does not flip the severity flag.
        stock = make_stock(self.user)
        make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=30))
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "ok")

    def test_expiry_severity_reached_when_today(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5, expiry_date=date.today())
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "reached")

    def test_expiry_severity_reached_when_past(self):
        # StockLotSerializer.validate_expiry_date forbids creating a lot
        # with a past date. Create with a future date and back-date via
        # queryset.update() to bypass model-level validators.
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=10))
        StockLot.objects.filter(pk=lot.pk).update(expiry_date=date.today() - timedelta(days=5))
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "reached")

    def test_expiry_severity_reached_takes_precedence_over_soon(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=10))
        past_lot = make_lot(stock, quantity=3, expiry_date=date.today() + timedelta(days=10))
        StockLot.objects.filter(pk=past_lot.pk).update(expiry_date=date.today() - timedelta(days=5))
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "reached")

    def test_expiry_severity_ignores_zero_quantity_lots(self):
        # The post_save signal `delete_empty_lot` would normally remove a
        # qty=0 lot; bypass with queryset.update() to test the safeguard
        # in the serializer itself.
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=10))
        StockLot.objects.filter(pk=lot.pk).update(quantity=0, expiry_date=date.today() - timedelta(days=5))
        data = StockSerializer(stock).data
        self.assertEqual(data["expiry_severity"], "ok")


# ── RoutineSerializer ────────────────────────────────────────────────────────


class RoutineSerializerTest(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_computed_fields_never_logged(self):
        r = make_routine(self.user, interval_hours=24)
        data = RoutineSerializer(r).data
        self.assertIsNone(data["last_entry_at"])
        self.assertIsNone(data["next_due_at"])
        self.assertTrue(data["is_due"])
        self.assertIsNone(data["hours_until_due"])

    def test_computed_fields_with_recent_entry(self):
        r = make_routine(self.user, interval_hours=48)
        make_entry(r)
        data = RoutineSerializer(r).data
        self.assertIsNotNone(data["last_entry_at"])
        self.assertIsNotNone(data["next_due_at"])
        self.assertFalse(data["is_due"])
        self.assertIsNotNone(data["hours_until_due"])
        self.assertGreater(data["hours_until_due"], 0)

    def test_stock_name_and_quantity(self):
        stock = make_stock(self.user, name="Filters")
        make_lot(stock, quantity=5)
        r = make_routine(self.user, stock=stock)
        data = RoutineSerializer(r).data
        self.assertEqual(data["stock_name"], "Filters")
        self.assertEqual(data["stock_quantity"], 5)

    def test_last_done_at_creates_backdated_entry(self):
        """When last_done_at is provided, a RoutineEntry is created with that timestamp."""
        backdated = timezone.now() - timedelta(hours=48)
        s = RoutineSerializer(
            data={
                "name": "Water cactus",
                "interval_hours": 336,
                "is_active": True,
                "last_done_at": backdated.isoformat(),
            }
        )
        self.assertTrue(s.is_valid(), s.errors)
        routine = s.save(user=self.user)
        self.assertEqual(routine.entries.count(), 1)
        entry = routine.entries.first()
        self.assertAlmostEqual(entry.created_at.timestamp(), backdated.timestamp(), delta=1)

    def test_last_done_at_omitted_creates_no_entry(self):
        """Without last_done_at, no RoutineEntry is created on routine creation."""
        s = RoutineSerializer(data={"name": "Oil change", "interval_hours": 24, "is_active": True})
        self.assertTrue(s.is_valid(), s.errors)
        routine = s.save(user=self.user)
        self.assertEqual(routine.entries.count(), 0)

    def test_last_done_at_null_creates_no_entry(self):
        """Explicit null last_done_at also creates no entry."""
        s = RoutineSerializer(
            data={"name": "Oil change", "interval_hours": 24, "is_active": True, "last_done_at": None}
        )
        self.assertTrue(s.is_valid(), s.errors)
        routine = s.save(user=self.user)
        self.assertEqual(routine.entries.count(), 0)

    def test_last_done_at_future_is_invalid(self):
        """A future last_done_at is rejected with a validation error."""
        future = timezone.now() + timedelta(hours=1)
        s = RoutineSerializer(
            data={"name": "Test", "interval_hours": 24, "is_active": True, "last_done_at": future.isoformat()}
        )
        self.assertFalse(s.is_valid())
        self.assertIn("last_done_at", s.errors)

    def test_last_done_at_not_in_read_response(self):
        """last_done_at is write-only and does not appear in serialized output."""
        r = make_routine(self.user)
        data = RoutineSerializer(r).data
        self.assertNotIn("last_done_at", data)

    def test_stock_validation_rejects_other_users_stock(self):
        other_user = make_user(username="other")
        other_stock = make_stock(other_user)

        from django.test import RequestFactory

        factory = RequestFactory()
        request = factory.post("/")
        request.user = self.user

        s = RoutineSerializer(
            data={
                "name": "Test",
                "interval_hours": 24,
                "stock": other_stock.id,
                "stock_usage": 1,
                "is_active": True,
            },
            context={"request": request},
        )
        self.assertFalse(s.is_valid())
        self.assertIn("stock", s.errors)


class SharedWithValidationTest(TestCase):
    """Covers the `validate_shared_with` branches in both StockSerializer
    and RoutineSerializer that are hard to reach from the ViewSet suite:
    (a) no-request context → pass value through unchanged,
    (b) non-owner trying to modify → raise ValidationError.
    """

    def setUp(self):
        self.owner = make_user()
        self.other = make_user(username="other")

    def test_stock_shared_with_no_request_returns_value(self):
        s = StockSerializer()
        # Directly invoke the validator — without a request in context
        # the method must pass the value through unchanged.
        self.assertEqual(s.validate_shared_with([]), [])

    def test_stock_shared_with_non_owner_rejected(self):
        from rest_framework import serializers as drf_serializers
        from rest_framework.test import APIRequestFactory

        stock = make_stock(self.owner)
        request = APIRequestFactory().patch("/")
        request.user = self.other  # not the owner
        s = StockSerializer(instance=stock, context={"request": request})
        with self.assertRaises(drf_serializers.ValidationError):
            s.validate_shared_with([])

    def test_routine_shared_with_no_request_returns_value(self):
        s = RoutineSerializer()
        self.assertEqual(s.validate_shared_with([]), [])

    def test_routine_shared_with_non_owner_rejected(self):
        from rest_framework import serializers as drf_serializers
        from rest_framework.test import APIRequestFactory

        routine = make_routine(self.owner)
        request = APIRequestFactory().patch("/")
        request.user = self.other
        s = RoutineSerializer(instance=routine, context={"request": request})
        with self.assertRaises(drf_serializers.ValidationError):
            s.validate_shared_with([])


# ── Stock ViewSet ─────────────────────────────────────────────────────────────


class StockViewSetTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)

    def test_list_only_own_stocks(self):
        make_stock(self.user, name="Mine")
        make_stock(self.other, name="Theirs")
        response = self.client.get("/api/stock/")
        self.assertEqual(response.status_code, 200)
        names = [s["name"] for s in response.json()["results"]]
        self.assertIn("Mine", names)
        self.assertNotIn("Theirs", names)

    def test_create_stock(self):
        response = self.client.post("/api/stock/", {"name": "New item"})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(Stock.objects.filter(name="New item", user=self.user).exists())

    def test_response_includes_lots_and_expiry_fields(self):
        response = self.client.post("/api/stock/", {"name": "Gadget"})
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertIn("lots", data)
        self.assertIn("expiring_lots", data)
        self.assertIn("stock_severity", data)
        self.assertIn("expiry_severity", data)

    def test_retrieve_own_stock(self):
        stock = make_stock(self.user)
        response = self.client.get(f"/api/stock/{stock.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "Filter")

    def test_retrieve_other_users_stock_returns_404(self):
        stock = make_stock(self.other)
        response = self.client.get(f"/api/stock/{stock.id}/")
        self.assertEqual(response.status_code, 404)

    def test_update_stock_name(self):
        stock = make_stock(self.user)
        response = self.client.patch(f"/api/stock/{stock.id}/", {"name": "Renamed"})
        self.assertEqual(response.status_code, 200)
        stock.refresh_from_db()
        self.assertEqual(stock.name, "Renamed")

    def test_delete_stock(self):
        stock = make_stock(self.user)
        response = self.client.delete(f"/api/stock/{stock.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Stock.objects.filter(pk=stock.id).exists())

    def test_patch_other_users_stock_returns_404(self):
        stock = make_stock(self.other)
        response = self.client.patch(f"/api/stock/{stock.id}/", {"name": "Hacked"})
        self.assertEqual(response.status_code, 404)
        stock.refresh_from_db()
        self.assertNotEqual(stock.name, "Hacked")

    def test_delete_other_users_stock_returns_404(self):
        stock = make_stock(self.other)
        response = self.client.delete(f"/api/stock/{stock.id}/")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Stock.objects.filter(pk=stock.id).exists())

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/stock/")
        self.assertEqual(response.status_code, 401)


# ── StockLot ViewSet ──────────────────────────────────────────────────────────


class StockLotViewSetTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)
        self.stock = make_stock(self.user)

    def test_create_lot(self):
        response = self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5, "lot_number": "LOT-1"},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.stock.lots.count(), 1)
        self.assertEqual(self.stock.lots.first().quantity, 5)

    def test_create_lot_with_expiry(self):
        response = self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3, "expiry_date": "2027-06-01"},
        )
        self.assertEqual(response.status_code, 201)
        lot = self.stock.lots.first()
        self.assertEqual(str(lot.expiry_date), "2027-06-01")

    def test_create_lot_negative_quantity_returns_400(self):
        response = self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": -1},
        )
        self.assertEqual(response.status_code, 400)

    def test_create_lot_other_users_stock_returns_403(self):
        other_stock = make_stock(self.other, name="OtherStock")
        response = self.client.post(
            f"/api/stock/{other_stock.id}/lots/",
            {"quantity": 5},
        )
        self.assertEqual(response.status_code, 403)

    def test_partial_update_lot(self):
        lot = make_lot(self.stock, quantity=10)
        response = self.client.patch(
            f"/api/stock/{self.stock.id}/lots/{lot.id}/",
            {"quantity": 7},
        )
        self.assertEqual(response.status_code, 200)
        lot.refresh_from_db()
        self.assertEqual(lot.quantity, 7)

    def test_delete_lot(self):
        lot = make_lot(self.stock, quantity=5)
        response = self.client.delete(f"/api/stock/{self.stock.id}/lots/{lot.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(StockLot.objects.filter(pk=lot.id).exists())

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(f"/api/stock/{self.stock.id}/lots/", {"quantity": 1})
        self.assertEqual(response.status_code, 401)

    # ── Lot dedup (T012) ────────────────────────────────────────────────────

    def test_create_lot_merges_same_lot_number_and_expiry(self):
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5, "lot_number": "LOT-A", "expiry_date": "2027-06-01"},
        )
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3, "lot_number": "LOT-A", "expiry_date": "2027-06-01"},
        )
        self.assertEqual(self.stock.lots.count(), 1)
        self.assertEqual(self.stock.lots.first().quantity, 8)

    def test_create_lot_different_expiry_creates_new(self):
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5, "lot_number": "LOT-A", "expiry_date": "2027-06-01"},
        )
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3, "lot_number": "LOT-A", "expiry_date": "2027-12-01"},
        )
        self.assertEqual(self.stock.lots.count(), 2)

    def test_create_lot_empty_lot_number_same_expiry_merges(self):
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5, "expiry_date": "2027-06-01"},
        )
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3, "expiry_date": "2027-06-01"},
        )
        self.assertEqual(self.stock.lots.count(), 1)
        self.assertEqual(self.stock.lots.first().quantity, 8)

    def test_create_lot_empty_lot_number_different_expiry_creates_new(self):
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5, "expiry_date": "2027-06-01"},
        )
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3, "expiry_date": "2027-12-01"},
        )
        self.assertEqual(self.stock.lots.count(), 2)

    def test_create_lot_empty_lot_number_null_expiry_merges(self):
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5},
        )
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3},
        )
        self.assertEqual(self.stock.lots.count(), 1)
        self.assertEqual(self.stock.lots.first().quantity, 8)

    def test_create_lot_same_lot_number_no_expiry_merges(self):
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5, "lot_number": "LOT-A"},
        )
        self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3, "lot_number": "LOT-A"},
        )
        self.assertEqual(self.stock.lots.count(), 1)
        self.assertEqual(self.stock.lots.first().quantity, 8)

    def test_create_lot_merge_returns_updated_data(self):
        res1 = self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 5, "lot_number": "LOT-A", "expiry_date": "2027-06-01"},
        )
        original_id = res1.data["id"]
        res2 = self.client.post(
            f"/api/stock/{self.stock.id}/lots/",
            {"quantity": 3, "lot_number": "LOT-A", "expiry_date": "2027-06-01"},
        )
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(res2.data["id"], original_id)
        self.assertEqual(res2.data["quantity"], 8)


# ── Stock consume / lots-for-selection ───────────────────────────────────────


class StockConsumeTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)
        self.stock = make_stock(self.user)

    # ── consume endpoint ──────────────────────────────────────────────────────

    def test_consume_fefo_single_lot(self):
        make_lot(self.stock, quantity=5)
        response = self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 1})
        self.assertEqual(response.status_code, 200)
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.quantity, 4)

    def test_consume_fefo_respects_expiry_order(self):
        soon = date.today() + timedelta(days=10)
        later = date.today() + timedelta(days=100)
        make_lot(self.stock, quantity=3, expiry_date=later)
        make_lot(self.stock, quantity=3, expiry_date=soon)
        self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 1})
        lots = list(self.stock.lots.order_by("expiry_date"))
        # The lot expiring sooner should have been decremented
        self.assertEqual(lots[0].quantity, 2)
        self.assertEqual(lots[1].quantity, 3)

    def test_consume_fefo_nulls_last(self):
        make_lot(self.stock, quantity=3, expiry_date=None)
        make_lot(self.stock, quantity=3, expiry_date=date.today() + timedelta(days=30))
        self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 1})
        no_expiry = self.stock.lots.get(expiry_date__isnull=True)
        with_expiry = self.stock.lots.get(expiry_date__isnull=False)
        # Lot with expiry should be consumed first (nulls last)
        self.assertEqual(with_expiry.quantity, 2)
        self.assertEqual(no_expiry.quantity, 3)

    def test_consume_fefo_spans_multiple_lots(self):
        make_lot(self.stock, quantity=1, expiry_date=date.today() + timedelta(days=5))
        make_lot(self.stock, quantity=5, expiry_date=date.today() + timedelta(days=50))
        response = self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 3})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.stock.quantity, 3)

    def test_consume_with_lot_selections(self):
        lot = make_lot(self.stock, quantity=5, lot_number="LOT-A")
        response = self.client.post(
            f"/api/stock/{self.stock.id}/consume/",
            {"quantity": 1, "lot_selections": [{"lot_id": lot.id, "quantity": 1}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        lot.refresh_from_db()
        self.assertEqual(lot.quantity, 4)

    def test_consume_lot_selections_wrong_total_returns_400(self):
        lot = make_lot(self.stock, quantity=5, lot_number="LOT-A")
        response = self.client.post(
            f"/api/stock/{self.stock.id}/consume/",
            {"quantity": 2, "lot_selections": [{"lot_id": lot.id, "quantity": 1}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_consume_lot_selections_invalid_lot_returns_400(self):
        other_stock = make_stock(self.other)
        other_lot = make_lot(other_stock, quantity=5)
        response = self.client.post(
            f"/api/stock/{self.stock.id}/consume/",
            {"quantity": 1, "lot_selections": [{"lot_id": other_lot.id, "quantity": 1}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_consume_zero_quantity_returns_400(self):
        response = self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 0})
        self.assertEqual(response.status_code, 400)

    def test_consume_returns_updated_stock_data(self):
        make_lot(self.stock, quantity=10)
        response = self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 3})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["quantity"], 7)
        self.assertIn("lots", data)
        self.assertIn("requires_lot_selection", data)

    def test_consume_other_users_stock_returns_404(self):
        stock = make_stock(self.other)
        make_lot(stock, quantity=5)
        response = self.client.post(f"/api/stock/{stock.id}/consume/", {"quantity": 1})
        self.assertEqual(response.status_code, 404)

    def test_consume_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 1})
        self.assertEqual(response.status_code, 401)

    # ── lots-for-selection endpoint ───────────────────────────────────────────

    def test_lots_for_selection_empty_stock(self):
        response = self.client.get(f"/api/stock/{self.stock.id}/lots-for-selection/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_lots_for_selection_returns_grouped_lots(self):
        lot = make_lot(self.stock, quantity=3, lot_number="LOT-1")
        response = self.client.get(f"/api/stock/{self.stock.id}/lots-for-selection/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["lot_id"], lot.id)
        self.assertEqual(data[0]["lot_number"], "LOT-1")
        self.assertEqual(data[0]["quantity"], 3)

    def test_lots_for_selection_fefo_order(self):
        later = date.today() + timedelta(days=90)
        soon = date.today() + timedelta(days=10)
        make_lot(self.stock, quantity=1, lot_number="LATER", expiry_date=later)
        make_lot(self.stock, quantity=1, lot_number="SOON", expiry_date=soon)
        response = self.client.get(f"/api/stock/{self.stock.id}/lots-for-selection/")
        data = response.json()
        self.assertEqual(data[0]["lot_number"], "SOON")
        self.assertEqual(data[1]["lot_number"], "LATER")

    def test_lots_for_selection_excludes_zero_quantity_lots(self):
        make_lot(self.stock, quantity=0, lot_number="EMPTY")
        make_lot(self.stock, quantity=2, lot_number="FULL")
        response = self.client.get(f"/api/stock/{self.stock.id}/lots-for-selection/")
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["lot_number"], "FULL")
        self.assertEqual(data[0]["quantity"], 2)

    def test_lots_for_selection_other_users_stock_returns_404(self):
        stock = make_stock(self.other)
        response = self.client.get(f"/api/stock/{stock.id}/lots-for-selection/")
        self.assertEqual(response.status_code, 404)

    # ── requires_lot_selection field ─────────────────────────────────────────

    def test_requires_lot_selection_false_with_no_lots(self):
        response = self.client.get(f"/api/stock/{self.stock.id}/")
        self.assertFalse(response.json()["requires_lot_selection"])

    def test_requires_lot_selection_false_with_blank_lot_numbers(self):
        make_lot(self.stock, quantity=5, lot_number="")
        response = self.client.get(f"/api/stock/{self.stock.id}/")
        self.assertFalse(response.json()["requires_lot_selection"])

    def test_requires_lot_selection_true_with_named_lot(self):
        make_lot(self.stock, quantity=5, lot_number="LOT-1")
        response = self.client.get(f"/api/stock/{self.stock.id}/")
        self.assertTrue(response.json()["requires_lot_selection"])

    def test_requires_lot_selection_false_when_named_lot_has_zero_quantity(self):
        make_lot(self.stock, quantity=0, lot_number="LOT-1")
        response = self.client.get(f"/api/stock/{self.stock.id}/")
        self.assertFalse(response.json()["requires_lot_selection"])


# ── Routine ViewSet ───────────────────────────────────────────────────────────


class RoutineViewSetTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)

    def test_list_only_own_routines(self):
        make_routine(self.user, name="Mine")
        make_routine(self.other, name="Theirs")
        response = self.client.get("/api/routines/")
        names = [r["name"] for r in response.json()["results"]]
        self.assertIn("Mine", names)
        self.assertNotIn("Theirs", names)

    def test_create_routine(self):
        response = self.client.post(
            "/api/routines/",
            {
                "name": "Morning run",
                "interval_hours": 24,
                "is_active": True,
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(Routine.objects.filter(name="Morning run", user=self.user).exists())

    def test_retrieve_own_routine(self):
        r = make_routine(self.user, name="My routine")
        response = self.client.get(f"/api/routines/{r.id}/")
        self.assertEqual(response.status_code, 200)

    def test_retrieve_other_users_routine_returns_404(self):
        r = make_routine(self.other)
        response = self.client.get(f"/api/routines/{r.id}/")
        self.assertEqual(response.status_code, 404)

    def test_update_routine(self):
        r = make_routine(self.user)
        response = self.client.patch(f"/api/routines/{r.id}/", {"interval_hours": 48})
        self.assertEqual(response.status_code, 200)
        r.refresh_from_db()
        self.assertEqual(r.interval_hours, 48)

    def test_delete_routine(self):
        r = make_routine(self.user)
        response = self.client.delete(f"/api/routines/{r.id}/")
        self.assertEqual(response.status_code, 204)

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/routines/")
        self.assertEqual(response.status_code, 401)

    def test_patch_other_users_routine_returns_404(self):
        r = make_routine(self.other)
        response = self.client.patch(f"/api/routines/{r.id}/", {"name": "Hacked"})
        self.assertEqual(response.status_code, 404)
        r.refresh_from_db()
        self.assertNotEqual(r.name, "Hacked")

    def test_delete_other_users_routine_returns_404(self):
        r = make_routine(self.other)
        response = self.client.delete(f"/api/routines/{r.id}/")
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Routine.objects.filter(pk=r.id).exists())

    def test_create_with_last_done_at_creates_backdated_entry(self):
        """POST /routines/ with last_done_at creates a RoutineEntry with that timestamp."""
        backdated = timezone.now() - timedelta(hours=48)
        response = self.client.post(
            "/api/routines/",
            {"name": "Water cactus", "interval_hours": 336, "is_active": True, "last_done_at": backdated.isoformat()},
        )
        self.assertEqual(response.status_code, 201)
        routine = Routine.objects.get(pk=response.json()["id"])
        self.assertEqual(routine.entries.count(), 1)
        self.assertAlmostEqual(
            routine.entries.first().created_at.timestamp(),
            backdated.timestamp(),
            delta=1,
        )

    def test_create_with_recent_last_done_at_not_due(self):
        """A new routine with a recent last_done_at should not be immediately due."""
        recent = timezone.now() - timedelta(hours=2)
        response = self.client.post(
            "/api/routines/",
            {"name": "Water cactus", "interval_hours": 336, "is_active": True, "last_done_at": recent.isoformat()},
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["is_due"])

    def test_create_without_last_done_at_is_due_immediately(self):
        """A new routine without last_done_at is due immediately."""
        response = self.client.post(
            "/api/routines/",
            {"name": "Water cactus", "interval_hours": 336, "is_active": True},
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["is_due"])

    def test_create_with_future_last_done_at_returns_400(self):
        """A future last_done_at is rejected."""
        future = timezone.now() + timedelta(hours=1)
        response = self.client.post(
            "/api/routines/",
            {"name": "Water cactus", "interval_hours": 336, "is_active": True, "last_done_at": future.isoformat()},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("last_done_at", response.json())

    def test_log_other_users_routine_returns_404(self):
        r = make_routine(self.other)
        response = self.client.post(f"/api/routines/{r.id}/log/", {})
        self.assertEqual(response.status_code, 404)

    # ── log action ────────────────────────────────────────────────────────────

    def test_log_creates_entry(self):
        r = make_routine(self.user)
        response = self.client.post(f"/api/routines/{r.id}/log/", {"notes": "Done"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(r.entries.count(), 1)
        self.assertEqual(r.entries.first().notes, "Done")

    def test_log_returns_entry_data(self):
        r = make_routine(self.user)
        response = self.client.post(f"/api/routines/{r.id}/log/", {})
        data = response.json()
        self.assertIn("id", data)
        self.assertIn("created_at", data)

    def test_log_decrements_stock_fefo(self):
        """FEFO: the lot with sooner expiry is consumed first."""
        stock = make_stock(self.user)
        early = make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=30))
        late = make_lot(stock, quantity=10, expiry_date=date.today() + timedelta(days=120))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 3
        r.save()
        self.client.post(f"/api/routines/{r.id}/log/", {})
        early.refresh_from_db()
        late.refresh_from_db()
        self.assertEqual(early.quantity, 2)  # 5 - 3
        self.assertEqual(late.quantity, 10)  # untouched

    def test_log_fefo_spans_multiple_lots(self):
        """FEFO: continues into next lot when first is exhausted."""
        stock = make_stock(self.user)
        early = make_lot(stock, quantity=2, expiry_date=date.today() + timedelta(days=30))
        early_id = early.pk
        late = make_lot(stock, quantity=10, expiry_date=date.today() + timedelta(days=120))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 5
        r.save()
        self.client.post(f"/api/routines/{r.id}/log/", {})
        # early lot was fully consumed → auto-deleted
        self.assertFalse(StockLot.objects.filter(pk=early_id).exists())
        late.refresh_from_db()
        self.assertEqual(late.quantity, 7)  # 10 - 3 (remaining after early)

    def test_log_fefo_no_expiry_lots_consumed_last(self):
        """Lots without expiry are consumed only after lots with expiry."""
        stock = make_stock(self.user)
        no_expiry = make_lot(stock, quantity=10)
        with_expiry = make_lot(stock, quantity=3, expiry_date=date.today() + timedelta(days=60))
        with_expiry_id = with_expiry.pk
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 3
        r.save()
        self.client.post(f"/api/routines/{r.id}/log/", {})
        # with_expiry lot was fully consumed → auto-deleted
        self.assertFalse(StockLot.objects.filter(pk=with_expiry_id).exists())
        no_expiry.refresh_from_db()
        self.assertEqual(no_expiry.quantity, 10)  # untouched

    def test_log_refuses_when_stock_insufficient(self):
        """T036: logging is refused when stock_usage exceeds available quantity.

        Previously the backend would silently cap consumption at the available
        amount, logging an entry while leaving the stock empty. That produced
        misleading history (the entry claims a consumption that didn't fully
        happen) and hid inventory problems from the user. The log action now
        returns 422 and leaves both the entries and the stock untouched.
        """
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=2)
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 10
        r.save()
        response = self.client.post(f"/api/routines/{r.id}/log/", {})
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["code"], "insufficient_stock")
        self.assertEqual(body["required"], 10)
        self.assertEqual(body["available"], 2)
        # No entry created; lot untouched.
        self.assertEqual(r.entries.count(), 0)
        lot.refresh_from_db()
        self.assertEqual(lot.quantity, 2)

    def test_log_refuses_when_stock_is_zero(self):
        """Pain-relief-like scenario: stock exists but every lot is 0."""
        stock = make_stock(self.user)
        # A lot explicitly at 0 — normally wiped by `delete_empty_lot`, but
        # we bypass that via bulk_create to emulate the T073 seed state.
        StockLot.objects.bulk_create([StockLot(stock=stock, quantity=0, lot_number="IBU-1")])
        r = make_routine(self.user, stock=stock)
        response = self.client.post(f"/api/routines/{r.id}/log/", {})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(r.entries.count(), 0)

    def test_log_resets_notification_state(self):
        r = make_routine(self.user)
        state = NotificationState.objects.create(
            routine=r,
            last_due_notification=timezone.now(),
            last_reminder=timezone.now(),
        )
        self.client.post(f"/api/routines/{r.id}/log/", {})
        state.refresh_from_db()
        self.assertIsNone(state.last_due_notification)
        self.assertIsNone(state.last_reminder)

    def test_log_no_stock_does_not_error(self):
        r = make_routine(self.user, stock=None)
        response = self.client.post(f"/api/routines/{r.id}/log/", {})
        self.assertEqual(response.status_code, 201)

    # ── requires_lot_selection ────────────────────────────────────────────────

    def test_requires_lot_selection_true(self):
        """Stock with at least one lot with lot_number → True."""
        stock = make_stock(self.user)
        make_lot(stock, quantity=5, lot_number="RTEW32")
        r = make_routine(self.user, stock=stock)
        response = self.client.get(f"/api/routines/{r.id}/")
        self.assertTrue(response.json()["requires_lot_selection"])

    def test_requires_lot_selection_false_no_lot_number(self):
        """All lots without lot_number → False."""
        stock = make_stock(self.user)
        make_lot(stock, quantity=5)
        r = make_routine(self.user, stock=stock)
        response = self.client.get(f"/api/routines/{r.id}/")
        self.assertFalse(response.json()["requires_lot_selection"])

    def test_requires_lot_selection_false_no_stock(self):
        """Routine without stock → False."""
        r = make_routine(self.user, stock=None)
        response = self.client.get(f"/api/routines/{r.id}/")
        self.assertFalse(response.json()["requires_lot_selection"])

    def test_requires_lot_selection_false_zero_quantity_lot(self):
        """Lot with lot_number but quantity=0 → False."""
        stock = make_stock(self.user)
        make_lot(stock, quantity=0, lot_number="RTEW32")
        r = make_routine(self.user, stock=stock)
        response = self.client.get(f"/api/routines/{r.id}/")
        self.assertFalse(response.json()["requires_lot_selection"])

    # ── lots_for_selection action ─────────────────────────────────────────────

    def test_lots_for_selection_returns_grouped_lots(self):
        """Each lot becomes one row with its quantity."""
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=2, lot_number="LOT-A")
        r = make_routine(self.user, stock=stock)
        response = self.client.get(f"/api/routines/{r.id}/lots-for-selection/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["lot_id"], lot.id)
        self.assertEqual(data[0]["lot_number"], "LOT-A")
        self.assertEqual(data[0]["quantity"], 2)

    def test_lots_for_selection_fefo_order(self):
        """Lots are returned in FEFO order (sooner expiry first)."""
        stock = make_stock(self.user)
        late = make_lot(stock, quantity=1, expiry_date=date.today() + timedelta(days=120), lot_number="LATE")
        early = make_lot(stock, quantity=1, expiry_date=date.today() + timedelta(days=30), lot_number="EARLY")
        r = make_routine(self.user, stock=stock)
        response = self.client.get(f"/api/routines/{r.id}/lots-for-selection/")
        data = response.json()
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["lot_id"], early.id)
        self.assertEqual(data[1]["lot_id"], late.id)

    def test_lots_for_selection_excludes_zero_quantity(self):
        """Lots with quantity=0 are excluded."""
        stock = make_stock(self.user)
        make_lot(stock, quantity=0, lot_number="EMPTY")
        make_lot(stock, quantity=3, lot_number="FULL")
        r = make_routine(self.user, stock=stock)
        response = self.client.get(f"/api/routines/{r.id}/lots-for-selection/")
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["lot_number"], "FULL")
        self.assertEqual(data[0]["quantity"], 3)

    def test_lots_for_selection_no_stock_returns_empty(self):
        """Routine without stock → empty list."""
        r = make_routine(self.user, stock=None)
        response = self.client.get(f"/api/routines/{r.id}/lots-for-selection/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_lots_for_selection_no_lot_number_returns_null(self):
        """Lots without lot_number are served with lot_number: null."""
        stock = make_stock(self.user)
        make_lot(stock, quantity=1)
        r = make_routine(self.user, stock=stock)
        response = self.client.get(f"/api/routines/{r.id}/lots-for-selection/")
        data = response.json()
        self.assertIsNone(data[0]["lot_number"])

    # ── log with lot_selections ───────────────────────────────────────────────

    def test_log_with_lot_selections(self):
        """Specified lots are decremented by given quantities."""
        stock = make_stock(self.user)
        lot1 = make_lot(stock, quantity=5, lot_number="LOT-1")
        lot2 = make_lot(stock, quantity=5, lot_number="LOT-2")
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 3
        r.save()
        response = self.client.post(
            f"/api/routines/{r.id}/log/",
            {"lot_selections": [{"lot_id": lot1.id, "quantity": 2}, {"lot_id": lot2.id, "quantity": 1}]},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        lot1.refresh_from_db()
        lot2.refresh_from_db()
        self.assertEqual(lot1.quantity, 3)
        self.assertEqual(lot2.quantity, 4)

    def test_log_with_lot_selections_stores_consumed_lots(self):
        """consumed_lots is saved with lot detail on manual selection."""
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=5, lot_number="RTEW32", expiry_date=date.today() + timedelta(days=60))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 2
        r.save()
        response = self.client.post(
            f"/api/routines/{r.id}/log/",
            {"lot_selections": [{"lot_id": lot.id, "quantity": 2}]},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(len(data["consumed_lots"]), 1)
        self.assertEqual(data["consumed_lots"][0]["lot_number"], "RTEW32")
        self.assertEqual(data["consumed_lots"][0]["quantity"], 2)

    def test_log_lot_selections_invalid_sum(self):
        """Sum of lot_selections quantities != stock_usage → 400."""
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=10, lot_number="LOT-1")
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 3
        r.save()
        response = self.client.post(
            f"/api/routines/{r.id}/log/",
            {"lot_selections": [{"lot_id": lot.id, "quantity": 2}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("lot_selections", response.json())

    def test_log_lot_selection_wrong_stock(self):
        """lot_id belonging to a different stock → 400."""
        stock = make_stock(self.user)
        # Give `stock` enough inventory so the insufficient-stock guard
        # (T036) doesn't fire first — the test is specifically about
        # rejecting a cross-stock lot_id, not about empty stock.
        make_lot(stock, quantity=5, lot_number="OWN")
        other_stock = make_stock(self.user, name="OtherStock")
        other_lot = make_lot(other_stock, quantity=10, lot_number="OTHER")
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 1
        r.save()
        response = self.client.post(
            f"/api/routines/{r.id}/log/",
            {"lot_selections": [{"lot_id": other_lot.id, "quantity": 1}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("lot_selections", response.json())

    def test_log_fefo_stores_consumed_lots(self):
        """FEFO auto-consumption also saves consumed_lots for traceability."""
        stock = make_stock(self.user)
        make_lot(stock, quantity=5, lot_number="LOT-1", expiry_date=date.today() + timedelta(days=30))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 2
        r.save()
        response = self.client.post(f"/api/routines/{r.id}/log/", {})
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(len(data["consumed_lots"]), 1)
        self.assertEqual(data["consumed_lots"][0]["lot_number"], "LOT-1")
        self.assertEqual(data["consumed_lots"][0]["quantity"], 2)

    # ── entries action ────────────────────────────────────────────────────────

    def test_entries_returns_list(self):
        r = make_routine(self.user)
        make_entry(r)
        make_entry(r)
        response = self.client.get(f"/api/routines/{r.id}/entries/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        count = data.get("count", len(data))
        self.assertEqual(count, 2)

    def test_entries_only_for_own_routine(self):
        other_routine = make_routine(self.other)
        response = self.client.get(f"/api/routines/{other_routine.id}/entries/")
        self.assertEqual(response.status_code, 404)


# ── RoutineEntry ViewSet ──────────────────────────────────────────────────────


class RoutineEntryViewSetTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)

    def test_list_returns_own_entries_only(self):
        my_routine = make_routine(self.user)
        other_routine = make_routine(self.other)
        make_entry(my_routine)
        make_entry(other_routine)
        response = self.client.get("/api/entries/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        for entry in data.get("results", data):
            self.assertEqual(
                Routine.objects.get(pk=entry["routine"]).user_id,
                self.user.id,
            )

    def test_read_only_post_not_allowed(self):
        response = self.client.post("/api/entries/", {})
        self.assertEqual(response.status_code, 405)

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/entries/")
        self.assertEqual(response.status_code, 401)

    # ── destroy / undo ────────────────────────────────────────────────────────

    def test_destroy_entry_without_stock(self):
        """An entry with no stock reference just disappears on DELETE."""
        r = make_routine(self.user, stock=None)
        entry = make_entry(r, notes="to undo")
        response = self.client.delete(f"/api/entries/{entry.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(RoutineEntry.objects.filter(pk=entry.pk).exists())

    def test_destroy_entry_restores_existing_lot_quantity(self):
        """Undoing a log increments the original lot's quantity back."""
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=10, lot_number="A1", expiry_date=date.today() + timedelta(days=30))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 1
        r.save()
        # Perform an actual log so consumed_lots is populated correctly.
        log_response = self.client.post(f"/api/routines/{r.id}/log/", {})
        self.assertEqual(log_response.status_code, 201)
        lot.refresh_from_db()
        self.assertEqual(lot.quantity, 9)
        entry_id = log_response.json()["id"]

        # Undo.
        response = self.client.delete(f"/api/entries/{entry_id}/")
        self.assertEqual(response.status_code, 204)
        lot.refresh_from_db()
        self.assertEqual(lot.quantity, 10)

    def test_destroy_entry_recreates_auto_deleted_lot(self):
        """When the last unit of a lot is consumed, the `delete_empty_lot`
        signal removes it. Undo must re-create the lot with the same
        lot_number + expiry_date and the original quantity.
        """
        stock = make_stock(self.user)
        make_lot(stock, quantity=1, lot_number="ONLY", expiry_date=date.today() + timedelta(days=10))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 1
        r.save()
        log_response = self.client.post(f"/api/routines/{r.id}/log/", {})
        self.assertEqual(log_response.status_code, 201)
        # Lot was auto-deleted because it hit zero.
        self.assertEqual(stock.lots.count(), 0)
        entry_id = log_response.json()["id"]

        response = self.client.delete(f"/api/entries/{entry_id}/")
        self.assertEqual(response.status_code, 204)
        # Lot is back.
        self.assertEqual(stock.lots.count(), 1)
        restored = stock.lots.first()
        self.assertEqual(restored.lot_number, "ONLY")
        self.assertEqual(restored.quantity, 1)

    def test_destroy_other_users_entry_returns_403_or_404(self):
        """Shared users (or strangers) can't undo the owner's log."""
        r_other = make_routine(self.other)
        entry = make_entry(r_other)
        response = self.client.delete(f"/api/entries/{entry.id}/")
        # get_queryset scopes to (own routines OR shared-with). Stranger
        # can't see the entry at all → 404.
        self.assertEqual(response.status_code, 404)


# ── Dashboard view ────────────────────────────────────────────────────────────


class DashboardViewTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)

    def test_dashboard_returns_due_and_upcoming(self):
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("due", data)
        self.assertIn("upcoming", data)

    def test_never_logged_routine_in_due(self):
        make_routine(self.user, name="Never done", interval_hours=24)
        response = self.client.get("/api/dashboard/")
        due_names = [r["name"] for r in response.json()["due"]]
        self.assertIn("Never done", due_names)

    def test_recent_entry_routine_in_upcoming(self):
        r = make_routine(self.user, name="Just done", interval_hours=48)
        make_entry(r)
        response = self.client.get("/api/dashboard/")
        upcoming_names = [r["name"] for r in response.json()["upcoming"]]
        self.assertIn("Just done", upcoming_names)

    def test_inactive_routines_excluded(self):
        make_routine(self.user, name="Inactive", interval_hours=24, is_active=False)
        response = self.client.get("/api/dashboard/")
        data = response.json()
        all_names = [r["name"] for r in data["due"] + data["upcoming"]]
        self.assertNotIn("Inactive", all_names)

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 401)

    def test_upcoming_sorted_by_next_due_at(self):
        r1 = make_routine(self.user, name="Soon", interval_hours=48)
        r2 = make_routine(self.user, name="Later", interval_hours=200)
        make_entry(r1)
        make_entry(r2)
        response = self.client.get("/api/dashboard/")
        upcoming = response.json()["upcoming"]
        names = [r["name"] for r in upcoming]
        self.assertLess(names.index("Soon"), names.index("Later"))

    def test_dashboard_only_shows_own_routines(self):
        other = make_user(username="other")
        make_routine(other, name="Not mine", interval_hours=1)
        response = self.client.get("/api/dashboard/")
        data = response.json()
        all_names = [r["name"] for r in data["due"] + data["upcoming"]]
        self.assertNotIn("Not mine", all_names)

    def test_due_today_before_time_appears_in_due(self):
        """A routine due later today should appear in 'due', not 'upcoming'."""
        # Pin to 10:00 UTC so due at 13:00 is still today
        fixed_now = dt.datetime(2026, 3, 4, 10, 0, tzinfo=dt.timezone.utc)
        with patch("django.utils.timezone.now", return_value=fixed_now):
            r = make_routine(self.user, name="Due later today", interval_hours=8)
            make_entry(r, offset_hours=-5)
            response = self.client.get("/api/dashboard/")
            data = response.json()
            due_names = [r["name"] for r in data["due"]]
            upcoming_names = [r["name"] for r in data["upcoming"]]
            self.assertIn("Due later today", due_names)
            self.assertNotIn("Due later today", upcoming_names)

    def test_due_today_has_is_overdue_false(self):
        """A routine due later today should have is_overdue=False."""
        # Pin to 10:00 UTC so due at 13:00 is still today
        fixed_now = dt.datetime(2026, 3, 4, 10, 0, tzinfo=dt.timezone.utc)
        with patch("django.utils.timezone.now", return_value=fixed_now):
            r = make_routine(self.user, name="Not yet overdue", interval_hours=8)
            make_entry(r, offset_hours=-5)  # due in 3 hours
            response = self.client.get("/api/dashboard/")
            routine_data = response.json()["due"][0]
            self.assertTrue(routine_data["is_due"])
            self.assertFalse(routine_data["is_overdue"])

    def test_overdue_has_is_overdue_true(self):
        """A routine past its due time should have is_overdue=True."""
        r = make_routine(self.user, name="Already overdue", interval_hours=1)
        make_entry(r, offset_hours=-3)  # due 2 hours ago
        response = self.client.get("/api/dashboard/")
        routine_data = response.json()["due"][0]
        self.assertTrue(routine_data["is_due"])
        self.assertTrue(routine_data["is_overdue"])

    def test_is_overdue_field_present_in_response(self):
        """The is_overdue field must be present in all routine responses."""
        make_routine(self.user, name="Test", interval_hours=24)
        response = self.client.get("/api/dashboard/")
        routine_data = response.json()["due"][0]
        self.assertIn("is_overdue", routine_data)


# ── StockGroup API ──────────────────────────────────────────────────────────


class StockGroupAPITest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)

    def test_list_groups(self):
        make_stock_group(self.user, name="Mine")
        make_stock_group(self.other, name="Theirs")
        response = self.client.get("/api/stock-groups/")
        self.assertEqual(response.status_code, 200)
        names = [g["name"] for g in response.json()["results"]]
        self.assertIn("Mine", names)
        self.assertNotIn("Theirs", names)

    def test_create_group(self):
        response = self.client.post("/api/stock-groups/", {"name": "Household"})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(StockGroup.objects.filter(name="Household", user=self.user).exists())

    def test_update_group(self):
        group = make_stock_group(self.user, name="Old name")
        response = self.client.patch(f"/api/stock-groups/{group.id}/", {"name": "New name"})
        self.assertEqual(response.status_code, 200)
        group.refresh_from_db()
        self.assertEqual(group.name, "New name")

    def test_delete_group_ungroups_stocks(self):
        group = make_stock_group(self.user, name="Deletable")
        stock = make_stock(self.user, name="Item")
        stock.group = group
        stock.save()
        response = self.client.delete(f"/api/stock-groups/{group.id}/")
        self.assertEqual(response.status_code, 204)
        stock.refresh_from_db()
        self.assertIsNone(stock.group)

    def test_cannot_access_other_users_groups(self):
        group = make_stock_group(self.other, name="Secret")
        response = self.client.get(f"/api/stock-groups/{group.id}/")
        self.assertEqual(response.status_code, 404)

    def test_assign_group_to_stock(self):
        group = make_stock_group(self.user, name="Diabetes")
        stock = make_stock(self.user, name="Insulin")
        response = self.client.patch(f"/api/stock/{stock.id}/", {"group": group.id})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["group"], group.id)
        self.assertEqual(response.json()["group_name"], "Diabetes")

    def test_assign_other_users_group_returns_400(self):
        group = make_stock_group(self.other, name="Not mine")
        stock = make_stock(self.user, name="Mine")
        response = self.client.patch(f"/api/stock/{stock.id}/", {"group": group.id})
        self.assertEqual(response.status_code, 400)

    def test_stock_without_group_returns_null(self):
        stock = make_stock(self.user, name="Ungrouped")
        response = self.client.get(f"/api/stock/{stock.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["group"])
        self.assertIsNone(response.json()["group_name"])

    def test_reorder_group(self):
        group = make_stock_group(self.user, name="Reorder me", display_order=0)
        response = self.client.patch(f"/api/stock-groups/{group.id}/", {"display_order": 5})
        self.assertEqual(response.status_code, 200)
        group.refresh_from_db()
        self.assertEqual(group.display_order, 5)


# ── StockConsumption model ─────────────────────────────────────────────────


class StockConsumptionModelTest(TestCase):
    def setUp(self):
        self.user = make_user()
        self.stock = make_stock(self.user)
        make_lot(self.stock, quantity=10)

    def test_str(self):
        c = make_stock_consumption(self.stock, quantity=2)
        self.assertIn("Filter", str(c))
        self.assertIn("consumed 2", str(c))

    def test_ordering_newest_first(self):
        c1 = make_stock_consumption(self.stock, quantity=1)
        c2 = make_stock_consumption(self.stock, quantity=2)
        # Force c1 to be older
        StockConsumption.objects.filter(pk=c1.pk).update(created_at=timezone.now() - timedelta(hours=1))
        qs = list(StockConsumption.objects.filter(stock=self.stock))
        self.assertEqual(qs[0], c2)
        self.assertEqual(qs[1], c1)

    def test_effective_created_at_prefers_client_timestamp(self):
        consumption = StockConsumption.objects.create(
            stock=self.stock,
            consumed_by=self.user,
            quantity=1,
            client_created_at=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
        )
        self.assertEqual(
            consumption.effective_created_at,
            dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
        )

    def test_effective_created_at_falls_back_to_created_at(self):
        # Server-initiated consumption with no client timestamp → falls back.
        consumption = StockConsumption.objects.create(
            stock=self.stock,
            consumed_by=self.user,
            quantity=1,
        )
        self.assertIsNone(consumption.client_created_at)
        self.assertEqual(consumption.effective_created_at, consumption.created_at)


# ── Stock consume audit trail ──────────────────────────────────────────────


class StockConsumeAuditTest(APITestCase):
    """Tests that consume() creates StockConsumption audit records."""

    def setUp(self):
        self.user = make_user()
        self.client.force_authenticate(user=self.user)
        self.stock = make_stock(self.user)

    def test_consume_creates_audit_record(self):
        make_lot(self.stock, quantity=10)
        self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 2})
        self.assertEqual(StockConsumption.objects.count(), 1)
        c = StockConsumption.objects.first()
        self.assertEqual(c.stock, self.stock)
        self.assertEqual(c.quantity, 2)

    def test_consume_with_lot_selections_creates_audit_record(self):
        lot = make_lot(self.stock, quantity=5, lot_number="LOT-A", expiry_date=date.today() + timedelta(days=60))
        self.client.post(
            f"/api/stock/{self.stock.id}/consume/",
            {"quantity": 2, "lot_selections": [{"lot_id": lot.id, "quantity": 2}]},
            format="json",
        )
        self.assertEqual(StockConsumption.objects.count(), 1)
        c = StockConsumption.objects.first()
        self.assertEqual(c.quantity, 2)
        self.assertEqual(len(c.consumed_lots), 1)
        self.assertEqual(c.consumed_lots[0]["lot_number"], "LOT-A")
        self.assertEqual(c.consumed_lots[0]["quantity"], 2)

    def test_consume_fefo_creates_audit_record(self):
        soon = date.today() + timedelta(days=10)
        later = date.today() + timedelta(days=100)
        make_lot(self.stock, quantity=3, expiry_date=soon, lot_number="SOON")
        make_lot(self.stock, quantity=5, expiry_date=later, lot_number="LATER")
        self.client.post(f"/api/stock/{self.stock.id}/consume/", {"quantity": 4})
        c = StockConsumption.objects.first()
        self.assertEqual(c.quantity, 4)
        self.assertEqual(len(c.consumed_lots), 2)
        # FEFO: SOON consumed first (3 units), then LATER (1 unit)
        self.assertEqual(c.consumed_lots[0]["lot_number"], "SOON")
        self.assertEqual(c.consumed_lots[0]["quantity"], 3)
        self.assertEqual(c.consumed_lots[1]["lot_number"], "LATER")
        self.assertEqual(c.consumed_lots[1]["quantity"], 1)


# ── StockConsumption API ───────────────────────────────────────────────────


class StockConsumptionAPITest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)
        self.stock = make_stock(self.user)

    def test_list_consumptions(self):
        make_stock_consumption(self.stock, quantity=1)
        make_stock_consumption(self.stock, quantity=2)
        response = self.client.get("/api/stock-consumptions/")
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual(len(results), 2)

    def test_filter_by_stock(self):
        other_stock = make_stock(self.user, name="Other")
        make_stock_consumption(self.stock, quantity=1)
        make_stock_consumption(other_stock, quantity=1)
        response = self.client.get(f"/api/stock-consumptions/?stock={self.stock.id}")
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["stock"], self.stock.id)

    def test_consumptions_scoped_to_user(self):
        other_stock = make_stock(self.other, name="Secret")
        make_stock_consumption(other_stock, quantity=1)
        response = self.client.get("/api/stock-consumptions/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 0)

    def test_patch_notes(self):
        c = make_stock_consumption(self.stock, quantity=1)
        response = self.client.patch(
            f"/api/stock-consumptions/{c.id}/",
            {"notes": "edited note"},
        )
        self.assertEqual(response.status_code, 200)
        c.refresh_from_db()
        self.assertEqual(c.notes, "edited note")

    def test_cannot_patch_quantity(self):
        c = make_stock_consumption(self.stock, quantity=3)
        self.client.patch(
            f"/api/stock-consumptions/{c.id}/",
            {"quantity": 999},
        )
        c.refresh_from_db()
        self.assertEqual(c.quantity, 3)

    def test_empty_consumptions(self):
        response = self.client.get("/api/stock-consumptions/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 0)

    def test_cannot_patch_other_users_consumption(self):
        other_stock = make_stock(self.other, name="Other")
        c = make_stock_consumption(other_stock, quantity=1)
        response = self.client.patch(
            f"/api/stock-consumptions/{c.id}/",
            {"notes": "hacked"},
        )
        self.assertEqual(response.status_code, 404)

    def test_stock_name_in_response(self):
        make_stock_consumption(self.stock, quantity=1)
        response = self.client.get("/api/stock-consumptions/")
        self.assertEqual(response.json()["results"][0]["stock_name"], "Filter")


# ── RoutineEntry notes editing ─────────────────────────────────────────────


class RoutineEntryNotesTest(APITestCase):
    def setUp(self):
        self.user = make_user()
        self.other = make_user(username="other")
        self.client.force_authenticate(user=self.user)
        self.routine = make_routine(self.user)

    def test_patch_notes(self):
        entry = make_entry(self.routine, notes="original")
        response = self.client.patch(
            f"/api/entries/{entry.id}/",
            {"notes": "edited"},
        )
        self.assertEqual(response.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual(entry.notes, "edited")

    def test_cannot_patch_created_at(self):
        entry = make_entry(self.routine)
        original_ts = entry.created_at
        response = self.client.patch(
            f"/api/entries/{entry.id}/",
            {"created_at": "2020-01-01T00:00:00Z"},
        )
        self.assertEqual(response.status_code, 200)
        entry.refresh_from_db()
        self.assertAlmostEqual(entry.created_at.timestamp(), original_ts.timestamp(), delta=1)

    def test_cannot_patch_other_users_entry(self):
        other_routine = make_routine(self.other)
        entry = make_entry(other_routine)
        response = self.client.patch(
            f"/api/entries/{entry.id}/",
            {"notes": "hacked"},
        )
        self.assertEqual(response.status_code, 404)


# ── Shared Routines ─────────────────────────────────────────────────────────


class SharedRoutineTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="pass")
        self.bob = User.objects.create_user(username="bob", password="pass")
        self.carol = User.objects.create_user(username="carol", password="pass")
        # alice and bob are contacts
        self.alice.contacts.add(self.bob)
        self.routine = make_routine(self.alice, name="Shared routine")
        self.stock = make_stock(self.alice, name="Shared filter")
        make_lot(self.stock, quantity=100)
        self.routine.stock = self.stock
        self.routine.save()
        self.routine.shared_with.add(self.bob)
        self.client.force_authenticate(user=self.bob)

    def test_list_includes_shared_routines(self):
        response = self.client.get("/api/routines/")
        self.assertEqual(response.status_code, 200)
        names = [r["name"] for r in response.json()["results"]]
        self.assertIn("Shared routine", names)

    def test_create_is_personal(self):
        response = self.client.post(
            "/api/routines/",
            {
                "name": "Bob's routine",
                "interval_hours": 24,
            },
        )
        self.assertEqual(response.status_code, 201)
        routine = Routine.objects.get(name="Bob's routine")
        self.assertEqual(routine.user, self.bob)

    def test_share_with_contact(self):
        self.client.force_authenticate(user=self.alice)
        routine = make_routine(self.alice, name="New shared")
        response = self.client.patch(
            f"/api/routines/{routine.id}/",
            {"shared_with": [self.bob.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(self.bob, routine.shared_with.all())

    def test_share_with_non_contact(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.patch(
            f"/api/routines/{self.routine.id}/",
            {"shared_with": [self.carol.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_owner_can_update(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.patch(
            f"/api/routines/{self.routine.id}/",
            {"name": "Updated name"},
        )
        self.assertEqual(response.status_code, 200)

    def test_shared_user_cannot_update(self):
        response = self.client.patch(
            f"/api/routines/{self.routine.id}/",
            {"name": "Hacked name"},
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_delete(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.delete(f"/api/routines/{self.routine.id}/")
        self.assertEqual(response.status_code, 204)

    def test_shared_user_cannot_delete(self):
        response = self.client.delete(f"/api/routines/{self.routine.id}/")
        self.assertEqual(response.status_code, 403)

    def test_shared_user_can_log(self):
        response = self.client.post(f"/api/routines/{self.routine.id}/log/")
        self.assertEqual(response.status_code, 201)

    def test_log_sets_completed_by(self):
        self.client.post(f"/api/routines/{self.routine.id}/log/")
        entry = RoutineEntry.objects.filter(routine=self.routine).order_by("-created_at").first()
        self.assertEqual(entry.completed_by, self.bob)

    def test_dashboard_includes_shared_routines(self):
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 200)
        all_names = [r["name"] for r in response.json()["due"] + response.json()["upcoming"]]
        self.assertIn("Shared routine", all_names)

    def test_entries_include_shared_routine_entries(self):
        RoutineEntry.objects.create(routine=self.routine, completed_by=self.alice)
        response = self.client.get("/api/entries/")
        self.assertEqual(response.status_code, 200)
        routine_ids = [e["routine"] for e in response.json()["results"]]
        self.assertIn(self.routine.id, routine_ids)


# ── Shared Stocks ────────────────────────────────────────────────────────────


class SharedStockTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="pass")
        self.bob = User.objects.create_user(username="bob", password="pass")
        self.carol = User.objects.create_user(username="carol", password="pass")
        self.alice.contacts.add(self.bob)
        self.stock = make_stock(self.alice, name="Shared stock")
        make_lot(self.stock, quantity=50)
        self.stock.shared_with.add(self.bob)
        self.client.force_authenticate(user=self.bob)

    def test_list_includes_shared_stocks(self):
        response = self.client.get("/api/stock/")
        self.assertEqual(response.status_code, 200)
        names = [s["name"] for s in response.json()["results"]]
        self.assertIn("Shared stock", names)

    def test_share_with_contact(self):
        self.client.force_authenticate(user=self.alice)
        stock = make_stock(self.alice, name="New shared stock")
        response = self.client.patch(
            f"/api/stock/{stock.id}/",
            {"shared_with": [self.bob.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(self.bob, stock.shared_with.all())

    def test_share_with_non_contact(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.patch(
            f"/api/stock/{self.stock.id}/",
            {"shared_with": [self.carol.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_owner_can_update(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.patch(
            f"/api/stock/{self.stock.id}/",
            {"name": "Updated stock"},
        )
        self.assertEqual(response.status_code, 200)

    def test_shared_user_cannot_update(self):
        response = self.client.patch(
            f"/api/stock/{self.stock.id}/",
            {"name": "Hacked stock"},
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_delete(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.delete(f"/api/stock/{self.stock.id}/")
        self.assertEqual(response.status_code, 204)

    def test_shared_user_cannot_delete(self):
        response = self.client.delete(f"/api/stock/{self.stock.id}/")
        self.assertEqual(response.status_code, 403)

    def test_shared_user_can_consume(self):
        response = self.client.post(
            f"/api/stock/{self.stock.id}/consume/",
            {"quantity": 1},
        )
        self.assertEqual(response.status_code, 200)

    def test_consume_sets_consumed_by(self):
        self.client.post(
            f"/api/stock/{self.stock.id}/consume/",
            {"quantity": 1},
        )
        consumption = StockConsumption.objects.filter(stock=self.stock).order_by("-created_at").first()
        self.assertEqual(consumption.consumed_by, self.bob)

    def test_consumptions_include_shared_stock(self):
        StockConsumption.objects.create(stock=self.stock, consumed_by=self.alice, quantity=1)
        response = self.client.get("/api/stock-consumptions/")
        self.assertEqual(response.status_code, 200)
        stock_ids = [c["stock"] for c in response.json()["results"]]
        self.assertIn(self.stock.id, stock_ids)


# ── Contact Removal Cascade ─────────────────────────────────────────────────


class ContactRemovalCascadeTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="pass")
        self.bob = User.objects.create_user(username="bob", password="pass")
        self.alice.contacts.add(self.bob)

        self.alice_routine = make_routine(self.alice, name="Alice routine")
        self.alice_routine.shared_with.add(self.bob)
        self.alice_stock = make_stock(self.alice, name="Alice stock")
        self.alice_stock.shared_with.add(self.bob)

        self.bob_routine = make_routine(self.bob, name="Bob routine")
        self.bob_routine.shared_with.add(self.alice)
        self.bob_stock = make_stock(self.bob, name="Bob stock")
        self.bob_stock.shared_with.add(self.alice)

    def test_remove_contact_cascades_shared_with(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.delete(f"/api/auth/contacts/{self.bob.pk}/")
        self.assertEqual(response.status_code, 204)

        # Bob removed from Alice's shared items
        self.assertFalse(self.alice_routine.shared_with.filter(pk=self.bob.pk).exists())
        self.assertFalse(self.alice_stock.shared_with.filter(pk=self.bob.pk).exists())

        # Alice removed from Bob's shared items
        self.assertFalse(self.bob_routine.shared_with.filter(pk=self.alice.pk).exists())
        self.assertFalse(self.bob_stock.shared_with.filter(pk=self.alice.pk).exists())


# ── validate_stock relaxation ──────────────────────────────────────────────


class ValidateStockSharedTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="pass")
        self.bob = User.objects.create_user(username="bob", password="pass")
        self.carol = User.objects.create_user(username="carol", password="pass")
        self.alice.contacts.add(self.bob)
        self.stock = make_stock(self.alice, name="Shared stock")
        self.stock.shared_with.add(self.bob)

    def test_create_routine_with_own_stock(self):
        self.client.force_authenticate(user=self.alice)
        response = self.client.post(
            "/api/routines/",
            {"name": "My routine", "interval_hours": 24, "stock": self.stock.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["stock"], self.stock.pk)

    def test_create_routine_with_shared_stock(self):
        self.client.force_authenticate(user=self.bob)
        response = self.client.post(
            "/api/routines/",
            {"name": "Bob routine", "interval_hours": 24, "stock": self.stock.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["stock"], self.stock.pk)

    def test_create_routine_with_unshared_stock_rejected(self):
        self.client.force_authenticate(user=self.carol)
        response = self.client.post(
            "/api/routines/",
            {"name": "Carol routine", "interval_hours": 24, "stock": self.stock.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


# ── m2m_changed signal: unlink routines on unshare ─────────────────────────


class UnlinkRoutinesOnUnshareTest(TestCase):
    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")
        self.carol = make_user("carol")
        self.stock = make_stock(self.alice, name="Shared stock")
        self.stock.shared_with.set([self.bob, self.carol])
        # Bob has a routine pointing to Alice's stock
        self.bob_routine = make_routine(self.bob, name="Bob routine", stock=self.stock)
        # Carol has a routine pointing to Alice's stock
        self.carol_routine = make_routine(self.carol, name="Carol routine", stock=self.stock)
        # Alice has her own routine on the same stock
        self.alice_routine = make_routine(self.alice, name="Alice routine", stock=self.stock)

    def test_remove_user_unlinks_their_routines(self):
        self.stock.shared_with.remove(self.bob)
        self.bob_routine.refresh_from_db()
        self.assertIsNone(self.bob_routine.stock)

    def test_remove_user_does_not_touch_owner_routines(self):
        self.stock.shared_with.remove(self.bob)
        self.alice_routine.refresh_from_db()
        self.assertEqual(self.alice_routine.stock, self.stock)

    def test_remove_user_does_not_touch_other_shared_users(self):
        self.stock.shared_with.remove(self.bob)
        self.carol_routine.refresh_from_db()
        self.assertEqual(self.carol_routine.stock, self.stock)

    def test_clear_shared_with_unlinks_all_non_owner_routines(self):
        self.stock.shared_with.clear()
        self.bob_routine.refresh_from_db()
        self.carol_routine.refresh_from_db()
        self.alice_routine.refresh_from_db()
        self.assertIsNone(self.bob_routine.stock)
        self.assertIsNone(self.carol_routine.stock)
        self.assertEqual(self.alice_routine.stock, self.stock)


# ── Stock depletion estimation ─────────────────────────────────────────────


class StockDepletionSerializerTest(TestCase):
    def setUp(self):
        self.alice = make_user("alice")
        self.bob = make_user("bob")

    def _get_stock_data(self, stock):
        """Serialize a stock through the API queryset to get prefetched data."""
        from django.db.models import Prefetch

        qs = (
            Stock.objects.filter(pk=stock.pk)
            .select_related("group", "user")
            .prefetch_related(
                "lots",
                "shared_with",
                Prefetch(
                    "routines",
                    queryset=Routine.objects.filter(is_active=True).select_related("user"),
                    to_attr="active_routines",
                ),
            )
        )
        return StockSerializer(qs.first()).data

    def test_no_active_routines_returns_null(self):
        stock = make_stock(self.alice)
        make_lot(stock, quantity=20)
        data = self._get_stock_data(stock)
        self.assertIsNone(data["estimated_depletion_date"])
        self.assertIsNone(data["daily_consumption_own"])
        self.assertIsNone(data["daily_consumption_shared"])

    def test_single_own_routine_daily_consumption(self):
        stock = make_stock(self.alice)
        make_lot(stock, quantity=20)
        make_routine(self.alice, name="Daily", interval_hours=24, stock=stock)
        data = self._get_stock_data(stock)
        self.assertEqual(data["daily_consumption_own"], 1.0)
        self.assertIsNone(data["daily_consumption_shared"])

    def test_depletion_date_correct(self):
        stock = make_stock(self.alice)
        make_lot(stock, quantity=20)
        # 24h interval, stock_usage=1 → 1/day → 20 days
        make_routine(self.alice, name="Daily", interval_hours=24, stock=stock)
        data = self._get_stock_data(stock)
        expected = date.today() + timedelta(days=20)
        self.assertEqual(data["estimated_depletion_date"], expected)

    def test_depletion_date_with_stock_usage_gt_1(self):
        stock = make_stock(self.alice)
        make_lot(stock, quantity=20)
        r = make_routine(self.alice, name="Double", interval_hours=24, stock=stock)
        r.stock_usage = 2
        r.save()
        data = self._get_stock_data(stock)
        # 2/day → 20/2 = 10 days
        self.assertEqual(data["daily_consumption_own"], 2.0)
        expected = date.today() + timedelta(days=10)
        self.assertEqual(data["estimated_depletion_date"], expected)

    def test_own_and_shared_consumption(self):
        stock = make_stock(self.alice)
        make_lot(stock, quantity=80)
        stock.shared_with.add(self.bob)
        # Alice: 24h, usage=2 → 2/day own
        r1 = make_routine(self.alice, name="Alice daily", interval_hours=24, stock=stock)
        r1.stock_usage = 2
        r1.save()
        # Bob: 24h, usage=1 → 1/day shared
        make_routine(self.bob, name="Bob daily", interval_hours=24, stock=stock)
        data = self._get_stock_data(stock)
        self.assertEqual(data["daily_consumption_own"], 2.0)
        self.assertEqual(data["daily_consumption_shared"], 1.0)
        # Total 3/day → 80/3 = 26 days (floor)
        expected = date.today() + timedelta(days=26)
        self.assertEqual(data["estimated_depletion_date"], expected)

    def test_quantity_zero_with_consumption(self):
        stock = make_stock(self.alice)
        # No lots → quantity = 0
        make_routine(self.alice, name="Daily", interval_hours=24, stock=stock)
        data = self._get_stock_data(stock)
        self.assertEqual(data["estimated_depletion_date"], date.today())
        # qty == 0 → severity 'out' regardless of consumption rate.
        self.assertEqual(data["stock_severity"], "out")

    def test_inactive_routine_not_counted(self):
        stock = make_stock(self.alice)
        make_lot(stock, quantity=20)
        make_routine(self.alice, name="Active", interval_hours=24, stock=stock)
        make_routine(self.alice, name="Inactive", interval_hours=24, stock=stock, is_active=False)
        data = self._get_stock_data(stock)
        # Only the active routine counts: 1/day
        self.assertEqual(data["daily_consumption_own"], 1.0)
        expected = date.today() + timedelta(days=20)
        self.assertEqual(data["estimated_depletion_date"], expected)

    def test_multiple_routines_accumulate(self):
        stock = make_stock(self.alice)
        make_lot(stock, quantity=48)
        # 12h interval → 2/day, 24h interval → 1/day = 3/day total
        make_routine(self.alice, name="Twice daily", interval_hours=12, stock=stock)
        make_routine(self.alice, name="Once daily", interval_hours=24, stock=stock)
        data = self._get_stock_data(stock)
        self.assertEqual(data["daily_consumption_own"], 3.0)
        expected = date.today() + timedelta(days=16)
        self.assertEqual(data["estimated_depletion_date"], expected)

    def test_api_returns_depletion_fields(self):
        """Verify the fields appear in a real API GET /stock/ response."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=30)
        make_routine(self.alice, name="Daily", interval_hours=24, stock=stock)
        client = self.client
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_authenticate(user=self.alice)
        response = client.get("/api/stock/")
        self.assertEqual(response.status_code, 200)
        stock_data = response.json()["results"][0]
        self.assertIn("estimated_depletion_date", stock_data)
        self.assertIn("daily_consumption_own", stock_data)
        self.assertIn("daily_consumption_shared", stock_data)
        self.assertIn("stock_severity", stock_data)
        self.assertIn("expiry_severity", stock_data)
        self.assertEqual(stock_data["daily_consumption_own"], 1.0)
        expected = date.today() + timedelta(days=30)
        self.assertEqual(stock_data["estimated_depletion_date"], expected.isoformat())

    # ── stock_severity (T104) ────────────────────────────────────────────────

    def test_stock_severity_out_when_quantity_zero(self):
        """qty == 0 → 'out'."""
        stock = make_stock(self.alice)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "out")

    def test_stock_severity_low_when_quantity_one(self):
        """qty == 1 → 'low'."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=1)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "low")

    def test_stock_severity_low_when_quantity_two(self):
        """qty == 2 → 'low' (boundary)."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=2)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "low")

    def test_stock_severity_ok_when_quantity_three_no_consumption(self):
        """qty == 3 without active routines → 'ok' (neither qty nor consumption rule)."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=3)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "ok")

    def test_stock_severity_ok_when_quantity_high_no_consumption(self):
        """qty == 50 without consumption → 'ok'."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=50)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "ok")

    def test_stock_severity_low_when_qty_three_weekly_consumption(self):
        """qty == 3 with a weekly routine → depletion in 21 days < 30 → 'low' via consumption rule.

        This is the canonical case the consumption branch is meant to catch:
        a 3-unit weekly medication looks fine on quantity alone but the user
        is one week from running out.
        """
        stock = make_stock(self.alice)
        make_lot(stock, quantity=3)
        make_routine(self.alice, name="Weekly", interval_hours=168, stock=stock)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "low")

    def test_stock_severity_low_when_qty_ten_daily_consumption(self):
        """qty == 10 with a daily routine → depletion in 10 days → 'low'."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=10)
        make_routine(self.alice, name="Daily", interval_hours=24, stock=stock)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "low")

    def test_stock_severity_ok_when_qty_high_slow_consumption(self):
        """qty == 50 with one consumption every 240h (10 days)
        → depletion in 500 days → 'ok'."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=50)
        make_routine(self.alice, name="Slow", interval_hours=240, stock=stock)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "ok")

    def test_stock_severity_ok_when_inactive_routine_consumes_stock(self):
        """An inactive routine does NOT count toward depletion → 'ok'
        even though it would consume rapidly if active."""
        stock = make_stock(self.alice)
        make_lot(stock, quantity=10)
        make_routine(self.alice, name="Disabled", interval_hours=24, stock=stock, is_active=False)
        data = self._get_stock_data(stock)
        self.assertEqual(data["stock_severity"], "ok")


# ── updated_at on mutable child models ─────────────────────────────────────


class UpdatedAtFieldsTest(APITestCase):
    """
    Tracks that `updated_at` is auto-bumped on save for the newly-annotated
    models and is exposed read-only in GET responses so clients can use it
    as an ETag for If-Unmodified-Since (see T020).
    """

    def setUp(self):
        self.user = make_user("alice")
        self.client.force_authenticate(user=self.user)

    # model-level auto_now
    def test_routine_entry_updated_at_bumps_on_save(self):
        routine = make_routine(self.user)
        entry = RoutineEntry.objects.create(routine=routine, notes="first")
        before = entry.updated_at
        entry.notes = "second"
        entry.save()
        entry.refresh_from_db()
        self.assertGreater(entry.updated_at, before)

    def test_stock_lot_updated_at_bumps_on_save(self):
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=5)
        before = lot.updated_at
        lot.quantity = 3
        lot.save()
        lot.refresh_from_db()
        self.assertGreater(lot.updated_at, before)

    def test_stock_consumption_updated_at_bumps_on_save(self):
        stock = make_stock(self.user)
        consumption = StockConsumption.objects.create(stock=stock, quantity=1, notes="n1")
        before = consumption.updated_at
        consumption.notes = "edited"
        consumption.save()
        consumption.refresh_from_db()
        self.assertGreater(consumption.updated_at, before)

    # API exposure
    def test_routine_entries_endpoint_returns_updated_at(self):
        routine = make_routine(self.user)
        RoutineEntry.objects.create(routine=routine, notes="hi")
        response = self.client.get(f"/api/routines/{routine.id}/entries/")
        self.assertEqual(response.status_code, 200)
        results = response.json()
        # The endpoint may return a list or paginated results; handle both.
        entries = results.get("results", results) if isinstance(results, dict) else results
        self.assertGreater(len(entries), 0)
        self.assertIn("updated_at", entries[0])
        self.assertIsNotNone(entries[0]["updated_at"])

    def test_stock_patch_response_includes_lot_updated_at(self):
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=10, lot_number="L-1")
        response = self.client.patch(f"/api/stock/{stock.id}/lots/{lot.id}/", {"quantity": 8})
        self.assertEqual(response.status_code, 200)
        self.assertIn("updated_at", response.json())
        self.assertIsNotNone(response.json()["updated_at"])

    def test_stock_consumption_list_includes_updated_at(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5)
        # Trigger consumption via API so the endpoint builds a real object
        response = self.client.post(
            f"/api/stock/{stock.id}/consume/",
            {"quantity": 2, "notes": "t"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        consumption_list = self.client.get("/api/stock-consumptions/")
        self.assertEqual(consumption_list.status_code, 200)
        results = consumption_list.json()
        items = results.get("results", results) if isinstance(results, dict) else results
        self.assertGreater(len(items), 0)
        self.assertIn("updated_at", items[0])


# ── Optimistic locking — integration per viewset ───────────────────────────


class OptimisticLockingIntegrationTest(APITestCase):
    """
    Exercises each ModelViewSet with a stale If-Unmodified-Since header and
    asserts the mixin short-circuits the update to 412 without writing.
    """

    STALE_HEADER = "Wed, 01 Jan 2020 00:00:00 GMT"

    def setUp(self):
        self.user = make_user("alice")
        self.client.force_authenticate(user=self.user)

    def _current_header(self, instance):
        return instance.updated_at.strftime("%a, %d %b %Y %H:%M:%S GMT")

    # Routine
    def test_patch_routine_with_stale_header_returns_412(self):
        routine = make_routine(self.user)
        response = self.client.patch(
            f"/api/routines/{routine.id}/",
            {"name": "Changed"},
            HTTP_IF_UNMODIFIED_SINCE=self.STALE_HEADER,
        )
        self.assertEqual(response.status_code, 412)
        body = response.json()
        self.assertEqual(body["error"], "conflict")
        self.assertIn("current", body)
        self.assertEqual(body["current"]["id"], routine.id)
        routine.refresh_from_db()
        self.assertNotEqual(routine.name, "Changed")

    def test_patch_routine_with_current_header_succeeds(self):
        routine = make_routine(self.user)
        response = self.client.patch(
            f"/api/routines/{routine.id}/",
            {"name": "Changed"},
            HTTP_IF_UNMODIFIED_SINCE=self._current_header(routine),
        )
        self.assertEqual(response.status_code, 200)
        routine.refresh_from_db()
        self.assertEqual(routine.name, "Changed")

    # Stock
    def test_patch_stock_with_stale_header_returns_412(self):
        stock = make_stock(self.user)
        response = self.client.patch(
            f"/api/stock/{stock.id}/",
            {"name": "Changed"},
            HTTP_IF_UNMODIFIED_SINCE=self.STALE_HEADER,
        )
        self.assertEqual(response.status_code, 412)
        self.assertEqual(response.json()["error"], "conflict")
        stock.refresh_from_db()
        self.assertNotEqual(stock.name, "Changed")

    def test_delete_stock_with_stale_header_returns_412(self):
        stock = make_stock(self.user)
        response = self.client.delete(
            f"/api/stock/{stock.id}/",
            HTTP_IF_UNMODIFIED_SINCE=self.STALE_HEADER,
        )
        self.assertEqual(response.status_code, 412)
        self.assertTrue(Stock.objects.filter(pk=stock.pk).exists())

    # StockLot
    def test_patch_stock_lot_with_stale_header_returns_412(self):
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=10, lot_number="L-1")
        response = self.client.patch(
            f"/api/stock/{stock.id}/lots/{lot.id}/",
            {"quantity": 5},
            HTTP_IF_UNMODIFIED_SINCE=self.STALE_HEADER,
        )
        self.assertEqual(response.status_code, 412)
        self.assertEqual(response.json()["error"], "conflict")
        lot.refresh_from_db()
        self.assertEqual(lot.quantity, 10)

    # RoutineEntry (notes PATCH)
    def test_patch_routine_entry_with_stale_header_returns_412(self):
        routine = make_routine(self.user)
        entry = RoutineEntry.objects.create(routine=routine, notes="original")
        response = self.client.patch(
            f"/api/entries/{entry.id}/",
            {"notes": "edited"},
            HTTP_IF_UNMODIFIED_SINCE=self.STALE_HEADER,
        )
        self.assertEqual(response.status_code, 412)
        entry.refresh_from_db()
        self.assertEqual(entry.notes, "original")

    # StockConsumption (notes PATCH)
    def test_patch_stock_consumption_with_stale_header_returns_412(self):
        stock = make_stock(self.user)
        consumption = StockConsumption.objects.create(stock=stock, quantity=1, notes="original")
        response = self.client.patch(
            f"/api/stock-consumptions/{consumption.id}/",
            {"notes": "edited"},
            HTTP_IF_UNMODIFIED_SINCE=self.STALE_HEADER,
        )
        self.assertEqual(response.status_code, 412)
        consumption.refresh_from_db()
        self.assertEqual(consumption.notes, "original")


# ── client_created_at on log + consume ──────────────────────────────────────


class ClientCreatedAtTest(APITestCase):
    """
    Both /api/routines/{id}/log/ and /api/stock/{id}/consume/ accept an
    optional `client_created_at` so entries synced after an offline stretch
    reflect the real action time. Skew validation is controlled by
    OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS.
    """

    def setUp(self):
        self.user = make_user("alice")
        self.client.force_authenticate(user=self.user)

    # ── /log/ endpoint ──────────────────────────────────────────────────────
    def test_log_without_client_created_at_leaves_field_null(self):
        routine = make_routine(self.user)
        response = self.client.post(f"/api/routines/{routine.id}/log/", {})
        self.assertEqual(response.status_code, 201)
        entry = routine.entries.get()
        self.assertIsNone(entry.client_created_at)
        self.assertAlmostEqual(entry.created_at.timestamp(), timezone.now().timestamp(), delta=5)

    def test_log_with_client_created_at_stores_it(self):
        routine = make_routine(self.user)
        action_time = timezone.now() - timedelta(hours=2)
        response = self.client.post(
            f"/api/routines/{routine.id}/log/",
            {"client_created_at": action_time.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        entry = routine.entries.get()
        self.assertIsNotNone(entry.client_created_at)
        self.assertAlmostEqual(entry.client_created_at.timestamp(), action_time.timestamp(), delta=2)
        # created_at remains server-side (sync time), independent of client_created_at
        self.assertGreater(entry.created_at, entry.client_created_at)

    def test_log_without_skew_setting_accepts_old_timestamp(self):
        routine = make_routine(self.user)
        one_year_ago = timezone.now() - timedelta(days=365)
        response = self.client.post(
            f"/api/routines/{routine.id}/log/",
            {"client_created_at": one_year_ago.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    @override_settings(OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS=24 * 60 * 60)
    def test_log_with_skew_within_limit_accepts(self):
        routine = make_routine(self.user)
        ok = timezone.now() - timedelta(hours=23)
        response = self.client.post(
            f"/api/routines/{routine.id}/log/",
            {"client_created_at": ok.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    @override_settings(OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS=24 * 60 * 60)
    def test_log_with_skew_over_limit_returns_400(self):
        routine = make_routine(self.user)
        too_old = timezone.now() - timedelta(hours=25)
        response = self.client.post(
            f"/api/routines/{routine.id}/log/",
            {"client_created_at": too_old.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("client_created_at", response.json())

    # ── next_due_at uses effective time ─────────────────────────────────────
    def test_next_due_at_uses_client_created_at_when_present(self):
        routine = make_routine(self.user, interval_hours=8)
        past_action = timezone.now() - timedelta(hours=7)
        response = self.client.post(
            f"/api/routines/{routine.id}/log/",
            {"client_created_at": past_action.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        routine.refresh_from_db()
        expected_due = past_action + timedelta(hours=8)
        self.assertAlmostEqual(
            routine.next_due_at().timestamp(),
            expected_due.timestamp(),
            delta=5,
        )

    def test_next_due_at_falls_back_to_created_at(self):
        routine = make_routine(self.user, interval_hours=8)
        response = self.client.post(f"/api/routines/{routine.id}/log/", {})
        self.assertEqual(response.status_code, 201)
        routine.refresh_from_db()
        entry = routine.entries.get()
        self.assertAlmostEqual(
            routine.next_due_at().timestamp(),
            (entry.created_at + timedelta(hours=8)).timestamp(),
            delta=1,
        )

    # ── /consume/ endpoint ──────────────────────────────────────────────────
    def test_consume_without_client_created_at_leaves_field_null(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5)
        response = self.client.post(f"/api/stock/{stock.id}/consume/", {"quantity": 1}, format="json")
        self.assertEqual(response.status_code, 200)
        consumption = stock.consumptions.get()
        self.assertIsNone(consumption.client_created_at)

    def test_consume_with_client_created_at_stores_it(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5)
        action_time = timezone.now() - timedelta(hours=3)
        response = self.client.post(
            f"/api/stock/{stock.id}/consume/",
            {"quantity": 1, "client_created_at": action_time.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        consumption = stock.consumptions.get()
        self.assertIsNotNone(consumption.client_created_at)
        self.assertAlmostEqual(consumption.client_created_at.timestamp(), action_time.timestamp(), delta=2)

    @override_settings(OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS=60)
    def test_consume_with_skew_over_limit_returns_400(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=5)
        too_old = timezone.now() - timedelta(hours=2)
        response = self.client.post(
            f"/api/stock/{stock.id}/consume/",
            {"quantity": 1, "client_created_at": too_old.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("client_created_at", response.json())

    def test_last_entry_at_in_serializer_uses_effective_time(self):
        routine = make_routine(self.user, interval_hours=8)
        past_action = timezone.now() - timedelta(hours=3)
        self.client.post(
            f"/api/routines/{routine.id}/log/",
            {"client_created_at": past_action.isoformat()},
            format="json",
        )
        response = self.client.get(f"/api/routines/{routine.id}/")
        self.assertEqual(response.status_code, 200)
        last_entry_at = response.json()["last_entry_at"]
        # Should match client_created_at (past), not server created_at (now)
        self.assertAlmostEqual(
            timezone.datetime.fromisoformat(last_entry_at.replace("Z", "+00:00")).timestamp(),
            past_action.timestamp(),
            delta=2,
        )

    # ── API exposure ────────────────────────────────────────────────────────
    def test_entries_endpoint_exposes_client_created_at(self):
        routine = make_routine(self.user)
        action_time = timezone.now() - timedelta(hours=1)
        self.client.post(
            f"/api/routines/{routine.id}/log/",
            {"client_created_at": action_time.isoformat()},
            format="json",
        )
        response = self.client.get(f"/api/routines/{routine.id}/entries/")
        self.assertEqual(response.status_code, 200)
        results = response.json()
        entries = results.get("results", results) if isinstance(results, dict) else results
        self.assertEqual(len(entries), 1)
        self.assertIn("client_created_at", entries[0])
        self.assertIsNotNone(entries[0]["client_created_at"])
