from django.conf import settings
from django.db import models


class IdempotencyRecord(models.Model):
    """
    Stores the response of a mutation keyed by (user, Idempotency-Key header)
    so repeated requests with the same key return the cached response instead
    of re-executing the view.
    """

    key = models.CharField(max_length=64)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="idempotency_records",
    )
    endpoint = models.CharField(max_length=255)
    method = models.CharField(max_length=10)
    body_hash = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField()
    response_body = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "key")]
        indexes = [models.Index(fields=["created_at"])]

    def __str__(self):
        return f"{self.user.username} {self.method} {self.endpoint} [{self.key[:8]}…]"
