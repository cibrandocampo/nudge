"""Standard shape of the data a regulatory client returns.

Everything outside ``apps.regulatory.clients`` works with these types and
never with an agency's own payload: dates are already converted, severities
already normalised, and the agency's raw JSON travels along only to be stored.
That is what keeps the data model agency-neutral while the code serves a
single agency.

A client is a module exposing four functions:

``code_from_gtin(gtin) -> str | None``
    The national code embedded in a pack's GTIN, or ``None`` when the GTIN is
    not one of this agency's packs.
``normalize_code(text) -> str | None``
    A typed national code in canonical form, or ``None`` when it is not one.
``fetch(code) -> PresentationData | NotFound``
    The current data of one presentation (pack), its medicine, its active
    supply problem and its safety notices.
``fetch_leaflet(medicine_code) -> list[dict] | None``
    The patient leaflet by sections, or ``None`` when there is none.

Only ``clients/aemps.py`` exists today, and on purpose there is no base class,
registry or client selection: with one agency they would be speculative. A
second agency adds its own module with the same functions.

This module is framework-free, like ``apps.routines.exceptions``: the types
and errors describe the data, not how it is stored or served.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Final

SEVERITY_WARNING: Final = "warning"
SEVERITY_DANGER: Final = "danger"


@dataclass(frozen=True)
class SupplyProblemData:
    """The **active** supply problem of a presentation.

    ``native_type`` is the agency's own code, kept as text so no format is
    imposed on future sources. ``severity`` is the normalised value the UI
    and the notifications rely on.
    """

    native_type: str
    severity: str
    note: str
    started_on: date | None
    expected_end_on: date | None


@dataclass(frozen=True)
class SafetyNoticeData:
    """A safety notice the agency published about a medicine."""

    reference: str
    native_kind: str
    title: str
    url: str
    published_on: date | None


@dataclass(frozen=True)
class MedicineData:
    """The authorised medicine a presentation belongs to.

    Authorisation status rule (the agency exposes the *current* state, so a
    lifted suspension removes ``suspended_on``): ``revoked_on`` set → revoked;
    else ``suspended_on`` set → suspended; else authorised.
    """

    code: str
    name: str
    authorized_on: date | None
    suspended_on: date | None
    revoked_on: date | None
    agency_url: str
    leaflet_url: str
    leaflet_pdf_url: str
    affects_driving: bool | None
    safety_notices: tuple[SafetyNoticeData, ...]
    raw: dict = field(repr=False)


@dataclass(frozen=True)
class PresentationData:
    """One presentation (a concrete pack), the unit a stock is linked to."""

    code: str
    name: str
    marketed: bool | None
    supply: SupplyProblemData | None
    medicine: MedicineData
    raw: dict = field(repr=False)


class NotFound:
    """The agency has no presentation with this code."""

    _instance: NotFound | None = None

    def __new__(cls):
        # A singleton so callers can write ``result is NOT_FOUND``.
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self):
        return "NOT_FOUND"


NOT_FOUND: Final = NotFound()


class ClientError(Exception):
    """Base for regulatory-client errors."""


class FetchDisabled(ClientError):
    """Network access is switched off (``REGULATORY_FETCH_ENABLED`` is false)."""


class UpstreamUnavailable(ClientError):
    """The agency could not be reached or failed transiently: worth retrying."""


class UpstreamPayloadError(ClientError):
    """The agency answered with something that cannot be trusted: not retried."""
