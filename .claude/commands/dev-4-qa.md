---
description: Forensic QA of a completed task — independent verification with evidence
argument-hint: <task-id, e.g.: T001>
---

# QA Review: $1

**Goal**: independently verify that the task meets its DoD. You produce real evidence or declare failure. No middle ground.
**Key behaviour**: you do not trust evidence from `/dev-3-run`. You re-execute everything from scratch. Anything broken — even if unrelated to the task — is a blocker. Never approve on top of a broken system.

---

## Step 1 — Read the task file

1. Locate the file `docs/tasks/$1*.md` and read it in full.
2. Extract:
   - **DoD**: the acceptance criteria.
   - **Evidence table**: commands, files, conditions.
   - **Dependencies**: are they completed?
3. Read the execution evidence from `/dev-3-run` (section `## Execution evidence`).
4. Read `CLAUDE.md` and `MEMORY.md` for context.

---

## Step 2 — Prepare environment and evidence

```bash
mkdir -p docs/tasks/evidence/$TASK_ID/qa
```

QA evidence goes separate from dev-3-run evidence to avoid contamination.

Make sure the dev environment is running:
```bash
docker compose -f dev/docker-compose.yml ps --format '{{.Service}} {{.State}}'
```

If any service is not running, start it before continuing.

---

## Step 3 — Progressive verification

**Do not trust dev-3-run evidence. Re-execute EVERYTHING.**

Verification follows a strict order from smallest to largest scope. If a phase fails,
the following phases are meaningless — skip directly to the verdict (Step 5).

Each command saves its evidence:
```bash
<command> 2>&1 | tee docs/docs/tasks/evidence/$TASK_ID/qa/<file>.txt
```

### 3.1 — Lint & format

Run linters and formatters. **If they fail, fix before continuing.**

**Backend:**
```bash
docker compose -f dev/docker-compose.yml exec backend ruff check . 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/ruff_check.txt
docker compose -f dev/docker-compose.yml exec backend ruff format --check . 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/ruff_format.txt
```

**Frontend:**
```bash
docker compose -f dev/docker-compose.yml exec frontend npx eslint src/ 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/eslint.txt
docker compose -f dev/docker-compose.yml exec frontend npm run format:check 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/prettier.txt
```

**If any fail:**
1. Fix: `ruff format .` / `ruff check --fix .` / `npm run format`
2. Re-run checks and save clean evidence.
3. Note the correction in the QA report (not a blocker, but documented).

### 3.2 — Unit tests (targeted)

Run tests **only for the files/apps modified by the task**.

1. Read the "Files to create/modify" section of the task file.
2. Identify the affected Django apps and frontend components.
3. Run only those:

**Backend (per affected app):**
```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py test apps.<app> 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/unit_<app>.txt
```

**Frontend (per affected test file):**
```bash
docker compose -f dev/docker-compose.yml exec frontend npx vitest run src/<path>/__tests__/<file>.test.jsx 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/unit_<component>.txt
```

If targeted unit tests fail → **RETURNED immediately**.
There is no point continuing with integration or E2E on code that fails its own tests.

### 3.2b — Coverage of new lines

**Run after 3.2 passes.** Check that every file modified by the task has no uncovered lines.

**Frontend** — run coverage scoped to the affected test file(s):
```bash
docker compose -f dev/docker-compose.yml exec frontend npx vitest run --coverage src/<path>/__tests__/<file>.test.jsx 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/coverage_frontend.txt
```

Read the output table. For **each file listed in "Files to create/modify"** of the task:
- `Uncovered Line #s` column must be **empty**.
- Any uncovered lines in a modified file → **FAIL (blocker)**.

> Exception: lines that are structurally unreachable (e.g. dead defensive guards)
> should be eliminated or refactored — not left uncovered. The fix is code simplification,
> not skipping the check.

**Backend** — run coverage scoped to the affected app(s):
```bash
docker compose -f dev/docker-compose.yml exec backend sh -c "coverage run manage.py test apps.<app> && coverage report --include='apps/<app>/*' --skip-covered" 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/coverage_backend.txt
```

Read the report. For each modified backend file, `Miss` column must be 0.
If not → **FAIL (blocker)**.

**If coverage fails → RETURNED immediately.** Tests pass but coverage is missing = the code is undertested.

### 3.3 — Integration tests (full suites)

Run the full suites to detect regressions in code not directly modified:

```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py test 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/backend_full.txt
docker compose -f dev/docker-compose.yml exec frontend npx vitest run 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/frontend_full.txt
```

If there are failures here that were not in 3.2, the task introduced a regression → **RETURNED**.

### 3.4 — E2E tests (Playwright)

**Run if** the task modifies UI or introduces a user-visible flow.
**Skip if** the task is backend-only with no UI changes (document why it was skipped).

```bash
docker run --rm --network host \
  -e E2E_USERNAME=admin \
  -e E2E_PASSWORD=$(grep ADMIN_PASSWORD .env | cut -d= -f2) \
  -e BASE_URL=http://localhost:5173 \
  nudge-e2e npx playwright test 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/e2e.txt
```

**Ignore known pre-existing failures** (documented in the `dev-workflow` skill).
Only **new** failures or those related to the task count as blockers.

### 3.5 — Functional DoD checks

Go through EACH DoD item from the task file that **is not lint or tests** (those are
already covered in 3.1–3.4). Typical examples:

