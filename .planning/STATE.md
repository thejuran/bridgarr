---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Rebrand + Pre-public Hardening
status: executing
stopped_at: Phase 7 Plan 01 complete — awaiting human-gated Plan 02 (NAS swap)
last_updated: "2026-06-16T20:05:00.000Z"
last_activity: 2026-06-16 -- Phase 07 Plan 01 complete (CI push + digest captured)
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 11
  completed_plans: 8
  percent: 73
---

# Project State

## Current Position

Phase: 07 (live-nas-e2e-cutover) — EXECUTING
Plan: 2 of 4 (awaiting human — Plan 02 is NAS swap, human-gated)
Status: Executing Phase 07 — Plan 01 complete
Last activity: 2026-06-16 -- Phase 07 Plan 01 complete (CI push + digest captured)

Progress: [██████████] 100%

## Performance Metrics

**v1.0 (reference):**

- Phases completed: 4 / 4
- Plans completed: 13 / 13
- Requirements mapped: 25 / 25
- Plan 01-01: 4 min, 3 tasks, 63 files
- Plan 01-02: 4 min, 2 tasks, 3 files
- Plan 01-03: 110 min, 3 tasks, 1 file (includes CI run watch + human checkpoint)
- Plan 02-01: 20 min, 3 tasks, 21 files
- Plan 02-02: 10 min, 2 tasks, 12 files
- Plan 02-03: 12 min, 2 tasks, 10 files
- Plan 02-04: 20 min, 3 tasks, 9 files (incl. human checkpoint)
- Plan 03-01: 10 min, 4 tasks, 4 files
- Plan 03-02: 5 min, 2 tasks, 1 file
- Plan 04-01: 3 min, 2 tasks, 2 files (SHIP-01 gate: .gitleaks.toml + .gitleaksignore committed + pushed 4fbf737)
- Plan 04-02: 10 min, 3 tasks, 6 files (D-02 hardening + post-D-02 CI push)

**v1.1 (current):**

- Plans completed: 8 / 8
- Plan 05-01: 7 min, 3 tasks, 5 files (core brand neutralization)
- Plan 05-02: 6 min, 3 tasks, 8 files (youtube app rebrand + tests)
- Plan 05-03: 8 min, 3 tasks, 3 files (docs + phase exit gate)
- Plan 06-01: 2 min, 2 tasks, 3 files (assertAllowedUrl in @bridgarr/core, HARD-02/03)
- Plan 06-02: 5 min, 2 tasks, 2 files (youtube runner thin-caller refactor, HARD-02/03)
- Plan 06-03: 5 min, 2 tasks, 2 files (HARD-01: req-size cap middleware)
- Plan 06-04: 8 min, 2 tasks, 1 file (HARD-04: Dockerfile runtime-stage smoke test)
- Plan 07-01: 8 min, 2 tasks, 2 files (CUT-01 wave 1: CI push + digest capture; PUSH_SHA=1658a8b; digest=sha256:492dab7f...)

## Accumulated Context

### Key Decisions

