"""Client for CIMA, the medicines database of the Spanish agency (AEMPS).

This is the **only** module that knows CIMA: its URLs, its field names and its
codes. Everything else in Nudge works with the standard shape defined in
``clients/types.py``. Keep it that way — the data model is agency-neutral only
as long as no CIMA name leaks out of this file.

Behaviour of CIMA this module relies on (verified live on 2026-11-10, see
``docs/tasks/evidence/T109/research.md``):

* ``GET medicamento?cn=<cn>`` returns the medicine **and** all its
  presentations, each with ``psum`` and ``detalleProblemaSuministro``. That
  detail carries dates, ``activo`` and ``observ`` but **not** the problem type;
  only ``GET psuministro/<cn>`` returns ``tipoProblemaSuministro``. The query
  form ``psuministro?cn=X`` ignores the filter and returns every problem in
  Spain — never use it.
* An unknown code, a full GTIN or a 7-digit CN answer **204** with no body:
  only the 6-digit CN works.
* Timestamps are epoch milliseconds at **Europe/Madrid** midnight; read as UTC
  they land on the previous day.
* ``estado`` exposes the current state: ``rev`` and ``susp`` disappear once
  they no longer apply, and never appear together.
* Each supply-problem type has one canonical text; ``observ`` is that text
  plus an optional free-text addition. There is no official code table, so the
  canonical texts are the meaning (``SEVERITY_BY_TYPE`` follows them).
* A safety notice's ``referencia`` is free text with irregular formatting,
  but stable and unique per notice.
* Reuse is allowed citing the origin and the date of the data (AEMPS legal
  notice), hence ``ATTRIBUTION`` and the "updated on" date the UI shows.
"""

from __future__ import annotations

import json
import re
import time
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import requests
from django.conf import settings

from .types import (
    NOT_FOUND,
    SEVERITY_DANGER,
    SEVERITY_WARNING,
    FetchDisabled,
    MedicineData,
    NotFound,
    PresentationData,
    SafetyNoticeData,
    SupplyProblemData,
    UpstreamPayloadError,
    UpstreamUnavailable,
)

SOURCE = "aemps"
DISPLAY_NAME = "AEMPS (CIMA)"
LANGUAGE = "es"
# Required by the AEMPS legal notice: reuse must cite the origin. The UI shows
# it next to the date the data was fetched (the other obligation).
ATTRIBUTION = "Agencia Española de Medicamentos y Productos Sanitarios (AEMPS) — CIMA"

BASE_URL = "https://cima.aemps.es/cima/rest/"
PUBLIC_URL = "https://cima.aemps.es/cima/publico/"

# (connect, read) seconds. CIMA usually answers in well under a second; the
# read timeout covers its occasional slow responses without stalling a worker.
TIMEOUT = (5, 15)
# Minimum gap between two calls: CIMA is a public service with no published
# rate limit, and nothing in Nudge needs more than a few calls a minute.
MIN_INTERVAL_SECONDS = 0.2
USER_AGENT = "Nudge (+https://github.com/cibrandocampo/nudge)"

# An NTIN is ``0847000`` followed by the 7-digit CN (6 digits + check digit).
# A pack coded with the manufacturer's own GTIN carries the CN in AI 712
# instead, so it cannot be derived from the GTIN.
NTIN_PREFIX = "0847000"

LEAFLET_DOC_TYPE = 2
MADRID = ZoneInfo("Europe/Madrid")

# Severity of each supply-problem type, from its canonical CIMA text.
# "danger": the medicine may simply not be obtainable through the usual
# channel. "warning": it is restricted or an equivalent exists.
SEVERITY_BY_TYPE = {
    "1": SEVERITY_DANGER,  # Consultar Nota Informativa
    "2": SEVERITY_WARNING,  # Suministro sólo a hospitales
    "3": SEVERITY_DANGER,  # El médico prescriptor deberá determinar otros tratamientos
    "4": SEVERITY_DANGER,  # Desabastecimiento temporal
    "5": SEVERITY_WARNING,  # Existe otro medicamento con el mismo principio activo
    "6": SEVERITY_WARNING,  # Existe otro medicamento con los mismos principios activos
    "7": SEVERITY_DANGER,  # Se puede solicitar como medicamento extranjero
    "8": SEVERITY_DANGER,  # Never observed: treated like an unknown type
    "9": SEVERITY_WARNING,  # Distribución controlada al existir unidades limitadas
    "10": SEVERITY_WARNING,  # Unidades por comercialización excepcional, otro idioma
    "11": SEVERITY_WARNING,  # Tratamientos alternativos no sujetos a prescripción
    "12": SEVERITY_WARNING,  # Distribución controlada a hospitales
}
# A type CIMA adds later is shown with its own text; until it is classified,
# assume the worse case rather than understate a shortage.
UNKNOWN_TYPE_SEVERITY = SEVERITY_DANGER

