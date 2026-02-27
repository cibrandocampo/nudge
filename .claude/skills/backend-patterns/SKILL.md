---
name: backend-patterns
description: Backend architecture patterns and conventions for Nudge. Use when creating or modifying Django models, views, serializers, URLs, or Celery tasks. Triggers when working on backend code or when the user asks about backend conventions.
---

# Backend Patterns — Nudge

## Architecture

- **Django 5 + DRF** with JWT auth (simplejwt)
- **PostgreSQL** database, **Redis** for Celery broker
- **Celery** worker with beat scheduler (every 5 min)
- Apps: `core`, `users`, `routines`, `notifications`

## URL structure

Prefixes are defined in `nudge/urls.py`, NOT in each app:

```python
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", include("apps.core.urls")),
    path("api/auth/",   include("apps.users.urls")),
    path("api/push/",   include("apps.notifications.urls")),
    path("api/",        include("apps.routines.urls")),  # catch-all for routines/stock/entries/dashboard
]
```

Each app's `urls.py` defines only the local part (e.g., `token/`, `subscribe/`).
The `routines` app is the exception — it defines `routines/`, `stock/`, `entries/`, `dashboard/` internally.

## Views

- DRF views use `@api_view` decorators (function-based)
- Plain Django views (like `admin_access`) need `@csrf_exempt` if called from the SPA
- All DRF views require JWT auth by default (configured in settings)

## Models

- Custom user model in `apps.users.models.User`
- User fields: `timezone` (IANA string), `daily_notification_time` (local time),
  `language` (en/es/gl)
- Backend always stores/works in UTC. Timezone conversion happens in Celery tasks.

## Push notifications

- `apps.notifications.push` module handles sending via `pywebpush`
- Messages are translated server-side using the user's `language` field
- Stale subscriptions (404/410 from push service) are auto-deleted
- The `notify_test()` helper sends a test notification to all user devices

## Celery tasks

- Beat runs every 5 minutes
- Three notification types: `daily_heads_up`, `due`, `reminder`
- Tasks respect user timezone and DST via `zoneinfo`
- Invalid timezones are logged and skipped (never crash the task)

## Testing

- Tests use Django's `TestCase` with `self.client`
- URLs are hardcoded as full paths (e.g., `/api/auth/token/`)
- No `reverse()` usage — tests verify the actual URLs clients use
- Run: `docker compose -f dev/docker-compose.yml exec backend python manage.py test`

## Formatting

- **ruff** for linting and formatting (configured in `pyproject.toml`)
- Format before committing: `docker compose -f dev/docker-compose.yml exec backend ruff format .`
- The pre-commit hook enforces this automatically