- Rewrite-then-merge strategy for history import (filter-repo to `packages/youtube/`, merge with `--allow-unrelated-histories`)
- Import must be fully green before any extraction begins (IMP-02 is a hard gate)
- Scaffold and import are one phase: "both packages build" cannot be true before the import exists
- Extraction is incremental: one substrate module at a time, suite must pass after each slice
- Endgame ordering is strict: gitleaks → NAS deploy + live e2e → flip public → delete ~/ytfortv
- `~/ytfortv` is never modified; rewrite operates on a throwaway copy
- Pinned all 15 direct deps in packages/youtube/package.json to exact versions for D-11 lockfile fidelity
- import-tip SHA: 3f0e3ca4d4f2a376b6ba9c8c4ff1839b827d1a42 (scope downstream commit counts to this)
- D-10 rename isolation: only the name field in package.json changed; rename is its own commit (diff: package.json name line + lockfile only)
- tsconfig.base.json must be COPY'd into the Docker build stage (packages/youtube/tsconfig.json extends it via ../../tsconfig.base.json)
- bridgarr-youtube Docker image builds from repo root; /healthz returns ok; ready for CI publish in plan 03
- All six Actions pinned to full-length immutable SHA (not floating tags) — supply chain hardening (T-01-09)
- packages: write scoped to publish job only; GITHUB_TOKEN ephemeral — no PAT required (T-01-10)
- Build→Bake→Release: type=raw,value=dev only on main; no semver/version tag patterns in ci.yml (D-09)
- Import-tip SHA 3f0e3ca is the scope anchor for verifying the 8 imported ytfortv commits (not total path history, which exceeds 8)
- GHCR package left private (default); public flip is Phase 4 after gitleaks audit (T-01-08)
- tsconfig split pattern: tsconfig.json (typecheck, src+test) + tsconfig.build.json (emit, src only) resolves rootDir conflict when test files colocated with sources
- types:[node] required in core tsconfig.json — tsconfig.base.json does not set it; youtube compiled without it implicitly
- escapeRegExp helper in nzb.ts: defensive future-proofing for metaType regex construction
- App passes {metaType:'ytfortv'} at all buildNzb/parseNzb call sites; NZB output byte-identical (D-05) — NOTE: v1.1 deliberately breaks this invariant; metaType renamed to 'bridgarr-youtube'
- CapsOptions categories is optional { movies?; tv? } shape — default undefined path renders ytfortv hardcoded blocks byte-identically (D-05 + CORE-04); flat array cannot represent dual Movies+TV parent structure
- Intra-core imports use relative sibling paths (../nzb.js), not barrel — avoids self-referential cycle
- SabSettings.metaType injected by app ('ytfortv'); core router uses ctx.settings.metaType; grep -c 'ytfortv' core/src/sabnzbd/router.ts == 0 (D-07)
- SabLogger optional injectable: no-op fallback avoids pino dep in core; pino logger satisfies interface structurally
- UploadedFile local interface in core router: @types/multer not a core devDep; cast via unknown
- No Settings/Config interface in core/src/config.ts (D-09): generic loadSettings<T> takes caller-supplied defaults
- Test import path depth: tests in test/ use ../src/; tests in test/subdir/ use ../../src/
- healthzHandler('bridgarr-youtube') in server.ts: RENAMED in plan 05-02 (was 'ytfortv'); service string injected (D-04)
- viewCount excluded from BridgeResult: YouTube-specific noise; ranking uses FlatEntry internally; D-11 small-required-core (02-04)
- releaseName hook is OPTIONAL on SourceBridge: YouTubeSource does not implement it; naming/release.ts stays in app (D-02/D-05); typed extension point visible in contract (D-10, IFACE-03)
- IFACE-03 human-approved: bridge.ts TSDoc sufficient for a stranger to implement a new bridge incl. naming without opening any youtube file
- season/episode REQUIRED on SourceBridge.searchTv: matches how *arrs always call it; provider guards undefined internally
- tsconfig self-import paths mapping with ignoreDeprecations:"6.0" — resolves @bridgarr/core self-import in walkthrough fixture to src/index.ts without a prior build; core-local only, does not affect youtube package resolution (03-01)
- Walkthrough fixture wrapped in exported buildBridge() function — avoids unused-variable tsc errors without @ts-ignore or any casts (03-01)
- D-04 honored: CONTRIBUTING.md kept light — PRs welcome, full npm command set (install/build/test/typecheck/lint + workspace-scoped tests + youtube dev), monorepo layout, and verbatim core/app boundary rule; no full guide (deferred) (03-02)
- CI/Docker build-order deviation fix (f9ade7f): Phase 2 core-extraction left a latent break — CI test job ran tsc --noEmit with no core/dist; Dockerfile never copied core into build stage. Fixed: ci.yml adds `npm run build --workspaces --if-present` before typecheck; Dockerfile copies core manifest+src into build stage, runs full `npm ci` + `npm run build --workspaces --if-present`, and copies core/package.json + core/dist into runtime stage so workspace symlink resolves. Local proofs: clean rm -rf core/dist → build+typecheck both exit 0; docker build succeeds; healthz 200 on first poll.
- assertYouTubeUrl places https-only protocol guard BEFORE host allowlist — closes file://youtube.com / ftp://youtube.com protocol-smuggling SSRF (T-04-05)
- Fixed -o template %(id)s.%(ext)s removes title from yt-dlp path — closes path traversal + format-string injection (T-04-06/07) in one change
- D-02a: LAN trust boundary documented in README, not code-enforced — auth-gating deferred; v1.1 will make the README trust-model section more prominent
- Pushed commit SHA for 04-03 digest binding: 496f1fa3904944410279c5cfd366323bdaea3f5e
- SHIP-01 gate: two-step proven — Step 1 exits nonzero (3 findings, all bridgarr-app-api-key in UAT.md @158ef9a); Step 2 exits 0 with .gitleaksignore; no unexpected secret surfaced
- Live key rotated (historical 1c3cbb1a0e4f3a9267315d26c7206ed3 gone from NAS settings.json); Sonarr indexer + download client re-tested green; Radarr not wired against this app
- .gitleaks.toml + .gitleaksignore committed and pushed to origin/main (4fbf737) — Plan 04-04 public-repo gate has both files present
- v1.1 Phase 5: metaType rename to 'bridgarr-youtube' is safe — token is internal (app writes + reads it itself; Sonarr/SABnzbd never inspect it); clean container swap in Phase 7 covers the in-flight-NZB edge
- v1.1 Phase 6 HARD-03: SSRF guard extracted to core as assertAllowedUrl(url, {protocols, hosts}); youtube bridge becomes a thin caller with identical allowlist behavior — regression test asserts same accept/reject set
- v1.1 Phase 7 CUT-03: ~/ytfortv deletion is the very last action, human-gated; history already preserved in the public repo; can be deferred again if operator declines at the gate
- v1.1 Phase 6 HARD-04: Dockerfile runtime-stage smoke test uses ESM dynamic import() (not require — core is type:module) + typeof m.assertAllowedUrl assertion (not if(!m) — always truthy) + explicit .catch; build-time failure surface so broken/stale dist never ships (D-04)
- v1.1 Phase 7 Plan 01 (CUT-01 wave 1): pushed 1658a8b to origin/main; CI run 27644510446 (test+publish=success); image ghcr.io/thejuran/bridgarr-youtube@sha256:492dab7f16998693c4d4b65e45aefb5478ad24f5e5c838f64976e1bc6e150c1c published; digest captured in 07-DIGEST.md; gitleaks local gate clean (69 commits); ba4739f (CWE-22) ancestry verified; 217 tests green on pushed HEAD

