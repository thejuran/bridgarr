---
phase: "07-live-nas-e2e-cutover"
plan: "01"
subsystem: "CI/CD — image publish + digest capture"
tags: ["cutover", "ci", "docker", "ghcr", "digest", "security", "gitleaks"]
dependency_graph:
  requires: []
  provides: ["07-DIGEST.md — pinned sha256 digest for NAS swap", "origin/main at 1658a8b"]
  affects: ["07-02 (NAS swap)", "07-03 (Sonarr e2e)", "07-04 (deletion gate)"]
tech_stack:
  added: []
  patterns: ["digest-pinned deploy (precedent: 496f1fa v1.0 Phase 4)", "local gitleaks pre-push gate"]
key_files:
  created:
    - ".planning/phases/07-live-nas-e2e-cutover/07-DIGEST.md"
    - ".planning/phases/07-live-nas-e2e-cutover/07-01-SUMMARY.md"
  modified: []
decisions:
  - "Digest captured from build-push-action ##[group]Digest output in the CI log — not from registry polling (authoritative CI source)"
  - "Clean-tree gate passed despite .planning/STATE.md showing modified: confirmed tracked orchestration file not in source tree, not tested, not shipped as source — consistent with plan's explicit note on this case"
  - "gitleaks run locally (69 commits, 539KB, no leaks) — this is the ONLY secret-scan gate; CI does not run gitleaks"
metrics:
  duration: "~8 min (Task 1 gates ~4 min; Task 2 push+CI watch ~4 min)"
  completed: "2026-06-16"
  tasks: 2
  files: 2
---

# Phase 7 Plan 1: CI Push + Digest Capture Summary

Pushed the rebranded (Phase 5) + hardened (Phase 6) code to origin/main as a CI-attested GHCR image, with the sha256 digest traceable to the exact pushed commit SHA captured in 07-DIGEST.md for Plan 02 to pin.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Verify reconciliation: ancestry + green suite + clean tree + gitleaks | (no new commit — verification only; existing HEAD 1658a8b was the clean tip) | packages/core/src/sabnzbd/router.ts (verified only) |
| 2 | Push to main, watch CI run 27644510446, capture digest | (no new source commit — push of existing HEAD 1658a8b; DIGEST.md + SUMMARY.md committed as docs) | 07-DIGEST.md, 07-01-SUMMARY.md |

## Gate Results

### Task 1: Pre-Push Gates

| Gate | Result | Detail |
|------|--------|--------|
| `git merge-base --is-ancestor ba4739f HEAD` | PASS | ba4739f (CWE-22 fix) is ancestor of 1658a8b — HARDCODED anchor, no grep |
| `git log --oneline HEAD..origin/main` | PASS (empty) | HEAD is not behind origin/main |
| `git log --oneline origin/main..HEAD` | PASS (21 commits) | All Phase 5/6 commits present |
| `git status --porcelain` | PASS | Only .planning/STATE.md modified (tracked orchestration file — not source, not tested, not shipped) |
| PUSH_SHA captured | PASS | 1658a8b25027b5db1e812206e3e3c4c0c7fee4e2 |
| CWE-22 guard in packages/core/src/sabnzbd/router.ts | PASS | CATEGORIES=['*','sonarr','radarr','tv','movies'] allowlist + path.join validation confirmed present |
| npm ci | PASS | exit 0 |
| npm run build --workspaces --if-present | PASS | exit 0 |
| npm run typecheck --workspaces --if-present | PASS | exit 0 |
| npm run lint --workspaces --if-present | PASS | exit 0 |
| npm test --workspaces --if-present | PASS | 72 core + 145 youtube = 217 tests |
| gitleaks detect --source . --redact --no-banner | PASS | 69 commits scanned, 539KB, no leaks found |

Note: gitleaks is a LOCAL pre-push gate only. CI does NOT run gitleaks (ci.yml has only `test` and `publish` jobs).

### Task 2: Push + CI + Digest

| Gate | Result | Detail |
|------|--------|--------|
| git push origin main | PASS | ba4739f..1658a8b main -> main |
| PUSH_SHA after push matches Task 1 SHA | PASS | 1658a8b25027b5db1e812206e3e3c4c0c7fee4e2 — no drift |
| CI run bound to PUSH_SHA | PASS | Run 27644510446, headSha=1658a8b25027b5db1e812206e3e3c4c0c7fee4e2 |
| `test` job conclusion | PASS (success) | 25s |
| `publish` job conclusion | PASS (success) | 54s |
| Overall run conclusion | PASS (success) | verified via `gh run view --json conclusion,headSha` |
| Digest captured | PASS | sha256:492dab7f16998693c4d4b65e45aefb5478ad24f5e5c838f64976e1bc6e150c1c |
| 07-DIGEST.md written | PASS | Full pinned reference + traceability annotation |
| NAS NOT touched | PASS | Swap is human-gated in Plan 02 |

## Artifact

```
ghcr.io/thejuran/bridgarr-youtube@sha256:492dab7f16998693c4d4b65e45aefb5478ad24f5e5c838f64976e1bc6e150c1c
```

Published by CI run 27644510446 for commit 1658a8b25027b5db1e812206e3e3c4c0c7fee4e2.
Consumed by Plan 02 (NAS swap).

## Deviations from Plan

None — plan executed exactly as written.

The `.planning/STATE.md` modified-file situation was anticipated by the plan's own note ("NOTE: .planning/STATE.md may show as modified — that is orchestration state"). Confirmed: it is a tracked orchestration file not in the source tree, not exercised by the test suite, and not shipped as part of the Docker image. The clean-tree gate passed as intended.

## Known Stubs

None.

## Threat Flags

None — this plan made no source code changes. It only verified, pushed, and recorded the CI artifact.

## Self-Check: PASSED

- 07-DIGEST.md exists: FOUND
- 07-01-SUMMARY.md exists: FOUND
- CI run 27644510446 for headSha 1658a8b: confirmed conclusion=success, both test+publish jobs=success
- Digest sha256:492dab7f16998693c4d4b65e45aefb5478ad24f5e5c838f64976e1bc6e150c1c present in 07-DIGEST.md
- PUSH_SHA 1658a8b25027b5db1e812206e3e3c4c0c7fee4e2 present in 07-DIGEST.md
