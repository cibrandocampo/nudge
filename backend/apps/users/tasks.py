import logging
from email.mime.image import MIMEImage
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.timezone import now

from .models import LoginCode, User

logger = logging.getLogger(__name__)

ALLOWED_LANGS = {"en", "es", "gl"}

# Logo embedded by Content-ID so the HTML can reference it as
# <img src="cid:logo">. Avoids remote-image blocking in most clients.
LOGO_PATH = Path(__file__).resolve().parent / "email_assets" / "logo.png"


@shared_task(name="apps.users.tasks.send_login_email")
def send_login_email(user_id: int, code: str, is_signup: bool, lang: str = "en") -> None:
    """Email a 6-digit OTP to the user.

    Sends multipart/alternative: a plain-text body (broad client support,
    accessibility, less spam-prone) plus an HTML body with the Nudge
    logo embedded inline via CID. The plaintext `code` is passed in
    (T193 generates and hashes it before enqueueing this task). `lang`
    is resolved by the caller — for existing users from `user.language`,
    for fresh signups from the request's Accept-Language. Unknown
    languages fall back to English.
    """
    user = User.objects.get(pk=user_id)
    if lang not in ALLOWED_LANGS:
        lang = "en"

    template_base = "emails/welcome_signup" if is_signup else "emails/login_code"
    site_url = (settings.NUDGE_SITE_URL or "").strip().rstrip("/")
    ctx = {
        "code": code,
        "first_name": user.first_name or "",
        "display_name": user.display_name,
        "lang": lang,
        "site_url": site_url,
        "site_host": _host_from_url(site_url),
    }

    subject = render_to_string(f"{template_base}/{lang}.subject.txt", ctx).strip()
    text_body = render_to_string(f"{template_base}/{lang}.body.txt", ctx)
    html_body = render_to_string(f"{template_base}/{lang}.body.html", ctx)

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.mixed_subtype = "related"  # so the CID logo is part of the HTML body
    _attach_logo(msg)
    msg.send()


def _host_from_url(url: str) -> str:
    """Extract the bare host from a URL (`https://nudge.example.com/x`
    → `nudge.example.com`). Empty in, empty out — the layout template
    suppresses the footer link when `site_host` is empty."""
    if not url:
        return ""
    # Strip the scheme without depending on urlparse (avoids a stdlib
    # import for a 2-line job).
    if "://" in url:
        url = url.split("://", 1)[1]
    return url.split("/", 1)[0]


def _attach_logo(msg: EmailMultiAlternatives) -> None:
    """Attach the Nudge logo with Content-ID `logo` so the HTML body can
    reference it as `<img src="cid:logo">`. Silent no-op if the asset
    file is missing — the plain-text fallback still works.
    """
    if not LOGO_PATH.is_file():
        return
    with LOGO_PATH.open("rb") as fh:
        image = MIMEImage(fh.read())
    image.add_header("Content-ID", "<logo>")
    image.add_header("Content-Disposition", "inline", filename="logo.png")
    msg.attach(image)


@shared_task(name="apps.users.tasks.cleanup_login_codes")
def cleanup_login_codes() -> int:
    """Delete LoginCode rows whose expires_at is in the past. Runs daily
    via Celery beat (`cleanup-login-codes` schedule). Returns the count
    deleted, mirroring the pattern of `cleanup_idempotency_records`.
    """
    deleted, _ = LoginCode.objects.filter(expires_at__lt=now()).delete()
    return deleted
