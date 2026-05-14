import hashlib
import zoneinfo
from datetime import time

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.timezone import now as tz_now

LANGUAGE_CHOICES = [("en", "English"), ("es", "Español"), ("gl", "Galego")]

AUTH_METHOD_CHOICES = [("otp", "OTP"), ("password", "Password")]


def validate_timezone(value):
    if value not in zoneinfo.available_timezones():
        raise ValidationError(f'"{value}" is not a valid IANA timezone.')


class User(AbstractUser):
    # Override AbstractUser's email field to be required + unique. Email is
    # now the primary user identifier for login (see auth_method below).
    email = models.EmailField(unique=True)
    # 'otp'  — login by 6-digit code sent to email (self-signup default)
    # 'password' — login by username + password (admins, or any user the
    #              admin chose to create manually with a password)
    # The two methods are orthogonal to is_staff: any user can have either.
    auth_method = models.CharField(
        max_length=10,
        choices=AUTH_METHOD_CHOICES,
        default="otp",
    )
    language = models.CharField(
        max_length=2,
        choices=LANGUAGE_CHOICES,
        default="en",
    )
    timezone = models.CharField(
        max_length=64,
        default="UTC",
        validators=[validate_timezone],
        help_text="IANA timezone string, e.g. Europe/Madrid",
    )
    # Stored as the user's LOCAL time (not UTC).
    # The Celery worker converts it to UTC at runtime using the timezone field,
    # which ensures DST is handled automatically.
    daily_notification_time = models.TimeField(
        default="08:30",
        help_text="Local time for the daily heads-up notification",
    )
    # Quiet hours. Reminders (every routine.reminder_interval_minutes) are
    # paused during this range when routine.respect_quiet_hours is True.
    # The initial "due" notification and the daily heads-up always fire.
    # Times are stored as the user's LOCAL time, same as daily_notification_time.
    quiet_hours_enabled = models.BooleanField(default=False)
    quiet_hours_start = models.TimeField(default=time(22, 0))
    quiet_hours_end = models.TimeField(default=time(7, 0))
    contacts = models.ManyToManyField("self", symmetrical=True, blank=True)
    # Bumped explicitly only when `timezone`, `daily_notification_time` or
    # `language` change (see UserUpdateSerializer). Exposed as an ETag for
    # optimistic concurrency on PATCH /api/auth/me/.
    settings_updated_at = models.DateTimeField(default=tz_now)

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"

    @property
    def display_name(self) -> str:
        full = f"{self.first_name} {self.last_name}".strip()
        return full or self.email

    def __str__(self):
        return self.display_name

    def is_in_quiet_hours(self, local_time):
        """True if quiet hours are enabled and `local_time` falls inside the range.

        `local_time` is a `datetime.time` in the user's local timezone — the
        caller (typically the notifications worker) is responsible for the
        UTC → user.timezone conversion before invoking this.
        """
        if not self.quiet_hours_enabled:
            return False
        start, end = self.quiet_hours_start, self.quiet_hours_end
        if start == end:
            return False
        if start < end:
            return start <= local_time < end
        # range crosses midnight
        return local_time >= start or local_time < end


class LoginCode(models.Model):
    """One-time 6-digit code emailed to a user for OTP login or signup
    verification. The plaintext is never persisted — only the SHA-256
    digest. The most recent unconsumed, unexpired row is matched at
    verify time; `attempts` is bumped on failures and blocks after 5.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="login_codes")
    code_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "consumed_at", "expires_at"])]

    @staticmethod
    def hash_code(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
