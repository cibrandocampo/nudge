import os
from datetime import datetime, timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import RequestFactory, TestCase, override_settings
from rest_framework import serializers as drf_serializers
from rest_framework.test import APITestCase

from apps.core.mixins import SharedWithMixin, parse_http_date
from apps.core.permissions import IsOwner
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


# ── App version: middleware + /api/version/ endpoint ───────────────────────


@override_settings(APP_VERSION="test-1.2.3", APP_COMMIT="abc1234", APP_BUILT_AT="2026-05-05T12:00:00Z")
class AppVersionHeaderMiddlewareTest(APITestCase):
    """Every response — success, error, unauth — must carry X-App-Version."""

    def test_header_present_on_200(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-App-Version"], "test-1.2.3")

    def test_header_present_on_404(self):
        response = self.client.get("/api/this-route-does-not-exist/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response["X-App-Version"], "test-1.2.3")

    def test_header_present_on_401_drf_route(self):
        # Hitting an authenticated DRF route without a token returns 401;
        # the middleware must still attach the header to that response.
        response = self.client.get("/api/routines/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response["X-App-Version"], "test-1.2.3")

    def test_header_reflects_current_settings(self):
        # Changing APP_VERSION via override_settings must take effect on
        # the next request — i.e. the middleware doesn't cache the value
        # at __init__ time.
        with override_settings(APP_VERSION="other-9.9.9"):
            response = self.client.get("/api/health/")
        self.assertEqual(response["X-App-Version"], "other-9.9.9")


@override_settings(APP_VERSION="test-1.2.3", APP_COMMIT="abc1234", APP_BUILT_AT="2026-05-05T12:00:00Z")
class VersionEndpointTest(APITestCase):
    """`GET /api/version/` exposes the build identifiers — public, no DB."""

    def test_returns_200(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)

    def test_payload_shape(self):
        response = self.client.get("/api/version/")
        body = response.json()
        self.assertEqual(body, {"version": "test-1.2.3", "commit": "abc1234", "built_at": "2026-05-05T12:00:00Z"})

    def test_no_authentication_required(self):
        # No Authorization header sent — endpoint must remain public.
        response = self.client.get("/api/version/")
        self.assertNotEqual(response.status_code, 401)
        self.assertNotEqual(response.status_code, 403)

    def test_does_not_hit_database(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)
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


# ── seed management command ────────────────────────────────────────────────


@override_settings(DEBUG=True)
class SeedCommandTest(TestCase):
    """Runs the unified seed and asserts deterministic counts + relationships."""

    EXPECTED_ROUTINE_NAMES = {
        "Take Vitamin D",
        "Change pump cannula",
        "Replace glucose sensor",
        "Take antihistamine",
        "Change Brita filter",
        "Fertilize orchid",
        "Water cactus",
        "IPL hair removal",
        "Descale coffee machine",
        "Take birth control pill",
    }

    EXPECTED_STOCK_NAMES = {
        "Hidroferol drops",
        "Insulin pump cannulas",
        "Glucose monitor sensors",
        "Ibuprofen 600mg",
        "Paracetamol 1g",
        "Ebastine",
        "Biodramina",
        "Brita filter cartridges",
        "Orchid fertilizer",
        "Descaler tablets",
        "Birth control pills",
    }

    def test_creates_expected_fixture(self):
        # An unrelated superuser must survive the wipe; non-superusers must not.
        admin = User.objects.create_superuser(username="admin", password="pw")
        doomed = User.objects.create_user(username="doomed", password="pw")

        call_command("seed")

        self.assertTrue(User.objects.filter(pk=admin.pk).exists())
        self.assertFalse(User.objects.filter(pk=doomed.pk).exists())

        # 3 demo users (cibran/maria/laura) plus the seeded admin = 4 total.
        self.assertEqual(User.objects.filter(is_superuser=False).count(), 3)
        self.assertEqual(Routine.objects.count(), 10)
        self.assertEqual(Stock.objects.count(), 11)
        self.assertEqual(StockLot.objects.count(), 16)
        self.assertEqual(RoutineEntry.objects.count(), 50)
        self.assertEqual(StockConsumption.objects.count(), 6)

        cibran = User.objects.get(username="cibran")
        maria = User.objects.get(username="maria")
        laura = User.objects.get(username="laura")

        # All three users are mutual contacts (symmetrical via `contacts.add`).
        self.assertIn(maria, cibran.contacts.all())
        self.assertIn(laura, cibran.contacts.all())
        self.assertIn(laura, maria.contacts.all())

        # Cibran shares 3 routines with maria; maria shares 1 routine with cibran.
        for name in ("Change Brita filter", "Fertilize orchid", "Water cactus"):
            routine = Routine.objects.get(name=name)
            self.assertEqual(routine.user, cibran)
            self.assertIn(maria, routine.shared_with.all())

        descale = Routine.objects.get(name="Descale coffee machine")
        self.assertEqual(descale.user, maria)
        self.assertIn(cibran, descale.shared_with.all())

        # Brita / Orchid stocks are shared cibran→maria; descaler is maria→cibran.
        for name in ("Brita filter cartridges", "Orchid fertilizer"):
            stock = Stock.objects.get(name=name)
            self.assertEqual(stock.user, cibran)
            self.assertIn(maria, stock.shared_with.all())

        descaler = Stock.objects.get(name="Descaler tablets")
        self.assertEqual(descaler.user, maria)
        self.assertIn(cibran, descaler.shared_with.all())

        # Birth control privacy contract: maria-owned, NOT shared with anyone.
        bcp_stock = Stock.objects.get(name="Birth control pills")
        self.assertEqual(bcp_stock.user, maria)
        self.assertEqual(bcp_stock.shared_with.count(), 0)
        bcp_routine = Routine.objects.get(name="Take birth control pill")
        self.assertEqual(bcp_routine.user, maria)
        self.assertEqual(bcp_routine.shared_with.count(), 0)

    def test_routine_and_stock_names_match_spec(self):
        call_command("seed")
        self.assertEqual(set(Routine.objects.values_list("name", flat=True)), self.EXPECTED_ROUTINE_NAMES)
        self.assertEqual(set(Stock.objects.values_list("name", flat=True)), self.EXPECTED_STOCK_NAMES)

    def test_change_pump_cannula_is_blocked_by_empty_cannulas(self):
        """`Change pump cannula` must be vinculated to a stock summing 0 units."""
        call_command("seed")
        cannula = Routine.objects.get(name="Change pump cannula")
        self.assertEqual(cannula.stock.name, "Insulin pump cannulas")
        # `quantity` sums all lot quantities; must be 0 so the UI blocks Done.
        self.assertEqual(cannula.stock.quantity, 0)
        # The lot itself must still exist (bulk_create bypasses delete_empty_lot)
        # so the UI can render "0 u." instead of "no lots".
        self.assertEqual(cannula.stock.lots.count(), 1)
        self.assertEqual(cannula.stock.lots.get().lot_number, "CAN-A")

    def test_hidroferol_has_three_lots_for_dedup_tests(self):
        """`stock-expiry.spec.js` exercises lot-dedup against this stock:
        two lots with SN (one near expiry, one far) plus one without SN
        — the dedup paths are by (SN+expiry) and by (no-SN+expiry)."""
        call_command("seed")
        hidroferol = Stock.objects.get(name="Hidroferol drops")
        lots = list(hidroferol.lots.all())
        self.assertEqual(len(lots), 3)
        sns = {lot.lot_number for lot in lots}
        self.assertEqual(sns, {"HID-A", "HID-B", ""})
        # HID-A is the FEFO front (closest expiry, still valid).
        hid_a = hidroferol.lots.get(lot_number="HID-A")
        hid_b = hidroferol.lots.get(lot_number="HID-B")
        no_sn = hidroferol.lots.get(lot_number="")
        self.assertLess(hid_a.expiry_date, hid_b.expiry_date)
        # The no-SN lot must have an expiry_date so the dedup-by-expiry
        # path has a target.
        self.assertIsNotNone(no_sn.expiry_date)

    def test_glucose_sensors_is_expiry_reached(self):
        """Glucose sensors carry the `expiry_severity='reached'` demo case."""
        call_command("seed")
        sensors = Stock.objects.get(name="Glucose monitor sensors")
        self.assertEqual(sensors.lots.count(), 1)
        lot = sensors.lots.get()
        self.assertEqual(lot.lot_number, "SEN-OLD")
        # Expired but still at qty>0 (bulk_create bypasses delete_empty_lot).
        self.assertGreater(lot.quantity, 0)
        from datetime import date

        self.assertLess(lot.expiry_date, date.today())

    def test_ebastine_has_three_sn_lots(self):
        """`offline-read.spec.js` iterates SEED.lots.EBASTINE_LOTS and the
        FEFO modal needs 3 distinguishable lots with SN."""
        call_command("seed")
        ebastine = Stock.objects.get(name="Ebastine")
        lots = list(ebastine.lots.order_by("expiry_date"))
        self.assertEqual(len(lots), 3)
        # FEFO order by expiry must yield EBA-1, EBA-2, EBA-3.
        self.assertEqual([lot.lot_number for lot in lots], ["EBA-1", "EBA-2", "EBA-3"])

    def test_brita_filter_has_no_sn_no_expiry_single_lot(self):
        """`stock-expiry.spec.js` "lot without expiry_date is not flagged"
        and `routine-completion.spec.js` Undo flow both rely on this
        shape: 1 lot, qty=1, no SN, no expiry_date."""
        call_command("seed")
        brita = Stock.objects.get(name="Brita filter cartridges")
        self.assertEqual(brita.lots.count(), 1)
        lot = brita.lots.get()
        self.assertEqual(lot.quantity, 1)
        self.assertEqual(lot.lot_number, "")
        self.assertIsNone(lot.expiry_date)

    def test_ibuprofen_is_multi_lot_same_sku(self):
        """Multi-lot same-SKU exercises FEFO ordering on the lot picker."""
        call_command("seed")
        ibuprofen = Stock.objects.get(name="Ibuprofen 600mg")
        lots = ibuprofen.lots.all()
        self.assertEqual(lots.count(), 2)
        sns = {lot.lot_number for lot in lots}
        self.assertEqual(sns, {"IBU-1", "IBU-2"})
        # IBU-1 must be the FEFO front: shorter expiry than IBU-2.
        ibu1 = ibuprofen.lots.get(lot_number="IBU-1")
        ibu2 = ibuprofen.lots.get(lot_number="IBU-2")
        self.assertLess(ibu1.expiry_date, ibu2.expiry_date)

    def test_ipl_hair_removal_has_no_entries(self):
        """The only never-started routine in the seed."""
        call_command("seed")
        ipl = Routine.objects.get(name="IPL hair removal")
        self.assertEqual(ipl.entries.count(), 0)

    def test_high_volume_routines_have_realistic_history(self):
        """Daily routines drive the /history pagination tests."""
        call_command("seed")
        antihistamine = Routine.objects.get(name="Take antihistamine")
        bcp = Routine.objects.get(name="Take birth control pill")
        vitamin_d = Routine.objects.get(name="Take Vitamin D")
        self.assertGreaterEqual(antihistamine.entries.count(), 14)
        self.assertGreaterEqual(bcp.entries.count(), 14)
        self.assertGreaterEqual(vitamin_d.entries.count(), 6)

    def test_upcoming_routines_are_not_due(self):
        """`is_due()` rounds to the user's local date — verify our timing."""
        call_command("seed")
        for name in ("Replace glucose sensor", "Fertilize orchid", "Descale coffee machine"):
            routine = Routine.objects.get(name=name)
            self.assertFalse(
                routine.is_due(),
                msg=f"{name} must evaluate as upcoming (not due) right after seed.",
            )

    def test_overdue_routine_is_due_and_overdue(self):
        """Take Vitamin D is the canonical overdue case."""
        call_command("seed")
        vitamin_d = Routine.objects.get(name="Take Vitamin D")
        self.assertTrue(vitamin_d.is_due())
        self.assertTrue(vitamin_d.is_overdue())

    def test_due_routine_not_overdue(self):
        """Daily routines (24h) land due-today but not overdue (offset -2h)."""
        call_command("seed")
        for name in ("Take antihistamine", "Take birth control pill", "Water cactus"):
            routine = Routine.objects.get(name=name)
            self.assertTrue(routine.is_due(), msg=f"{name} should be due")
            self.assertFalse(routine.is_overdue(), msg=f"{name} should not be overdue")

    def test_due_routine_seeded_near_local_midnight_does_not_flake(self):
        """Regression: a +2h "due" offset must not push next_due_at into the
        next local day when seed runs late in the user's TZ.

        cibran's timezone is Europe/Madrid. We freeze `now()` at 23:55 CEST
        (= 21:55 UTC summer) — naive +2h would land at 01:55 next day local
        and `is_due()` would return False. The fix caps the target so it
        always sits inside today's local date.
        """
        # 2026-07-15 21:55 UTC = 2026-07-15 23:55 CEST (summer offset +02:00).
        frozen_now = datetime(2026, 7, 15, 21, 55, 0, tzinfo=timezone.utc)
        with mock.patch(
            "apps.core.management.commands.seed.timezone.now",
            return_value=frozen_now,
        ):
            call_command("seed")
        with mock.patch("django.utils.timezone.now", return_value=frozen_now):
            for name in ("Take antihistamine", "Take birth control pill", "Water cactus"):
                routine = Routine.objects.get(name=name)
                self.assertTrue(
                    routine.is_due(),
                    msg=f"{name} should be due even when seeded close to local midnight",
                )
                self.assertFalse(
                    routine.is_overdue(),
                    msg=f"{name} should not be overdue right after seed",
                )

    def test_idempotent(self):
        call_command("seed")
        first_counts = (
            User.objects.filter(is_superuser=False).count(),
            Routine.objects.count(),
            Stock.objects.count(),
            StockLot.objects.count(),
            RoutineEntry.objects.count(),
            StockConsumption.objects.count(),
        )

        call_command("seed")
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

        call_command("seed")

        self.assertFalse(User.objects.filter(username="victim").exists())
        self.assertFalse(Stock.objects.filter(name="Doomed stock").exists())
        self.assertEqual(PushSubscription.objects.count(), 0)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)

    def test_demo_users_password_env_is_honoured(self):
        """`DEMO_USERS_PASSWORD` controls all three demo users."""
        with mock.patch.dict(os.environ, {"DEMO_USERS_PASSWORD": "test-pw-xyz"}):
            call_command("seed")
        for username in ("cibran", "maria", "laura"):
            user = User.objects.get(username=username)
            self.assertTrue(user.check_password("test-pw-xyz"), msg=f"{username} password mismatch")


class SeedGateTest(TestCase):
    """The triple gate keeps the destructive command out of production."""

    @override_settings(DEBUG=False)
    def test_refuses_without_env_and_debug_off(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("E2E_SEED_ALLOWED", None)
            with self.assertRaises(CommandError):
                call_command("seed")

    @override_settings(DEBUG=False)
    def test_runs_with_env_gate(self):
        with mock.patch.dict(os.environ, {"E2E_SEED_ALLOWED": "true"}):
            call_command("seed")
        self.assertTrue(User.objects.filter(username="cibran").exists())


class SeedEndpointTest(APITestCase):
    @override_settings(DEBUG=True)
    def test_post_triggers_seed(self):
        response = self.client.post("/api/internal/seed/")
        self.assertEqual(response.status_code, 204)
        self.assertTrue(User.objects.filter(username="cibran").exists())

    @override_settings(DEBUG=False)
    def test_post_forbidden_without_gate(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("E2E_SEED_ALLOWED", None)
            response = self.client.post("/api/internal/seed/")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username="cibran").exists())

    def test_legacy_endpoint_returns_404(self):
        """The old `/api/internal/e2e-seed/` path must no longer exist."""
        response = self.client.post("/api/internal/e2e-seed/")
        self.assertEqual(response.status_code, 404)

    @override_settings(DEBUG=False)
    def test_post_forbidden_with_explicit_empty_env_var(self):
        """The production `docker-compose.yml` hard-sets `E2E_SEED_ALLOWED=""`
        to defend against `.env` drift. The view must still refuse: an
        empty string is not the literal `"true"`, regardless of how it
        got into the environment."""
        with mock.patch.dict(os.environ, {"E2E_SEED_ALLOWED": ""}):
            response = self.client.post("/api/internal/seed/")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username="cibran").exists())

    @override_settings(DEBUG=False)
    def test_post_forbidden_with_truthy_but_not_literal_true(self):
        """`E2E_SEED_ALLOWED` must be the literal string "true"; "1" or
        "yes" do not unlock the gate. Pins the contract."""
        for impostor in ("1", "yes", "True ", "TRUE\n"):
            with mock.patch.dict(os.environ, {"E2E_SEED_ALLOWED": impostor}):
                response = self.client.post("/api/internal/seed/")
            self.assertEqual(
                response.status_code,
                403,
                msg=f"Impostor value {impostor!r} should not unlock the gate",
            )


