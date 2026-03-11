---
description: Quick fix — implement a focused bug fix or small change without full dev pipeline
argument-hint: <description of what to fix>
---

# Fix: $1

**Goal**: implement a focused correction and leave the code ready for `/push`.
**Behaviour**: lightweight path — no plan document, no task files, no evidence folder. Read before writing, test what you touch, stop if scope grows.

---

## Step 1 — Understand the problem

1. Read `CLAUDE.md` and `MEMORY.md` for context and known pitfalls.
2. Read the affected files before writing a single line.
3. If the fix is unclear or touches more than ~3 files, stop and suggest using `/dev-1-plan` instead.

---

## Step 2 — Implement

1. Apply the minimal change that solves the problem. No refactors, no extra features.
2. Follow conventions from `backend-patterns` and `frontend-patterns` skills.
3. Self-review: re-read every line you wrote. Fix typos, missing imports, inconsistencies.

---

## Step 3 — Verify

Run only the tests relevant to what you changed:

**Backend (affected app only):**
```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py test apps.<app>
```

**Frontend (affected test file only):**
```bash
docker compose -f dev/docker-compose.yml exec frontend npx vitest run src/<path>/__tests__/<file>.test.jsx
```

If tests fail: fix and re-run. Do not proceed with broken tests.

---

## Step 4 — Hand off

Tell the user: **"Fix complete. Ready for `/push`."**

---

## Unbreakable rules

- **Read before writing**: never modify code you haven't read.
- **Minimal scope**: if the fix keeps growing, stop and escalate to `/dev-1-plan`.
- **No placeholders, no TODOs**: the fix must be complete and functional.
- **Do NOT commit**: that is `/push`'s responsibility.
