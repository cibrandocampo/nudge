import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from apps.routines.models import Stock

from . import services
from .clients.types import FetchDisabled, UpstreamUnavailable
from .models import Medicine, Presentation, SafetyNotice

logger = logging.getLogger(__name__)

MAX_RETRIES = 5
# 30 s, 60 s, 120 s, … capped at 10 minutes: an agency outage is usually short,
# and nothing waits on this fetch but the product page.
RETRY_BASE_SECONDS = 30
RETRY_MAX_SECONDS = 600
# How long a presentation no stock references is kept before it is deleted.
ORPHAN_GRACE_DAYS = 30


def retry_countdown(retries):
    return min(RETRY_BASE_SECONDS * 2**retries, RETRY_MAX_SECONDS)


@shared_task(
    bind=True,
    name="apps.regulatory.tasks.fetch_presentation",
    max_retries=MAX_RETRIES,
    time_limit=120,
    soft_time_limit=100,
)
def fetch_presentation(self, presentation_id):
    """Fetch one presentation in the background — the user never waits for it.

    The first Celery task in the repo with retries: a network failure or a 5xx
    is retried with exponential backoff; once retries run out the presentation
    is marked ``error`` and keeps its last good data.
    """
    try:
        services.refresh_presentation(presentation_id)
    except Presentation.DoesNotExist:
        logger.info("fetch_presentation: presentation %s no longer exists", presentation_id)
    except FetchDisabled:
        logger.info("fetch_presentation: fetching disabled, presentation %s left as is", presentation_id)
    except UpstreamUnavailable as exc:
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=retry_countdown(self.request.retries)) from exc
        logger.error("fetch_presentation: giving up on presentation %s: %s", presentation_id, exc)
        services.record_fetch_error(presentation_id, exc)


def _link_pending_stocks():
    """Relink stocks that have a code but lost (or never got) their row."""
    linked = 0
    for stock in Stock.objects.filter(presentation__isnull=True).exclude(national_code=""):
        services.link_stock(stock, offer_name=False, touch_updated_at=False, enqueue=False)
        linked += 1
    return linked


def _refresh_linked():
    refreshed = errors = 0
    ids = Presentation.objects.filter(stocks__isnull=False).distinct().values_list("pk", flat=True)
    for presentation_id in ids:
        try:
            services.refresh_presentation(presentation_id)
        except Presentation.DoesNotExist:
            # Unlinked and deleted since the id list was read: nothing to do.
            continue
        except UpstreamUnavailable as exc:
            # One unreachable answer must not stop the rest of the run.
            logger.warning("sync_regulatory_data: presentation %s unavailable: %s", presentation_id, exc)
            services.record_fetch_error(presentation_id, exc)
            errors += 1
        else:
            refreshed += 1
    return refreshed, errors


def _deleted(queryset):
    # `delete()` totals the cascade too (supply problems, M2M rows); count only
    # the model asked for.
    _, per_model = queryset.delete()
    return per_model.get(queryset.model._meta.label, 0)


def _prune_orphans():
    cutoff = timezone.now() - timedelta(days=ORPHAN_GRACE_DAYS)
    presentations = _deleted(
        Presentation.objects.filter(stocks__isnull=True).filter(
            Q(last_attempt_at__isnull=True) | Q(last_attempt_at__lt=cutoff)
        )
    )
    medicines = _deleted(Medicine.objects.filter(presentations__isnull=True))
    notices = _deleted(SafetyNotice.objects.filter(medicines__isnull=True))
    return presentations, medicines, notices


@shared_task(
    name="apps.regulatory.tasks.sync_regulatory_data",
    time_limit=1800,
    soft_time_limit=1700,
)
def sync_regulatory_data():
    """Daily refresh of the catalogue, at 03:00 UTC (before any morning digest).

    Links stocks with a code but no row, refreshes every presentation a stock
    references — one by one, isolating failures — and deletes what no stock
    uses. With fetching disabled it still links and prunes.
    """
    summary = {"linked": _link_pending_stocks(), "refreshed": 0, "errors": 0}
    if settings.REGULATORY_FETCH_ENABLED:
        summary["refreshed"], summary["errors"] = _refresh_linked()
    summary["pruned_presentations"], summary["pruned_medicines"], summary["pruned_notices"] = _prune_orphans()
    logger.info("sync_regulatory_data: %s", summary)
    return summary
