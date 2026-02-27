---
name: django-admin
description: Django admin customization patterns for Nudge. Use when modifying the admin panel, adding models to admin, or changing admin branding/styling. Triggers when the user asks about Django admin, admin panel, or model registration.
---

# Django Admin — Nudge

## Branding

The admin is branded with Nudge's indigo color scheme via a custom template:
`backend/templates/admin/base_site.html`

This template:
- Extends `admin/base.html` (NOT `admin/base_site.html` — that would loop)
- Overrides Django's CSS variables for both light and dark mode
- Sets the "Nudge" logo linking to `/` (the app, not `/admin/`)
- Forces white text on indigo headers in all theme modes

### Color palette (from frontend)

| Token            | Light          | Dark           |
|------------------|----------------|----------------|
| Primary          | `#6366f1`      | `#6366f1`      |
| Primary dark     | `#4f46e5`      | `#4f46e5`      |
| Secondary bg     | `#eef2ff`      | `#312e81`      |
| Links            | `#6366f1`      | `#a5b4fc`      |
| Links hover      | `#4f46e5`      | `#c7d2fe`      |
| Body bg          | `#f9fafb`      | `#1e1e2e`      |

### Django CSS variables to override

The key to theming Django admin is overriding its own CSS custom properties:
`--header-bg`, `--module-bg`, `--link-fg`, `--button-bg`, `--breadcrumbs-bg`, etc.
Do this for `:root`, `html[data-theme="light"]`, `html[data-theme="dark"]`,
and `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])`.

## Admin access from the PWA

The frontend has an "Admin" button (staff users only) in the Header component.
It works by creating a hidden form that POSTs the JWT token to `/api/auth/admin-access/`.
The backend view (`apps.users.views.admin_access`):
- Is `@csrf_exempt` (no CSRF token available from the SPA)
- Validates the JWT, checks `is_staff`
- Creates a Django session via `django_login()`
- Redirects to `/admin/`

## i18n

Django admin is multilingual out of the box. We enabled it by:
- Adding `django.middleware.locale.LocaleMiddleware` to `MIDDLEWARE`
  (after `SessionMiddleware`, before `CommonMiddleware`)
- Setting `LANGUAGES = [("en", "English"), ("es", "Español"), ("gl", "Galego")]`

The admin auto-detects language from the browser's `Accept-Language` header.

## Registering models

Pattern used in `apps/users/admin.py`:

```python
@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Nudge settings", {"fields": ("timezone", "daily_notification_time", "language")}),
    )
    list_display = ["username", "email", "timezone", "is_staff", "is_active"]
    list_filter = ["is_staff", "is_active", "timezone"]
    search_fields = ["username", "email"]
```
