# Shared User Workspace

Canonical source of truth for files that are provisioned into user workspaces.

Use this directory for any shared user-space rollout:
- update the files here first
- run `node scripts/sync-user-workspace.mjs --all`
- new user creation will also read from this directory

Structure:
- `manifest.json`: declares which files are synced as shared files, rendered as templates, or created empty
- `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`: copied into every user workspace
- `USER.md.template`: rendered into `USER.md` for new users only

Rules:
- keep exactly one canonical copy of shared user-workspace files here
- do not keep parallel template directories elsewhere in the repo
- do not use this sync path to overwrite user-specific data files under `users/*/data`
