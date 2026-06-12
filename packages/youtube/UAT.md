# YTforTV — UAT Runbook & Results

**Date:** 2026-06-12
**Build:** ytfortv:dev-amd64 (commit 35c9312), deployed on NAS port **8487**
**Service settings page:** `http://192.168.7.233:8487`
**Browse UI:** `http://192.168.7.233:8487/browse`
**API key:** `1c3cbb1a0e4f3a9267315d26c7206ed3`
**Dirs:** downloads `/data/ytfortv/downloads`, complete `/data/ytfortv/complete` (host `/volume1/data/ytfortv/...`, same `/data` mount Sonarr/Radarr use)

## Pre-flight (automated, done before UAT)

| Check | Result |
|---|---|
| Container healthy on NAS, yt-dlp self-updated to 2026.6.9 | ✅ PASS |
| Newznab caps served | ✅ PASS |
| Live YouTube search from the NAS IP (no bot-check) | ✅ PASS — Roobarb S01E01 returned named releases |
| Full pipeline on dev machine (search → NZB → addfile → yt-dlp → completeDir) | ✅ PASS (Phase 4 e2e, 32.8MB mkv) |

---

## Step 0 — Quality profile allows 480p WEB

Every ytfortv release is tagged `480p ... WEB-DL`, which Sonarr reads as quality **WEBDL-480p**. If the series' quality profile doesn't allow it, every result shows as rejected.

**Do:** Sonarr → Settings → Profiles → open the profile you'll use for the test series. In the quality list, make sure the **WEB 480p** group (WEBDL-480p / WEBRip-480p) is **checked** (it does not need to be the cutoff — just allowed). If you don't want to touch existing profiles, clone one (or make a new profile like "Anything-YT") and use it only for the test series.

- **Profile used:** existing profile (WEB 480p ticked)
- **Result:** ✅ PASS

## Step 1 — Sonarr: add the indexer

**Do:** Sonarr → Settings → Indexers → **+** → choose **Newznab** (generic, at the bottom). Fill in:

| Field | Value |
|---|---|
| Name | `YTforTV` |
| Enable RSS | **OFF** |
| Enable Automatic Search | **OFF** |
| Enable Interactive Search | **ON** |
| URL | `http://192.168.7.233:8487` |
| API Path | `/api` (the default) |
| API Key | `1c3cbb1a0e4f3a9267315d26c7206ed3` |
| Categories | leave default (5030, 5040) |
| Anime categories / Additional params / Tags | leave empty |

Click **Test**.

**Expect:** a green checkmark. Behind the scenes Sonarr fetched our capabilities XML and ran a parameterless test search, which we answer with one synthetic release (`YTforTV.Indexer.Test.S01E01.Connection.OK...`) precisely so this test passes.
**If it fails:** note the exact message (red banner). "Unable to connect" = network/port issue; "Indexer returned no results" would mean the synthetic-item trick didn't satisfy your Sonarr version.

Then **Save**.

- **Result:** ✅ PASS — Test green, saved with RSS/Automatic off, Interactive on. The synthetic connection-test release satisfied Sonarr's save-time check (risk #2 from the plan: cleared).

## Step 2 — Sonarr: add the download client

**Do:** Sonarr → Settings → Download Clients → **+** → choose **SABnzbd**. Fill in:

| Field | Value |
|---|---|
| Name | `YTforTV` |
| Enable | ON |
| Host | `192.168.7.233` |
| Port | `8487` |
| Use SSL | OFF |
| URL Base | leave empty |
| API Key | `1c3cbb1a0e4f3a9267315d26c7206ed3` |
| Username / Password | leave empty |
| Category | `sonarr` |
| Recent/Older Priority | Default |
| Remove Completed | ON (default is fine) |

Click **Test**.

**Expect:** green checkmark (Sonarr calls our fake SAB's `version` + `get_config`).
**Known cosmetic possibility:** a health warning about SABnzbd's "remove completed downloads" config — harmless if it appears; note it.

Then **Save**.

- **Result:** ✅ PASS — Test green, saved, no health warnings.

## Step 3 — Interactive Search renders and maps

**Pick a test show** — ideally one of your real white-whale shows so the test is honest. Known-good fallback: **Roobarb** (1974) — verified to have full episodes on YouTube during development.

**Do:**
1. If the show isn't in Sonarr: Series → Add New, search it, pick the **quality profile from Step 0**, and **untick "Start search for missing episodes"** (we don't want other indexers grabbing).
2. Open the series → click an episode number → **Interactive Search** (the person-with-magnifier icon / "Interactive Search" tab).
3. Wait ~5–10s (we fan out 4 YouTube searches behind the scenes).

