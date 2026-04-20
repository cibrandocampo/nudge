import os
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APITestCase

from .models import validate_timezone

User = get_user_model()


# ── validate_timezone ────────────────────────────────────────────────────────


class ValidateTimezoneTest(TestCase):
    def test_valid_timezone_utc(self):
        # Should not raise
        validate_timezone("UTC")

    def test_valid_timezone_europe_madrid(self):
        validate_timezone("Europe/Madrid")

    def test_valid_timezone_america_new_york(self):
        validate_timezone("America/New_York")

    def test_invalid_timezone_raises(self):
        with self.assertRaises(ValidationError):
            validate_timezone("Not/ATimezone")

    def test_empty_string_raises(self):
        with self.assertRaises(ValidationError):
            validate_timezone("")


# ── User model ───────────────────────────────────────────────────────────────


class UserModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="testuser",
            password="pass",
        )
        self.user.refresh_from_db()

    def test_default_timezone_is_utc(self):
        self.assertEqual(self.user.timezone, "UTC")

    def test_default_daily_notification_time(self):
        from datetime import time

        self.assertEqual(self.user.daily_notification_time, time(8, 30))

    def test_str_returns_username(self):
        self.assertEqual(str(self.user), "testuser")

    def test_invalid_timezone_fails_validation(self):
        self.user.timezone = "Invalid/Zone"
        with self.assertRaises(ValidationError):
            self.user.full_clean()

    def test_valid_timezone_passes_validation(self):
        self.user.timezone = "Europe/London"
        # Should not raise
        self.user.full_clean()

    def test_default_language_is_en(self):
        self.assertEqual(self.user.language, "en")

    def test_language_accepts_all_valid_choices(self):
        for code in ("en", "es", "gl"):
            self.user.language = code
            self.user.full_clean()  # should not raise

    def test_invalid_language_fails_validation(self):
        self.user.language = "fr"
        with self.assertRaises(ValidationError):
            self.user.full_clean()


# ── /api/auth/token/ ─────────────────────────────────────────────────────────


class TokenAuthTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="secret")
        self.url = "/api/auth/token/"

    def test_obtain_token_with_valid_credentials(self):
        response = self.client.post(self.url, {"username": "alice", "password": "secret"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())
        self.assertIn("refresh", response.json())

    def test_obtain_token_with_wrong_password(self):
        response = self.client.post(self.url, {"username": "alice", "password": "wrong"})
        self.assertEqual(response.status_code, 401)

    def test_obtain_token_with_missing_fields(self):
        response = self.client.post(self.url, {"username": "alice"})
        self.assertEqual(response.status_code, 400)

    def test_refresh_token(self):
        obtain = self.client.post(self.url, {"username": "alice", "password": "secret"})
        refresh = obtain.json()["refresh"]
        response = self.client.post("/api/auth/refresh/", {"refresh": refresh})
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.json())


# ── /api/auth/me/ ────────────────────────────────────────────────────────────


class MeViewTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="bob",
            email="bob@example.com",
            password="pass",
            timezone="Europe/Madrid",
        )
        self.user.refresh_from_db()
        self.client.force_authenticate(user=self.user)

    def test_get_me_returns_200(self):
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)

    def test_get_me_returns_user_fields(self):
        response = self.client.get("/api/auth/me/")
        data = response.json()
        self.assertEqual(data["username"], "bob")
        self.assertEqual(data["email"], "bob@example.com")
        self.assertEqual(data["timezone"], "Europe/Madrid")
        self.assertIn("daily_notification_time", data)

    def test_get_me_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 401)

    def test_patch_me_updates_timezone(self):
        response = self.client.patch("/api/auth/me/", {"timezone": "America/New_York"})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.timezone, "America/New_York")

    def test_patch_me_updates_daily_notification_time(self):
        response = self.client.patch("/api/auth/me/", {"daily_notification_time": "09:00"})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        from datetime import time

        self.assertEqual(self.user.daily_notification_time, time(9, 0))

    def test_patch_me_with_invalid_timezone_returns_400(self):
        response = self.client.patch("/api/auth/me/", {"timezone": "Invalid/Zone"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("timezone", response.json())

    def test_patch_me_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.patch("/api/auth/me/", {"timezone": "UTC"})
        self.assertEqual(response.status_code, 401)

    def test_patch_me_is_partial(self):
        """Sending only one field should not clear the other."""
        original_time = self.user.daily_notification_time
        self.client.patch("/api/auth/me/", {"timezone": "UTC"})
        self.user.refresh_from_db()
        self.assertEqual(self.user.daily_notification_time, original_time)

    def test_get_me_returns_language(self):
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("language", response.json())
        self.assertEqual(response.json()["language"], "en")

    def test_patch_me_updates_language(self):
        response = self.client.patch("/api/auth/me/", {"language": "es"})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.language, "es")

    def test_patch_me_language_gl(self):
        response = self.client.patch("/api/auth/me/", {"language": "gl"})
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.language, "gl")

    def test_patch_me_invalid_language_returns_400(self):
        response = self.client.patch("/api/auth/me/", {"language": "fr"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("language", response.json())


# ── settings_updated_at ──────────────────────────────────────────────────────


class SettingsUpdatedAtTest(APITestCase):
    """
    `settings_updated_at` acts as an ETag for optimistic concurrency on
    /api/auth/me/. It must bump only when a SETTINGS field changes.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username="carol",
            password="pass",
            timezone="UTC",
            language="en",
        )
        self.client.force_authenticate(user=self.user)

    def _snapshot(self):
        self.user.refresh_from_db()
        return self.user.settings_updated_at

    def test_get_me_returns_settings_updated_at(self):
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("settings_updated_at", response.json())
        self.assertIsNotNone(response.json()["settings_updated_at"])

    def test_patch_timezone_bumps(self):
        before = self._snapshot()
        response = self.client.patch("/api/auth/me/", {"timezone": "Europe/Madrid"})
        self.assertEqual(response.status_code, 200)
        after = self._snapshot()
        self.assertGreater(after, before)

    def test_patch_daily_notification_time_bumps(self):
        before = self._snapshot()
        response = self.client.patch("/api/auth/me/", {"daily_notification_time": "09:45"})
        self.assertEqual(response.status_code, 200)
        after = self._snapshot()
        self.assertGreater(after, before)

    def test_patch_language_bumps(self):
        before = self._snapshot()
        response = self.client.patch("/api/auth/me/", {"language": "es"})
        self.assertEqual(response.status_code, 200)
        after = self._snapshot()
        self.assertGreater(after, before)

    def test_patch_same_value_does_not_bump(self):
        # Re-PATCHing the same value should not move the timestamp.
        before = self._snapshot()
        response = self.client.patch("/api/auth/me/", {"timezone": "UTC"})
        self.assertEqual(response.status_code, 200)
        after = self._snapshot()
        self.assertEqual(after, before)


# ── me() optimistic concurrency ─────────────────────────────────────────────


class MeOptimisticLockingTest(APITestCase):
    """
    /api/auth/me/ PATCH respects If-Unmodified-Since via settings_updated_at.
    """

    STALE_HEADER = "Wed, 01 Jan 2020 00:00:00 GMT"

    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="pw")
        self.client.force_authenticate(user=self.user)

    def _current_header(self):
        self.user.refresh_from_db()
        return self.user.settings_updated_at.strftime("%a, %d %b %Y %H:%M:%S GMT")

    def test_patch_without_header_succeeds(self):
        response = self.client.patch("/api/auth/me/", {"timezone": "Europe/Madrid"})
        self.assertEqual(response.status_code, 200)

    def test_patch_with_current_header_succeeds(self):
        response = self.client.patch(
            "/api/auth/me/",
            {"timezone": "Europe/Madrid"},
            HTTP_IF_UNMODIFIED_SINCE=self._current_header(),
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.timezone, "Europe/Madrid")

    def test_patch_with_stale_header_returns_412(self):
        response = self.client.patch(
            "/api/auth/me/",
            {"timezone": "Europe/Madrid"},
            HTTP_IF_UNMODIFIED_SINCE=self.STALE_HEADER,
        )
        self.assertEqual(response.status_code, 412)
        body = response.json()
        self.assertEqual(body["error"], "conflict")
        self.assertIn("current", body)
        self.assertEqual(body["current"]["username"], "alice")
        self.assertIn("settings_updated_at", body["current"])
        self.user.refresh_from_db()
        self.assertNotEqual(self.user.timezone, "Europe/Madrid")

    def test_patch_with_malformed_header_returns_400(self):
        response = self.client.patch(
            "/api/auth/me/",
            {"timezone": "Europe/Madrid"},
            HTTP_IF_UNMODIFIED_SINCE="not-a-date",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())


# ── ensure_admin management command ─────────────────────────────────────────


class EnsureAdminCommandTest(TestCase):
    def _call(self, env_overrides=None):
        out = StringIO()
        env = {
            "ADMIN_USERNAME": "admin",
            "ADMIN_EMAIL": "admin@example.com",
            "ADMIN_PASSWORD": "testpass123",
        }
        if env_overrides:
            env.update(env_overrides)
        with patch.dict(os.environ, env, clear=False):
            call_command("ensure_admin", stdout=out)
        return out.getvalue()

    def test_creates_superuser_when_none_exists(self):
        output = self._call()
        self.assertTrue(User.objects.filter(is_superuser=True).exists())
        self.assertIn("created", output)

    def test_does_not_create_when_superuser_already_exists(self):
        User.objects.create_superuser(username="existing", password="pass", email="")
        self._call()
        # Only the pre-existing superuser should exist
        self.assertEqual(User.objects.filter(is_superuser=True).count(), 1)

    def test_skips_without_password_env_var(self):
        output = self._call(env_overrides={"ADMIN_PASSWORD": ""})
        self.assertFalse(User.objects.filter(is_superuser=True).exists())
        self.assertIn("ADMIN_PASSWORD", output)

    def test_uses_env_var_username(self):
        self._call(env_overrides={"ADMIN_USERNAME": "myadmin"})
        self.assertTrue(User.objects.filter(username="myadmin", is_superuser=True).exists())


# ── /api/auth/change-password/ ──────────────────────────────────────────────


class ChangePasswordTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="old-password-123")
        self.client.force_authenticate(user=self.user)
        self.url = "/api/auth/change-password/"

    def test_change_password_success(self):
        response = self.client.post(
            self.url,
            {
                "current_password": "old-password-123",
                "new_password": "new-password-456",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("new-password-456"))

    def test_wrong_current_password_returns_400(self):
        response = self.client.post(
            self.url,
            {
                "current_password": "wrong",
                "new_password": "new-password-456",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("old-password-123"))

    def test_short_new_password_returns_400(self):
        response = self.client.post(
            self.url,
            {
                "current_password": "old-password-123",
                "new_password": "short",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("old-password-123"))

    def test_unauthenticated_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            self.url,
            {
                "current_password": "old-password-123",
                "new_password": "new-password-456",
            },
        )
        self.assertEqual(response.status_code, 401)


# ── /api/auth/admin-access/ ─────────────────────────────────────────────────


# ── /api/auth/contacts/ ───────────────────────────────────────────────────


class ContactTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username="alice", password="pass")
        self.bob = User.objects.create_user(username="bob", password="pass")
        self.carol = User.objects.create_user(username="carol", password="pass")
        self.inactive = User.objects.create_user(username="inactive", password="pass", is_active=False)
        self.client.force_authenticate(user=self.alice)
        self.url = "/api/auth/contacts/"

    def test_list_contacts_empty(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_add_contact(self):
        response = self.client.post(self.url, {"username": "bob"})
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["username"], "bob")
        self.assertEqual(data["id"], self.bob.pk)

    def test_list_contacts_after_add(self):
        self.alice.contacts.add(self.bob)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        usernames = [c["username"] for c in response.json()]
        self.assertIn("bob", usernames)

    def test_add_contact_case_insensitive(self):
        response = self.client.post(self.url, {"username": "BOB"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["username"], "bob")

    def test_add_self_returns_400(self):
        response = self.client.post(self.url, {"username": "alice"})
        self.assertEqual(response.status_code, 400)

    def test_add_nonexistent_user_returns_404(self):
        response = self.client.post(self.url, {"username": "nobody"})
        self.assertEqual(response.status_code, 404)

    def test_add_inactive_user_returns_404(self):
        response = self.client.post(self.url, {"username": "inactive"})
        self.assertEqual(response.status_code, 404)

    def test_add_duplicate_returns_400(self):
        self.alice.contacts.add(self.bob)
        response = self.client.post(self.url, {"username": "bob"})
        self.assertEqual(response.status_code, 400)

    def test_bidirectional(self):
        self.client.post(self.url, {"username": "bob"})
        self.client.force_authenticate(user=self.bob)
        response = self.client.get(self.url)
        usernames = [c["username"] for c in response.json()]
        self.assertIn("alice", usernames)

    def test_remove_contact(self):
        self.alice.contacts.add(self.bob)
        response = self.client.delete(f"{self.url}{self.bob.pk}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(self.alice.contacts.filter(pk=self.bob.pk).exists())
        self.assertFalse(self.bob.contacts.filter(pk=self.alice.pk).exists())

    def test_remove_non_contact_returns_404(self):
        response = self.client.delete(f"{self.url}{self.carol.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_search_contacts(self):
        response = self.client.get(f"{self.url}search/", {"q": "bo"})
        self.assertEqual(response.status_code, 200)
        usernames = [c["username"] for c in response.json()]
        self.assertIn("bob", usernames)
        self.assertNotIn("alice", usernames)

    def test_search_excludes_self(self):
        response = self.client.get(f"{self.url}search/", {"q": "ali"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_search_excludes_existing_contacts(self):
        self.alice.contacts.add(self.bob)
        response = self.client.get(f"{self.url}search/", {"q": "bo"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_search_excludes_inactive(self):
        response = self.client.get(f"{self.url}search/", {"q": "inac"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_search_with_empty_query_returns_empty_list(self):
        # Guard: `q=` (or missing) must short-circuit to [] instead of
        # leaking every user via an unfiltered `username__istartswith=""`.
        response = self.client.get(f"{self.url}search/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_add_contact_with_empty_username_returns_400(self):
        response = self.client.post(self.url, {"username": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Username is required."})

    def test_unauthenticated_list_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_add_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(self.url, {"username": "bob"})
        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_delete_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.delete(f"{self.url}{self.bob.pk}/")
        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_search_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(f"{self.url}search/", {"q": "bo"})
        self.assertEqual(response.status_code, 401)


# ── ensure_e2e_users management command ─────────────────────────────────────


class EnsureE2eUsersCommandTest(TestCase):
    def _call(self, env_overrides=None):
        out = StringIO()
        env = {
            "E2E_USER2_USERNAME": "e2e-user2",
            "E2E_USER2_PASSWORD": "e2e-pass2",
        }
        if env_overrides:
            env.update(env_overrides)
        with patch.dict(os.environ, env, clear=False):
            call_command("ensure_e2e_users", stdout=out)
        return out.getvalue()

    def test_creates_user_when_not_exists(self):
        output = self._call()
        self.assertTrue(User.objects.filter(username="e2e-user2").exists())
        self.assertIn("created", output)

    def test_updates_user_when_already_exists(self):
        User.objects.create_user(username="e2e-user2", password="old-pass")
        output = self._call()
        self.assertEqual(User.objects.filter(username="e2e-user2").count(), 1)
        self.assertIn("updated", output)

    def test_uses_env_var_username(self):
        self._call(env_overrides={"E2E_USER2_USERNAME": "custom-e2e"})
        self.assertTrue(User.objects.filter(username="custom-e2e").exists())

    def test_password_is_set(self):
        self._call(env_overrides={"E2E_USER2_PASSWORD": "new-pass-123"})
        user = User.objects.get(username="e2e-user2")
        self.assertTrue(user.check_password("new-pass-123"))

    def test_idempotent(self):
        self._call()
        self._call()
        self.assertEqual(User.objects.filter(username="e2e-user2").count(), 1)


# ── /api/auth/admin-access/ ─────────────────────────────────────────────────


class AdminAccessTest(APITestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            username="staffuser",
            password="pass",
            is_staff=True,
        )
        self.regular = User.objects.create_user(
            username="regular",
            password="pass",
            is_staff=False,
        )
        self.url = "/api/auth/admin-access/"

    def _get_token(self, user):
        response = self.client.post(
            "/api/auth/token/",
            {
                "username": user.username,
                "password": "pass",
            },
        )
        return response.json()["access"]

    def test_staff_user_redirects_to_admin(self):
        token = self._get_token(self.staff)
        response = self.client.post(self.url, {"token": token})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, "/admin/")

    def test_non_staff_user_returns_403(self):
        token = self._get_token(self.regular)
        response = self.client.post(self.url, {"token": token})
        self.assertEqual(response.status_code, 403)

    def test_invalid_token_returns_403(self):
        response = self.client.post(self.url, {"token": "garbage"})
        self.assertEqual(response.status_code, 403)

    def test_get_method_returns_403(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 403)
