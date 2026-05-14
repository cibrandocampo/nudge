import os
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from .models import LoginCode, validate_timezone

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
            email="testuser@example.com",
        )
        self.user.refresh_from_db()

    def test_default_timezone_is_utc(self):
        self.assertEqual(self.user.timezone, "UTC")

    def test_default_daily_notification_time(self):
        from datetime import time

        self.assertEqual(self.user.daily_notification_time, time(8, 30))

    def test_str_returns_display_name_falls_back_to_email(self):
        # No first/last name → display_name (and __str__) falls back to email.
        self.assertEqual(str(self.user), "testuser@example.com")

    def test_default_auth_method_is_otp(self):
        self.assertEqual(self.user.auth_method, "otp")

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


# ── User.display_name ────────────────────────────────────────────────────────


class DisplayNameTest(TestCase):
    def test_first_and_last_name_concatenated(self):
        u = User.objects.create_user(
            username="dn1",
            password="pw",
            email="dn1@example.com",
            first_name="Ada",
            last_name="Lovelace",
        )
        self.assertEqual(u.display_name, "Ada Lovelace")
        self.assertEqual(str(u), "Ada Lovelace")

    def test_only_first_name(self):
        u = User.objects.create_user(
            username="dn2",
            password="pw",
            email="dn2@example.com",
            first_name="Grace",
        )
        self.assertEqual(u.display_name, "Grace")

    def test_only_last_name(self):
        u = User.objects.create_user(
            username="dn3",
            password="pw",
            email="dn3@example.com",
            last_name="Hopper",
        )
        self.assertEqual(u.display_name, "Hopper")

    def test_falls_back_to_email_when_no_names(self):
        u = User.objects.create_user(username="dn4", password="pw", email="dn4@example.com")
        self.assertEqual(u.display_name, "dn4@example.com")


# ── User.email unique constraint ─────────────────────────────────────────────


class EmailUniqueTest(TestCase):
    def test_duplicate_email_raises_integrity_error(self):
        User.objects.create_user(username="u1", password="pw", email="dup@example.com")
        with self.assertRaises(IntegrityError):
            User.objects.create_user(username="u2", password="pw", email="dup@example.com")


# ── LoginCode model ──────────────────────────────────────────────────────────


class LoginCodeTest(TestCase):
    # Known SHA-256 digest for the literal string "123456" — hardcoded so the
    # test fails loudly if the hashing scheme ever changes silently.
    EXPECTED_HASH_123456 = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"

    def test_hash_code_is_sha256_hex(self):
        self.assertEqual(LoginCode.hash_code("123456"), self.EXPECTED_HASH_123456)

    def test_hash_code_is_deterministic(self):
        self.assertEqual(LoginCode.hash_code("abcdef"), LoginCode.hash_code("abcdef"))

    def test_hash_code_differs_for_different_inputs(self):
        self.assertNotEqual(LoginCode.hash_code("000000"), LoginCode.hash_code("000001"))

    def test_create_login_code(self):
        from datetime import timedelta

        from django.utils.timezone import now

        u = User.objects.create_user(username="lc1", password="pw", email="lc1@example.com")
        lc = LoginCode.objects.create(
            user=u,
            code_hash=LoginCode.hash_code("987654"),
            expires_at=now() + timedelta(minutes=10),
        )
        self.assertEqual(lc.attempts, 0)
        self.assertIsNone(lc.consumed_at)
        self.assertEqual(u.login_codes.count(), 1)


# ── apps.users.tasks.send_login_email ────────────────────────────────────────