_CN_RE = re.compile(r"(\d{6})(?:\.?(\d))?")

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
_last_call = 0.0


# ── Codes ─────────────────────────────────────────────────────────────────────


def _gs1_check_digit(digits: str) -> int:
    """GS1 mod-10 check digit of ``digits`` (weights 3,1,3,… from the right)."""
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digits)))
    return (10 - total % 10) % 10


def _cn_check_digit(cn: str) -> int:
    """Check digit of a 6-digit CN.

    It is the GS1 check digit of the NTIN ``0847000`` + CN: AEMPS defines the
    NTIN as that prefix followed by the full 7-digit CN, so both digits are
    the same one. Verified on real CNs (FIASP 728514.4, Ibuprofeno Cinfa
    661426.6, …); the NTIN in AEMPS's own FAQ example (08470008722513 ↔
    872251.3) is illustrative — it is not even a valid GS1 code.
    """
    return _gs1_check_digit(NTIN_PREFIX + cn)


def code_from_gtin(gtin: str) -> str | None:
    """CN embedded in an NTIN-coded pack, or ``None`` for any other GTIN.

    The GTIN's own check digit is validated by the caller (``is_valid_gtin``);
    for an NTIN that digit is also the CN check digit, so it is not repeated
    here.
    """
    if not isinstance(gtin, str) or len(gtin) != 14 or not gtin.isdigit():
        return None
    if not gtin.startswith(NTIN_PREFIX):
        return None
    return gtin[7:13]


def normalize_code(text: str) -> str | None:
    """Canonical 6-digit CN from a typed one, or ``None`` if it is not a CN.

    Accepts the 6 digits (``728514``), the 7 digits (``7285144``) and the
    printed form (``728514.4``); whitespace is ignored. A 7th digit must be the
    right check digit — a mistyped CN would otherwise silently link to another
    medicine.
    """
    if not isinstance(text, str):
        return None
    match = _CN_RE.fullmatch(re.sub(r"\s+", "", text))
    if match is None:
        return None
    cn, check = match.groups()
    if check is not None and int(check) != _cn_check_digit(cn):
        return None
    return cn


# ── Parsing (pure: also used by the seed on recorded payloads) ────────────────


