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