class SendLoginEmailTaskTest(TestCase):
    """`send_login_email` renders one of two templates per language and
    delivers via the configured EMAIL_BACKEND. Test runs use the locmem
    backend (see settings.py "Test-run quiet mode" block) so we can
    introspect `django.core.mail.outbox`.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username="email-target",
            password="pw",
            email="target@example.com",
        )

    def _send(self, **overrides):
        from django.core import mail

        from .tasks import send_login_email

        mail.outbox = []
        kwargs = {"user_id": self.user.pk, "code": "123456", "is_signup": False, "lang": "en"}
        kwargs.update(overrides)
        send_login_email(**kwargs)
        return mail.outbox

    def test_login_code_en_subject_and_body(self):
        # Default user has no first_name → generic "Welcome back to Nudge"
        outbox = self._send(is_signup=False, lang="en")
        self.assertEqual(len(outbox), 1)
        msg = outbox[0]
        self.assertEqual(msg.to, ["target@example.com"])
        self.assertEqual(msg.subject, "Welcome back to Nudge")
        self.assertIn("123456", msg.body)
        self.assertIn("expires in 10 minutes", msg.body)
        self.assertIn("the Nudge team", msg.body)

    def test_welcome_signup_en_subject_and_body(self):
        outbox = self._send(is_signup=True, lang="en")
        self.assertEqual(len(outbox), 1)
        self.assertEqual(outbox[0].subject, "Welcome to Nudge")
        self.assertIn("123456", outbox[0].body)
        self.assertIn("Welcome to Nudge", outbox[0].body)
        self.assertIn("the Nudge team", outbox[0].body)

    def test_invalid_language_falls_back_to_english(self):
        outbox = self._send(is_signup=False, lang="fr")
        self.assertEqual(outbox[0].subject, "Welcome back to Nudge")

    def test_login_code_es_subject_personalised_when_first_name_set(self):
        self.user.first_name = "Cibrán"
        self.user.save(update_fields=["first_name"])
        outbox = self._send(is_signup=False, lang="es")
        self.assertEqual(outbox[0].subject, "Bienvenido de nuevo, Cibrán")
        self.assertIn("Hola Cibrán", outbox[0].body)
        self.assertIn("el equipo de Nudge", outbox[0].body)
        self.assertIn("123456", outbox[0].body)

    def test_login_code_gl_subject_falls_back_when_no_first_name(self):
        outbox = self._send(is_signup=False, lang="gl")
        self.assertEqual(outbox[0].subject, "Benvido de novo a Nudge")
        self.assertIn("o equipo de Nudge", outbox[0].body)
        self.assertIn("123456", outbox[0].body)

    def test_welcome_signup_es_template_loads(self):
        outbox = self._send(is_signup=True, lang="es")
        self.assertEqual(outbox[0].subject, "Bienvenido a Nudge")

    def test_welcome_signup_gl_template_loads(self):
        outbox = self._send(is_signup=True, lang="gl")
        self.assertEqual(outbox[0].subject, "Benvido a Nudge")

    def test_from_email_uses_default_from_email_setting(self):
        from django.conf import settings as dj_settings

        outbox = self._send()
        self.assertEqual(outbox[0].from_email, dj_settings.DEFAULT_FROM_EMAIL)

    def test_message_is_multipart_with_html_alternative(self):
        # The HTML alternative ships alongside the plain-text body and
        # references the embedded logo via `cid:logo`.
        outbox = self._send(is_signup=False, lang="en")
        msg = outbox[0]
        self.assertEqual(len(msg.alternatives), 1)
        html, mime = msg.alternatives[0]
        self.assertEqual(mime, "text/html")
        self.assertIn("123456", html)
        self.assertIn('src="cid:logo"', html)

    def test_html_uses_localised_strings(self):
        # Sanity check that the {% extends %} chain wires through and
        # the right language block lands in the rendered HTML.
        outbox_es = self._send(is_signup=False, lang="es")
        html_es, _ = outbox_es[0].alternatives[0]
        self.assertIn("el equipo de Nudge", html_es)
        outbox_gl = self._send(is_signup=False, lang="gl")
        html_gl, _ = outbox_gl[0].alternatives[0]
        self.assertIn("o equipo de Nudge", html_gl)

    def test_logo_attached_with_content_id(self):
        outbox = self._send(is_signup=False, lang="en")
        msg = outbox[0]
        # `attach()` adds non-alternative parts to `attachments`. Each
        # entry is a MIME instance; we look for the one whose CID is
        # `<logo>`.
        logos = [part for part in msg.attachments if getattr(part, "get", lambda _h: None)("Content-ID") == "<logo>"]
        self.assertEqual(len(logos), 1)
        self.assertEqual(logos[0].get_content_type(), "image/png")


# ── apps.users.tasks.cleanup_login_codes ─────────────────────────────────────


class CleanupLoginCodesTaskTest(TestCase):
    def setUp(self):
        from datetime import timedelta

        from django.utils.timezone import now

        from .tasks import cleanup_login_codes

        self.cleanup = cleanup_login_codes
        self.now = now
        self.timedelta = timedelta
        self.user = User.objects.create_user(
            username="cleanup-user",
            password="pw",
            email="cleanup@example.com",
        )

    def _row(self, expires_delta_seconds: int) -> LoginCode:
        return LoginCode.objects.create(
            user=self.user,
            code_hash=LoginCode.hash_code("000000"),
            expires_at=self.now() + self.timedelta(seconds=expires_delta_seconds),
        )

    def test_deletes_expired_rows(self):
        expired = self._row(-60)
        deleted_count = self.cleanup()
        self.assertEqual(deleted_count, 1)
        self.assertFalse(LoginCode.objects.filter(pk=expired.pk).exists())

    def test_preserves_unexpired_rows(self):
        fresh = self._row(600)
        deleted_count = self.cleanup()
        self.assertEqual(deleted_count, 0)
        self.assertTrue(LoginCode.objects.filter(pk=fresh.pk).exists())

    def test_mixed_expiry_only_expired_are_deleted(self):
        expired_1 = self._row(-30)
        expired_2 = self._row(-1)
        fresh_1 = self._row(60)
        fresh_2 = self._row(600)
        deleted_count = self.cleanup()
        self.assertEqual(deleted_count, 2)
        self.assertFalse(LoginCode.objects.filter(pk__in=[expired_1.pk, expired_2.pk]).exists())
        self.assertTrue(LoginCode.objects.filter(pk__in=[fresh_1.pk, fresh_2.pk]).count() == 2)

    def test_consumed_expired_rows_are_also_deleted(self):
        # cleanup is a TTL sweep — it ignores `consumed_at` and operates
        # purely on `expires_at`. Confirms we don't accidentally need a
        # separate sweep for consumed-but-not-yet-expired rows.
        row = self._row(-30)
        row.consumed_at = self.now()
        row.save(update_fields=["consumed_at"])
        self.assertEqual(self.cleanup(), 1)


# ── Celery beat schedule sanity ──────────────────────────────────────────────


class DisposableEmailValidatorTest(TestCase):
    """Unit-level tests for `is_disposable_email`."""

    def test_known_disposable_domain_detected(self):
        from .email_validation import is_disposable_email

        self.assertTrue(is_disposable_email("foo@yopmail.com"))
        self.assertTrue(is_disposable_email("BAR@MAILINATOR.COM"))

    def test_normal_domain_passes_through(self):
        from .email_validation import is_disposable_email

        self.assertFalse(is_disposable_email("alice@gmail.com"))
        self.assertFalse(is_disposable_email("admin@example.com"))

    def test_empty_or_malformed_email_returns_false(self):
        from .email_validation import is_disposable_email

        self.assertFalse(is_disposable_email(""))
        self.assertFalse(is_disposable_email("not-an-email"))
        self.assertFalse(is_disposable_email("@no-local-part.com"))

    @override_settings(DISPOSABLE_EMAIL_EXTRA_DOMAINS=["evil-corp.example"])
    def test_extra_domains_env_var_extends_blacklist(self):
        from .email_validation import is_disposable_email

        self.assertTrue(is_disposable_email("u@evil-corp.example"))

    @override_settings(DISPOSABLE_EMAIL_ALLOW_DOMAINS=["yopmail.com"])
    def test_allow_list_overrides_bundled_entries(self):
        # If a bundled domain shows up as a false positive for a real
        # corporate account, ALLOW_DOMAINS unblocks it.
        from .email_validation import is_disposable_email

        self.assertFalse(is_disposable_email("u@yopmail.com"))


class BeatScheduleTest(TestCase):
    def test_cleanup_login_codes_registered(self):
        from django.conf import settings as dj_settings

        self.assertIn("cleanup-login-codes", dj_settings.CELERY_BEAT_SCHEDULE)
        entry = dj_settings.CELERY_BEAT_SCHEDULE["cleanup-login-codes"]
        self.assertEqual(entry["task"], "apps.users.tasks.cleanup_login_codes")
        self.assertEqual(entry["schedule"], 24 * 60 * 60)


# ── /api/auth/login/start/ ───────────────────────────────────────────────────


class AuthConfigTest(APITestCase):
    """`GET /api/auth/config/` — public, unauthenticated. Exposes the
    feature flags the /login page needs to render the right copy.
    """

    URL = "/api/auth/config/"

    @override_settings(ALLOW_SELF_SIGNUP=True)
    def test_returns_allow_self_signup_true_when_enabled(self):
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"allow_self_signup": True})

    @override_settings(ALLOW_SELF_SIGNUP=False)
    def test_returns_allow_self_signup_false_when_disabled(self):
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"allow_self_signup": False})

    def test_does_not_require_authentication(self):
        # No credentials attached. Endpoint must return 200, not 401/403.
        response = self.client.get(self.URL)
        self.assertEqual(response.status_code, 200)


class LoginStartTest(APITestCase):
    """`POST /api/auth/login/start/` — step 1 of the email-OTP flow.

    Decides what the frontend should ask next (`method: otp | password`)
    and, when OTP applies, enqueues the welcome / login email.
    """

    URL = "/api/auth/login/start/"

    def setUp(self):
        from django.core import mail
        from django.core.cache import cache

        mail.outbox = []
        cache.clear()

    def _post(self, email):
        return self.client.post(self.URL, {"email": email}, format="json")

    @override_settings(ALLOW_SELF_SIGNUP=False)
    def test_unknown_email_with_signup_off_returns_404(self):
        from django.core import mail

        response = self._post("nobody@example.com")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"error": "user_not_found"})
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(User.objects.filter(email="nobody@example.com").exists())

    @override_settings(ALLOW_SELF_SIGNUP=True)
    def test_unknown_email_with_signup_on_creates_inactive_user_and_sends_welcome(self):
        from django.core import mail

        response = self._post("fresh@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"method": "otp"})
        # 1 welcome email sent
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["fresh@example.com"])
        # User created inactive with OTP auth, no password set
        user = User.objects.get(email="fresh@example.com")
        self.assertEqual(user.auth_method, "otp")
        self.assertFalse(user.is_active)
        self.assertFalse(user.has_usable_password())
        # A LoginCode row exists
        self.assertEqual(user.login_codes.count(), 1)

    def test_existing_otp_user_gets_login_code_email(self):
        from django.core import mail

        u = User.objects.create_user(
            username="otp-user",
            password="pw",
            email="otp@example.com",
            auth_method="otp",
        )
        response = self._post("otp@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"method": "otp"})
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["otp@example.com"])
        # Login-code subject (returning user, not welcome) — post-T-email-improvements
        # this is "Welcome back to Nudge" rather than the old "Your Nudge login code".
        self.assertIn("welcome back", mail.outbox[0].subject.lower())
        self.assertEqual(u.login_codes.count(), 1)

    def test_existing_password_user_returns_password_method_no_email(self):
        from django.core import mail

        User.objects.create_user(
            username="pw-user",
            password="pw",
            email="pw@example.com",
            auth_method="password",
        )
        response = self._post("pw@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"method": "password"})
        self.assertEqual(len(mail.outbox), 0)

    def test_email_lookup_is_case_insensitive(self):
        User.objects.create_user(
            username="mixed-case",
            password="pw",
            email="MixedCase@example.com",
            auth_method="otp",
        )
        response = self._post("mixedcase@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"method": "otp"})

    @override_settings(ALLOW_SELF_SIGNUP=True)
    def test_signup_username_collision_gets_numeric_suffix(self):
        # Pre-occupy the username space.
        User.objects.create_user(username="collide", password="pw", email="collide@a.com")
        response = self._post("collide@b.com")
        self.assertEqual(response.status_code, 200)
        new_user = User.objects.get(email="collide@b.com")
        self.assertEqual(new_user.username, "collide2")

    def test_invalid_email_format_returns_400(self):
        response = self._post("not-an-email")
        self.assertEqual(response.status_code, 400)

    @override_settings(ALLOW_SELF_SIGNUP=True, BLOCK_DISPOSABLE_EMAIL=True)
    def test_signup_rejects_disposable_email_when_block_enabled(self):
        from django.core import mail

        response = self._post("attacker@yopmail.com")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"error": "disposable_email"})
        # No user was created and no email sent.
        self.assertFalse(User.objects.filter(email="attacker@yopmail.com").exists())
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(ALLOW_SELF_SIGNUP=True, BLOCK_DISPOSABLE_EMAIL=False)
    def test_signup_accepts_disposable_email_when_block_disabled(self):
        # Dev default — BLOCK_DISPOSABLE_EMAIL is False so any provider goes through.
        response = self._post("dev@yopmail.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"method": "otp"})
        self.assertTrue(User.objects.filter(email="dev@yopmail.com").exists())

    @override_settings(ALLOW_SELF_SIGNUP=True, BLOCK_DISPOSABLE_EMAIL=True)
    def test_disposable_block_does_not_apply_to_existing_users(self):
        # A pre-existing user on a flagged domain (e.g. before the
        # blacklist was tightened) keeps working. The check only gates
        # the create-new-signup path.
        User.objects.create_user(
            username="legacy",
            password="pw",
            email="legacy@yopmail.com",
            auth_method="otp",
        )
        response = self._post("legacy@yopmail.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"method": "otp"})


# ── /api/auth/login/verify/ ──────────────────────────────────────────────────


class LoginVerifyTest(APITestCase):
    URL_VERIFY = "/api/auth/login/verify/"
    URL_START = "/api/auth/login/start/"

    def setUp(self):
        from django.core import mail
        from django.core.cache import cache

        mail.outbox = []
        cache.clear()

    def _issue_code_for(self, user, *, lang="en", is_signup=False):
        """Drive login_start via the helper so we exercise the real path,
        then pull the plaintext code from the captured email body. Cheap
        and faithful — avoids relying on internals."""
        from django.core import mail

        from .services import issue_otp

        issue_otp(user, is_signup=is_signup, lang=lang)
        # The 6-digit code is the only run of digits in the body.
        import re

        m = re.search(r"\b(\d{6})\b", mail.outbox[-1].body)
        self.assertIsNotNone(m, f"No 6-digit code in body: {mail.outbox[-1].body!r}")
        return m.group(1)

    def test_otp_verify_success_returns_tokens_and_activates(self):
        user = User.objects.create_user(
            username="verify1",
            password="pw",
            email="v1@example.com",
            auth_method="otp",
            is_active=False,
        )
        code = self._issue_code_for(user, is_signup=True)
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v1@example.com", "code": code},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIn("access", body)
        self.assertIn("refresh", body)
        self.assertTrue(body["is_new"])  # no first/last name set
        user.refresh_from_db()
        self.assertTrue(user.is_active)

    def test_is_new_false_when_first_name_set(self):
        user = User.objects.create_user(
            username="verify2",
            password="pw",
            email="v2@example.com",
            auth_method="otp",
            first_name="Ada",
        )
        code = self._issue_code_for(user)
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v2@example.com", "code": code},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["is_new"])

    def test_otp_verify_wrong_code_returns_400_and_bumps_attempts(self):
        from .models import LoginCode

        user = User.objects.create_user(
            username="verify3",
            password="pw",
            email="v3@example.com",
            auth_method="otp",
        )
        self._issue_code_for(user)
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v3@example.com", "code": "000000"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        lc = LoginCode.objects.get(user=user)
        self.assertEqual(lc.attempts, 1)
        self.assertIsNone(lc.consumed_at)

    def test_otp_verify_locked_after_5_attempts(self):
        from .models import LoginCode

        user = User.objects.create_user(
            username="verify4",
            password="pw",
            email="v4@example.com",
            auth_method="otp",
        )
        code = self._issue_code_for(user)
        # Manually bump attempts to the cap; subsequent verify (even with
        # the right code) must be rejected.
        lc = LoginCode.objects.get(user=user)
        lc.attempts = 5
        lc.save(update_fields=["attempts"])
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v4@example.com", "code": code},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_otp_verify_expired_code_rejected(self):
        from datetime import timedelta

        from django.utils.timezone import now

        from .models import LoginCode

        user = User.objects.create_user(
            username="verify5",
            password="pw",
            email="v5@example.com",
            auth_method="otp",
        )
        code = self._issue_code_for(user)
        # Push the row into the past.
        LoginCode.objects.filter(user=user).update(expires_at=now() - timedelta(seconds=1))
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v5@example.com", "code": code},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_password_verify_success(self):
        User.objects.create_user(
            username="verify6",
            password="hunter2",
            email="v6@example.com",
            auth_method="password",
            first_name="Bob",
            last_name="Doe",
        )
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v6@example.com", "password": "hunter2"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("access", body)
        self.assertFalse(body["is_new"])

    def test_password_verify_wrong_password_400(self):
        User.objects.create_user(
            username="verify7",
            password="hunter2",
            email="v7@example.com",
            auth_method="password",
        )
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v7@example.com", "password": "wrong"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_code_on_password_user_returns_method_mismatch(self):
        User.objects.create_user(
            username="verify8",
            password="pw",
            email="v8@example.com",
            auth_method="password",
        )
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v8@example.com", "code": "123456"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"error": "method_mismatch"})

    def test_password_on_otp_user_returns_method_mismatch(self):
        User.objects.create_user(
            username="verify9",
            password="pw",
            email="v9@example.com",
            auth_method="otp",
        )
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v9@example.com", "password": "pw"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"error": "method_mismatch"})

    def test_neither_code_nor_password_returns_400(self):
        User.objects.create_user(
            username="verify10",
            password="pw",
            email="v10@example.com",
            auth_method="otp",
        )
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "v10@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_unknown_email_returns_400(self):
        response = self.client.post(
            self.URL_VERIFY,
            {"email": "ghost@example.com", "code": "123456"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


# ── Rate limits on login endpoints ───────────────────────────────────────────


class LoginRateLimitTest(APITestCase):
    """DRF's SimpleRateThrottle reads `THROTTLE_RATES` at class-load time,
    so `override_settings(REST_FRAMEWORK={...})` doesn't change live
    rates. We patch the class attr directly for the duration of each
    test — gives a clean reset and works regardless of import order.
    """

    URL_START = "/api/auth/login/start/"

    def setUp(self):
        from django.core import mail
        from django.core.cache import cache

        mail.outbox = []
        cache.clear()

    def _patch_rates(self, **overrides):
        """Returns a context manager that swaps the rates on the
        throttle classes for the duration of `with`."""
        from contextlib import ExitStack
        from unittest.mock import patch

        from .throttles import EmailDestThrottle, LoginStartThrottle, LoginVerifyThrottle

        stack = ExitStack()
        # All three throttles share THROTTLE_RATES via SimpleRateThrottle —
        # patching one patches them all, but we patch each explicitly
        # to make the intent obvious.
        rates = {
            "auth": "9999/minute",
            "login_start": "9999/hour",
            "login_verify": "9999/minute",
            "email_dest": "9999/hour",
        }
        rates.update(overrides)
        for cls in (LoginStartThrottle, LoginVerifyThrottle, EmailDestThrottle):
            stack.enter_context(patch.object(cls, "THROTTLE_RATES", rates))
        return stack

    @override_settings(ALLOW_SELF_SIGNUP=True)
    def test_login_start_per_ip_rate_limit(self):
        # 2 should pass, 3rd should be throttled to 429.
        # Each request uses a different email so the per-email throttle
        # never kicks in — we isolate the per-IP one.
        with self._patch_rates(login_start="2/hour"):
            for i in range(2):
                r = self.client.post(self.URL_START, {"email": f"ip-rl-{i}@example.com"}, format="json")
                self.assertEqual(r.status_code, 200, f"req {i} unexpectedly failed: {r.status_code}")
            r = self.client.post(self.URL_START, {"email": "ip-rl-3@example.com"}, format="json")
            self.assertEqual(r.status_code, 429)

    @override_settings(ALLOW_SELF_SIGNUP=True)
    def test_login_start_per_email_rate_limit(self):
        # 2 hits on the same email pass; 3rd → 429 even though the IP
        # rate is absurdly high.
        with self._patch_rates(email_dest="2/hour"):
            for _ in range(2):
                r = self.client.post(self.URL_START, {"email": "victim@example.com"}, format="json")
                self.assertEqual(r.status_code, 200)
            r = self.client.post(self.URL_START, {"email": "victim@example.com"}, format="json")
            self.assertEqual(r.status_code, 429)


# ── JWT settings sanity ──────────────────────────────────────────────────────


class JwtLifetimesTest(TestCase):
    def test_access_token_lifetime_is_2h(self):
        from datetime import timedelta

        from django.conf import settings as dj_settings

        self.assertEqual(dj_settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"], timedelta(hours=2))

    def test_refresh_token_lifetime_is_60d(self):
        from datetime import timedelta

        from django.conf import settings as dj_settings

        self.assertEqual(dj_settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"], timedelta(days=60))


# ── /api/auth/token/ ─────────────────────────────────────────────────────────


class TokenAuthTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="alice", password="secret", email="alice@example.com")
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

    def test_patch_me_updates_first_and_last_name(self):
        # The onboarding step (T196) PATCHes /me/ with first/last name
        # after the new user verifies their first OTP. The serializer
        # must accept these as writable fields.
        response = self.client.patch(
            "/api/auth/me/",
            {"first_name": "Ada", "last_name": "Lovelace"},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Ada")
        self.assertEqual(self.user.last_name, "Lovelace")

    def test_patch_me_first_name_empty_rejected(self):
        response = self.client.patch(
            "/api/auth/me/",
            {"first_name": "   "},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("first_name", response.json())

    def test_patch_me_last_name_empty_rejected(self):
        response = self.client.patch(
            "/api/auth/me/",
            {"last_name": ""},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("last_name", response.json())

    def test_patch_me_first_name_does_not_bump_settings_updated_at(self):
        # first_name / last_name aren't "settings" — they're identity.
        # The optimistic-concurrency timestamp must stay still.
        self.user.refresh_from_db()
        before = self.user.settings_updated_at
        response = self.client.patch(
            "/api/auth/me/",
            {"first_name": "Ada", "last_name": "Lovelace"},
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.settings_updated_at, before)


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
            email="carol@example.com",
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
        self.user = User.objects.create_user(username="alice", password="pw", email="alice@example.com")
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


# ── quiet hours ──────────────────────────────────────────────────────────────


class QuietHoursHelperTest(TestCase):
    """`User.is_in_quiet_hours(local_time)` covers the gate + range logic."""

    def _user(self, *, enabled, start_h, start_m, end_h, end_m):
        from datetime import time as t

        return User(
            username="placeholder",
            quiet_hours_enabled=enabled,
            quiet_hours_start=t(start_h, start_m),
            quiet_hours_end=t(end_h, end_m),
        )

    def test_disabled_always_false(self):
        from datetime import time

        u = self._user(enabled=False, start_h=22, start_m=0, end_h=7, end_m=0)
        self.assertFalse(u.is_in_quiet_hours(time(3, 0)))

    def test_crosses_midnight_inside(self):
        from datetime import time

        u = self._user(enabled=True, start_h=22, start_m=0, end_h=7, end_m=0)
        self.assertTrue(u.is_in_quiet_hours(time(3, 0)))

    def test_crosses_midnight_outside(self):
        from datetime import time

        u = self._user(enabled=True, start_h=22, start_m=0, end_h=7, end_m=0)
        self.assertFalse(u.is_in_quiet_hours(time(12, 0)))

    def test_boundary_start_inclusive(self):
        from datetime import time

        u = self._user(enabled=True, start_h=22, start_m=0, end_h=7, end_m=0)
        self.assertTrue(u.is_in_quiet_hours(time(22, 0)))

    def test_boundary_end_exclusive(self):
        from datetime import time

        u = self._user(enabled=True, start_h=22, start_m=0, end_h=7, end_m=0)
        self.assertFalse(u.is_in_quiet_hours(time(7, 0)))

    def test_normal_range_inside(self):
        from datetime import time

        u = self._user(enabled=True, start_h=9, start_m=0, end_h=17, end_m=0)
        self.assertTrue(u.is_in_quiet_hours(time(12, 0)))

    def test_normal_range_outside(self):
        from datetime import time

        u = self._user(enabled=True, start_h=9, start_m=0, end_h=17, end_m=0)
        self.assertFalse(u.is_in_quiet_hours(time(18, 0)))

    def test_start_equals_end_is_noop(self):
        from datetime import time

        u = self._user(enabled=True, start_h=22, start_m=0, end_h=22, end_m=0)
        self.assertFalse(u.is_in_quiet_hours(time(22, 0)))


class UserUpdateValidatorTest(APITestCase):
    """`UserUpdateSerializer.validate()` blocks daily_notification_time
    overlap with the active quiet hours range. Gated by `enabled`."""

    def setUp(self):
        from datetime import time

        self.user = User.objects.create_user(
            username="quiet-validator-user",
            password="pw",
            email="quiet-validator@example.com",
            timezone="UTC",
            daily_notification_time=time(8, 0),
            quiet_hours_enabled=False,
            quiet_hours_start=time(22, 0),
            quiet_hours_end=time(7, 0),
        )
        self.client.force_authenticate(user=self.user)

    def _set_quiet(self, *, enabled, start=None, end=None, daily=None):
        from datetime import time

        if enabled is not None:
            self.user.quiet_hours_enabled = enabled
        if start is not None:
            h, m = map(int, start.split(":"))
            self.user.quiet_hours_start = time(h, m)
        if end is not None:
            h, m = map(int, end.split(":"))
            self.user.quiet_hours_end = time(h, m)
        if daily is not None:
            h, m = map(int, daily.split(":"))
            self.user.daily_notification_time = time(h, m)
        self.user.save()

    def test_enable_with_no_overlap_succeeds(self):
        response = self.client.patch(
            "/api/auth/me/",
            {
                "quiet_hours_enabled": True,
                "quiet_hours_start": "22:00",
                "quiet_hours_end": "07:00",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.quiet_hours_enabled)

    def test_enable_with_overlap_in_same_patch_is_rejected(self):
        response = self.client.patch(
            "/api/auth/me/",
            {
                "quiet_hours_enabled": True,
                "quiet_hours_start": "22:00",
                "quiet_hours_end": "07:00",
                "daily_notification_time": "06:00",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("daily_notification_time", response.json())

    def test_move_daily_into_active_quiet_hours_is_rejected(self):
        self._set_quiet(enabled=True, start="22:00", end="07:00")
        response = self.client.patch(
            "/api/auth/me/",
            {"daily_notification_time": "06:00"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("daily_notification_time", response.json())

    def test_move_daily_into_disabled_quiet_hours_is_accepted(self):
        self._set_quiet(enabled=False, start="22:00", end="07:00")
        response = self.client.patch(
            "/api/auth/me/",
            {"daily_notification_time": "06:00"},
        )
        self.assertEqual(response.status_code, 200)

    def test_disable_and_move_daily_inside_old_range_is_accepted(self):
        self._set_quiet(enabled=True, start="22:00", end="07:00")
        response = self.client.patch(
            "/api/auth/me/",
            {
                "quiet_hours_enabled": False,
                "daily_notification_time": "06:00",
            },
        )
        self.assertEqual(response.status_code, 200)

    def test_start_equals_end_is_noop_validator(self):
        response = self.client.patch(
            "/api/auth/me/",
            {
                "quiet_hours_enabled": True,
                "quiet_hours_start": "22:00",
                "quiet_hours_end": "22:00",
            },
        )
        # daily=08:00 unchanged; start==end means no active range → accepted
        self.assertEqual(response.status_code, 200)

    def test_extend_end_pulls_daily_into_quiet_range_rejected(self):
        self._set_quiet(enabled=True, start="22:00", end="07:00")
        # Extending end to 10:00 places daily=08:00 inside the range.
        response = self.client.patch(
            "/api/auth/me/",
            {"quiet_hours_end": "10:00"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("daily_notification_time", response.json())


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
        User.objects.create_superuser(
            username="existing",
            password="pass",
            email="existing@example.com",
        )
        self._call()
        # Only the pre-existing superuser should exist
        self.assertEqual(User.objects.filter(is_superuser=True).count(), 1)

    def test_skips_without_password_env_var(self):
        output = self._call(env_overrides={"ADMIN_PASSWORD": ""})
        self.assertFalse(User.objects.filter(is_superuser=True).exists())
        self.assertIn("ADMIN_PASSWORD", output)

    def test_skips_without_email_env_var(self):
        # ADMIN_EMAIL is required: the new unique constraint on User.email
        # cannot accept the empty-string fallback that pre-T191 builds used.
        output = self._call(env_overrides={"ADMIN_EMAIL": ""})
        self.assertFalse(User.objects.filter(is_superuser=True).exists())
        self.assertIn("ADMIN_EMAIL", output)

    def test_uses_env_var_username(self):
        self._call(env_overrides={"ADMIN_USERNAME": "myadmin"})
        self.assertTrue(User.objects.filter(username="myadmin", is_superuser=True).exists())

    def test_created_admin_has_password_auth_method(self):
        self._call()
        admin = User.objects.filter(is_superuser=True).first()
        self.assertEqual(admin.auth_method, "password")
        self.assertEqual(admin.email, "admin@example.com")


# ── /api/auth/change-password/ ──────────────────────────────────────────────


class ChangePasswordTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="alice",
            password="old-password-123",
            email="alice@example.com",
        )
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
        self.alice = User.objects.create_user(username="alice", password="pass", email="alice@example.com")
        self.bob = User.objects.create_user(username="bob", password="pass", email="bob@example.com")
        self.carol = User.objects.create_user(username="carol", password="pass", email="carol@example.com")
        self.inactive = User.objects.create_user(
            username="inactive",
            password="pass",
            email="inactive@example.com",
            is_active=False,
        )
        self.client.force_authenticate(user=self.alice)
        self.url = "/api/auth/contacts/"

    def test_list_contacts_empty(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_add_contact(self):
        response = self.client.post(self.url, {"email": "bob@example.com"})
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["email"], "bob@example.com")
        self.assertEqual(data["id"], self.bob.pk)
        # The shape no longer leaks `username` to the frontend.
        self.assertNotIn("username", data)

    def test_list_contacts_after_add(self):
        self.alice.contacts.add(self.bob)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        emails = [c["email"] for c in response.json()]
        self.assertIn("bob@example.com", emails)
        for c in response.json():
            self.assertNotIn("username", c)

    def test_add_contact_case_insensitive(self):
        # Mixed-case email in the payload still resolves the canonical
        # (lowercased) row stored in the DB.
        response = self.client.post(self.url, {"email": "BOB@EXAMPLE.com"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["email"], "bob@example.com")

    def test_add_contact_strips_whitespace(self):
        response = self.client.post(self.url, {"email": "  bob@example.com  "})
        self.assertEqual(response.status_code, 201)

    def test_add_self_returns_400(self):
        response = self.client.post(self.url, {"email": "alice@example.com"})
        self.assertEqual(response.status_code, 400)

    def test_add_nonexistent_user_returns_404(self):
        response = self.client.post(self.url, {"email": "nobody@example.com"})
        self.assertEqual(response.status_code, 404)

    def test_add_inactive_user_returns_404(self):
        response = self.client.post(self.url, {"email": "inactive@example.com"})
        self.assertEqual(response.status_code, 404)

    def test_add_duplicate_returns_400(self):
        self.alice.contacts.add(self.bob)
        response = self.client.post(self.url, {"email": "bob@example.com"})
        self.assertEqual(response.status_code, 400)

    def test_bidirectional(self):
        self.client.post(self.url, {"email": "bob@example.com"})
        self.client.force_authenticate(user=self.bob)
        response = self.client.get(self.url)
        emails = [c["email"] for c in response.json()]
        self.assertIn("alice@example.com", emails)

    def test_remove_contact(self):
        self.alice.contacts.add(self.bob)
        response = self.client.delete(f"{self.url}{self.bob.pk}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(self.alice.contacts.filter(pk=self.bob.pk).exists())
        self.assertFalse(self.bob.contacts.filter(pk=self.alice.pk).exists())

    def test_remove_non_contact_returns_404(self):
        response = self.client.delete(f"{self.url}{self.carol.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_add_contact_with_empty_email_returns_400(self):
        response = self.client.post(self.url, {"email": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Email is required."})

    def test_add_contact_with_missing_email_returns_400(self):
        response = self.client.post(self.url, {})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Email is required."})

    def test_search_endpoint_removed(self):
        # The /contacts/search/ URL was the main prefix-leak channel and
        # has been deleted along with its view in T194. Confirm the route
        # no longer resolves.
        response = self.client.get(f"{self.url}search/")
        self.assertEqual(response.status_code, 404)

    def test_unauthenticated_list_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_add_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(self.url, {"email": "bob@example.com"})
        self.assertEqual(response.status_code, 401)

    def test_unauthenticated_delete_returns_401(self):
        self.client.force_authenticate(user=None)
        response = self.client.delete(f"{self.url}{self.bob.pk}/")
        self.assertEqual(response.status_code, 401)


# ── /api/auth/admin-access/ ─────────────────────────────────────────────────


class AdminAccessTest(APITestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            username="staffuser",
            password="pass",
            email="staff@example.com",
            is_staff=True,
        )
        self.regular = User.objects.create_user(
            username="regular",
            password="pass",
            email="regular@example.com",
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