# ── IsOwner permission ──────────────────────────────────────────────────────


class IsOwnerPermissionTest(TestCase):
    """Unit tests for the object-level IsOwner permission."""

    def setUp(self):
        self.factory = RequestFactory()
        self.owner = User.objects.create_user(username="owner-perm", password="pw")
        self.other = User.objects.create_user(username="other-perm", password="pw")

    def _make_request(self, user):
        request = self.factory.get("/")
        request.user = user
        return request

    def _make_obj(self, user):
        return type("Obj", (), {"user": user})()

    def test_grants_access_to_owner(self):
        request = self._make_request(self.owner)
        obj = self._make_obj(self.owner)
        self.assertTrue(IsOwner().has_object_permission(request, None, obj))

    def test_denies_access_to_non_owner(self):
        request = self._make_request(self.other)
        obj = self._make_obj(self.owner)
        self.assertFalse(IsOwner().has_object_permission(request, None, obj))

    def test_message_is_user_facing(self):
        self.assertEqual(IsOwner.message, "Only the owner can modify this resource.")


# ── SharedWithMixin ─────────────────────────────────────────────────────────


class _MockSerializer(SharedWithMixin, drf_serializers.Serializer):
    """Minimal serializer used to exercise SharedWithMixin in isolation."""

    pass


