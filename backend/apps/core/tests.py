import os
from datetime import datetime, timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from apps.core.mixins import parse_http_date
from apps.idempotency.models import IdempotencyRecord
from apps.notifications.models import PushSubscription
from apps.routines.models import (
    Routine,
    RoutineEntry,
    Stock,
    StockConsumption,
    StockLot,
)

User = get_user_model()


class HealthCheckTestCase(APITestCase):
    def _assert_ok(self, response):
        # Match the Docker healthcheck and the frontend reachability poll:
        # both treat any 2xx as "backend alive", not strictly 200.
        self.assertGreaterEqual(response.status_code, 200)
        self.assertLess(response.status_code, 300)

    def test_returns_2xx(self):
        response = self.client.get("/api/health/")
        self._assert_ok(response)

    def test_payload_shape(self):
        response = self.client.get("/api/health/")
        self._assert_ok(response)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["status"], "ok")
        self.assertIn("timestamp", body)
        # ISO 8601 timestamp is parseable back to an aware datetime.
        parsed = datetime.fromisoformat(body["timestamp"])
        self.assertIsNotNone(parsed.tzinfo)

    def test_no_authentication_required(self):
        # Health endpoint must be publicly accessible — no Authorization header.
        response = self.client.get("/api/health/")
        self.assertNotEqual(response.status_code, 401)
        self.assertNotEqual(response.status_code, 403)

    def test_does_not_hit_database(self):
        # The endpoint is polled every 20s while offline — must stay cheap.
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get("/api/health/")
        self._assert_ok(response)
        self.assertEqual(len(ctx.captured_queries), 0)


# ── parse_http_date helper ──────────────────────────────────────────────────


class ParseHttpDateTest(APITestCase):
    def test_valid_http_date_returns_aware_datetime(self):
        dt = parse_http_date("Wed, 21 Oct 2026 07:28:00 GMT")
        self.assertIsNotNone(dt)
        self.assertEqual(dt, datetime(2026, 10, 21, 7, 28, 0, tzinfo=timezone.utc))

    def test_invalid_string_returns_none(self):
        self.assertIsNone(parse_http_date("not-a-date"))

    def test_empty_string_returns_none(self):
        self.assertIsNone(parse_http_date(""))


# ── OptimisticLockingMixin (integrated through StockViewSet) ────────────────


