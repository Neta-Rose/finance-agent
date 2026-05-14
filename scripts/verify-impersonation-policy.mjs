#!/usr/bin/env node
/**
 * S07 impersonation policy verifier.
 *
 * Static checks:
 * 1. readOnlyGuard is imported and wired in app.ts after userIsolationMiddleware.
 * 2. authMiddleware reads impersonatorId/sessionId/readOnly claims and calls validateSession.
 * 3. Frontend API client checks sessionStorage impersonation_token before normal JWT.
 * 4. ImpersonationBanner is imported and mounted in App.tsx.
 * 5. Admin impersonation routes exist and are mounted in admin.ts.
 * 6. No production code logs JWT token values.
 * 7. readOnlyGuard blocks non-GET methods and writes to admin_audit_log.
 * 8. impersonationService never logs the token value.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let failures = 0;

function fail(msg) {
  console.error(`  ✖ ${msg}`);
  failures++;
}

function pass(msg) {
  console.log(`  ✔ ${msg}`);
}

async function readSrc(relPath) {
  return readFile(path.join(root, relPath), "utf-8");
}

// ── 1. readOnlyGuard wired in app.ts ────────────────────────────────────────
console.log("\n[1] app.ts — readOnlyGuard wired after userIsolationMiddleware");
try {
  const src = await readSrc("backend/src/app.ts");
  if (src.includes("readOnlyGuard")) {
    pass("readOnlyGuard is imported in app.ts");
  } else {
    fail("readOnlyGuard is not imported in app.ts");
  }
  // Check it appears after userIsolationMiddleware in the middleware chain
  const chainMatch = src.match(/authMiddleware.*userIsolationMiddleware.*readOnlyGuard/s);
  if (chainMatch) {
    pass("readOnlyGuard is chained after authMiddleware + userIsolationMiddleware");
  } else {
    fail("readOnlyGuard is not chained after authMiddleware + userIsolationMiddleware in app.ts");
  }
  if (src.includes("from \"./middleware/impersonation.js\"") || src.includes("from './middleware/impersonation.js'")) {
    pass("readOnlyGuard imported from middleware/impersonation.js");
  } else {
    fail("readOnlyGuard not imported from middleware/impersonation.js");
  }
} catch (err) {
  fail(`Could not read app.ts: ${err.message}`);
}

// ── 2. authMiddleware validates impersonation tokens ────────────────────────
console.log("\n[2] authMiddleware — validates impersonation tokens");
try {
  const src = await readSrc("backend/src/middleware/auth.ts");
  if (src.includes("validateSession")) {
    pass("authMiddleware calls validateSession");
  } else {
    fail("authMiddleware does not call validateSession");
  }
  if (src.includes("impersonatorId") && src.includes("sessionId") && src.includes("readOnly")) {
    pass("authMiddleware sets impersonatorId, sessionId, readOnly in res.locals");
  } else {
    fail("authMiddleware missing impersonatorId/sessionId/readOnly locals");
  }
  if (src.includes("impersonation_session_invalid")) {
    pass("authMiddleware returns impersonation_session_invalid on invalid session");
  } else {
    fail("authMiddleware missing impersonation_session_invalid error code");
  }
} catch (err) {
  fail(`Could not read auth.ts: ${err.message}`);
}

// ── 3. Frontend API client uses impersonation token ─────────────────────────
console.log("\n[3] Frontend API client — impersonation token preference");
try {
  const src = await readSrc("frontend/src/api/client.ts");
  if (src.includes("getImpersonationToken") || src.includes("impersonation_token")) {
    pass("API client checks for impersonation token");
  } else {
    fail("API client does not check for impersonation token");
  }
  if (src.includes("readonly_impersonation")) {
    pass("API client handles 403 readonly_impersonation without redirecting to login");
  } else {
    fail("API client missing readonly_impersonation 403 handling");
  }
  if (src.includes("clearImpersonationState")) {
    pass("API client clears impersonation state on 401");
  } else {
    fail("API client does not clear impersonation state on 401");
  }
} catch (err) {
  fail(`Could not read client.ts: ${err.message}`);
}

// ── 4. ImpersonationBanner mounted in App.tsx ────────────────────────────────
console.log("\n[4] App.tsx — ImpersonationBanner mounted globally");
try {
  const src = await readSrc("frontend/src/App.tsx");
  if (src.includes("ImpersonationBanner")) {
    pass("ImpersonationBanner is imported in App.tsx");
  } else {
    fail("ImpersonationBanner is not imported in App.tsx");
  }
  if (src.includes("<ImpersonationBanner")) {
    pass("ImpersonationBanner is rendered in App.tsx");
  } else {
    fail("ImpersonationBanner is not rendered in App.tsx");
  }
} catch (err) {
  fail(`Could not read App.tsx: ${err.message}`);
}

// ── 5. Admin impersonation routes exist and are mounted ──────────────────────
console.log("\n[5] Admin impersonation routes");
try {
  const routeSrc = await readSrc("backend/src/routes/adminImpersonation.ts");
  if (routeSrc.includes("POST") && routeSrc.includes("/impersonation/sessions")) {
    pass("POST /impersonation/sessions route exists");
  } else {
    fail("POST /impersonation/sessions route missing");
  }
  if (routeSrc.includes("GET") && routeSrc.includes("/impersonation/sessions")) {
    pass("GET /impersonation/sessions route exists");
  } else {
    fail("GET /impersonation/sessions route missing");
  }
  if (routeSrc.includes("DELETE") && routeSrc.includes("/impersonation/sessions/:id")) {
    pass("DELETE /impersonation/sessions/:id route exists");
  } else {
    fail("DELETE /impersonation/sessions/:id route missing");
  }

  const adminSrc = await readSrc("backend/src/routes/admin.ts");
  if (adminSrc.includes("impersonationRouter") || adminSrc.includes("adminImpersonation")) {
    pass("Impersonation router is mounted in admin.ts");
  } else {
    fail("Impersonation router is not mounted in admin.ts");
  }
} catch (err) {
  fail(`Could not read impersonation routes: ${err.message}`);
}

// ── 6. No production code logs JWT token values ──────────────────────────────
console.log("\n[6] No JWT token values logged in production code");
try {
  const files = [
    "backend/src/services/impersonationService.ts",
    "backend/src/middleware/auth.ts",
    "backend/src/middleware/impersonation.ts",
    "backend/src/routes/adminImpersonation.ts",
  ];
  for (const file of files) {
    const src = await readSrc(file);
    // Check that the token variable is not passed to logger calls
    const logTokenPattern = /logger\.(info|warn|error|debug)\([^)]*\btoken\b[^)]*\)/;
    if (logTokenPattern.test(src)) {
      fail(`${file} may log a token value — review logger calls containing 'token'`);
    } else {
      pass(`${file} does not log token values`);
    }
  }
} catch (err) {
  fail(`Could not check for token logging: ${err.message}`);
}

// ── 7. readOnlyGuard blocks non-GET and writes audit log ────────────────────
console.log("\n[7] readOnlyGuard — blocks writes and audits");
try {
  const src = await readSrc("backend/src/middleware/impersonation.ts");
  if (src.includes("readonly_impersonation")) {
    pass("readOnlyGuard returns readonly_impersonation error code");
  } else {
    fail("readOnlyGuard missing readonly_impersonation error code");
  }
  if (src.includes("admin_audit_log")) {
    pass("readOnlyGuard writes to admin_audit_log");
  } else {
    fail("readOnlyGuard does not write to admin_audit_log");
  }
  if (src.includes("GET") && src.includes("HEAD") && src.includes("OPTIONS")) {
    pass("readOnlyGuard allows GET, HEAD, OPTIONS");
  } else {
    fail("readOnlyGuard missing GET/HEAD/OPTIONS passthrough");
  }
} catch (err) {
  fail(`Could not read impersonation.ts: ${err.message}`);
}

// ── 8. impersonationService never logs the token ────────────────────────────
console.log("\n[8] impersonationService — token never logged");
try {
  const src = await readSrc("backend/src/services/impersonationService.ts");
  if (src.includes("never log the token") || src.includes("never log")) {
    pass("impersonationService has explicit comment about not logging token");
  } else {
    pass("impersonationService — no explicit token-logging comment (acceptable)");
  }
  // The token variable should not appear in any logger call
  const lines = src.split("\n");
  const suspicious = lines.filter((line) =>
    line.includes("logger.") && line.includes("token") && !line.includes("//")
  );
  if (suspicious.length === 0) {
    pass("impersonationService does not log token in any logger call");
  } else {
    fail(`impersonationService may log token value: ${suspicious[0]?.trim()}`);
  }
} catch (err) {
  fail(`Could not read impersonationService.ts: ${err.message}`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("✅ All impersonation policy checks passed.");
  process.exit(0);
} else {
  console.error(`❌ ${failures} check(s) failed.`);
  process.exit(1);
}
