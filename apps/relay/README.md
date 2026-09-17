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

## GitHub sign-in (personal service)

Settings → Connections → **Continue with GitHub**, or `kaioken connect login`,
starts a ten-minute sign-in. The browser confirms the computer name and goes to
GitHub; the runtime receives approval over a hibernating WebSocket and registers
itself. Signing in on another Mac discovers the same account's computers.
Projects, repositories, tasks and provider credentials stay on their host.

This relay admits exactly one configured numeric GitHub user ID. It is not a
public multi-account service. GitHub supplies identity only: no repository or
email scopes are requested, and its access token is not persisted. OAuth uses
state, S256 PKCE, and a browser-bound HttpOnly cookie. Each runtime generates its
own random device credential; the relay stores its hash. Callback links contain
no device credentials. Completion is idempotent and cannot resurrect revoked
access. Pending sign-ins resume after restart and expire after ten minutes.

Before deploying this feature:

1. Create a GitHub OAuth App with homepage `https://kaioken.app` and authorization
   callback `https://kaioken.app/auth/github/callback`.
2. Configure `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and
   `GITHUB_ALLOWED_USER_ID` on the relay using `wrangler secret put <name>`.
   The allowed ID is the owner's stable numeric GitHub ID (`gh api user --jq .id`
   when logged into that account), not a username. Keep the client secret out of
   source control and clients.
3. Retain `SESSION_SECRET` and existing bindings. Deploy migration `v4`, which adds
   SQLite-backed `LoginDO`, along with the existing `v3` AccountDO migration.
4. Use clients containing the Connect login implementation on both computers.
   In a source checkout, set the Connect `relayUrl` to the configured relay;
   the development Cloud server does not implement this GitHub flow.

No live GitHub sign-in or deployment is performed by local tests. Missing OAuth
configuration returns a clear 503 error; it never falls back to an open account.
Legacy pairing remains available under **Connect with a pairing code**.

Login endpoints on the account origin:

- `POST /api/connect/login` accepts `{name, challenge, previous}`. `challenge` is
  SHA-256 of a client-generated `bbcred_` credential with 32 random bytes encoded
  as base64url. `previous` is null or `{handle, hash}` to rotate an existing device
  without duplicating it. Returns `{id, browserUrl, expiresAt}`.
- `/auth/github` displays consent and redirects to GitHub on a CSRF-protected POST;
  `/auth/github/callback` validates state, cookie, PKCE exchange and allowed owner.
- `GET /api/connect/login/:id/events` upgrades to a WebSocket;
  `POST /api/connect/login/:id/complete` and `/cancel` finish or cancel. All three
  require `x-kaioken-login-proof`. Events contain only `{phase}`; completion returns
  device metadata, never the secret. Cancel also removes a completed registration
  if the client cancels before accepting it. Automatic text ping/pong keeps idle
  WebSockets hibernating; there is no approval polling loop.
- `PATCH /api/connect/devices/:handle` with `{name}` renames a computer;
  `DELETE` revokes it and closes its tunnel. These require a server credential in
  `x-bb-connect-machine`; paired browser/mobile credentials cannot manage devices.

## Live device discovery

The personal account's `AccountDO` owns paired servers, device credentials, and
short-lived pairing codes in durable SQLite-backed storage. All Worker instances
route account operations to this coordinator. Pairing codes are consumed serially,
and credential revocation takes effect without a cache expiry window.

The Connect plugin maintains one authenticated discovery WebSocket. The relay
sends a complete directory snapshot on connection and when a server is paired,
unpaired, connects, or disconnects. The plugin shares these updates through the
local Kaioken realtime connection with browser views and the desktop app. The
CLI's `kaioken connect servers` and SDK's existing Connect `listAccountServers`
RPC read the same snapshot. A desktop without a local runtime subscribes directly.

Discovery uses Cloudflare's hibernating WebSocket API and automatic text
ping/pong replies. Heartbeats do not rescan KV or write a last-seen record.
Reconnects use exponential backoff with jitter and receive a fresh snapshot.
Failed presence broadcasts are retained for retry. A clean disconnect updates
presence immediately; silent network loss is detected by heartbeat timeout.
The tunnel checks for missing heartbeats every 50 seconds with a 90-second limit.

The UI's five-minute refresh is a fallback against the local plugin; it returns
its live snapshot while discovery is connected. While disconnected, fallback
HTTP directory reads are coalesced and cached for 60 seconds. These reads use
the coordinator, not KV. Remote project/task snapshot refreshes are separate and
unchanged. This removes recurring KV directory scans, not all Cloudflare usage.

Visitor sessions remain HMAC-signed cookies scoped to the whole domain, so one
pairing covers every handle. This is still a **single personal account** selected
by the relay, not a public sign-in service. Future multi-account authentication
must select the coordinator from verified identity, never a caller-supplied ID.

## State migration and rollout

Wrangler migration `v3` adds `AccountDO`. On its first request, the coordinator
imports known records from `STATE` once, including legacy single-server records
and unexpired pairing codes. It retains the original KV data as a migration
backup. All subsequent reads and writes use durable account storage.

Deploy the relay before updating clients: existing clients can continue using
`GET /api/connect/servers`; updated clients use `/api/connect/events`. Updated
clients retain HTTP fallback when used with an older relay.

Do not roll back to a KV-only worker after accepting new pairings or revocations:
the retained KV copy is then stale. A rollback must keep the coordinator-backed
state path or explicitly reconcile current state first. No deployment is part of
local tests, and no desktop release is required to review this implementation.

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
- `GET /api/connect/events` upgrades to a WebSocket using the
  `x-bb-connect-machine` header (server or paired-device credential). It sends
  `{ type: "snapshot", servers: [...] }` using the same server fields as `/servers`.
  Send `kaioken:ping` for an automatic `kaioken:pong`. A revoked subscription
  receives `{ type: "revoked" }` and closes with code `4001`; rejected handshakes
  return `401`. Browser origins must match the trusted account domain.
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

Redeploy after changes with `wrangler deploy`; secrets and durable account state persist.
Follow the migration and rollback constraints above.
