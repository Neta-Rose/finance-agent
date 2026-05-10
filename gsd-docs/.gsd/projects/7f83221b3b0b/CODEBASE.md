# Codebase Map

Generated: 2026-05-10T13:35:09Z | Files: 362 | Described: 0/362
<!-- gsd:codebase-meta {"generatedAt":"2026-05-10T13:35:09Z","fingerprint":"312019815e9721bcf29deb960bdb703d20a9375c","fileCount":362,"truncated":false} -->

### (root)/
- `.gitignore`
- `AGENTS.md`
- `CLAUDE.md`
- `deploy.sh`
- `HEARTBEAT.md`
- `IDENTITY.md`
- `README.md`
- `RESET.md`
- `SOUL.md`
- `TOOLS.md`
- `USER.md`

### backend/
- `backend/.env.example`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/tsconfig.json`

### backend/scripts/
- `backend/scripts/migrateObservabilityToPostgres.mjs`
- `backend/scripts/run-tests.mjs`

### backend/src/
- `backend/src/app.ts`
- `backend/src/server.ts`

### backend/src/db/
- `backend/src/db/applicationDataSource.ts`

### backend/src/db/entities/
- *(29 files: 29 .ts)*

### backend/src/middleware/
- `backend/src/middleware/auth.ts`
- `backend/src/middleware/rateLimit.ts`
- `backend/src/middleware/userIsolation.ts`

### backend/src/routes/
- *(25 files: 25 .ts)*

### backend/src/schemas/
- `backend/src/schemas/analysts.ts`
- `backend/src/schemas/channels.ts`
- `backend/src/schemas/control.ts`
- `backend/src/schemas/index.ts`
- `backend/src/schemas/job.ts`
- `backend/src/schemas/notifications.ts`
- `backend/src/schemas/onboarding.ts`
- `backend/src/schemas/pilotFeature.ts`
- `backend/src/schemas/portfolio.ts`
- `backend/src/schemas/profile.ts`
- `backend/src/schemas/strategy.test.ts`
- `backend/src/schemas/strategy.ts`
- `backend/src/schemas/support.ts`

### backend/src/scripts/
- `backend/src/scripts/cleanupOpenClawWorkspaces.ts`
- `backend/src/scripts/migrateUserStateToPostgres.ts`
- `backend/src/scripts/migrateUserToStepQueue.ts`
- `backend/src/scripts/rebuildIndex.ts`
- `backend/src/scripts/replayOpeningLots.ts`
- `backend/src/scripts/supersedeStuckJob.test.ts`
- `backend/src/scripts/supersedeStuckJob.ts`
- `backend/src/scripts/verifyMigrationParity.ts`

### backend/src/services/
- *(87 files: 87 .ts)*

### backend/src/services/chat/
- `backend/src/services/chat/agentChat.ts`
- `backend/src/services/chat/confirmationStore.ts`
- `backend/src/services/chat/conversationStore.savedChats.test.ts`
- `backend/src/services/chat/conversationStore.ts`
- `backend/src/services/chat/outputFilter.ts`
- `backend/src/services/chat/personaPrompt.ts`

### backend/src/services/chat/llmProviders/
- `backend/src/services/chat/llmProviders/anthropicProvider.ts`
- `backend/src/services/chat/llmProviders/geminiProvider.ts`
- `backend/src/services/chat/llmProviders/index.ts`
- `backend/src/services/chat/llmProviders/openAiProvider.ts`
- `backend/src/services/chat/llmProviders/openRouterProvider.ts`

### backend/src/services/chat/tools/
- `backend/src/services/chat/tools/actionTools.ts`
- `backend/src/services/chat/tools/readTools.ts`
- `backend/src/services/chat/tools/registry.ts`

### backend/src/services/dataSources/
- `backend/src/services/dataSources/cache.ts`
- `backend/src/services/dataSources/fundamentalsSource.ts`
- `backend/src/services/dataSources/macroSource.ts`
- `backend/src/services/dataSources/marketDataSource.ts`
- `backend/src/services/dataSources/sentimentSource.ts`

### backend/src/services/scheduler/
- `backend/src/services/scheduler/watchdog.ts`

### backend/src/services/security/
- `backend/src/services/security/adminAuditStore.ts`
- `backend/src/services/security/encryptedSecretsStore.ts`
- `backend/src/services/security/startupGuards.ts`

### backend/src/services/stepQueue/
- `backend/src/services/stepQueue/admission.ts`
- `backend/src/services/stepQueue/artifactIO.ts`
- `backend/src/services/stepQueue/completionEffects.ts`
- `backend/src/services/stepQueue/executor.ts`
- `backend/src/services/stepQueue/expansion.ts`
- `backend/src/services/stepQueue/featureFlag.ts`
- `backend/src/services/stepQueue/handlers.ts`
- `backend/src/services/stepQueue/handlerUtils.ts`
- `backend/src/services/stepQueue/instructorClient.ts`
- `backend/src/services/stepQueue/modelTier.ts`
- `backend/src/services/stepQueue/types.ts`

### backend/src/services/stepQueue/handlers/
- `backend/src/services/stepQueue/handlers/dailyBrief.ts`
- `backend/src/services/stepQueue/handlers/debate.ts`
- `backend/src/services/stepQueue/handlers/fundamentals.ts`
- `backend/src/services/stepQueue/handlers/macro.ts`
- `backend/src/services/stepQueue/handlers/quickCheck.ts`
- `backend/src/services/stepQueue/handlers/risk.ts`
- `backend/src/services/stepQueue/handlers/sentiment.ts`
- `backend/src/services/stepQueue/handlers/synthesis.ts`
- `backend/src/services/stepQueue/handlers/technical.ts`

### backend/src/types/
- `backend/src/types/index.ts`

### data/
- `data/config.json`
- `data/model-profiles.json`
- `data/portfolio.json`
- `data/support-messages.json`
- `data/system-agent.json`
- `data/system-control.json`

### db/
- `db/application_postgres.sql`

### docs/pilot-features/
- `docs/pilot-features/pilot-core.json`
- `docs/pilot-features/README.md`

### frontend/
- `frontend/.gitignore`
- `frontend/eslint.config.js`
- `frontend/index.html`
- `frontend/package-lock.json`
- `frontend/package.json`
- `frontend/README.md`
- `frontend/tsconfig.app.json`
- `frontend/tsconfig.json`
- `frontend/tsconfig.node.json`
- `frontend/vite.config.ts`

### frontend/src/
- `frontend/src/App.css`
- `frontend/src/App.tsx`
- `frontend/src/index.css`
- `frontend/src/main.tsx`

### frontend/src/api/
- `frontend/src/api/admin.ts`
- `frontend/src/api/analystConfig.ts`
- `frontend/src/api/auth.ts`
- `frontend/src/api/balance.ts`
- `frontend/src/api/channels.ts`
- `frontend/src/api/chat.ts`
- `frontend/src/api/client.ts`
- `frontend/src/api/conditions.ts`
- `frontend/src/api/control.ts`
- `frontend/src/api/jobs.ts`
- `frontend/src/api/notifications.ts`
- `frontend/src/api/onboarding.ts`
- `frontend/src/api/portfolio.ts`
- `frontend/src/api/portfolioRisk.ts`
- `frontend/src/api/search.ts`
- `frontend/src/api/strategies.ts`
- `frontend/src/api/support.ts`
- `frontend/src/api/verdictActions.ts`

### frontend/src/components/
- `frontend/src/components/AnalystPipelineConfig.tsx`
- `frontend/src/components/ChannelConnectCode.tsx`
- `frontend/src/components/ControlBanner.tsx`

### frontend/src/components/design/
- `frontend/src/components/design/ActionBadge.tsx`
- `frontend/src/components/design/AlertBanner.tsx`
- `frontend/src/components/design/HeroStatCard.tsx`
- `frontend/src/components/design/ScoreChip.tsx`
- `frontend/src/components/design/StatCell.tsx`

### frontend/src/components/jobs/
- `frontend/src/components/jobs/JobCard.tsx`
- `frontend/src/components/jobs/SupersededJobBanner.tsx`

### frontend/src/components/portfolio/
- `frontend/src/components/portfolio/AddPositionModal.tsx`
- `frontend/src/components/portfolio/PortfolioRiskCard.tsx`
- `frontend/src/components/portfolio/PositionDetailModal.tsx`
- `frontend/src/components/portfolio/PositionRow.tsx`
- `frontend/src/components/portfolio/StrategyModal.tsx`
- `frontend/src/components/portfolio/SummaryStrip.tsx`

### frontend/src/components/support/
- `frontend/src/components/support/ContactAdminButton.tsx`

### frontend/src/components/today/
- `frontend/src/components/today/AttentionBlock.tsx`
- `frontend/src/components/today/AttentionCard.tsx`
- `frontend/src/components/today/HealthHero.tsx`
- `frontend/src/components/today/SetupBanner.tsx`

### frontend/src/components/ui/
- `frontend/src/components/ui/Badge.tsx`
- `frontend/src/components/ui/BottomNav.tsx`
- `frontend/src/components/ui/Card.tsx`
- `frontend/src/components/ui/EmptyState.tsx`
- `frontend/src/components/ui/ErrorState.tsx`
- `frontend/src/components/ui/PointsBadge.tsx`
- `frontend/src/components/ui/Spinner.tsx`
- `frontend/src/components/ui/TickerSearch.tsx`
- `frontend/src/components/ui/Toast.tsx`
- `frontend/src/components/ui/TopBar.tsx`

### frontend/src/pages/
- `frontend/src/pages/Admin.tsx`
- `frontend/src/pages/Alerts.tsx`
- `frontend/src/pages/Chat.tsx`
- `frontend/src/pages/Controls.tsx`
- `frontend/src/pages/Login.tsx`
- `frontend/src/pages/Onboarding.tsx`
- `frontend/src/pages/Portfolio.tsx`
- `frontend/src/pages/Reports.tsx`
- `frontend/src/pages/Settings.tsx`
- `frontend/src/pages/Strategies.tsx`
- `frontend/src/pages/SuspensionPage.tsx`

### frontend/src/store/
- `frontend/src/store/authStore.ts`
- `frontend/src/store/i18n.ts`
- `frontend/src/store/preferencesStore.ts`
- `frontend/src/store/toastStore.ts`

### frontend/src/types/
- `frontend/src/types/api.ts`

### frontend/src/utils/
- `frontend/src/utils/format.ts`
- `frontend/src/utils/id.ts`

### frontend/src/utils/today/
- `frontend/src/utils/today/classifyAttention.ts`
- `frontend/src/utils/today/factoid.ts`
- `frontend/src/utils/today/healthScore.ts`
- `frontend/src/utils/today/positionSubLine.ts`
- `frontend/src/utils/today/scoreColor.ts`
- `frontend/src/utils/today/whyToday.ts`

### open-bugs/
- `open-bugs/full-report-schema-validation-failure.md`
- `open-bugs/v2-deploy-bugs.md`
- `open-bugs/v3-deploy-bugs.md`
- `open-bugs/v4-deploy-bugs.md`
- `open-bugs/v5-deploy-bugs.md`

### production-reports/
- `production-reports/how-to-deploy-v2.md`
- `production-reports/migrations.md`
- `production-reports/phase-0-bugfix.md`
- `production-reports/phase-1-postgres-foundation.md`
- `production-reports/phase-2-step-queue.md`
- `production-reports/phase-3-openclaw-retirement.md`
- `production-reports/phase-3-review-fixes.md`
- `production-reports/phase-4-structured-outputs.md`
- `production-reports/phase-5-chat-agent.md`
- `production-reports/phase-6-transports.md`
- `production-reports/phase-7-ledger-snooze-dispatch.md`
- `production-reports/phase-v3-bugfixes.md`

### scripts/
- `scripts/verify-pilot-surface.mjs`
- `scripts/verify-saved-chat-ui.mjs`

### shared/user-workspace/
- `shared/user-workspace/manifest.json`
- `shared/user-workspace/README.md`
- `shared/user-workspace/USER.md.template`

### skills/quick-check/
- `skills/quick-check/SKILL.md`

### skills/self-improving-agent/
- `skills/self-improving-agent/_meta.json`
- `skills/self-improving-agent/SKILL.md`

### skills/self-improving-agent/assets/
- `skills/self-improving-agent/assets/ERRORS.md`
- `skills/self-improving-agent/assets/FEATURE_REQUESTS.md`
- `skills/self-improving-agent/assets/LEARNINGS.md`
- `skills/self-improving-agent/assets/SKILL-TEMPLATE.md`

### skills/self-improving-agent/hooks/openclaw/
- `skills/self-improving-agent/hooks/openclaw/handler.js`
- `skills/self-improving-agent/hooks/openclaw/HOOK.md`

### skills/self-improving-agent/references/
- `skills/self-improving-agent/references/examples.md`
- `skills/self-improving-agent/references/hooks-setup.md`
- `skills/self-improving-agent/references/openclaw-integration.md`

### skills/self-improving-agent/scripts/
- `skills/self-improving-agent/scripts/activator.sh`
- `skills/self-improving-agent/scripts/error-detector.sh`
- `skills/self-improving-agent/scripts/extract-skill.sh`
