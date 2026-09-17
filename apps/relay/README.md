# @kaioken/relay

A single-account Kaioken connect relay on your own Cloudflare account. It
replaces bb's hosted `getbb.app` relay, keeps the tunnel engine unchanged, and
speaks the same pairing endpoints the desktop plugin and the phone app already
use. One account holds many Kaiokens: every Mac pairs under its own handle and
gets its own tunnel, and any paired device can reach all of them.

Hosts (domain mode, the default config):

- `kaioken.app` — pairing API (`/api/connect/*`) and a landing page listing the
  paired Macs.
- `<handle>.kaioken.app` — one Kaioken app per paired Mac, tunnelled from it.
- `<handle>--<port>.kaioken.app` — port shares from that Mac.

The wildcard route in `wrangler.jsonc` needs a proxied wildcard DNS record
(`*.kaioken.app`) in the zone; the two custom domains manage their own records.

State lives in one KV namespace: one `server:<handle>` record per paired Mac
(credential hash, handle, display name), paired devices ("machines"), and
short-lived pairing codes. A legacy single `server` record is migrated to
`server:<HANDLE>` on first use. Visitor sessions are HMAC-signed cookies scoped
to the whole domain, so one sign-in covers every handle. Requests still check
the target server and, where applicable, the visiting device's credentials.

The device directory caches handles and display names for five minutes per
Worker isolate and KV namespace. Repeated directory requests share the cached
listing, while online status is read live from each tunnel. Pairing or
disconnecting a server invalidates the local directory cache; other isolates
refresh within five minutes. Credential resolution and revocation checks do
not use this directory cache. Cold starts and separate isolates each need
their own KV scan, so the cache reduces usage without guaranteeing a daily
operation ceiling.

Browsers loading the app from one handle may call another handle's API:
server hosts answer CORS for `https://kaioken.app` and any
`https://<handle>.kaioken.app` origin with credentials, and refuse everything
else.

## API

- `POST /api/connect/redeem` `{ code, handle?, name? }` → `{ credential, handle,
name, serverId, serverUrl, tunnelUrl }`. `code` is `PAIR_CODE`. `handle` is
  `[a-z0-9]` with hyphens, 1–32 chars, not `www`/`api`/`mail`/`admin`; omitted,
  it defaults to the request host's handle or `HANDLE`. Re-pairing a handle
  replaces its credential.
- `GET /api/connect/servers` (any account credential) → `{ servers: [{ handle,
name, live, lastSeenAt, url }] }`.
- `POST /api/connect/disconnect` (server credential) unpairs only that handle.
- `machine-code`, `redeem-machine`, `revoke-machine`, `desktop-session` are
  unchanged and account-wide.
- `GET /__health` on a handle host reports that handle's tunnel.

## One-time setup

```sh
pnpm --filter @kaioken/relay exec wrangler login
pnpm --filter @kaioken/relay exec wrangler kv namespace create STATE   # paste the id into wrangler.jsonc
pnpm --filter @kaioken/relay exec wrangler secret put PAIR_CODE        # what every Mac types to pair
pnpm --filter @kaioken/relay exec wrangler secret put SESSION_SECRET   # any long random string
pnpm --filter @kaioken/relay exec wrangler deploy
```

Pair each Mac that runs Kaioken, under its own name:

```sh
kaioken connect --code <PAIR_CODE> --base-url https://kaioken.app --handle macbook
kaioken connect --code <PAIR_CODE> --base-url https://kaioken.app --handle mini
```

Pair a phone or browser once: Settings → Connect → phone pairing code (needs
the "Mobile app" experiment), then scan the QR in the app or type the code at
`https://<handle>.kaioken.app/__login`. The session covers every handle.

Redeploy after changes with `wrangler deploy`; secrets and KV state persist.
