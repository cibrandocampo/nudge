from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, []),
    CSRF_TRUSTED_ORIGINS=(list, []),
)

# Load .env file if present (useful for local development outside Docker)
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

# ── Security ──────────────────────────────────────────────────────────────────

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = [h for h in env("DJANGO_ALLOWED_HOSTS") if h]

# ── App version (read at process start; baked into the image by CI) ──────────

APP_VERSION = env("APP_VERSION", default="dev")
APP_COMMIT = env("COMMIT_SHA", default="dev")
APP_BUILT_AT = env("BUILT_AT", default="dev")

# ── Applications ──────────────────────────────────────────────────────────────

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    # Project apps
    "apps.core",
    "apps.users",
    "apps.routines",
    "apps.notifications",
    "apps.idempotency",
]

AUTH_USER_MODEL = "users.User"

# ── Middleware ────────────────────────────────────────────────────────────────

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.idempotency.middleware.IdempotencyMiddleware",
    "apps.core.middleware.AppVersionHeaderMiddleware",
]

ROOT_URLCONF = "nudge.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "nudge.wsgi.application"

# ── Database ──────────────────────────────────────────────────────────────────

DATABASES = {"default": env.db("DATABASE_URL")}

# ── Password validation ──────────────────────────────────────────────────────

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ── Internationalisation and timezone ─────────────────────────────────────────

LANGUAGE_CODE = "en-us"
LANGUAGES = [
    ("en", "English"),
    ("es", "Español"),
    ("gl", "Galego"),
]
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ── Static files ──────────────────────────────────────────────────────────────

STATIC_URL = "/django-static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# ── Models ────────────────────────────────────────────────────────────────────

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── CORS ──────────────────────────────────────────────────────────────────────

if DEBUG:
    # Dev compose maps the frontend to host port 15173 (and backend to
    # 18000); keep the legacy ports too so anyone running the frontend
    # outside the dev compose (e.g. `npm run dev` on the host) still
    # works without tweaking settings.
    CORS_ALLOWED_ORIGINS = [
        "http://localhost:15173",
        "http://127.0.0.1:15173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    CSRF_TRUSTED_ORIGINS = [
        "http://localhost:15173",
        "http://127.0.0.1:15173",
        "http://localhost:18000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
    ]
else:  # pragma: no cover — production branch, pure config assignments, no logic to test.
    # Never use CORS_ALLOW_ALL_ORIGINS — always whitelist explicitly.
    CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
    CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# ── Security headers (production only) ────────────────────────────────────────

if not DEBUG:  # pragma: no cover — production-only hardening, straight config assignments.
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    # SSL redirect is handled by the external reverse proxy (Synology / nginx),
    # not by Django. Enabling it here breaks the HTTP-only Docker internal traffic.
    SECURE_SSL_REDIRECT = False
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    X_FRAME_OPTIONS = "DENY"
    # Trust X-Forwarded-Proto from the nginx proxy so Django knows when the
    # upstream request arrived over HTTPS.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ── Django REST Framework ─────────────────────────────────────────────────────

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": (),
    "DEFAULT_THROTTLE_RATES": {
        "auth": "9999/minute" if DEBUG else "5/minute",
        # Per-IP rate on /api/auth/login/start/ — every hit can trigger
        # an outbound email, hence the per-hour cap.
        "login_start": "9999/hour" if DEBUG else "10/hour",
        # Per-IP rate on /api/auth/login/verify/ — protects the OTP code
        # input from brute force on top of the per-code `attempts` limit.
        "login_verify": "9999/minute" if DEBUG else "10/minute",
        # Per-email-destination rate on /api/auth/login/start/ — caps
        # how many OTP emails a single address can receive, even if the
        # requests come from different IPs.
        "email_dest": "9999/hour" if DEBUG else "3/hour",
    },
}

# ── JWT ───────────────────────────────────────────────────────────────────────

SIMPLE_JWT = {
    # Short access lifetime keeps the window of a stolen token small.
    # Refresh is long because every interactive login costs an OTP email,
    # so we want sessions to last ~2 months before re-auth.
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=2),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=60),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# ── Celery ────────────────────────────────────────────────────────────────────

CELERY_BROKER_URL = env("REDIS_URL")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TIMEZONE = "UTC"
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]

CELERY_BEAT_SCHEDULE = {
    "check-notifications": {
        "task": "apps.notifications.tasks.check_notifications",
        "schedule": 300,  # every 5 minutes
    },
    "cleanup-idempotency-records": {
        "task": "apps.idempotency.tasks.cleanup_idempotency_records",
        "schedule": 24 * 60 * 60,  # once a day
    },
    "cleanup-login-codes": {
        "task": "apps.users.tasks.cleanup_login_codes",
        "schedule": 24 * 60 * 60,  # once a day
    },
}

# ── Email (SMTP) ──────────────────────────────────────────────────────────────
# All env-driven. In dev, default backend is `console` so emails appear in
# the Django / Celery stdout. In prod set EMAIL_BACKEND to
# `django.core.mail.backends.smtp.EmailBackend` and fill the SMTP fields.
# In the test run (`manage.py test`) the backend is forced to `locmem` so
# tests can assert on `django.core.mail.outbox` (see "Test-run quiet mode"
# block at the end of this file).
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Nudge <noreply@nudge.local>")

# ── Auth: self-signup gate ────────────────────────────────────────────────────
# When False (default), /api/auth/login/start/ with an unknown email returns
# 404 — only admin-created accounts can log in. When True, an unknown email
# is auto-created with auth_method='otp' and is_active=False; verifying the
# OTP from the welcome email activates the account.
ALLOW_SELF_SIGNUP = env.bool("ALLOW_SELF_SIGNUP", default=False)

