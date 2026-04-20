from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.routines.models import Routine

from .models import IdempotencyRecord
from .tasks import cleanup_idempotency_records

User = get_user_model()


def auth_headers(user):
    """Build a real JWT Authorization header — required because the
    idempotency middleware authenticates requests itself, not via
    APIClient.force_authenticate (which only sets the user at DRF view level)."""
    token = RefreshToken.for_user(user).access_token
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class MiddlewareTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pw")
        self.other = User.objects.create_user(username="bob", password="pw")
        self.auth = auth_headers(self.user)

    # ── No header ────────────────────────────────────────────────────────────
    def test_no_header_passes_through(self):
        response = self.client.post(
            "/api/routines/",
            {"name": "R1", "interval_hours": 24, "is_active": True},
            **self.auth,
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)

    # ── First request + replay (same body) ───────────────────────────────────
    def test_first_request_creates_record_and_replay_returns_cached(self):
        payload = {"name": "Replay", "interval_hours": 12, "is_active": True}
        headers = {**self.auth, "HTTP_IDEMPOTENCY_KEY": "abc-123"}

        first = self.client.post("/api/routines/", payload, **headers)
        self.assertEqual(first.status_code, 201)
        first_body = first.json()
        routine_id = first_body["id"]

        self.assertEqual(IdempotencyRecord.objects.count(), 1)
        record = IdempotencyRecord.objects.get()
        self.assertEqual(record.key, "abc-123")
        self.assertEqual(record.user, self.user)
        self.assertEqual(record.method, "POST")
        self.assertEqual(record.endpoint, "/api/routines/")
        self.assertEqual(record.response_status, 201)

        # Replay with the same key + body
        second = self.client.post("/api/routines/", payload, **headers)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second.json(), first_body)

        # No second routine was created
        self.assertEqual(Routine.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Routine.objects.filter(pk=routine_id).count(), 1)

    # ── Replay with different body → 422 ─────────────────────────────────────
    def test_replay_with_different_body_returns_422(self):
        headers = {**self.auth, "HTTP_IDEMPOTENCY_KEY": "reuse-key"}
        self.client.post(
            "/api/routines/",
            {"name": "First", "interval_hours": 24, "is_active": True},
            **headers,
        )
        response = self.client.post(
            "/api/routines/",
            {"name": "Different", "interval_hours": 48, "is_active": True},
            **headers,
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("error", response.json())

    # ── Unauthenticated request ──────────────────────────────────────────────
    def test_unauthenticated_passes_through(self):
        # No auth header → JWT auth fails → middleware bypasses, view returns 401
        response = self.client.post(
            "/api/routines/",
            {"name": "R", "interval_hours": 24},
            HTTP_IDEMPOTENCY_KEY="xyz",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)

    # ── GET not processed ────────────────────────────────────────────────────
    def test_get_is_not_processed(self):
        response = self.client.get(
            "/api/routines/",
            HTTP_IDEMPOTENCY_KEY="should-ignore",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)

    # ── Non-/api path not processed ──────────────────────────────────────────
    def test_non_api_path_is_not_a_candidate(self):
        # Unit-test the candidate check directly to avoid pulling in admin
        # template rendering (which needs staticfiles collected).
        from django.test import RequestFactory

        from .middleware import IdempotencyMiddleware

        factory = RequestFactory()
        request = factory.post("/admin/login/", {"x": "y"})
        self.assertFalse(IdempotencyMiddleware._is_candidate(request))

        api_request = factory.post("/api/routines/", {})
        self.assertTrue(IdempotencyMiddleware._is_candidate(api_request))

    # ── 5xx response not cached ──────────────────────────────────────────────
    def test_server_error_not_cached(self):
        # Patch the viewset to raise, forcing a 500.
        from rest_framework.viewsets import ModelViewSet

        with patch.object(ModelViewSet, "create", side_effect=RuntimeError("boom")):
            headers = {**self.auth, "HTTP_IDEMPOTENCY_KEY": "fails"}
            with self.assertRaises(RuntimeError):
                self.client.post(
                    "/api/routines/",
                    {"name": "R", "interval_hours": 24, "is_active": True},
                    **headers,
                )
        self.assertEqual(IdempotencyRecord.objects.count(), 0)

    # ── 4xx response IS cached ───────────────────────────────────────────────
    def test_client_error_is_cached(self):
        # Invalid payload → 400. Still cached so retries return the same error.
        headers = {**self.auth, "HTTP_IDEMPOTENCY_KEY": "bad-payload"}
        first = self.client.post("/api/routines/", {}, **headers)
        self.assertEqual(first.status_code, 400)
        self.assertEqual(IdempotencyRecord.objects.count(), 1)

        second = self.client.post("/api/routines/", {}, **headers)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json(), first.json())

    # ── Same key for two different users is independent ──────────────────────
    def test_same_key_different_users_is_independent(self):
        headers_a = {**self.auth, "HTTP_IDEMPOTENCY_KEY": "shared-uuid"}
        headers_b = {**auth_headers(self.other), "HTTP_IDEMPOTENCY_KEY": "shared-uuid"}
        payload = {"name": "R", "interval_hours": 24, "is_active": True}

        r1 = self.client.post("/api/routines/", payload, **headers_a)
        r2 = self.client.post("/api/routines/", payload, **headers_b)
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(IdempotencyRecord.objects.count(), 2)
        self.assertNotEqual(r1.json()["id"], r2.json()["id"])

    # ── Oversized key is ignored ─────────────────────────────────────────────
    def test_oversized_key_is_ignored(self):
        headers = {**self.auth, "HTTP_IDEMPOTENCY_KEY": "x" * 100}
        response = self.client.post(
            "/api/routines/",
            {"name": "R", "interval_hours": 24, "is_active": True},
            **headers,
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)


