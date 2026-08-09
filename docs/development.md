# Development — Claude Code workflow

Nudge is developed with [Claude Code](https://claude.ai/claude-code) as a copilot.
Conventions, patterns, and workflows are codified in **skills** (passive knowledge)
and **commands** (invocable actions).

Both live in `.claude/` and are version-controlled in git.

---

## Skills (passive knowledge)

Skills are loaded automatically when Claude detects they are relevant.
They are not invoked manually — they inform the model's decisions.

| Skill | What it contains | Triggers when... |
|-------|-----------------|------------------|
| `dev-workflow` | Docker commands, services, ports, Vite proxy, E2E | Working with Docker, setup, or environment |
| `backend-patterns` | URL structure, views, serializers, models, FEFO, Celery, Django testing | Touching backend code |
| `frontend-patterns` | API client, CSS modules, i18n, Vitest/MSW testing, design system, modals, spinners | Touching frontend code |
| `django-admin` | Branding, PWA access, i18n, model registration | Modifying Django Admin |
| `git-conventions` | Commit format, pre-commit hook, branch naming, PR workflow | Making commits or creating branches |

### Location

```
.claude/skills/
├── backend-patterns/SKILL.md
├── dev-workflow/SKILL.md
├── django-admin/SKILL.md
├── frontend-patterns/SKILL.md
└── git-conventions/SKILL.md
```

### When to update a skill

- A new architectural pattern is introduced (e.g.: new middleware, new testing convention).
- An existing convention changes (e.g.: migrating from ESLint 8 to 9).
- A quirk or caveat affecting development is discovered (e.g.: jsdom doesn't support `scrollIntoView`).

**Do not document**: implementation details specific to a task, temporary code,
or information that only applies to a one-off context.

---

## Commands (invocable actions)

Commands are invoked with `/name` in Claude Code.
Each one is a structured prompt that guides the model step by step.

### Workflow paths

Three paths depending on the type of work:

```
New feature (multi-layer):
  /dev-1-plan  →  /dev-2-tasks  →  /dev-3-run  →  /dev-4-qa  →  /push
       │                │               │               │             │
       ▼                ▼               ▼               ▼             ▼
  Design doc       Task files      Implements      Verifies       Commit, PR,
  in docs/plans/   in docs/tasks/  a single task   with evidence  green CI

Bug fix / small change:
  /fix  →  /push

Consistency audit:
  /audit  →  /push
```

---

### `/dev-1-plan <feature description>`

**Role**: Tech lead planning a feature.

**What it does**:
1. Reads project context (CLAUDE.md, MEMORY.md, docs/).
2. Asks the user to clarify requirements and constraints.
3. Explores affected code with agents.
4. Generates a design document at `docs/plans/YYYY-MM-DD-name.md`.
5. Iterates with the user until approval.

**Produces**: plan document (no code, no tasks).

**Key rules**:
- Never implements anything.
- Asks before assuming.
- The document must be self-contained.

---

### `/dev-2-tasks <path to plan or name>`

**Role**: Tech lead dividing a plan into executable tasks.

**What it does**:
1. Locates and reads the approved plan in `docs/plans/`.
2. Divides the feature into self-contained tasks (one per Claude session).
3. Presents the division to the user (table + dependency graph) and waits for approval.
4. Generates task files at `docs/tasks/TXXX_name.md`.
5. Creates/updates `docs/tasks/INDEX.md` with the index and execution order.

**Produces**: task files with standardized structure (context, steps, DoD,
evidence table, files to modify).

**Key rules**:
- Each task must be executable with `/dev-3-run TXXX` without additional context.
- Does not create files until the division is approved.
- Dependencies between tasks must be explicit and correct.

---

### `/dev-3-run <task-id>`

**Role**: Senior developer executing a task.

**What it does**:
1. Locates the task in `docs/tasks/` and reads it in full.
2. If it's a re-execution (has `## Code Review — RETURNED`), prioritizes blockers.
3. Creates an execution plan with one item per DoD deliverable.
4. Implements each deliverable: reads before writing, follows skill patterns, self-reviews.
5. Verifies each DoD item by executing real commands and saving evidence to `docs/tasks/evidence/`.
6. Documents evidence in the task file.
7. Updates MEMORY.md and INDEX.md.

**Produces**: implemented code + verification evidence.

**Key rules**:
- Total ownership principle: if it finds an error (even if not its own), it fixes it.
- No TODOs, no fake mocks, no placeholders.
- Never verifies "from memory" — always executes the real command.
- **Does not commit or push** (that's `/push`'s responsibility).
- All commands via Docker (`docker compose -f dev/docker-compose.yml exec`).

---

### `/dev-4-qa <task-id>`

**Role**: Forensic QA engineer verifying a completed task.

**What it does** (progressive verification — if a phase fails, subsequent ones are skipped):
1. Reads the task file and extracts DoD + evidence table.
2. **Lint & format** (ruff, eslint, prettier) — fixes if they fail.
3. **Targeted unit tests** — only apps/components affected by the task.
4. **Coverage gate** — uncovered lines in modified files = FAIL blocker.
5. **Integration tests** — full suites to detect regressions.
6. **E2E tests** (Playwright) — only if the task modifies UI.
7. **Functional DoD checks** — endpoints, models, files, builds.
8. **Code review** — conventions, security, edge cases.
9. Issues verdict: **APPROVED** or **RETURNED** (with numbered blockers B1, B2...).
10. Updates the task file and INDEX.md.

**Produces**: QA report with verification table + evidence in `docs/tasks/evidence/TXXX/qa/`.

**Key rules**:
- Does not trust `/dev-3-run` evidence — re-executes everything.
- If it didn't execute the command, it has no evidence.
- Never approves under time pressure.
- If there is any FAIL, the verdict is RETURNED (no exceptions).
- Unreachable defensive guards must be refactored, not exempted from coverage.

---

### `/push <description or task-id>`

**Role**: Senior developer closing a work cycle.

**What it does**:
1. Reviews `git status` and `git diff` to understand what changed.
2. Updates documentation if applicable (CLAUDE.md, skills, dev/README.md, docs/development.md).
3. Runs local tests (backend + frontend) — if they fail, fixes before continuing.
4. Commits applying the `git-conventions` skill (format, pre-commit hook).
5. Creates branch if needed, pushes, and creates PR with `gh pr create`.
6. Monitors the CI pipeline until it passes. If it fails, fixes and pushes again.

**Produces**: PR with green pipeline, ready for merge.

**Key rules**:
- Local tests BEFORE commit.
- If pre-commit hook fails: fix + new commit (never `--amend`).
- Does not consider it done until pipeline is green.
- Skips tests if `Code Review — APPROVED` is present in the task file.

---

### `/fix`

**Role**: Senior developer applying a focused bug fix or small change.

**What it does**:
1. Reads the relevant code before modifying anything.
2. Implements the minimal change needed.
3. Runs targeted tests to verify the fix.
4. Does not refactor surrounding code unless directly required.

**Produces**: working fix ready to close with `/push`.

---

### `/audit`

**Role**: Tech lead auditing a code area for inconsistencies.

**What it does**:
1. Reads all files in the target area.
2. Identifies inconsistencies, anti-patterns, or convention violations.
3. Proposes fixes as a numbered list and waits for approval.
4. Applies approved fixes.

**Produces**: consistent code area ready to close with `/push`.

---

### Command location

```
.claude/commands/
├── dev-1-plan.md
├── dev-2-tasks.md
├── dev-3-run.md
├── dev-4-qa.md
├── push.md
├── fix.md
└── audit.md
```

---

## Artifact structure

Commands generate artifacts in these locations:

```
docs/plans/                     ← Design documents (/dev-1-plan)
docs/tasks/                     ← Task files (/dev-2-tasks)
  ├── INDEX.md                  ← Task index
  ├── TXXX_name.md              ← Task definition
  └── evidence/                 ← Evidence (gitignored)
      └── TXXX/
          ├── backend_tests.txt ← /dev-3-run evidence
          └── qa/               ← /dev-4-qa evidence
```

> **All three are in `.gitignore`** — `docs/plans/`, `docs/tasks/` and the
> evidence directory inside it are local working material, not repository
> content. Committing one takes an explicit `git add -f`, which is the intended
> friction: a plan or a task file is scaffolding for building the change, and
> the change itself is what the repository keeps.

---

## Quality gates

Every change goes through GitHub Actions, and the gates are the same ones the
commands run locally:

- **Backend** — `ruff check`, `ruff format --check`, and the full Django suite
  under coverage.
- **Frontend** — ESLint, Prettier and the Vitest suite. Coverage thresholds are
  **not uniform**: statements, functions and lines must reach 95 %, branches
  93 %. CI fails on whichever gate breaks, so read the `ERROR: Coverage for X`
  line rather than guessing from the exit code.
- **Coverage reporting** — [Codecov](https://codecov.io/gh/cibrandocampo/nudge)
  tracks project and patch coverage. The patch gate is a separate check: a pull
  request that leaves its own touched lines uncovered is flagged before merge.
- **End-to-end** — Playwright specs covering online and offline flows
  (dashboard, inventory, history, sharing, i18n, push, plus dedicated offline
  read / mutations / sync suites). Not wired into CI today; run them locally
  with `make test-e2e`.

Test counts are deliberately not quoted here — they change every week and a
stale number is worse than none. `make help` lists the targets that report them.

How to behave when a test fails is not a matter of taste: see
`.claude/skills/test-discipline/SKILL.md`.

---

## Demo seed

One management command wipes the business tables and rebuilds a deterministic
fixture, used by both the E2E suite and the public screenshots pipeline:

```bash
docker compose -f dev/docker-compose.yml exec backend python manage.py seed
```

It is destructive: every non-superuser account, routine, stock and history row
goes. The `admin` superuser survives. It refuses to run unless
`DJANGO_DEBUG=True` (the default in `dev/docker-compose.yml`) **or**
`E2E_SEED_ALLOWED=true` is exported, and the production `docker-compose.yml`
hard-sets both to safe values — so it cannot run against a real deployment
without a deliberate override.

The fixture creates three users, all with `auth_method="password"` and the same
password (`DEMO_USERS_PASSWORD`, default `change-me`), so you can log in through
the email wizard without configuring SMTP:

| Email | Display name | Locale | Role |
|-------|--------------|--------|------|
| `cibran@nudge.test` | Cibrán Docampo | en | Protagonist of every screenshot. Owns most of the routines. |
| `maria@nudge.test` | María García | es | Sharing partner: one routine shared with cibran, one private. |
| `laura@nudge.test` | Laura Vázquez | gl | Third mutual contact with no resources, used by the `unshare` spec. |

The stock side is shaped to exercise the whole model rather than a happy path:
scanned packs with GS1 serials beside hand-counted lots, a scanned box whose
code carried no serial, every stock and expiry severity, a phase-based schedule,
and a shared item each side files under a different category. The full catalogue
lives in the source, which is the only copy that cannot go stale:
[`backend/apps/core/management/commands/seed.py`](../backend/apps/core/management/commands/seed.py).

### Regenerating the screenshots

Every image in the README and on the project site comes from that fixture in one
pass, against the running dev stack:

```bash
export DEMO_USERS_PASSWORD=change-me   # must match what the seed used
make screenshots
```

The scanner scene has no camera to work with inside a container, so it renders
the fixture's own GS1 DataMatrix, encodes it as a video file and hands it to
Chromium as a fake capture device. Nothing binary is committed — the clip is
rebuilt on every run.

Review the output before committing it. A broken scene fails the run loudly; a
*wrong* one (an empty list, a modal caught mid-animation, a stale date) does
not.
