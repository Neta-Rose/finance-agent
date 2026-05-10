# GSD context snapshot (2026-05-10T13:33:05.455Z)

## Top project memories
- [MEM008] (gotcha) Root `.gitignore` ignores `docs/` broadly, so tracked pilot feature catalog files under `docs/pilot-features/` require explicit unignore exceptions for the directory and JSON files.
- [MEM013] (preference) For OpenClaw agile work, prefer deploying each deployable feature/slice as soon as it is verified before moving to the next slice. Do not continue from S01 to S02/S03 in auto-mode without first deploying the completed deployable slice.
- [MEM020] (architecture) S03 established `notificationService.publishNotification` as the semantic-only production notification boundary: publishers provide domain event fields and the service owns composer rendering, category mapping, batch idempotency, channel records, and redacted delivery logs. Future notification publishers should add a semantic kind/composer mapping instead of constructing title/body/category strings at call sites.
- [MEM021] (pattern) Telegram pilot notifications intentionally render as bounded plain text with no Markdown/HTML parse mode and disabled link previews. Treat all ticker/title/body/news/report text as untrusted and let shared Telegram delivery handle splitting and failure persistence.
- [MEM026] (environment) Backend `npm --prefix backend test -- src/path/file.test.ts` now scopes to explicit `*.test.ts` positional arguments in `backend/scripts/run-tests.mjs`; omit file arguments to run the full discovered backend test suite.
- [MEM007] (gotcha) In this worktree, `npm --prefix backend test -- --test-name-pattern ...` still enumerates the full `src/**/*.test.ts` suite; use direct node test invocation for an isolated file when diagnosing a specific backend test, and record exact-command failures separately from targeted subtest pass/fail evidence.

## Recent gsd_exec runs
- [d13da4ba-59f5-4805-b4d5-887be7e7e0c6] bash exit:0 — M001 S04 T03 saved-chat UI verification rerun after hooks fixes
- [a1065796-b60f-42d1-9a3e-4aca9691f774] bash exi
…[truncated]