class CleanupTaskTest(TestCase):
    def test_cleanup_deletes_old_and_preserves_recent(self):
        user = User.objects.create_user(username="alice", password="pw")

        fresh = IdempotencyRecord.objects.create(
            user=user,
            key="fresh",
            endpoint="/api/x/",
            method="POST",
            body_hash="h1",
            response_status=201,
            response_body={},
        )
        stale = IdempotencyRecord.objects.create(
            user=user,
            key="stale",
            endpoint="/api/x/",
            method="POST",
            body_hash="h2",
            response_status=201,
            response_body={},
        )
        IdempotencyRecord.objects.filter(pk=stale.pk).update(created_at=timezone.now() - timedelta(days=8))

        deleted = cleanup_idempotency_records()

        self.assertEqual(deleted, 1)
        self.assertTrue(IdempotencyRecord.objects.filter(pk=fresh.pk).exists())
        self.assertFalse(IdempotencyRecord.objects.filter(pk=stale.pk).exists())


class IdempotencyRecordStrTest(TestCase):
    def test_str_truncates_key_and_shows_user_and_endpoint(self):
        user = User.objects.create_user(username="alice", password="pw")
        record = IdempotencyRecord.objects.create(
            user=user,
            key="abcdefghijklmnop",  # 16 chars; first 8 shown
            endpoint="/api/routines/",
            method="POST",
            body_hash="h",
            response_status=201,
            response_body={},
        )
        self.assertEqual(str(record), "alice POST /api/routines/ [abcdefgh…]")


class IdempotencyRecordAdminTest(TestCase):
    def setUp(self):
        from django.contrib.admin.sites import AdminSite

        from .admin import IdempotencyRecordAdmin

        self.admin = IdempotencyRecordAdmin(IdempotencyRecord, AdminSite())

    def test_add_permission_is_denied(self):
        # Admins cannot create idempotency records manually — they are
        # written by the middleware only.
        self.assertFalse(self.admin.has_add_permission(request=None))

    def test_change_permission_is_denied(self):
        # Records are immutable snapshots of a past response.
        self.assertFalse(self.admin.has_change_permission(request=None))
        self.assertFalse(self.admin.has_change_permission(request=None, obj=object()))
