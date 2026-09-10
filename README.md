<p align="center">
  <img alt="Kaioken" src="assets/kaioken-logo.svg" width="128">
</p>

# Kaioken

Kaioken is a personal agentic IDE. It is a fork of
[bb](https://github.com/get-bb/bb), the agentic IDE that builds itself, renamed
and tuned for one person's setup. It can control, customize, and automate
itself: every surface, whether the desktop app, web app, CLI, or HTTP API, is a
first-class way to drive it. Work runs in threads you can follow live, steer at
any point, or hand off to another agent.

> [!IMPORTANT]
> Kaioken is not published. There is no `kaioken-app` on npm and no desktop
> release, so `npx kaioken-app@latest` and the download links in the older docs
> do not work. Install from source as described below.

## Run it from source

Requires Node.js 22.19 or newer and pnpm 9.15. Kaioken uses the provider CLIs
you already have authenticated (Claude Code, Codex, Cursor, and so on).

```bash
git clone https://github.com/jayasuryajsk/kaioken.git
cd kaioken
pnpm install
pnpm start
```

`pnpm start` builds the app, server, and host-daemon artifacts, then runs the
launcher against them in production mode. It prints the URL at startup
(`http://localhost:38886` by default). Production data lives under `~/.kaioken`.

### The `kaioken` CLI

The CLI is the same surface agents use. From the checkout:

```bash
pnpm kaioken --help            # built CLI, targets the production instance
pnpm kaioken:dev --help        # source CLI, targets this checkout's dev instance
```

To put `kaioken` on your PATH, build the launcher package and install the
packed tarball globally:

```bash
pnpm build
cd packages/kaioken-app && pnpm pack
npm install -g --allow-scripts=better-sqlite3,node-pty,@parcel/watcher ./kaioken-app-*.tgz
kaioken --help
```

### Desktop app

The Electron shell is built locally rather than downloaded:

```bash
pnpm --filter @kaioken/desktop package        # macOS arm64, output in apps/desktop/release
pnpm --filter @kaioken/desktop package:linux  # Linux x64 AppImage
```

## Development

Use the development loop when working on Kaioken itself:

```bash
pnpm dev
```

That starts the Vite app and proxies API and WebSocket traffic to a separate
dev server. The launcher prints the actual ports at startup. Each checkout gets
a data directory under `~/.kaioken-dev/<checkout-instance>/` and deterministic
high ports derived from the checkout path, so a dev instance and the production
instance run side by side.

```bash
pnpm dev:desktop      # the same dev server inside the Electron shell
pnpm start:worktree   # production bundle on this checkout's dev ports
pnpm reset:dev        # clear this checkout's dev state
pnpm reset            # clear production state
```

Build, typecheck, and test go through Turbo so upstream packages build first:

```bash
pnpm exec turbo run typecheck --filter=@kaioken/server
pnpm exec turbo run test --filter=@kaioken/cli
```

See [AGENTS.md](AGENTS.md) for the codebase guidelines,
[docs/repository-overview.md](docs/repository-overview.md) for the package map,
and [docs/system-overview.md](docs/system-overview.md) for the runtime
architecture.

## Telemetry

Off. Kaioken never sends usage telemetry unless you explicitly set
`KAIOKEN_TELEMETRY=true`.

## Keeping up with upstream

bb moves fast, and the rename touches thousands of files, so Kaioken does not
merge upstream. It re-applies the rename on top of a fresh upstream snapshot
instead:

```bash
git fetch upstream
git checkout -B main upstream/main
node scripts/rebrand-kaioken.mjs
git add -A && git commit -m "Rebrand upstream to Kaioken"
# then cherry-pick the Kaioken-only commits (icons, README, telemetry, CI)
```

[`scripts/rebrand-kaioken.mjs`](scripts/rebrand-kaioken.mjs) documents exactly
what is renamed and what is deliberately left alone. In short: package scopes,
the CLI name, env vars (`KAIOKEN_*`), data directories, and identifiers are
renamed; the plugin manifest key `bb`, the `x-bb-*` wire headers, marketplace
ids, and upstream URLs are kept so plugins from the
[BB Community marketplace](https://github.com/get-bb/marketplace) still install
and load. Plugins written against `@get-bb/plugin-sdk` keep working because that
specifier is accepted as an alias of `@get-kaioken/plugin-sdk`.

## Troubleshooting

### `Could not locate the bindings file`

Kaioken uses native add-ons (`better-sqlite3`, `node-pty`, `@parcel/watcher`)
that build in a package install script. npm 12 and later block install scripts
by default, and `ignore-scripts=true` in `~/.npmrc` does the same. Allow them
for the install:

```bash
npm install -g --allow-scripts=better-sqlite3,node-pty,@parcel/watcher ./kaioken-app-*.tgz
```

A Node.js major-version change after the install, or a `node_modules` copied
from another OS or CPU architecture, causes the same error. Reinstall, or run
`npm rebuild better-sqlite3`.

## License

MIT, same as upstream. See [LICENSE](LICENSE).
