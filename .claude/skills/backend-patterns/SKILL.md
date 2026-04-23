---
name: backend-patterns
description: Backend architecture patterns and conventions for Nudge. Use when creating or modifying Django models, views, serializers, URLs, or Celery tasks. Triggers when working on backend code or when the user asks about backend conventions.
---

# Backend Patterns — Nudge

## Reuse first — never define the same thing twice

The single most important rule in this codebase: **if a mixin, base class,
service, manager, serializer, or utility with the same intent already
exists, consume it. Do not re-implement. Do not duplicate.**

The corollary: **when designing something new, think abstract → concrete.**
If the thing has reuse potential (optimistic locking, idempotency handling,
owner-vs-shared querysets, a FEFO ordering), build the mixin / helper / base
class first and use it from the concrete model / viewset / serializer.
Don't spread the same 5-line block across three viewsets and "refactor
later".

### Pre-write checklist

Before creating ANY new backend code, grep the layers below in this order
and extend / consume what matches. If nothing matches, decide whether this
belongs in a shared layer (mixin / base class / util) or is a true
one-off.

1. **Mixins & base classes** — notably
   `apps.core.mixins.OptimisticLockingMixin` (ETag / If-Match + 412 on
   stale writes) and `apps.core.mixins.ClientCreatedAtMixin` (accept
   client-sent `client_created_at` in offline queue replays). If a new
   viewset mutates a model that already has `updated_at`, it almost
   certainly should mix `OptimisticLockingMixin`.
2. **Serializer base patterns** — `ModelSerializer` is always the base;
   validation belongs in `validate_<field>()` or `validate()`, never in
   the view. Computed read-only fields use `SerializerMethodField`. Owner
   visibility (`user=request.user | shared_with=request.user`) is a
   queryset filter, not a per-serializer decision.
3. **Querysets** — the "owner OR shared" pattern
   (`Q(user=request.user) | Q(shared_with=request.user)` + `.distinct()`)
   appears in routines and stock. If a third sharable model needs it,
   promote it to a manager method rather than re-pasting the Q expression.
4. **Test helpers** — the `make_*` pattern
   (`make_user`, `make_stock`, `make_lot`, `make_routine`) lives in
   `tests.py` modules. New tests reuse these; don't redefine them in
   every module.
5. **Transactional patterns** — stock mutations ALWAYS go inside
   `transaction.atomic()`. Every call site uses the same shape —
   consume it verbatim.
6. **Push / Celery** — `apps.notifications.push.send_push_to_user`
   already handles translation + stale-subscription cleanup. New
   notification types go through it, not direct `pywebpush` calls.
7. **Admin** — new models follow the pattern in `apps/users/admin.py`
   (`@admin.register`, `list_display`, `list_filter`, `search_fields`).
   If list filters, search, or custom actions repeat across admins, they
   become a shared `admin.ModelAdmin` base.

### The 1 / 2 / 3 rule

- **1 occurrence**: local code is fine.
- **2 occurrences**: acceptable only if disparate intent. If the intent
  matches, extract before the second lands.
- **3 occurrences**: technical debt. Must extract before merging the
  third.

Same rule as frontend — aligns with CLAUDE.md's "three similar lines is
better than a premature abstraction". The third occurrence is where the
pattern has proven itself.

### When NOT to abstract

- Single endpoint with no visible twin → keep local.
- Superficially similar but semantically different (two serializers that
  share a `validate_name` but validate against different rules) → extract
  **shape** (the validation protocol), not **context** (the rule).
- A mixin that grows conditionals for every consumer → wrong shape. Split
  into smaller mixins (e.g. `OptimisticLockingMixin` separate from
  `ClientCreatedAtMixin` — they solve different problems).

### Concrete examples already applied in this repo

- **`OptimisticLockingMixin`** (`apps.core.mixins`) — wraps every mutable
  viewset to honour If-Match / return 412 on stale updated_at. No viewset
  reimplements the concurrency check.
- **`ClientCreatedAtMixin`** — accepts `client_created_at` with bounded
  skew, lets the offline mutation queue replay with the original
  timestamp. Single source of truth for the skew envelope.
- **`IdempotencyKey` middleware + model** (`apps.idempotency`) — any
  POST that could be retried by the offline queue is idempotent via the
  same mechanism. New mutable endpoints ride on it, they don't invent
  their own dedup.
- **`StockLot.post_save` signal** (`delete_empty_lot`) — auto-deletes
  any lot with `quantity=0`. Every consume / reconcile path in the codebase
  relies on this instead of deleting manually. (Gotcha: bulk paths bypass
  signals — see `MEMORY.md`.)
- **`send_push_to_user`** — one callsite for push, handles i18n + stale
  subs. Celery tasks never instantiate `pywebpush` directly.
- **`seed_e2e` / `seed_demo` management commands** — shared fixture
  builders. Test-writers extend these instead of crafting inline
  fixtures.

These are the reuses to protect. If you find yourself writing something
that could be one of these — stop, find the existing primitive or propose
it first.

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

## Serializers

- Use DRF `ModelSerializer` as the base
- Validation goes in `validate_<field>()` or `validate()` — never in the view
- Read-only computed fields use `SerializerMethodField`
- Nested objects: use separate serializers, never raw dict construction

```python
class RoutineSerializer(serializers.ModelSerializer):
    is_due = serializers.SerializerMethodField()

    class Meta:
        model = Routine
        fields = ['id', 'name', 'is_due']
        read_only_fields = ['id']

    def get_is_due(self, obj):
        return obj.next_due <= now()

    def validate_interval_days(self, value):
        if value < 1:
            raise serializers.ValidationError("Must be at least 1.")
        return value
```

## Migrations

Always run both commands in sequence:

```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py makemigrations
docker compose -f dev/docker-compose.yml exec backend python manage.py migrate
```

## Stock patterns

- **FEFO ordering** (First Expired First Out):
  ```python
  queryset.order_by(F("expiry_date").asc(nulls_last=True), "created_at")
  ```
- **Stock mutations** must use `transaction.atomic()` to prevent partial updates:
  ```python
  from django.db import transaction

  with transaction.atomic():
      lot.quantity -= consumed
      lot.save()
  ```

## Testing

- Tests use Django's `TestCase` with `self.client`
- URLs are hardcoded as full paths (e.g., `/api/auth/token/`)
- No `reverse()` usage — tests verify the actual URLs clients use
- Run: `docker compose -f dev/docker-compose.yml exec backend python manage.py test`

### Required for every new backend feature

1. **Write new tests** covering: happy path, validation errors (400), auth/ownership
   (401/403/404). Use `APITestCase` for views, `TestCase` for models/serializers.
   Follow the `make_*` helper pattern (e.g. `make_user`, `make_stock`, `make_lot`).
2. **Run the full suite** and confirm no regressions.
3. **Update `backend-patterns` SKILL.md** if a new architectural pattern or
   convention is introduced.

## Formatting

- **ruff** for linting and formatting (configured in `pyproject.toml`)
- Format before committing: `docker compose -f dev/docker-compose.yml exec backend ruff format .`
- The pre-commit hook enforces this automatically
