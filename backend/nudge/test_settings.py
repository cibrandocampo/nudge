import os

# Provide required env vars before importing the main settings
os.environ.setdefault("DJANGO_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("DATABASE_URL", "sqlite://:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from nudge.settings import *  # noqa: E402, F403

# Override database to SQLite in-memory — no PostgreSQL needed
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# Disable Celery during tests
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
