---
phase: 06-hardening-4-deferred-findings
plan: "03"
subsystem: api
tags: [multer, express, error-middleware, supertest, security, upload-limit]

requires:
  - phase: 06-hardening-4-deferred-findings
    provides: "Phase context — multer already configured with fileSize:1MB and files:1 limits at server.ts:83"

provides:
  - "4-arg Express error-handling middleware in server.ts returning 413 SAB-style body for ANY multer.MulterError (LIMIT_FILE_SIZE and LIMIT_FILE_COUNT)"
  - "Supertest regressions for both the oversize and multi-file upload paths"

affects:
  - 06-hardening-4-deferred-findings
  - 07-cut-and-publish

tech-stack:
  added: []
  patterns:
    - "Express 4-arg error middleware placed AFTER the route that produces multer errors — required for Express error routing"
    - "Broad instanceof guard (err instanceof multer.MulterError) maps every upload-constraint violation to 413, not narrowed to a specific err.code"
    - "SAB-style body { status: false, error: '<message>' } for all 413 responses so Sonarr parses identically to other SAB errors"
    - "Non-multer 500 branch logs detail server-side via logger.error; never sends err.message or stack to client"

key-files:
  created: []
  modified:
    - packages/youtube/src/server.ts
    - packages/youtube/test/server.test.ts

key-decisions:
  - "Used broad instanceof multer.MulterError guard (not err.code === 'LIMIT_FILE_SIZE') so LIMIT_FILE_COUNT (2-file upload) also maps to 413 — closes Finding 3"
  - "Error message 'Upload exceeds limit' chosen to be generic enough for both size and file-count violations"
  - "next param prefixed _next to satisfy eslint argsIgnorePattern:'^_' — required by Express for 4-arg recognition but unused in implementation"
  - "Middleware positioned after app.post('/api') and before /nzb/:token route and return app — load-bearing placement (Pitfall 1)"

patterns-established:
  - "Multer error middleware: always use broad instanceof guard, never narrow to a single err.code"

requirements-completed: [HARD-01]

duration: 5min
completed: 2026-06-16
---

# Phase 6 Plan 03: HARD-01 Multer Upload-Limit 413 Middleware Summary

**4-arg Express error middleware catching any multer.MulterError → HTTP 413 SAB-style body, with supertest regressions for both LIMIT_FILE_SIZE and LIMIT_FILE_COUNT paths**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-16T14:47:00Z
- **Completed:** 2026-06-16T14:52:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `NextFunction` to the express import and registered a 4-arg error-handling middleware after `app.post('/api', upload.any(), apiDispatch)` in server.ts; catches ANY `multer.MulterError` (LIMIT_FILE_SIZE for oversize files, LIMIT_FILE_COUNT for >1 file) and returns HTTP 413 with `{ status: false, error: 'Upload exceeds limit' }` — the SAB-style body Sonarr can parse
- Non-multer errors log detail server-side via `logger.error({ err }, 'unhandled error')` and return a generic 500 with no internal detail to the client (CLAUDE.md security rule)
- Added two supertest cases to server.test.ts: one posting a 1,000,001-byte buffer (trips LIMIT_FILE_SIZE) and one posting two small files (trips LIMIT_FILE_COUNT) — both assert 413 + the SAB body; youtube suite grew from 141 to 143 tests, all green

## Task Commits

1. **Task 1: Add 4-arg 413 error-handling middleware (any MulterError) to server.ts** — `6fd9e10` (feat)
2. **Task 2: Add supertest 413 regressions for BOTH oversize and multi-file uploads** — `81f8f45` (test)

## Files Created/Modified

- `packages/youtube/src/server.ts` — Added `type NextFunction` to express import; added 4-arg error-handling middleware after POST /api route
- `packages/youtube/test/server.test.ts` — Added two 413 regression cases (LIMIT_FILE_SIZE and LIMIT_FILE_COUNT paths)

## Decisions Made

- Used broad `instanceof multer.MulterError` (not `err.code === 'LIMIT_FILE_SIZE'`) so both configured limit types produce the same clean 413; this closes Finding 3 where a 2-file upload slipped through to a generic 500
- Error message `'Upload exceeds limit'` is generic enough to describe either limit violation without leaking specifics
- `_next` prefix on the fourth param satisfies `eslint argsIgnorePattern: '^_'` while keeping Express's 4-arg error-middleware detection intact

## Deviations from Plan

None — plan executed exactly as written. The PATTERNS.md showed a narrower `err.code === 'LIMIT_FILE_SIZE'` form but the PLAN.md was explicit: broad `instanceof multer.MulterError` only. Plan was authoritative.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- HARD-01 requirement fully closed: multer upload-limit violations (size and file-count) return 413 SAB-style body; no unhandled crash or 500
- youtube typecheck clean, 143 tests green
- Ready for phase 6 remaining plans (06-02, 06-04) and eventual phase 7

---
*Phase: 06-hardening-4-deferred-findings*
*Completed: 2026-06-16*
