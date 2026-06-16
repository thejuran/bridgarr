# Requirements: Bridgarr — Milestone v1.1

**Defined:** 2026-06-15
**Core Value:** A developer who has never read ytfortv's internals can build a working *arr source bridge from `@bridgarr/core`'s docs alone — and the reference bridge keeps working unchanged as the proof.

**Milestone goal:** Rename the YouTube reference app's emitted/displayed identity (YTforTV → bridgarr-youtube), fix the deferred hardening debt plus one year-title search bug, and complete SHIP-04 (`~/ytfortv` deletion) behind a live verification gate.

> **Note:** This milestone deliberately breaks the v1.0 D-05 byte-identical NZB invariant — that invariant proved the extraction preserved behavior exactly; with extraction shipped, the identity is now free to change.

## v1.1 Requirements

### Rebrand

- [x] **BRAND-01**: The Newznab caps title Sonarr displays reads "bridgarr-youtube" (not "YTforTV")
- [x] **BRAND-02**: The Settings and Browse UI (`<title>`, `<h1>`, nav) read "bridgarr-youtube"
- [x] **BRAND-03**: The Newznab connection-test release name uses the "bridgarr-youtube" identity
- [x] **BRAND-04**: The core `searchRss` default feed title is "bridgarr-youtube"
- [x] **BRAND-05**: The NZB `metaType` wire token is "bridgarr-youtube", and the `buildNzb`→`parseNzb` round-trip still succeeds with the renamed token
- [x] **BRAND-06**: Diagnostic outputs (startup log line + `/healthz` `service` field) read "bridgarr-youtube"
- [x] **BRAND-07**: The README presents the app as "bridgarr-youtube" with a prominent LAN-only trust-model section
- [x] **BRAND-08**: A search for a show titled only a year (e.g. "1923") produces a non-empty search title (year-only-title fallback fix)

### Hardening

- [x] **HARD-01**: A request exceeding the multer upload limit returns a SAB-style error body (HTTP 413), not an unhandled crash
- [x] **HARD-02**: A YouTube URL carrying embedded credentials (`user:pass@`) is rejected or stripped before reaching yt-dlp (CWE-116)
- [x] **HARD-03**: The SSRF/URL-allowlist guard lives in `@bridgarr/core` as a parameterized helper (`assertAllowedUrl(url, {protocols, hosts})`), with the YouTube bridge calling it and preserving the same accept/reject behavior
- [x] **HARD-04**: A broken or incomplete `core/dist` copy fails the Docker build via a runtime import smoke test, not production

### Cutover

- [ ] **CUT-01**: The rebranded+hardened image is deployed to the NAS via a clean container swap (old container drained/stopped before the new one starts) and `/healthz` returns 200
- [ ] **CUT-02**: A live Sonarr search→grab→import completes end-to-end against the rebranded app, with the Sonarr indexer + download client re-tested and re-saved
- [ ] **CUT-03**: `~/ytfortv` is deleted as the final milestone action, gated behind explicit human confirmation (history already preserved in the public repo)

## Future Requirements

Deferred beyond v1.1. Tracked but not in this roadmap.

### Hardening (low-severity Phase-1 debt)

- **HARD-F01**: Sonarr/Radarr fetch has a request timeout
- **HARD-F02**: Deleting a downloading job kills the yt-dlp child process and frees the slot
- **HARD-F03**: pino-pretty is not selected at runtime under a non-prod TTY

### Auth

- **AUTH-F01**: Settings UI + `/nzb/:token` behind an auth gate (only if the LAN-only trust model is later revisited)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| New authentication for Settings UI / `/nzb` | D-02a LAN-only trust retained — same model as Sonarr/SABnzbd themselves; no new auth code in v1.1 |
| `metaType` dual-token back-compat parsing | Single-NAS LAN app retiring its only old build; clean container swap covers the in-flight-NZB edge — dual-token parsing is over-engineering |
| Second source bridge implementation | The SSRF-to-core extraction (HARD-03) prepares for it but does not build one |
| New ytfortv/youtube app features | This milestone is identity + hardening + cutover only; no behavior changes beyond the named fixes |
| npm publishing of `@bridgarr/core` | Publish when the API stabilizes post-milestone (unchanged from v1.0) |

## Traceability

Which phases cover which requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BRAND-01 | Phase 5 | Complete |
| BRAND-02 | Phase 5 | Complete |
| BRAND-03 | Phase 5 | Complete |
| BRAND-04 | Phase 5 | Complete |
| BRAND-05 | Phase 5 | Complete |
| BRAND-06 | Phase 5 | Complete |
| BRAND-07 | Phase 5 | Complete |
| BRAND-08 | Phase 5 | Complete |
| HARD-01 | Phase 6 | Complete |
| HARD-02 | Phase 6 | Complete |
| HARD-03 | Phase 6 | Complete |
| HARD-04 | Phase 6 | Complete |
| CUT-01 | Phase 7 | Pending |
| CUT-02 | Phase 7 | Pending |
| CUT-03 | Phase 7 | Pending |

**Coverage:**
- v1.1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-15*
*Last updated: 2026-06-15 after roadmap creation*
