---
project: Bridgarr
updated: 2026-06-15
---

# Roadmap: Bridgarr

## Milestones

- ✅ **v1.0 Public Bridge Substrate + YouTube Reference App** — Phases 1-4 (shipped 2026-06-15)
- 🔨 **v1.1 Rebrand + Pre-public Hardening** — Phases 5-7 (in progress)

## Phases

<details>
<summary>✅ v1.0 Public Bridge Substrate + YouTube Reference App (Phases 1-4) — SHIPPED 2026-06-15</summary>

Full phase details archived at [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md).

- [x] Phase 1: Monorepo Scaffold, History Import & Green Baseline (3/3 plans) — completed 2026-06-12
- [x] Phase 2: Core Extraction & Source Interface (4/4 plans) — completed 2026-06-13
- [x] Phase 3: Public-Readiness Docs (2/2 plans) — completed 2026-06-13
- [x] Phase 4: Ship Endgame (4/4 plans) — completed 2026-06-15 (SHIP-04 ~/ytfortv deletion deferred to v1.1)

</details>

### v1.1 Rebrand + Pre-public Hardening

- [x] **Phase 5: Rebrand emitted identity** — Rename all emitted display strings and the metaType wire token from ytfortv/YTforTV to bridgarr-youtube; fix the year-only-title search fallback bug; update README trust-model section (completed 2026-06-16)
- [ ] **Phase 6: Hardening (4 deferred findings)** — Multer limit error handler, URL credential stripping, SSRF guard extracted into @bridgarr/core, Docker runtime-stage import smoke test
- [ ] **Phase 7: Live NAS e2e + cutover** — Build and push the rebranded+hardened image, clean container swap on the NAS, live Sonarr e2e verification, then human-gated ~/ytfortv deletion as the final milestone action

## Phase Details

### Phase 5: Rebrand emitted identity
**Goal**: The running app presents itself as "bridgarr-youtube" everywhere it emits output — UI, wire protocol, diagnostics, and README — and the year-only-title search bug no longer silently drops search queries
**Depends on**: Nothing (first phase of v1.1; v1.0 code is the baseline)
**Requirements**: BRAND-01, BRAND-02, BRAND-03, BRAND-04, BRAND-05, BRAND-06, BRAND-07, BRAND-08
**Success Criteria** (what must be TRUE):
  1. The Newznab caps endpoint returns "bridgarr-youtube" as the indexer title — Sonarr shows "bridgarr-youtube" in its indexer list
  2. The Settings and Browse UI pages display "bridgarr-youtube" in `<title>`, `<h1>`, and nav
  3. The NZB `metaType` token is "bridgarr-youtube" and the `buildNzb`→`parseNzb` round-trip succeeds with the renamed token
  4. Startup log and `/healthz` `service` field both read "bridgarr-youtube"; README has a prominent LAN-only trust-model section
  5. `grep -rn 'ytfortv\|YTforTV' packages/*/src` returns zero non-comment hits; a search for "1923" produces a non-empty search title; full test suite is green
**Plans**: 3 plans (2 waves)
Plans:
- [x] 05-01-PLAN.md — Core: neutral searchRss default ('bridgarr') + D-07 comment rewrites + core test updates (BRAND-04, BRAND-05)
- [x] 05-02-PLAN.md — Youtube app: APP_TITLE rebrand across caps/searchRss/conn-test/metaType/healthz/startup/UI + year-only-title fix + youtube test updates (BRAND-01..06, BRAND-08)
- [x] 05-03-PLAN.md — Docs: README rebrand + LAN-only trust section/callout + repo-root SECURITY.md + CONTRIBUTING label + phase gate (BRAND-07)
**UI hint**: yes

### Phase 6: Hardening (4 deferred findings)
**Goal**: The four medium security/robustness findings deferred from v1.0 are fixed with regression tests, and the SSRF guard is reusable across future bridges
**Depends on**: Phase 5
**Requirements**: HARD-01, HARD-02, HARD-03, HARD-04
**Success Criteria** (what must be TRUE):
  1. A request exceeding the multer upload limit returns HTTP 413 with a SAB-style JSON error body — no unhandled crash or 500
  2. A YouTube URL carrying embedded credentials (`user:pass@`) is rejected or stripped before reaching yt-dlp; the normalized URL is passed downstream
  3. `@bridgarr/core` exports `assertAllowedUrl(url, {protocols, hosts})`; the YouTube bridge calls it and preserves identical accept/reject behavior for its existing URL allowlist
  4. `docker build` fails fast on a broken or incomplete `core/dist` copy via a runtime-stage import smoke test — the failure surface is build time, not production
**Plans**: TBD

### Phase 7: Live NAS e2e + cutover
**Goal**: The rebranded and hardened image is running live on the NAS, Sonarr is verified end-to-end against it, and ~/ytfortv is deleted as the final action of the milestone
**Depends on**: Phase 6
**Requirements**: CUT-01, CUT-02, CUT-03
**Success Criteria** (what must be TRUE):
  1. The rebranded+hardened `:dev` image is pushed to GHCR with a pinned digest and deployed to the NAS via a clean container swap (old container drained/stopped before new one starts); `/healthz` returns 200 on the new build
  2. A live Sonarr search→grab→import e2e cycle completes successfully against the rebranded app on the NAS, with the Sonarr indexer and download client re-tested and re-saved
  3. `~/ytfortv` is removed as the final milestone action, gated behind explicit human confirmation (or explicitly deferred again if the operator declines at the gate)
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Monorepo Scaffold, History Import & Green Baseline | v1.0 | 3/3 | Complete | 2026-06-12 |
| 2. Core Extraction & Source Interface | v1.0 | 4/4 | Complete | 2026-06-13 |
| 3. Public-Readiness Docs | v1.0 | 2/2 | Complete | 2026-06-13 |
| 4. Ship Endgame | v1.0 | 4/4 | Complete | 2026-06-15 |
| 5. Rebrand emitted identity | v1.1 | 3/3 | Complete   | 2026-06-16 |
| 6. Hardening (4 deferred findings) | v1.1 | 3/4 | In Progress|  |
| 7. Live NAS e2e + cutover | v1.1 | 0/? | Not started | - |