- Endpoint responds with expected status → `curl -sv ... 2>&1 | tee ...`
- Model has correct field/default → Django shell or Read the file
- File created with expected content → Read tool
- Frontend build completes without errors → `npm run build`
- Migration generates correct changes → `makemigrations --check`

For each functional check, execute the real command and save evidence:
```bash
<command> 2>&1 | tee docs/tasks/evidence/$TASK_ID/qa/dod_<name>.txt
```

**Don't invent checks**: only verify what the task's DoD explicitly requires.

### Evidence file verification

For EACH file generated in the previous phases:

1. `Read("docs/tasks/evidence/$TASK_ID/qa/<file>.txt")` — full read.
2. Apply the expected condition.
3. Record: PASS or FAIL with the exact reason.

**Absolute rules:**
- File **does not exist** → FAIL automatic (the command was not executed).
- File **is empty** → FAIL automatic.
- Condition not met → FAIL. Copy the fragment from the file that proves it.
- Never evaluate "from memory" — always read the file with Read tool.

---

## Step 4 — Code review and scope

**Only if ALL Step 3 checks passed.** If there is any FAIL, skip directly to the verdict.

### 4.1 — Scope verification

Compare the task's objective with what was actually implemented:

1. Re-read the **"Objective"** section of the task file.
2. Go through each step of the task file and verify it was completed:
   - Was each file listed in "Files to create/modify" actually created/modified?
   - Is any deliverable described in the steps missing?
   - Was anything out of scope implemented that shouldn't be?
3. If a deliverable is missing or the objective is not met → blocker.

### 4.2 — Code review

Read the code modified/created by the task:

1. Read all files listed in "Files to create/modify" of the task file.
2. Verify:
   - Does it follow project conventions? (backend-patterns, frontend-patterns skills)
   - Are there security issues? (injection, XSS, exposed data)
   - Are there uncovered edge cases?
   - Is the code clean and maintainable?
   - Do the tests cover the relevant cases for the task?
3. If you find issues: they are additional blockers (B1, B2...).

---

## Step 5 — Verdict

### Build verification table

| # | Phase | Deliverable | Evidence file | Condition | Result |
|---|-------|------------|---------------|-----------|--------|
| 1 | 3.1 | Backend lint | `qa/ruff_check.txt` | No errors | PASS/FAIL |
| 2 | 3.1 | Backend format | `qa/ruff_format.txt` | No diffs | PASS/FAIL |
| 3 | 3.1 | Frontend lint | `qa/eslint.txt` | No errors | PASS/FAIL |
| 4 | 3.1 | Frontend format | `qa/prettier.txt` | No diffs | PASS/FAIL |
| 5 | 3.2 | Unit tests (targeted) | `qa/unit_<app>.txt` | "OK", 0 failures | PASS/FAIL |
| 6 | 3.2b | Frontend coverage | `qa/coverage_frontend.txt` | 0 uncovered lines in modified files | PASS/FAIL |
| 7 | 3.2b | Backend coverage | `qa/coverage_backend.txt` | Miss=0 in modified files | PASS/FAIL or N/A |
| 8 | 3.3 | Backend full suite | `qa/backend_full.txt` | "OK", 0 failures | PASS/FAIL |
| 9 | 3.3 | Frontend full suite | `qa/frontend_full.txt` | All pass | PASS/FAIL |
| 10 | 3.4 | E2E tests | `qa/e2e.txt` | No new failures | PASS/FAIL or N/A |
| 11 | 3.5 | Functional DoD checks | `qa/dod_*.txt` | Per DoD | PASS/FAIL |
| 12 | 4.1 | Scope completed | — | Objective met | PASS/FAIL |
| 13 | 4.2 | Code review | — | No issues | PASS/FAIL |

### If all PASS → APPROVED

Append to the task file:

```markdown
## Code Review — APPROVED

**Date**: YYYY-MM-DD

### QA verification

| # | Deliverable | Evidence | Result |
|---|------------|----------|--------|
| 1 | ... | `tasks/evidence/TXXX/qa/...` | PASS |

### Observations

(Positive notes, minor non-blocking suggestions if any)
```

### If any FAIL → RETURNED

Append to the task file:

```markdown
## Code Review — RETURNED

**Date**: YYYY-MM-DD

### QA verification

| # | Deliverable | Evidence | Result |
|---|------------|----------|--------|
| 1 | ... | `tasks/evidence/TXXX/qa/...` | FAIL |

### Blockers

- **B1**: Exact description of the problem. Affected file and line. What was expected vs what occurred.
- **B2**: ...

### Required action

Run `/dev-3-run $1` to fix the listed blockers.
```

---

## Final step — Update INDEX.md

1. Read `docs/tasks/INDEX.md`.
2. Update the **QA** column for the task:
   - APPROVED → `Approved`
   - RETURNED → `Returned (B1, B2...)`
3. If INDEX.md doesn't exist, skip without error.

---

## Absolute rules — etched in stone

- **If you didn't execute the command with Bash tool, you have no evidence.**
- **If the output is not in a physical file in `docs/tasks/evidence/`, you have no evidence.**
- **If you didn't read the file with Read tool, you have no evidence.**
- **"The code looks correct" is not evidence.**
- **"The previous task verified it" is not evidence.**
- **Never approve under time or attempt pressure.**
- **Missing file = command not executed = FAIL.**
- **Empty file = FAIL.**