**Expect:**
- Rows from indexer "YTforTV" appear, named like `Show.Name.S01E03.YT.<Upload.Title>.<NN>min.480p.WEB-DL-<Channel>` — the upload's real title, length in minutes, and channel are visible in the release name.
- Quality column reads **WEBDL-480p**; size ≈ 15 MB per minute of video (the Size column doubles as a duration gauge).
- No "Unknown Series" / "Unable to parse" rejections on our rows (hover the warning icon if one appears and note the text).
- Clips/shorts mostly absent (anything under 10 min was filtered).

- **Show/episode used:** user's choice (not recorded)
- **Result:** ✅ PASS — YTforTV rows rendered with upload title/minutes/channel in the name, mapped to the searched episode, no parse rejections (risk #1 from the plan — the big one — cleared).

## Step 4 — Grab → download → import

**Do:** in the same Interactive Search list, judge by the embedded upload title + minutes, and click the **download icon** on the most plausible full episode. Then watch **Activity → Queue**.

**Expect:**
1. The release appears in the queue as "Downloading" with a moving percentage (yt-dlp progress is translated to SAB progress).
2. When finished it briefly shows importing, then disappears from the queue.
3. The episode now has a file (check the series page; quality WEBDL-480p, the file lives under the series folder, named by your Sonarr naming scheme).

**If it sits at "Downloading 0%"** for >1 min, or fails: check `Activity → Queue` error and tell me; I can read container logs from here.

- **Release grabbed:** `Acorn.Antiques.S02E01.YT.Omibus.Edition.67min.480p.WEB-DL-AlexCairncross` (youtube.com/watch?v=rl4lKaNKZCw)
- **Result:** ✅ PASS (after Issues 1 & 2 were fixed) — third attempt downloaded with progress and imported cleanly; episode shows its file at WEBDL-480p.
- **Content caveat (expected, not a bug):** the upload turned out to be an omnibus compilation, not the single episode — YouTube titles lie; that's the interactive trust model working as designed. Led to Improvement 1 below.

## Improvements made during UAT

1. **Preview link on every release** — the user couldn't check what a video actually was before grabbing. Each release now sets the Newznab `<comments>` element to the YouTube watch page, which Sonarr/Radarr surface as the release's info link in Interactive Search. Click it to preview the upload in a browser before grabbing. (156 tests; deployed.)

## Step 5 — Radarr: indexer + client + movie search

**Do:** repeat Steps 1–2 in Radarr (`http://192.168.7.233:7878`) with identical values **except** Download Client Category = `radarr`. Add the download client **first**, then in the indexer settings set **Download Client = YTforTV** (see Issue 1 — Radarr has the same multi-SAB routing problem). Also confirm the movie's quality profile allows **WEBDL-480p** (Radarr groups it under WEB 480p).
Then pick an old/obscure movie (add it if needed, untick search-on-add), open it → **Interactive Search**.

**Expect:** rows named `Movie.Title.<Year>.YT.<Upload.Title>.<NN>min.480p.WEB-DL-<Channel>`; results ≥ 45 min only (clip floor). Optionally grab one and confirm download + import like Step 4.

- **Indexer/client tests:** _pending_
- **Movie used:** _pending_
- **Result:** _pending_

## Step 6 — Browse UI scouting (optional)

**Do:** open `http://192.168.7.233:8487/browse`, search any obscure title.
**Expect:** raw YouTube results (title/channel/length/views, links open YouTube), plus "Add to Sonarr"/"Add to Radarr" buttons. The add flow needs Sonarr/Radarr URL+API key set in ytfortv's settings page first — optional for this UAT.

- **Result:** _pending_

## Issues found

1. **Grab routed to the wrong download client** (Step 4, 2026-06-12 11:47). With multiple SABnzbd-type clients configured, Sonarr sent the YTforTV NZB to iViewarr's fake SAB (port 8486), which rejected it (`not an iviewarr nzb`) → grab failed with a 500. Sonarr log: `SabnzbdProxy|Url: http://192.168.7.233:8486/api?mode=addfile...` for a YTforTV release.
   **Root cause:** the YTforTV indexer had no pinned download client (`downloadClientId: 0`), unlike iViewarr/iPlayarr which are pinned to theirs. The pinning step was missing from the README and this runbook.
   **Fix:** Sonarr → Settings → Indexers → YTforTV → set **Download Client = YTforTV** → Save. README updated with this step.
   Side observation: the rejected-NZB safety check did its job — a foreign NZB was refused, not mis-downloaded.

2. **Import failed: root-owned files** (Step 4 retry, 11:55). After the routing fix the download completed, Sonarr accepted the file, but the move failed: `System.UnauthorizedAccessException: Access to the path '…' is denied`. The container ran node as root, so the webm + complete dir were root-owned; Sonarr (PUID 1026) couldn't move the file.
   **Fix (durable):** image now supports linuxserver-style `PUID`/`PGID` — entrypoint runs the yt-dlp self-update as root, then drops to `su-exec $PUID:$PGID` for the app (`HOME` pointed at the config volume for yt-dlp's cache). Container redeployed with `PUID=1026 PGID=100`; existing files chowned. README compose snippet updated.
