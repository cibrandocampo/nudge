"""Helpers for the email-OTP auth flow.

Kept out of `views.py` so the two endpoints (`login_start`,
`login_verify`) stay short and free of business logic that would
otherwise be duplicated between the "user exists" and "new signup"
branches.
"""

import re
import secrets
from datetime import timedelta

from django.utils.timezone import now

from .models import LoginCode, User
from .tasks import send_login_email

OTP_TTL = timedelta(minutes=10)
OTP_MAX_ATTEMPTS = 5
ALLOWED_LANGS = ("en", "es", "gl")
DEFAULT_LANG = "en"

# Strips characters that aren't allowed in Django's AbstractUser.username
# field (max 150 chars, alphanumeric + @/./+/-/_). The signup helper falls
# back to a numeric suffix if the slugified local-part collides.
_USERNAME_SAFE = re.compile(r"[^A-Za-z0-9._+\-]")


def _username_from_email(email: str) -> str:
    local = email.split("@", 1)[0]
    cleaned = _USERNAME_SAFE.sub("", local) or "user"
    return cleaned[:140]  # leave headroom for a numeric suffix


def _unique_username(base: str) -> str:
    """Return `base` if free, else `base{n}` with the smallest free n."""
    if not User.objects.filter(username=base).exists():
        return base
    n = 2
    while User.objects.filter(username=f"{base}{n}").exists():
        n += 1
    return f"{base}{n}"


def create_signup_user(email: str) -> User:
    """Create a new user from a self-signup. Inactive until OTP verifies."""
    base = _username_from_email(email)
    username = _unique_username(base)
    user = User.objects.create(
        username=username,
        email=email,
        auth_method="otp",
        is_active=False,
    )
    user.set_unusable_password()
    user.save(update_fields=["password"])
    return user


def issue_otp(user: User, *, is_signup: bool, lang: str) -> None:
    """Generate a fresh 6-digit code, store its hash, enqueue the email task."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    LoginCode.objects.create(
        user=user,
        code_hash=LoginCode.hash_code(code),
        expires_at=now() + OTP_TTL,
    )
    send_login_email.delay(user.id, code, is_signup, lang)


def verify_otp(user: User, raw_code: str) -> bool:
    """Validate `raw_code` against the user's most recent unconsumed,
    unexpired LoginCode. Increments `attempts` on failure; marks
    `consumed_at` on success. Returns True iff success.
    """
    candidate = (
        LoginCode.objects.filter(user=user, consumed_at__isnull=True, expires_at__gt=now())
        .order_by("-created_at")
        .first()
    )
    if candidate is None or candidate.attempts >= OTP_MAX_ATTEMPTS:
        return False
    if LoginCode.hash_code(raw_code) != candidate.code_hash:
        candidate.attempts += 1
        candidate.save(update_fields=["attempts"])
        return False
    candidate.consumed_at = now()
    candidate.save(update_fields=["consumed_at"])
    return True


def resolve_lang(request) -> str:
    """Pick the first match against ALLOWED_LANGS from the Accept-Language
    header, else DEFAULT_LANG. Used for fresh signups (existing users
    have a stored `language` preference)."""
    header = request.META.get("HTTP_ACCEPT_LANGUAGE", "")
    for chunk in header.split(","):
        code = chunk.split(";", 1)[0].strip().lower()[:2]
        if code in ALLOWED_LANGS:
            return code
    return DEFAULT_LANG
