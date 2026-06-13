# Contributing

PRs welcome.

## Monorepo layout

| Package | Path | Role |
|---------|------|------|
| `@bridgarr/core` | `packages/core` | Substrate / toolkit library — the shared Newznab + SABnzbd emulation parts |
| `@bridgarr/youtube` | `packages/youtube` | Reference bridge app (YTforTV) built on `@bridgarr/core` |

## Development commands

**Install all workspaces:**

```sh
npm install
```

**Build all packages:**

```sh
npm run build
```

**Test all packages:**

```sh
npm test
```

**Type-check all packages:**

```sh
npm run typecheck
```

**Lint all packages:**

```sh
npm run lint
```

**Run a single workspace's tests:**

```sh
npm test -w @bridgarr/core
npm test -w @bridgarr/youtube
```

**Start the youtube bridge in watch mode (development):**

```sh
npm run dev -w @bridgarr/youtube
```

Note: only `@bridgarr/youtube` has a `dev` script; `@bridgarr/core` is a library and has no dev server.

## Where code belongs

> "core knows how to talk to the *arrs and how to compare titles; each bridge knows how its site organises content."

Source-site-specific logic belongs in a bridge package (e.g. `packages/youtube`), not in `@bridgarr/core`. Core handles Newznab XML, SABnzbd routing, title normalisation, the download queue, and config helpers. A bridge supplies a `SourceBridge` implementation with its own search and knows how to feed results into core's machinery.
