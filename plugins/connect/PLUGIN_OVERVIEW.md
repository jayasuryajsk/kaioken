Open your kaioken from a phone or another computer. After you pair, this kaioken answers at `https://<handle>.kaioken.app` for anyone signed in to your kaioken.app account. One account holds many Kaiokens: every Mac pairs under its own handle, and a paired phone or browser can reach all of them.

## What you get

- Remote access to the full kaioken app through a tunnel. Your kaioken makes an outbound connection, so you do not open ports or change your router.
- Port shares. Publish a local HTTP server, such as a dev server, at a share URL. The link opens from any device with your session.
- Pairing for the kaioken mobile app with a QR code or a one-time code.
- A Remote access section in Settings, and a sidebar shortcut to it, with the connection state and the remote URL.

## How it works

Choose **Continue with GitHub** in Settings → Connections, or run `kaioken connect
login --name "Mac Studio"` and open the printed link. Sign in with the same
configured GitHub account on each computer. Kaioken registers each device
and reconnects after restart. Repositories, tasks and provider credentials stay
on their computer. Rename and revoke computers from Connections settings, or use
`kaioken connect rename <handle> --name <name>` and `kaioken connect revoke <handle>`.
`kaioken connect logout` confirms revocation before signing out; `login --cancel`
cancels a pending sign-in. All support `--json`.

The relay needs its GitHub OAuth App credentials and allowed numeric owner ID
configured first; see `apps/relay/README.md`. This is a personal single-owner
service. Pending sign-in resumes after restart and expires after ten minutes.
Device credentials use private runtime files; no GitHub access token is retained.
Advanced **Connect with a pairing code** remains available for existing setups.
Disable the plugin to stop remote access or use `kaioken connect off` to forget
local pairing even if the relay cannot be reached.

Device discovery is live: the plugin subscribes once to the relay and shares
updates with all local views. Newly paired computers and connection changes
appear without waiting for a polling interval. After a network interruption,
it reconnects with backoff and requests a fresh snapshot. `kaioken connect
servers` and the Connect `listAccountServers` RPC use that same device list.

## For agents

When you view kaioken remotely, agents are told to share servers with `kaioken connect expose <port>`. A localhost link would not open. The `share-server-links` skill explains the flow. Other commands: `kaioken connect status`, `kaioken connect unexpose <port>`, `kaioken connect shares`, `kaioken connect servers`, and `kaioken connect machine-code`.

## Requirements

A configured personal Kaioken relay and its permitted GitHub account. Share links open only for viewers with your kaioken.app session; they are not public. Mobile pairing needs the "Mobile app" experiment.