# Disposable / throwaway email blacklist for self-signup. Defaults to ON in
# production (DEBUG=False) and OFF in dev. The bundled file in
# `apps/users/disposable_email_domains.txt` is a curated ~80-entry list,
# distilled from the community-maintained CC0 list at
# https://github.com/disposable-email-domains/disposable-email-domains —
# extend it via env var or swap the file for that project's full
# `disposable_email_blocklist.conf` for ~4500 entries.
BLOCK_DISPOSABLE_EMAIL = env.bool("BLOCK_DISPOSABLE_EMAIL", default=not DEBUG)
DISPOSABLE_EMAIL_EXTRA_DOMAINS = env.list("DISPOSABLE_EMAIL_EXTRA_DOMAINS", default=[])
DISPOSABLE_EMAIL_ALLOW_DOMAINS = env.list("DISPOSABLE_EMAIL_ALLOW_DOMAINS", default=[])

# ── Branding ──────────────────────────────────────────────────────────────────
# Public URL where this Nudge instance is hosted. Used in the email footer
# and (potentially) future deep-link generation. Leave empty to suppress
# the "nudge.example.com" line in transactional emails.
NUDGE_SITE_URL = env("NUDGE_SITE_URL", default="")

# ── Offline sync safeguards ──────────────────────────────────────────────────

# Maximum allowed skew (in seconds) between a client-reported action timestamp
# (`client_created_at` on RoutineEntry / StockConsumption) and the server's
# current time. Unset (None) means no limit — appropriate for weeklong offline
# trips. Set to e.g. `86400` (24h) if clients ever drift/misuse the field.
_skew = env("OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS", default=None)
OFFLINE_MAX_CLIENT_TIMESTAMP_SKEW_SECONDS = int(_skew) if _skew else None

# ── Stock severity thresholds ────────────────────────────────────────────────
# Drive `stock_severity` / `expiry_severity` and the depletion estimator. See
# docs/configuration.md for the user-facing description of each variable.
STOCK_SEVERITY_WARNING_DAYS = env.int("STOCK_SEVERITY_WARNING_DAYS", default=30)
STOCK_SEVERITY_CRITICAL_DAYS = env.int("STOCK_SEVERITY_CRITICAL_DAYS", default=7)
STOCK_LOW_THRESHOLD_UNITS = env.int("STOCK_LOW_THRESHOLD_UNITS", default=3)
STOCK_DIRECT_CONSUMPTION_WINDOW_DAYS = env.int("STOCK_DIRECT_CONSUMPTION_WINDOW_DAYS", default=60)
STOCK_DIRECT_CONSUMPTION_HALF_DAYS = env.int("STOCK_DIRECT_CONSUMPTION_HALF_DAYS", default=30)

# ── Web Push VAPID ────────────────────────────────────────────────────────────

VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY", default="")
VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY", default="")
VAPID_CLAIMS_EMAIL = env("VAPID_CLAIMS_EMAIL", default="admin@example.com")

# ── Logging ───────────────────────────────────────────────────────────────────

_LOG_LEVEL = env("DJANGO_LOG_LEVEL", default="INFO").upper()

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": _LOG_LEVEL,
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": _LOG_LEVEL,
            "propagate": False,
        },
        "apps": {
            "handlers": ["console"],
            "level": _LOG_LEVEL,
            "propagate": False,
        },
        "celery": {
            "handlers": ["console"],
            "level": env("CELERY_LOG_LEVEL", default="INFO").upper(),
            "propagate": False,
        },
    },
}

# ── Test-run quiet mode ───────────────────────────────────────────────────────
# During `manage.py test` dozens of specs exercise 4xx paths (401/403/404/
# 412/422) on purpose. Django's `django.request` logger fires WARNING for
# each one — hundreds of lines drown the useful pass/fail signal in CI.
# Silence WARNING and below during the test run; ERROR and CRITICAL still
# surface (and tests that trigger ERROR on purpose capture it with
# `assertLogs`, which proves the log fires AND suppresses the output —
# see apps.idempotency / apps.notifications tests).
import sys  # noqa: E402

if "test" in sys.argv:
    import logging  # noqa: E402

    logging.disable(logging.WARNING)

    # WhiteNoise's CompressedManifestStaticFilesStorage expects a manifest
    # produced by `collectstatic`. In the test run we don't collect statics
    # (it's not needed to exercise any view), so the manifest is missing
    # and Django emits "No directory at: .../staticfiles/" as a UserWarning.
    # Swap to the plain storage — correct choice for the test environment —
    # and ensure the STATIC_ROOT directory exists so the staticfiles
    # handler doesn't warn on first request.
    STORAGES["staticfiles"] = {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    }
    STATIC_ROOT.mkdir(parents=True, exist_ok=True)

    # Force the in-memory mail backend so tests can assert on
    # `django.core.mail.outbox` without touching the configured SMTP
    # backend (console in dev, real SMTP in prod). Overrides whatever
    # EMAIL_BACKEND was resolved above.
    EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

    # Run Celery tasks synchronously in tests so `.delay()` actually
    # produces side effects we can observe (mail outbox, DB writes from
    # the task body). Without this the tests would have to manually
    # invoke each task — which loses the wiring guarantee that the view
    # is enqueueing the right task with the right args.
    CELERY_TASK_ALWAYS_EAGER = True
    CELERY_TASK_EAGER_PROPAGATES = True
