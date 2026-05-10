# Shared User Workspace

Canonical source of truth for files that are provisioned into user workspaces.

Use this directory for any shared user-space rollout:
- update the files here first
- run `node scripts/sync-user-workspace.mjs --all` when intentionally syncing existing workspaces
- new user creation also reads from this directory

Structure:
- `manifest.json`: declares which files are copied, rendered as templates, or created empty
- `USER.md.template`: rendered into `USER.md` for new users only

Retired OpenClaw-managed workspace files such as `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`, `RESET.md`, `IDENTITY.md`, and `TOOLS.md` are no longer provisioned into user workspaces.

Rules:
- keep exactly one canonical copy of shared user-workspace files here
- do not keep parallel template directories elsewhere in the repo
- do not use this sync path to overwrite user-specific data files under `users/*/data`
