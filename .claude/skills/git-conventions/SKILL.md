---
name: git-conventions
description: Git commit message conventions and branch naming standards for Nudge. Use when creating commits, branches, or preparing code for version control. Triggers on commit creation, branch creation, or when user asks about git workflow conventions.
---

# Git Conventions — Nudge

## Commit Message Format

```
<type>: <subject>

<bullet points explaining what changed and why>
```

### Rules

1. **Type**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`
2. **Subject**: imperative mood, lowercase, no period at end
3. **Body**: bullet points grouped by area (backend, frontend, infra, etc.)
4. **Co-Authored-By**: NEVER include Co-Authored-By lines
5. **Language**: always English, even if the conversation was in Spanish/Galician
6. **Author/Committer**: always use the git config from the current PC (never hardcode or use other identities). New commits automatically use `git config user.name` and `git config user.email`. When amending, use `--reset-author` to update to current PC config.

## Branch naming

```
feat/<slug>    # new feature
fix/<slug>     # bug fix
chore/<slug>   # maintenance, refactor, tooling
```

Examples: `feat/lot-selection-modal`, `fix/push-token-refresh`, `chore/docker-hardening`

## PR workflow

`main` is protected — direct push is rejected. Always:

```bash
git checkout -b <type>/<slug>
git push -u origin <type>/<slug>
gh pr create --title "<concise title>" --body "..."
```

Never `push --force`. If there are conflicts, resolve with merge.

### Pre-commit hook

The project has a pre-commit hook (`scripts/pre-commit`) that runs:
- `ruff check` + `ruff format --check` on backend (Python)
- `prettier --check` + `eslint` on frontend (JS/JSX)

If the hook fails, **fix the issue and create a NEW commit** (never `--amend`).
To format before committing:
- `docker compose -f dev/docker-compose.yml exec backend ruff format .`
- `docker compose -f dev/docker-compose.yml exec frontend npm run format`

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
```
