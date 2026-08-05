"""Disposable / throwaway email blacklist for self-signup.

Loaded once at module import — ~8k entries, so the `set` lookup is O(1)
and the cost negligible. Env vars `DISPOSABLE_EMAIL_EXTRA_DOMAINS`
(additive) and `DISPOSABLE_EMAIL_ALLOW_DOMAINS` (counter-allow list for
false positives) are layered on top of the bundled files via settings.

Two files are unioned:

* `disposable_email_domains.txt` — auto-synced from upstream weekly and
  replaced wholesale, so it must not carry local edits.
* `disposable_email_domains.local.txt` — hand-curated, never touched by
  the sync. Holds entries upstream lacks, which would otherwise be
  silently unblocked the next time the sync runs.
"""

from pathlib import Path

from django.conf import settings

_DOMAINS_DIR = Path(__file__).resolve().parent
_DOMAINS_FILES = (
    _DOMAINS_DIR / "disposable_email_domains.txt",
    _DOMAINS_DIR / "disposable_email_domains.local.txt",
)


def _load_bundled_domains() -> frozenset[str]:
    out: set[str] = set()
    for path in _DOMAINS_FILES:
        if not path.is_file():
            continue
        with path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip().lower()
                if not line or line.startswith("#"):
                    continue
                out.add(line)
    return frozenset(out)


_BUNDLED_DOMAINS = _load_bundled_domains()


def _normalise(domains) -> frozenset[str]:
    return frozenset(d.strip().lower() for d in domains if d.strip())


def disposable_domains() -> frozenset[str]:
    """Bundled list plus the env-driven extras, minus the env-driven
    allow-list. Recomputed on every call so settings overrides applied
    in tests via `override_settings` take effect.
    """
    extra = _normalise(getattr(settings, "DISPOSABLE_EMAIL_EXTRA_DOMAINS", []))
    allow = _normalise(getattr(settings, "DISPOSABLE_EMAIL_ALLOW_DOMAINS", []))
    return (_BUNDLED_DOMAINS | extra) - allow


def is_disposable_email(email: str) -> bool:
    """True when the email's domain part is on the active blacklist.
    Case-insensitive; returns False on empty / malformed input.
    """
    if not email or "@" not in email:
        return False
    domain = email.rsplit("@", 1)[1].strip().lower()
    if not domain:
        return False
    return domain in disposable_domains()
