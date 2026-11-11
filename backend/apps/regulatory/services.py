"""Linking stocks to the regulatory catalogue and storing what clients return.

Agency-neutral: this module only understands ``clients/types.py``. It calls
``clients.aemps`` directly — there is one agency, and a mechanism to choose
between clients would be speculative.
"""

import logging
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from apps.routines.models import Stock

from .clients import aemps
from .clients.types import NotFound, PresentationData, UpstreamPayloadError
from .models import (
    EventDelivery,
    Medicine,
    MedicineLeaflet,
    Presentation,
    RegulatoryEvent,
    SafetyNotice,
    SupplyProblem,
)
from .sanitize import sanitize_leaflet_html

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


def enqueue_leaflet_fetch(medicine_id):
    """Fetch a medicine's leaflet in the background once the transaction commits."""
    from .tasks import fetch_leaflet

    transaction.on_commit(lambda: fetch_leaflet.delay(medicine_id))


def enqueue_refresh(presentation):
    """What "Refresh info" fetches: the presentation again, and its medicine's leaflet.

    Only a stored leaflet is enqueued here. A missing one is enqueued by the
    presentation fetch itself once it is applied (``apply_presentation``);
    enqueuing it here too would download the same leaflet twice, in parallel.
    """
    enqueue_fetch(presentation.pk)
    if MedicineLeaflet.objects.filter(medicine_id=presentation.medicine_id).exists():
        enqueue_leaflet_fetch(presentation.medicine_id)


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
            "leaflet_url": data.leaflet_url,
            "leaflet_pdf_url": data.leaflet_pdf_url,
            "affects_driving": data.affects_driving,
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


# ── Change detection ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Snapshot:
    """What change detection compares, in the model's terms only.

    ``supply`` is the active problem (``native_type``, ``severity``,
    ``expected_end_on``) or ``None``; ``notices`` maps each safety notice's
    ``reference`` to what an event about it carries. Dates are ISO strings,
    ready for a JSON payload.
    """

    supply: dict | None
    marketed: bool | None
    status: str | None
    notices: dict


def _iso(value):
    return value.isoformat() if value is not None else None


def _snapshot(presentation) -> Snapshot:
    medicine = presentation.medicine
    active = presentation.supply_problems.filter(resolved_at__isnull=True).first()
    supply = None
    if active is not None:
        supply = {
            "native_type": active.native_type,
            "severity": active.severity,
            "expected_end_on": _iso(active.expected_end_on),
        }
    notices = {}
    if medicine is not None:
        for notice in medicine.safety_notices.all():
            notices[notice.reference] = {
                "reference": notice.reference,
                "title": notice.title,
                "url": notice.url,
                "published_on": _iso(notice.published_on),
            }
    return Snapshot(
        supply=supply,
        marketed=presentation.marketed,
        status=medicine.status if medicine is not None else None,
        notices=notices,
    )


def _has_baseline(presentation) -> bool:
    """Whether the stored state is one to compare a new answer against.

    Never on a first fetch (``fetched_at`` null): every problem already there
    would look new. Nor right after a ``not_found``: that answer closed the
    active problem without the shortage ending, so the next ``ok`` is a fresh
    baseline too rather than a "supply problem started". (A refresh marks the
    row ``pending`` before fetching, which hides an earlier ``not_found``; that
    rare path compares against the closed state.)
    """
    return presentation.fetched_at is not None and presentation.fetch_status != Presentation.FetchStatus.NOT_FOUND


def _diff(before: Snapshot, after: Snapshot) -> list[tuple[str, dict]]:
    """The events between two snapshots, in a stable order.

    Supply first, then new safety notices (by reference), marketing and
    authorisation. A change limited to the wording of a supply note is not an
    event; neither is ``marketed`` moving to or from unknown.
    """
    Kind = RegulatoryEvent.Kind
    changes = []

    if before.supply is None and after.supply is not None:
        changes.append((Kind.SUPPLY_STARTED, {"after": after.supply}))
    elif before.supply is not None and after.supply is None:
        changes.append((Kind.SUPPLY_RESOLVED, {"before": before.supply}))
    elif before.supply is not None and any(
        before.supply[field] != after.supply[field] for field in ("native_type", "expected_end_on")
    ):
        changes.append((Kind.SUPPLY_CHANGED, {"before": before.supply, "after": after.supply}))

    for reference in sorted(after.notices.keys() - before.notices.keys()):
        changes.append((Kind.SAFETY_NOTICE_ADDED, after.notices[reference]))

    if before.marketed is True and after.marketed is False:
        changes.append((Kind.MARKETING_STOPPED, {}))
    elif before.marketed is False and after.marketed is True:
        changes.append((Kind.MARKETING_RESUMED, {}))

    if before.status is not None and after.status != before.status:
        Status = Medicine.Status
        kind = {
            Status.SUSPENDED: Kind.AUTHORIZATION_SUSPENDED,
            Status.REVOKED: Kind.AUTHORIZATION_REVOKED,
            Status.AUTHORISED: Kind.AUTHORIZATION_REINSTATED,
        }[after.status]
        changes.append((kind, {"before": before.status}))

    return changes


def _deliver(event):
    """One delivery per user holding a stock of the event's presentation now.

    Owners and guests alike; a user with several such stocks is told once,
    through the one with the lowest id.
    """
    stocks = Stock.objects.filter(presentation_id=event.presentation_id).order_by("pk").prefetch_related("shared_with")
    stock_by_user = {}
    for stock in stocks:
        for user_id in (stock.user_id, *(user.pk for user in stock.shared_with.all())):
            stock_by_user.setdefault(user_id, stock.pk)
    EventDelivery.objects.bulk_create(
        [EventDelivery(event=event, user_id=user_id, stock_id=stock_id) for user_id, stock_id in stock_by_user.items()],
        ignore_conflicts=True,
    )


