# @kaioken/relay

A single-user Kaioken connect relay on your own Cloudflare account. It replaces
bb's hosted `getbb.app` relay for one server, keeps the tunnel engine unchanged,
and speaks the same five pairing endpoints the desktop plugin and the phone app
already use, so neither client needs to know the difference.

Hosts (domain mode, the default config):

- `kaioken.app` — pairing API (`/api/connect/*`) and a landing page.
- `studio.kaioken.app` — the Kaioken app, tunnelled from the Mac.
- `studio--<port>.kaioken.app` — port shares (needs a wildcard DNS record).

State lives in one KV namespace: the paired server credential hash, paired
devices ("machines"), and short-lived pairing codes. Visitor sessions are
HMAC-signed cookies, so no database lookups per request.

## One-time setup

```sh
pnpm --filter @kaioken/relay exec wrangler login
pnpm --filter @kaioken/relay exec wrangler kv namespace create STATE   # paste the id into wrangler.jsonc
pnpm --filter @kaioken/relay exec wrangler secret put PAIR_CODE        # what you type to pair the Mac
pnpm --filter @kaioken/relay exec wrangler secret put SESSION_SECRET   # any long random string
pnpm --filter @kaioken/relay exec wrangler deploy
```

Pair the Mac that runs Kaioken:

```sh
kaioken connect --code <PAIR_CODE> --server https://studio.kaioken.app --base-url https://kaioken.app
```

Pair a phone or browser: Settings → Connect → phone pairing code (needs the
"Mobile app" experiment), then scan the QR in the app or type the code at
`https://studio.kaioken.app/__login`.

Redeploy after changes with `wrangler deploy`; secrets and KV state persist.
