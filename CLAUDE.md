# Nudge — Claude Code instructions

## Development environment: ALWAYS use Docker

**NEVER run Python, Node, or npm directly on the host.**
Always use `dev/docker-compose.yml` (bind mounts — local changes reflected instantly).
The root `docker-compose.yml` is for **production** only (uses COPY, no live reload).

For commands, services, and setup details, see the `dev-workflow` skill.

## Git workflow

**ALWAYS run the `git-conventions` skill before creating any commit or branch.**
