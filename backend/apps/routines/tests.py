import datetime as dt
from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
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

    def test_has_expiring_lots_true_within_window(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=3, expiry_date=date.today() + timedelta(days=30))
        data = StockSerializer(stock).data
        self.assertTrue(data["has_expiring_lots"])

    def test_has_expiring_lots_false_outside_window(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=3, expiry_date=date.today() + timedelta(days=200))
        data = StockSerializer(stock).data
        self.assertFalse(data["has_expiring_lots"])

    def test_has_expiring_lots_false_for_no_expiry_lots(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=3)  # no expiry_date
        data = StockSerializer(stock).data
        self.assertFalse(data["has_expiring_lots"])

    def test_expiring_lots_contains_correct_lots(self):
        stock = make_stock(self.user)
        expiring = make_lot(stock, quantity=2, expiry_date=date.today() + timedelta(days=60))
        make_lot(stock, quantity=5, expiry_date=date.today() + timedelta(days=200))
        data = StockSerializer(stock).data
        self.assertEqual(len(data["expiring_lots"]), 1)
        self.assertEqual(data["expiring_lots"][0]["id"], expiring.id)

    def test_expiring_lots_excludes_zero_quantity(self):
        stock = make_stock(self.user)
        make_lot(stock, quantity=0, expiry_date=date.today() + timedelta(days=30))
        data = StockSerializer(stock).data
        self.assertFalse(data["has_expiring_lots"])
        self.assertEqual(len(data["expiring_lots"]), 0)


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
        self.assertIn("has_expiring_lots", data)
        self.assertIn("expiring_lots", data)

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
        late = make_lot(stock, quantity=10, expiry_date=date.today() + timedelta(days=120))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 5
        r.save()
        self.client.post(f"/api/routines/{r.id}/log/", {})
        early.refresh_from_db()
        late.refresh_from_db()
        self.assertEqual(early.quantity, 0)  # fully consumed
        self.assertEqual(late.quantity, 7)  # 10 - 3 (remaining after early)

    def test_log_fefo_no_expiry_lots_consumed_last(self):
        """Lots without expiry are consumed only after lots with expiry."""
        stock = make_stock(self.user)
        no_expiry = make_lot(stock, quantity=10)
        with_expiry = make_lot(stock, quantity=3, expiry_date=date.today() + timedelta(days=60))
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 3
        r.save()
        self.client.post(f"/api/routines/{r.id}/log/", {})
        with_expiry.refresh_from_db()
        no_expiry.refresh_from_db()
        self.assertEqual(with_expiry.quantity, 0)  # consumed first
        self.assertEqual(no_expiry.quantity, 10)  # untouched

    def test_log_does_not_decrement_below_zero(self):
        """Total consumption is capped by available stock."""
        stock = make_stock(self.user)
        lot = make_lot(stock, quantity=2)
        r = make_routine(self.user, stock=stock)
        r.stock_usage = 10
        r.save()
        self.client.post(f"/api/routines/{r.id}/log/", {})
        lot.refresh_from_db()
        self.assertEqual(lot.quantity, 0)
        self.assertEqual(stock.quantity, 0)

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