def _madrid_date(value) -> date | None:
    """A CIMA timestamp (epoch ms at Madrid midnight) as a Madrid date."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise UpstreamPayloadError(f"Unexpected timestamp: {value!r}")
    return datetime.fromtimestamp(value / 1000, tz=MADRID).date()


def _require(payload: dict, key: str, kind: type):
    value = payload.get(key)
    if not isinstance(value, kind) or (isinstance(value, str) and not value.strip()):
        raise UpstreamPayloadError(f"Missing or invalid {key!r}")
    return value


def _find_presentation(medicamento: dict, cn: str) -> dict | None:
    presentations = _require(medicamento, "presentaciones", list)
    for presentation in presentations:
        if isinstance(presentation, dict) and str(presentation.get("cn")) == cn:
            return presentation
    return None


def _has_active_problem(presentation: dict) -> bool:
    detail = presentation.get("detalleProblemaSuministro")
    return bool(presentation.get("psum")) and isinstance(detail, dict) and bool(detail.get("activo"))


def _parse_supply(cn: str, presentation: dict, psuministro) -> SupplyProblemData | None:
    if not _has_active_problem(presentation):
        return None
    detail = presentation["detalleProblemaSuministro"]
    # The type lives only in `psuministro/<cn>`; without it the problem cannot
    # be classified, and storing it unclassified would understate it.
    results = psuministro.get("resultados") if isinstance(psuministro, dict) else None
    entry = next(
        (r for r in results or () if isinstance(r, dict) and str(r.get("cn")) == cn),
        None,
    )
    if entry is None or entry.get("tipoProblemaSuministro") is None:
        raise UpstreamPayloadError(f"Active supply problem of {cn} without its type")
    native_type = str(entry["tipoProblemaSuministro"])
    return SupplyProblemData(
        native_type=native_type,
        severity=SEVERITY_BY_TYPE.get(native_type, UNKNOWN_TYPE_SEVERITY),
        note=str(detail.get("observ") or "").strip(),
        started_on=_madrid_date(detail.get("fini")),
        expected_end_on=_madrid_date(detail.get("ffin")),
    )


def _parse_notice(notice) -> SafetyNoticeData:
    if not isinstance(notice, dict):
        raise UpstreamPayloadError(f"Unexpected safety notice: {notice!r}")
    return SafetyNoticeData(
        reference=_require(notice, "referencia", str).strip(),
        native_kind=str(notice.get("tipo") or ""),
        title=str(notice.get("asunto") or "").strip(),
        url=str(notice.get("url") or ""),
        published_on=_madrid_date(notice.get("fecha")),
    )


def _leaflet_url(medicamento: dict) -> str:
    for doc in medicamento.get("docs") or ():
        if isinstance(doc, dict) and doc.get("tipo") == LEAFLET_DOC_TYPE:
            return str(doc.get("urlHtml") or doc.get("url") or "")
    return ""


def parse_presentation(cn: str, medicamento, psuministro=None, notas=None) -> PresentationData | NotFound:
    """Build the standard shape from CIMA payloads, already decoded.

    ``psuministro`` is the answer of ``psuministro/<cn>`` (needed only when the
    presentation has an active problem) and ``notas`` that of
    ``notas/<nregistro>``. Anything missing or malformed raises
    ``UpstreamPayloadError``: half-understood data is never returned.
    """
    if not isinstance(medicamento, dict):
        raise UpstreamPayloadError("Unexpected medicine payload")
    nregistro = str(_require(medicamento, "nregistro", str | int))
    name = _require(medicamento, "nombre", str).strip()
    presentation = _find_presentation(medicamento, cn)
    if presentation is None:
        return NOT_FOUND
    if notas is not None and not isinstance(notas, list):
        raise UpstreamPayloadError("Unexpected safety notices payload")

    estado = medicamento.get("estado") or {}
    if not isinstance(estado, dict):
        raise UpstreamPayloadError("Unexpected authorisation state")
    comerc = presentation.get("comerc")

    medicine = MedicineData(
        code=nregistro,
        name=name,
        authorized_on=_madrid_date(estado.get("aut")),
        suspended_on=_madrid_date(estado.get("susp")),
        revoked_on=_madrid_date(estado.get("rev")),
        agency_url=f"{PUBLIC_URL}detalle.html?{urlencode({'nregistro': nregistro})}",
        leaflet_url=_leaflet_url(medicamento),
        safety_notices=tuple(_parse_notice(n) for n in notas or ()),
        raw=medicamento,
    )
    return PresentationData(
        code=cn,
        name=str(presentation.get("nombre") or "").strip(),
        marketed=comerc if isinstance(comerc, bool) else None,
        supply=_parse_supply(cn, presentation, psuministro),
        medicine=medicine,
        raw=presentation,
    )


def parse_recorded(cn: str, directory) -> PresentationData | NotFound:
    """Parse CIMA answers recorded on disk, as ``fetch`` would parse live ones.

    The layout is this client's own convention (see the fixtures README):
    ``medicamento_<cn>.json``, plus ``psuministro_<cn>.json`` and
    ``notas_<nregistro>.json`` when they were recorded. The seed uses it, so
    the demo data goes through the real parser without the network and nothing
    outside this module needs to know CIMA's endpoint names.
    """
    directory = Path(directory)

    def read(name):
        path = directory / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    medicamento = read(f"medicamento_{cn}.json")
    if medicamento is None:
        raise FileNotFoundError(f"No recorded CIMA answer for CN {cn} in {directory}")
    nregistro = medicamento.get("nregistro") if isinstance(medicamento, dict) else None
    return parse_presentation(
        cn,
        medicamento,
        psuministro=read(f"psuministro_{cn}.json"),
        notas=read(f"notas_{nregistro}.json"),
    )


# ── Network ───────────────────────────────────────────────────────────────────


def _throttle():
    global _last_call
    wait = MIN_INTERVAL_SECONDS - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.monotonic()


def _get_json(path: str, params: dict | None = None):
    """GET a CIMA resource. ``None`` means 204 (CIMA's "nothing here")."""
    _throttle()
    try:
        response = _session.get(BASE_URL + path, params=params, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise UpstreamUnavailable(f"CIMA unreachable ({path}): {exc}") from exc
    if response.status_code == 204:
        return None
    if response.status_code == 429 or response.status_code >= 500:
        raise UpstreamUnavailable(f"CIMA answered {response.status_code} ({path})")
    if response.status_code != 200:
        raise UpstreamPayloadError(f"CIMA answered {response.status_code} ({path})")
    try:
        return response.json()
    except ValueError as exc:
        raise UpstreamPayloadError(f"CIMA answered invalid JSON ({path})") from exc


def fetch(cn: str) -> PresentationData | NotFound:
    """Current CIMA data of one presentation: 1 to 3 calls."""
    if not settings.REGULATORY_FETCH_ENABLED:
        raise FetchDisabled("Regulatory fetching is disabled (REGULATORY_FETCH_ENABLED)")
    medicamento = _get_json("medicamento", {"cn": cn})
    if medicamento is None:
        return NOT_FOUND
    if not isinstance(medicamento, dict):
        raise UpstreamPayloadError("Unexpected medicine payload")
    presentation = _find_presentation(medicamento, cn)
    if presentation is None:
        return NOT_FOUND
    psuministro = _get_json(f"psuministro/{cn}") if _has_active_problem(presentation) else None
    notas = None
    if medicamento.get("notas"):
        nregistro = str(_require(medicamento, "nregistro", str | int))
        notas = _get_json(f"notas/{nregistro}") or []
    return parse_presentation(cn, medicamento, psuministro=psuministro, notas=notas)
