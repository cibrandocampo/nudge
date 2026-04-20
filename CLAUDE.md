# Nudge — Claude Code instructions

## Development environment: ALWAYS use Docker

**NEVER run Python, Node, or npm directly on the host.**
Always use `dev/docker-compose.yml` (bind mounts — local changes reflected instantly).
The root `docker-compose.yml` is for **production** only (uses COPY, no live reload).

For commands, services, and setup details, see the `dev-workflow` skill.

## Development workflow

Three paths depending on the type of work. When in doubt, use the simplest one that fits.

| Situation | Path |
|-----------|------|
| New feature with multiple layers or non-trivial design | `/dev-1-plan` → `/dev-2-tasks` → `/dev-3-run` → `/dev-4-qa` → `/push` |
| Bug fix, CSS tweak, small isolated change | `/fix` → `/push` |
| Consistency audit of a code area (CSS, API, models…) | `/audit` → `/push` |

Task files live in `docs/tasks/`. Plan files live in `docs/plans/`.

## Seed data

**NEVER ask for confirmation before running seed commands.** Execute them directly without prompting.

## Git workflow

**ALWAYS run the `git-conventions` skill before creating any commit or branch.**

## Testing workflow

**ALWAYS consult the `test-discipline` skill before writing or debugging
any test (unit, integration, E2E).** Short version: one test = one
concept, fail hard, diagnose root cause (test / app / infra) before
editing anything, never reach for `test.skip` or loosened assertions to
go green, and re-run 3 times back-to-back without `--retries` before
declaring done.
