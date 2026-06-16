# Phase 7: Image Digest — CI-Attested Build

## Pushed Commit SHA

```
1658a8b25027b5db1e812206e3e3c4c0c7fee4e2
```

## CI Run

- **Run ID:** 27644510446
- **Run URL:** https://github.com/thejuran/bridgarr/actions/runs/27644510446
- **Triggered by:** push to refs/heads/main
- **headSha:** 1658a8b25027b5db1e812206e3e3c4c0c7fee4e2 (matches PUSH_SHA — no drift)

## Job Conclusions

| Job     | Conclusion |
|---------|------------|
| test    | success    |
| publish | success    |

## Published Image Digest

Digest published by CI run 27644510446 for commit 1658a8b25027b5db1e812206e3e3c4c0c7fee4e2:

```
sha256:492dab7f16998693c4d4b65e45aefb5478ad24f5e5c838f64976e1bc6e150c1c
```

**Full pinned reference (for NAS deploy — use this, NOT the floating :dev tag):**

```
ghcr.io/thejuran/bridgarr-youtube@sha256:492dab7f16998693c4d4b65e45aefb5478ad24f5e5c838f64976e1bc6e150c1c
```

Source: `build-push-action` `##[group]Digest` output in the publish job log of run 27644510446.
ImageID and Digest both resolved to the same sha256 (single-platform linux/amd64 build).

## Traceability

- PUSH_SHA `1658a8b25027b5db1e812206e3e3c4c0c7fee4e2` was pushed to `origin/main`
- CI run 27644510446 matched `headSha == PUSH_SHA` (verified via `gh run list --commit`)
- Both `test` and `publish` jobs concluded `success` (verified via `gh run view --json jobs`)
- Digest captured from `build-push-action` step output in the publish job log (not from registry polling)
- Tag `:dev` on `ghcr.io/thejuran/bridgarr-youtube` now resolves to this digest

## Rollback Reference

The prior live image on the NAS is:
- Container: `ytfortv` (port 8487)
- Prior image: `sha256:4a0b1659...` (security-fixed v1.0 image — recorded in STATE.md)

To roll back: stop the new container and restart from the prior digest.

## Captured At

2026-06-16T20:04:00Z

## Consumed By

Plan 02 (07-02: NAS container swap) — use the full pinned reference above to deploy.
