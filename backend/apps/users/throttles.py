from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle


class AuthRateThrottle(AnonRateThrottle):
    """Used by /api/auth/token/ and /api/auth/refresh/."""

    scope = "auth"


class LoginStartThrottle(AnonRateThrottle):
    """Per-IP rate on /api/auth/login/start/ — every hit can trigger an
    outbound email, so the cap is per-hour rather than per-minute."""

    scope = "login_start"


class LoginVerifyThrottle(AnonRateThrottle):
    """Per-IP rate on /api/auth/login/verify/."""

    scope = "login_verify"


class EmailDestThrottle(SimpleRateThrottle):
    """Per-email-destination rate, keyed on the `email` field in the
    request body. Defends against an attacker rotating IPs to spam OTP
    emails to a single victim address. Returns no cache key (i.e. skips
    throttling) when the body has no email — that error path is handled
    by the serializer with a 400 response instead.
    """

    scope = "email_dest"

    def get_cache_key(self, request, view):
        email = (request.data.get("email") or "").lower().strip()
        if not email:
            return None
        return f"throttle_email_dest_{email}"
