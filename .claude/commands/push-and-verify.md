---
description: Update documentation, commit with pre-commit, create PR, and verify CI pipeline
argument-hint: <change description or task-id (optional)>
---

# Push and Verify: $1

You are a senior developer closing a work cycle. Your goal is to leave the code
ready for merge: documentation updated, clean commit, PR created, and pipeline green.

---

## Step 1 — Review current state

1. Run `git status` to see modified, added, and untracked files.
2. Run `git diff --stat` to see a summary of changes.
3. If `$1` references a task-id, read the task file for commit context.
4. If there is no `$1`, review modified files to understand what changed.

If there are no changes, inform the user and stop.

---

## Step 2 — Update documentation

Review whether the changes require documentation updates:

### Documentation checklist

- [ ] **`docs/configuration.md`**: are there new environment variables? Did any existing one change?
- [ ] **`README.md`**: do the changes affect installation or usage instructions?
- [ ] **`CLAUDE.md`**: are there new patterns or conventions Claude should know?
- [ ] **Skills (`.claude/skills/`)**: did any convention documented in a skill change?
- [ ] **`docs/ARCHITECTURE.md`**: did the system architecture change?

For each applicable item:
1. Read the current file.
2. Update with the new information.
3. Don't add unnecessary documentation — only what changed.

Ask the user with `AskUserQuestion` if there is anything additional to document.

---

## Step 3 — Verify tests locally

**Before committing, verify that everything passes locally.**

Make sure the dev environment is running:
```bash
docker compose -f dev/docker-compose.yml ps --format '{{.Service}} {{.State}}'
```

Run tests in parallel if possible:
- Backend: `docker compose -f dev/docker-compose.yml exec backend python manage.py test`
- Frontend: `docker compose -f dev/docker-compose.yml exec frontend npx vitest run`

If any fail: **stop, fix, and re-verify.** Do not commit with broken tests.

---

## Step 4 — Commit

**Strictly apply the `git-conventions` skill** for format, rules, and pre-commit hook handling.

```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
<type>: <subject>

- bullet points
EOF
)"
```

If the pre-commit hook fails: fix, `git add`, new commit (never `--amend`).

---

## Step 5 — Pull Request

### Create branch (if needed)

If you are on `main`, create a descriptive branch:
```bash
git checkout -b <type>/<descriptive-name>
```

Examples: `feat/celery-healthcheck`, `fix/redis-password`, `chore/docker-hardening`

### Push

```bash
git push -u origin <branch>
```

**Never `push --force`.**

### Create PR

```bash
gh pr create --title "<concise title>" --body "$(cat <<'EOF'
## Summary

- Bullet 1
- Bullet 2

## Test plan

- [ ] Backend tests pass
- [ ] Frontend tests pass
- [ ] Lint/format clean
- [ ] (other specific checks)
EOF
)"
```

- Title: <70 characters, in English
- Body: clear summary + test plan with checklist

---

## Step 6 — Verify CI

The GitHub Actions pipeline runs:
- `test-backend`: ruff check + ruff format --check + coverage run manage.py test
- `test-frontend`: npm run lint + npm run test:coverage

### Monitor

```bash
gh pr checks <pr-number> --watch
```

Or to see the status of a specific run:
```bash
gh run list --limit 1
gh run view <run-id>
```

### If the pipeline fails

1. Identify which job failed:
   ```bash
   gh run view <run-id> --log-failed
   ```
2. Diagnose the error in the output.
3. Fix locally.
4. Verify it passes locally (tests + lint).
5. Create a **new commit** (not amend) and push.
6. Repeat until pipeline is green.

### When the pipeline passes

Inform the user with:
- PR URL
- Pipeline status (green)
- Summary of what the PR includes

---

## Unbreakable rules

- **Local tests BEFORE commit**: never commit without verifying.
- **Apply `git-conventions` skill**: format, commit rules, and pre-commit hook handling.
- **Never `push --force`**: if there are conflicts, resolve with merge.
- **Green pipeline**: do not consider it done until CI passes.
- **If CI fails, fix it**: do not ignore it or ask the user to handle it manually.
- **Commit and PR language**: always English.