### Constraints in Force

- All planning/orchestration files (.planning/, docs/superpowers/, .turingmind/, .orchestrator.json, bridgarr-brief.md) must be gitignored from the very first commit
- `~/ytfortv` retained as fallback until Phase 7 CUT-03 confirms live NAS e2e green
- gitleaks gate must remain clean (all new commits)
- Phase 7 is the hard gate: irreversible live-system changes (container swap, ~/ytfortv deletion) only after all-green code + explicit human confirmation

### Blockers

- None

## Session Continuity

Stopped at: Phase 7 Plan 01 complete — awaiting human-gated Plan 02 (NAS swap)
Next action: Execute Phase 7 Plan 02 — NAS container swap (human-gated: operator must run swap commands on NAS, verify /healthz 200, then trigger Plan 03 Sonarr e2e)
Context: Phase 7 Plan 01 complete. origin/main at 1658a8b (Phase 5+6+CWE-22). CI run 27644510446 green. Image ghcr.io/thejuran/bridgarr-youtube@sha256:492dab7f16998693c4d4b65e45aefb5478ad24f5e5c838f64976e1bc6e150c1c published and recorded in 07-DIGEST.md. Plan 02 (NAS swap) and Plan 03 (Sonarr e2e) are human-gated checkpoints.

## Deferred Items

Items from v1.0 carried into v1.1:

| Category | Item | Status |
|----------|------|--------|
| verification | SHIP-04 (~/ytfortv deletion) | active in v1.1 Phase 7 (CUT-03) — preconditions pass, ytfortv retained as fallback |
| hardening | 4 medium deep-review findings | active in v1.1 Phase 6 (HARD-01..04) |
| Phase 05-rebrand-emitted-identity P01 | 7 min | 3 tasks | 5 files |
| Phase 05-rebrand-emitted-identity P03 | 8min | 3 tasks | 3 files |
| Phase 06-hardening-4-deferred-findings P03 | 5min | 2 tasks | 2 files |
| Phase 06-hardening-4-deferred-findings P02 | 5 min | 2 tasks | 2 files |
| Phase 06-hardening-4-deferred-findings P04 | 8 | 2 tasks | 1 files |
