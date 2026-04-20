import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import IdempotencyRecord

logger = logging.getLogger(__name__)

RETENTION_DAYS = 7


@shared_task(name="apps.idempotency.tasks.cleanup_idempotency_records")
def cleanup_idempotency_records():
    """
    Delete IdempotencyRecord rows older than RETENTION_DAYS. Runs daily via
    Celery beat; prevents the table from growing unbounded.
    """
    threshold = timezone.now() - timedelta(days=RETENTION_DAYS)
    deleted, _ = IdempotencyRecord.objects.filter(created_at__lt=threshold).delete()
    logger.info("cleanup_idempotency_records: deleted %s rows", deleted)
    return deleted