def _record_events(presentation, changes, now):
    """Store the events of one application, each with its deliveries.

    A safety notice belongs to the medicine, which several followed
    presentations may share: its event is recorded on every one of them that
    has stocks and a baseline, at once. Applying the next presentation of the
    same medicine does not repeat it, because the "before" notices are read at
    medicine level — the notice is already linked by then.
    """
    for kind, payload in changes:
        targets = [presentation]
        if kind == RegulatoryEvent.Kind.SAFETY_NOTICE_ADDED:
            siblings = (
                Presentation.objects.filter(medicine_id=presentation.medicine_id, stocks__isnull=False)
                .exclude(pk=presentation.pk)
                .exclude(fetched_at__isnull=True)
                .distinct()
                .order_by("pk")
            )
            targets.extend(siblings)
        for target in targets:
            _deliver(RegulatoryEvent.objects.create(presentation=target, kind=kind, payload=payload, detected_at=now))


def apply_presentation(presentation_id, data: PresentationData | NotFound, *, enqueue_leaflet=True):
    """Store a client's answer for one presentation.

    The row is locked for the whole write, so a refresh and the daily sync can
    never apply the same answer twice.

    ``enqueue_leaflet`` schedules the leaflet of a medicine that has none yet
    (a new one, typically). The daily sync passes False because it fetches
    missing leaflets itself right after, and the seed because it applies its
    recorded ones.
    """
    now = timezone.now()
    with transaction.atomic():
        presentation = Presentation.objects.select_for_update().get(pk=presentation_id)

        if isinstance(data, NotFound):
            # No event either way. A code that vanishes may be a passing glitch
            # of the agency, and if it lasts the page already says "not found".
            # Closing the active problem below is the code disappearing, not
            # the shortage ending: it must not read as "supply restored".
            presentation.fetch_status = Presentation.FetchStatus.NOT_FOUND
            presentation.last_error = ""
            # Also a baseline: the agency has answered, even if with nothing.
            presentation.fetched_at = now
            # A code the agency no longer knows has no current shortage: an
            # active problem would otherwise stay in the summary for good.
            presentation.supply_severity = None
            presentation.save(update_fields=["fetch_status", "last_error", "fetched_at", "supply_severity"])
            _apply_supply(presentation, None, now)
            # No official name will ever come for this code.
            Stock.objects.filter(presentation=presentation, name_offer_pending=True).update(name_offer_pending=False)
            return presentation

        # Change detection: the stored state, read before anything below
        # overwrites it. No baseline, no events (see `_has_baseline`).
        before = _snapshot(presentation) if _has_baseline(presentation) else None

        presentation.medicine = medicine = _apply_medicine(presentation.source, data.medicine, now)
        presentation.name = data.name
        presentation.marketed = data.marketed
        presentation.raw = data.raw
        presentation.supply_severity = data.supply.severity if data.supply else None
        presentation.fetch_status = Presentation.FetchStatus.OK
        presentation.last_error = ""
        presentation.fetched_at = now
        presentation.save()
        _apply_supply(presentation, data.supply, now)
        if before is not None:
            _record_events(presentation, _diff(before, _snapshot(presentation)), now)
        # A new medicine, or one whose leaflet was never stored.
        if enqueue_leaflet and not MedicineLeaflet.objects.filter(medicine=medicine).exists():
            enqueue_leaflet_fetch(medicine.pk)
        return presentation


def record_fetch_error(presentation_id, error):
    """Mark a failed fetch. ``fetched_at`` is kept: the last good state stays."""
    Presentation.objects.filter(pk=presentation_id).update(
        fetch_status=Presentation.FetchStatus.ERROR,
        last_error=str(error)[:MAX_ERROR_LENGTH],
    )


def refresh_presentation(presentation_id, *, enqueue_leaflet=True):
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
    return apply_presentation(presentation_id, data, enqueue_leaflet=enqueue_leaflet)


def apply_leaflet(medicine_id, sections: list | None):
    """Store a medicine's leaflet, sanitised.

    ``None`` — the agency has no sectioned leaflet — is stored as no sections:
    the leaflet has been looked for, and the client offers the agency's link.
    """
    now = timezone.now()
    with transaction.atomic():
        medicine = Medicine.objects.select_for_update().get(pk=medicine_id)
        clean = [{**section, "html": sanitize_leaflet_html(section["html"])} for section in sections or ()]
        leaflet, _ = MedicineLeaflet.objects.update_or_create(
            medicine=medicine,
            defaults={"sections": clean, "source_url": medicine.leaflet_url, "fetched_at": now},
        )
        return leaflet


def refresh_leaflet(medicine_id):
    """Fetch a medicine's leaflet from its agency and store it.

    Like ``refresh_presentation``: ``FetchDisabled`` and ``UpstreamUnavailable``
    propagate, an untrusted payload is logged and the stored leaflet kept.
    """
    medicine = Medicine.objects.get(pk=medicine_id)
    try:
        sections = aemps.fetch_leaflet(medicine.code)
    except UpstreamPayloadError as exc:
        logger.error("Untrusted leaflet payload for medicine %s: %s", medicine_id, exc)
        return None
    return apply_leaflet(medicine_id, sections)
