from django.conf import settings
from django.db import models


class NotificationState(models.Model):
    """
    Tracks when the last notifications were sent for a routine,
    preventing duplicate sends within the same cycle.
    """

    routine = models.OneToOneField(
        "routines.Routine",
        on_delete=models.CASCADE,
        related_name="notification_state",
    )
    last_due_notification = models.DateTimeField(null=True, blank=True)
    last_reminder = models.DateTimeField(null=True, blank=True)
    # Date (not datetime) — only one daily heads-up per calendar day
    last_daily_notification = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"NotificationState for {self.routine.name}"


class PushSubscription(models.Model):
    """
    Stores a Web Push subscription for a user device/browser.
    One user can have multiple subscriptions (one per device).
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.CharField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.user.username} — {self.endpoint[:60]}..."
