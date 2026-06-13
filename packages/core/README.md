# @bridgarr/core

Shared TypeScript substrate for building Sonarr/Radarr source bridges: Newznab indexer emulation, SABnzbd download-client emulation, and all the plumbing in between.

## Install

```bash
npm install @bridgarr/core
```

## What's in the box

- **Title normalization and matching** — `normalizeShowTitle`, `titlesMatch`, `stripSearchYear`, `extractSearchYear`, `queryMatches`
- **Fake-NZB token codec + XML builder** — `encodeToken`, `decodeToken`, `buildNzb`, `parseNzb`, `escapeXml`
- **Newznab caps/RSS XML builders** — `capsXml`, `searchRss`, `errorXml`
- **In-memory download queue** — `DownloadQueue` class (no persistence layer)
- **SABnzbd-emulation router** — `handleSab`, `SabContext`, `SabSettings`, `SabLogger`
- **Healthz handler** — `healthzHandler` factory (takes a service-name string, returns an Express handler)
- **Config-persistence helpers** — `loadSettings`, `saveSettings`, `generateApiKey`
- **SourceBridge interface** — `SourceBridge`, `BridgeResult`, `ReleaseIdentity`

## Walkthrough

See the [bridgarr README](../../README.md#build-your-own-bridge) for the full build-your-own-bridge walkthrough — from `npm install` to a type-checking, Sonarr-pointable bridge skeleton with both Newznab indexer and SABnzbd download-client wiring.