class OptimisticLockingMixinTest(APITestCase):
    """
    Covers the mixin through the StockViewSet, which applies it. Ownership
    checks ensure only the owner can mutate, so all requests use the owner.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pw")
        self.client.force_authenticate(user=self.user)
        self.stock = Stock.objects.create(user=self.user, name="Filter")

    def _http_date(self, dt):
        return dt.strftime("%a, %d %b %Y %H:%M:%S GMT")

    def test_patch_without_header_succeeds(self):
        response = self.client.patch(f"/api/stock/{self.stock.id}/", {"name": "Renamed"})
        self.assertEqual(response.status_code, 200)

    def test_patch_with_current_header_succeeds(self):
        current = self.stock.updated_at
        response = self.client.patch(
            f"/api/stock/{self.stock.id}/",
            {"name": "Renamed"},
            HTTP_IF_UNMODIFIED_SINCE=self._http_date(current),
        )
        self.assertEqual(response.status_code, 200)

    def test_patch_with_stale_header_returns_412(self):
        stale = datetime(2020, 1, 1, tzinfo=timezone.utc)
        response = self.client.patch(
            f"/api/stock/{self.stock.id}/",
            {"name": "Renamed"},
            HTTP_IF_UNMODIFIED_SINCE=self._http_date(stale),
        )
        self.assertEqual(response.status_code, 412)
        body = response.json()
        self.assertEqual(body["error"], "conflict")
        self.assertIn("current", body)
        self.assertEqual(body["current"]["id"], self.stock.id)
        self.assertEqual(body["current"]["name"], "Filter")  # unchanged
        self.stock.refresh_from_db()
        self.assertEqual(self.stock.name, "Filter")  # nothing written

    def test_patch_with_malformed_header_returns_400(self):
        response = self.client.patch(
            f"/api/stock/{self.stock.id}/",
            {"name": "Renamed"},
            HTTP_IF_UNMODIFIED_SINCE="not-a-date",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_delete_without_header_succeeds(self):
        response = self.client.delete(f"/api/stock/{self.stock.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Stock.objects.filter(pk=self.stock.pk).exists())

    def test_delete_with_current_header_succeeds(self):
        current = self.stock.updated_at
        response = self.client.delete(
            f"/api/stock/{self.stock.id}/",
            HTTP_IF_UNMODIFIED_SINCE=self._http_date(current),
        )
        self.assertEqual(response.status_code, 204)

    def test_delete_with_stale_header_returns_412(self):
        stale = datetime(2020, 1, 1, tzinfo=timezone.utc)
        response = self.client.delete(
            f"/api/stock/{self.stock.id}/",
            HTTP_IF_UNMODIFIED_SINCE=self._http_date(stale),
        )
        self.assertEqual(response.status_code, 412)
        self.assertTrue(Stock.objects.filter(pk=self.stock.pk).exists())


# ── seed_e2e management command ─────────────────────────────────────────────


@override_settings(DEBUG=True)
class SeedE2ECommandTest(TestCase):
    """Runs the seed and asserts deterministic counts + relationships."""

    EXPECTED_ROUTINE_NAMES = {
        "Take vitamins",
        "Morning stretch",
        "Weekly cleaning",
        "Water filter",
        "Vitamin D supplement",
        "Medication",
        "Pain relief",
    }

    EXPECTED_STOCK_NAMES = {
        "Vitamin D",
        "Filter cartridge",
        "Pills",
        "Ibuprofen",
        "Personal stock",
    }

    def test_creates_expected_fixture(self):
        # An unrelated superuser must survive the wipe; non-superusers must not.
        admin = User.objects.create_superuser(username="admin", password="pw")
        doomed = User.objects.create_user(username="doomed", password="pw")

        call_command("seed_e2e")

        self.assertTrue(User.objects.filter(pk=admin.pk).exists())
        self.assertFalse(User.objects.filter(pk=doomed.pk).exists())

        self.assertEqual(User.objects.filter(is_superuser=False).count(), 3)
        self.assertEqual(Routine.objects.count(), 7)
        self.assertEqual(Stock.objects.count(), 5)
        self.assertEqual(StockLot.objects.count(), 9)

        # Entries live in a range to give headroom if future tweaks shift the
        # cadence; the ballpark stays stable.
        entries_total = RoutineEntry.objects.count()
        self.assertGreaterEqual(entries_total, 70)
        self.assertLessEqual(entries_total, 100)

        self.assertEqual(StockConsumption.objects.count(), 6)

        user1 = User.objects.get(username="user1")
        user2 = User.objects.get(username="user2")
        user3 = User.objects.get(username="user3")

        self.assertIn(user2, user1.contacts.all())
        self.assertIn(user3, user1.contacts.all())
        self.assertIn(user3, user2.contacts.all())

        medication = Routine.objects.get(name="Medication")
        self.assertIn(user2, medication.shared_with.all())
        pills = Stock.objects.get(name="Pills")
        self.assertIn(user2, pills.shared_with.all())

    def test_routine_and_stock_names_match_spec(self):
        call_command("seed_e2e")
        self.assertEqual(set(Routine.objects.values_list("name", flat=True)), self.EXPECTED_ROUTINE_NAMES)
        self.assertEqual(set(Stock.objects.values_list("name", flat=True)), self.EXPECTED_STOCK_NAMES)

    def test_pain_relief_is_blocked_by_depleted_ibuprofen(self):
        """Pain relief must exist and its ibuprofen stock must sum to 0 units."""
        call_command("seed_e2e")
        pain_relief = Routine.objects.get(name="Pain relief")
        self.assertEqual(pain_relief.stock.name, "Ibuprofen")
        # quantity property sums all lot quantities; must be 0 so the UI
        # blocks completion.
        self.assertEqual(pain_relief.stock.quantity, 0)
        # The lot itself must still exist (UI renders it as "0 u." with an
        # empty indicator). bulk_create bypasses the delete-empty-lot signal.
        self.assertEqual(pain_relief.stock.lots.count(), 1)
        self.assertEqual(pain_relief.stock.lots.get().lot_number, "IBU-1")

    def test_vitamin_d_has_three_lots_including_one_without_sn(self):
        """The dedup test in T037 needs a lot without lot_number + with expiry."""
        call_command("seed_e2e")
        vitamin_d = Stock.objects.get(name="Vitamin D")
        lots = vitamin_d.lots.all()
        self.assertEqual(lots.count(), 3)
        # One SN + near expiry, one SN + far expiry, one without SN but with expiry.
        sns = {lot.lot_number for lot in lots}
        self.assertIn("VIT-A", sns)
        self.assertIn("VIT-B", sns)
        self.assertIn("", sns)
        # The empty-SN lot must have an expiry_date (so the "no SN + matching
        # expiry → merge" dedup test has a concrete target).
        no_sn = vitamin_d.lots.get(lot_number="")
        self.assertIsNotNone(no_sn.expiry_date)

    def test_never_started_routines_have_no_entries(self):
        call_command("seed_e2e")
        for name in ["Morning stretch", "Water filter", "Pain relief"]:
            routine = Routine.objects.get(name=name)
            self.assertEqual(
                routine.entries.count(),
                0,
                msg=f"{name} must have 0 entries to represent 'never started'.",
            )

    def test_high_volume_routines_have_realistic_history(self):
        """Take vitamins and Medication drive the History pagination tests."""
        call_command("seed_e2e")
        self.assertGreaterEqual(Routine.objects.get(name="Take vitamins").entries.count(), 25)
        self.assertGreaterEqual(Routine.objects.get(name="Medication").entries.count(), 35)

    def test_upcoming_routines_are_not_due(self):
        """`is_due()` rounds to the user's local date — verify our timing."""
        call_command("seed_e2e")
        for name in ["Vitamin D supplement", "Weekly cleaning"]:
            routine = Routine.objects.get(name=name)
            self.assertFalse(
                routine.is_due(),
                msg=f"{name} must evaluate as upcoming (not due) right after seed.",
            )

    def test_overdue_routines_are_due(self):
        call_command("seed_e2e")
        for name in ["Take vitamins", "Medication"]:
            routine = Routine.objects.get(name=name)
            self.assertTrue(
                routine.is_due(),
                msg=f"{name} must evaluate as due/overdue right after seed.",
            )

    def test_idempotent(self):
        call_command("seed_e2e")
        first_counts = (
            User.objects.filter(is_superuser=False).count(),
            Routine.objects.count(),
            Stock.objects.count(),
            StockLot.objects.count(),
            RoutineEntry.objects.count(),
            StockConsumption.objects.count(),
        )

        call_command("seed_e2e")
        second_counts = (
            User.objects.filter(is_superuser=False).count(),
            Routine.objects.count(),
            Stock.objects.count(),
            StockLot.objects.count(),
            RoutineEntry.objects.count(),
            StockConsumption.objects.count(),
        )
        self.assertEqual(first_counts, second_counts)

    def test_wipes_existing_business_data(self):
        # Create artefacts that should be wiped.
        user = User.objects.create_user(username="victim", password="pw")
        stock = Stock.objects.create(user=user, name="Doomed stock")
        StockLot.objects.create(stock=stock, quantity=1)
        PushSubscription.objects.create(user=user, endpoint="https://e.test/x", p256dh="p", auth="a")
        IdempotencyRecord.objects.create(
            key="k",
            user=user,
            endpoint="/api/x/",
            method="POST",
            body_hash="b",
            response_status=200,
        )

        call_command("seed_e2e")

        self.assertFalse(User.objects.filter(username="victim").exists())
        self.assertFalse(Stock.objects.filter(name="Doomed stock").exists())
        self.assertEqual(PushSubscription.objects.count(), 0)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)


class SeedE2EGateTest(TestCase):
    """The triple gate keeps the destructive command out of production."""

    @override_settings(DEBUG=False)
    def test_refuses_without_env_and_debug_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("E2E_SEED_ALLOWED", None)
            with self.assertRaises(CommandError):
                call_command("seed_e2e")

    @override_settings(DEBUG=False)
    def test_runs_with_env_gate(self):
        with mock.patch.dict(os.environ, {"E2E_SEED_ALLOWED": "true"}):
            call_command("seed_e2e")
        self.assertTrue(User.objects.filter(username="user1").exists())


class E2ESeedEndpointTest(APITestCase):
    @override_settings(DEBUG=True)
    def test_post_triggers_seed(self):
        response = self.client.post("/api/internal/e2e-seed/")
        self.assertEqual(response.status_code, 204)
        self.assertTrue(User.objects.filter(username="user1").exists())

    @override_settings(DEBUG=False)
    def test_post_forbidden_without_gate(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("E2E_SEED_ALLOWED", None)
            response = self.client.post("/api/internal/e2e-seed/")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username="user1").exists())
