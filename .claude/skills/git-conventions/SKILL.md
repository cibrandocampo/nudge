---
name: git-conventions
description: Git commit message conventions and branch naming standards for Nudge. Use when creating commits, branches, or preparing code for version control. Triggers on commit creation, branch creation, or when user asks about git workflow conventions.
---

# Git Conventions — Nudge

## Commit Message Format

```
<type>: <subject>

<bullet points explaining what changed and why>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

### Rules

1. **Type**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`
2. **Subject**: imperative mood, lowercase, no period at end
3. **Body**: bullet points grouped by area (backend, frontend, infra, etc.)
4. **Co-Authored-By**: always include the Claude line
5. **Language**: always English, even if the conversation was in Spanish/Galician

### Pre-commit hook

The project has a pre-commit hook (`scripts/pre-commit`) that runs:
- `ruff check` + `ruff format --check` on backend (Python)
- `prettier --check` + `eslint` on frontend (JS/JSX)

If the hook fails, **fix the issue and create a NEW commit** (never `--amend`).
To format before committing:
- `docker compose -f dev/docker-compose.yml exec backend ruff format .`
- `docker compose -f dev/docker-compose.yml exec frontend npx prettier --write src/`

### Example

```
feat: reorganize URL namespaces, Django admin branding, and UX improvements

URL namespaces:
- Move app prefixes (api/health/, api/auth/, api/push/) to root urls.py
- Strip duplicate prefixes from each app's urls.py

Django admin:
- Custom branding with Nudge indigo color scheme
- Add LocaleMiddleware for multilingual admin (en/es/gl)

Push notifications:
- Enable VitePWA service worker in dev mode
- Add @csrf_exempt to admin_access view

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
