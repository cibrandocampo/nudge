import zoneinfo

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models

LANGUAGE_CHOICES = [("en", "English"), ("es", "Español"), ("gl", "Galego")]


def validate_timezone(value):
    if value not in zoneinfo.available_timezones():
        raise ValidationError(f'"{value}" is not a valid IANA timezone.')


class User(AbstractUser):
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

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self):
        return self.username
