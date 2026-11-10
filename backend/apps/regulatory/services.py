"""Linking stocks to the regulatory catalogue and storing what clients return.

Agency-neutral: this module only understands ``clients/types.py``. It calls
``clients.aemps`` directly — there is one agency, and a mechanism to choose
between clients would be speculative.
"""

import logging

from django.db import transaction
from django.utils import timezone

from apps.routines.models import Stock

from .clients import aemps
from .clients.types import NotFound, PresentationData, UpstreamPayloadError
from .models import Medicine, Presentation, SafetyNotice, SupplyProblem

logger = logging.getLogger(__name__)

# Long enough for a useful traceback summary, short enough for the admin.
MAX_ERROR_LENGTH = 1000


def derive_national_code(gtin, typed_code):
    """``(code, source)`` for a stock, or ``None`` when it has no valid code.

    An NTIN wins: the code inside it is the pack's identity. Otherwise a code
    given explicitly — typed by the owner or read from a scan's AI 712 — is
    accepted once normalised. Keeping a previously derived code when the GTIN
    is cleared depends on the stock's prior state and is the serializer's job.
    """
    derived = aemps.code_from_gtin(gtin or "")
    if derived is not None:
        return derived, aemps.SOURCE
    normalised = aemps.normalize_code(typed_code or "")
    if normalised is not None:
        return normalised, aemps.SOURCE
    return None


def enqueue_fetch(presentation_id):
    """Fetch a presentation in the background once the current transaction commits."""
    # Imported here: the task module imports this one.
    from .tasks import fetch_presentation

    transaction.on_commit(lambda: fetch_presentation.delay(presentation_id))


def link_stock(stock, *, offer_name, touch_updated_at, enqueue=True):
    """Point ``stock`` at the presentation of its national code.

    ``offer_name`` raises the official-name offer when the link changes; the
    daily sync relinking a pruned row passes False so the offer is made once.
    ``touch_updated_at`` must be False for background writes: bumping
    ``Stock.updated_at`` would make queued offline edits fail with 412.
    ``enqueue`` schedules a fetch for a presentation with no baseline yet; the
    daily sync passes False because it fetches everything itself right after.
    """
    presentation = None
    if stock.national_code:
        presentation, _ = Presentation.objects.get_or_create(
            source=stock.national_code_source or aemps.SOURCE,
            code=stock.national_code,
        )

    if stock.presentation_id != (presentation.pk if presentation else None):
        stock.presentation = presentation
        fields = ["presentation"]
        if offer_name and presentation is not None:
            stock.name_offer_pending = True
            fields.append("name_offer_pending")
        if touch_updated_at:
            stock.save(update_fields=[*fields, "updated_at"])
        else:
            Stock.objects.filter(pk=stock.pk).update(**{field: getattr(stock, field) for field in fields})

    if enqueue and presentation is not None and presentation.fetched_at is None:
        enqueue_fetch(presentation.pk)
    return presentation


def _apply_supply(presentation, supply, now):
    active = presentation.supply_problems.filter(resolved_at__isnull=True).first()
    if supply is None:
        if active is not None:
            active.resolved_at = now
            active.save(update_fields=["resolved_at"])
        return
    values = {
        "native_type": supply.native_type,
        "severity": supply.severity,
        "note": supply.note,
        "started_on": supply.started_on,
        "expected_end_on": supply.expected_end_on,
    }
    if active is None:
        SupplyProblem.objects.create(presentation=presentation, **values)
        return
    for field, value in values.items():
        setattr(active, field, value)
    active.save(update_fields=list(values))


def _apply_medicine(source, data, now):
    medicine, _ = Medicine.objects.update_or_create(
        source=source,
        code=data.code,
        defaults={
            "name": data.name,
            "authorized_on": data.authorized_on,
            "suspended_on": data.suspended_on,
            "revoked_on": data.revoked_on,
            "agency_url": data.agency_url,
            "raw": data.raw,
            "fetched_at": now,
        },
    )
    notices = [
        SafetyNotice.objects.update_or_create(
            source=source,
            reference=notice.reference,
            defaults={
                "native_kind": notice.native_kind,
                "title": notice.title,
                "url": notice.url,
                "published_on": notice.published_on,
            },
        )[0]
        for notice in data.safety_notices
    ]
    # A notice the agency no longer lists for this medicine is unlinked from it.
    medicine.safety_notices.set(notices)
    return medicine


def apply_presentation(presentation_id, data: PresentationData | NotFound):
    """Store a client's answer for one presentation.

    The row is locked for the whole write, so a refresh and the daily sync can
    never apply the same answer twice.
    """
    now = timezone.now()
    with transaction.atomic():
        presentation = Presentation.objects.select_for_update().get(pk=presentation_id)

        if isinstance(data, NotFound):
            presentation.fetch_status = Presentation.FetchStatus.NOT_FOUND
            presentation.last_error = ""
            # Also a baseline: the agency has answered, even if with nothing.
            presentation.fetched_at = now
            presentation.save(update_fields=["fetch_status", "last_error", "fetched_at"])
            # No official name will ever come for this code.
            Stock.objects.filter(presentation=presentation, name_offer_pending=True).update(name_offer_pending=False)
            return presentation

        # Change detection compares the stored state against `data` here,
        # before anything below overwrites it.
        presentation.medicine = _apply_medicine(presentation.source, data.medicine, now)
        presentation.name = data.name
        presentation.marketed = data.marketed
        presentation.raw = data.raw
        presentation.supply_severity = data.supply.severity if data.supply else None
        presentation.fetch_status = Presentation.FetchStatus.OK
        presentation.last_error = ""
        presentation.fetched_at = now
        presentation.save()
        _apply_supply(presentation, data.supply, now)
        return presentation


def record_fetch_error(presentation_id, error):
    """Mark a failed fetch. ``fetched_at`` is kept: the last good state stays."""
    Presentation.objects.filter(pk=presentation_id).update(
        fetch_status=Presentation.FetchStatus.ERROR,
        last_error=str(error)[:MAX_ERROR_LENGTH],
    )


def refresh_presentation(presentation_id):
    """Fetch one presentation from its agency and store the answer.

    ``FetchDisabled`` and ``UpstreamUnavailable`` propagate: the caller decides
    (the task retries, the daily sync records and moves on). A payload that
    cannot be trusted is recorded here — retrying would get the same answer.
    """
    Presentation.objects.filter(pk=presentation_id).update(last_attempt_at=timezone.now())
    presentation = Presentation.objects.get(pk=presentation_id)
    try:
        data = aemps.fetch(presentation.code)
    except UpstreamPayloadError as exc:
        # An error, not a warning: the agency's contract may have changed, and
        # every later fetch of this code will fail the same way until it is fixed.
        logger.error("Untrusted payload for presentation %s: %s", presentation_id, exc)
        record_fetch_error(presentation_id, exc)
        return None
    return apply_presentation(presentation_id, data)