class _MockObj:
    """Stand-in for a model instance with a `shared_with` related manager."""

    def __init__(self, users):
        self._users = users

    @property
    def shared_with(self):
        # Simulate a Django related manager with `.all()`.
        outer = self

        class _Manager:
            def all(self_inner):
                return outer._users

        return _Manager()


class SharedWithMixinTest(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.user = User.objects.create_user(username="cibran-mix", password="pw")
        self.contact = User.objects.create_user(
            username="maria-mix",
            password="pw",
            first_name="María",
            last_name="González",
        )
        self.stranger = User.objects.create_user(username="stranger-mix", password="pw")
        self.user.contacts.add(self.contact)

    def _serializer(self):
        request = self.factory.get("/")
        request.user = self.user
        return _MockSerializer(context={"request": request})

    def test_validate_shared_with_accepts_contact(self):
        result = self._serializer().validate_shared_with([self.contact])
        self.assertEqual(result, [self.contact])

    def test_validate_shared_with_rejects_non_contact(self):
        with self.assertRaises(drf_serializers.ValidationError):
            self._serializer().validate_shared_with([self.stranger])

    def test_validate_shared_with_returns_value_without_request(self):
        # When no request in context, the mixin returns the value unchanged
        # (defensive fallback for serializers used outside the API flow).
        serializer = _MockSerializer(context={})
        result = serializer.validate_shared_with([self.stranger])
        self.assertEqual(result, [self.stranger])

    def test_get_shared_with_details_returns_full_dicts(self):
        obj = _MockObj([self.contact])
        details = _MockSerializer().get_shared_with_details(obj)
        self.assertEqual(len(details), 1)
        self.assertEqual(
            details[0],
            {
                "id": self.contact.pk,
                "username": "maria-mix",
                "first_name": "María",
                "last_name": "González",
            },
        )

    def test_get_shared_with_details_returns_empty_list_for_no_shares(self):
        obj = _MockObj([])
        details = _MockSerializer().get_shared_with_details(obj)
        self.assertEqual(details, [])
