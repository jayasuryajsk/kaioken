---
name: share-server-links
description: "Expose a local HTTP server through Kaioken Connect and give the user its remotely accessible URL."
---

# Share local server links via kaioken connect

When you start an HTTP server the user should open, give them a connect share
URL — not a localhost URL. Shares work from threads running on any enrolled
host, and the command resolves the thread's host automatically.

1. Check pairing: run `kaioken connect status --json`. If not paired / not
   connected, give the localhost URL and mention that `kaioken connect login` prints a GitHub sign-in link and enables
   remote URLs after authorization.
2. From the thread that started the HTTP server, run `kaioken connect expose
<port>`. It prints that host's share URL. Use `--host <name-or-id>` only
   when you intentionally need another enrolled host; outside a thread,
   sharing defaults to the machine running the kaioken server.
3. Give the returned URL to the user as a markdown link. It works for viewers
   who have the owner's kaioken.app session; it is not a public internet link.
4. When the server stops, run `kaioken connect unexpose <port>` from the same
   thread (or with the same `--host`) so the share is cleaned up. Use
   `kaioken connect shares [--host <name-or-id>]` to inspect that host's shares.

Server-host shares use `https://<server-label>--<port>.<base-domain>` through
the server tunnel. Other enrolled hosts use
`https://<machine-label>--<port>.<base-domain>` through their daemon. If a
machine was not enrolled through Connect, expose fails with instructions to
remove and re-add it under Settings > Machines.

## Agent instructions setting

Settings → Installed plugins → Connect has a "Tell agents about remote access"
toggle, enabled by default. Use
`kaioken plugin config connect set sendRemoteInstructions false` to suppress the
remote-access message, or `true` to restore it. This controls only the message;
sharing still works. The message otherwise requires active or recent remote
usage. Changes apply when session instructions are next assembled.

## Account and computers

Use `kaioken connect login [--name <computer-name>] [--json]` and give the user its
browser URL. The configured GitHub owner authorizes in the browser; the runtime
finishes automatically and retains login across restarts. Do not poll for OAuth
approval or ask the user to paste a GitHub token. `login --cancel` cancels a
pending sign-in; `status --json` and `servers --json` inspect the connection.
`rename <handle> --name <name>` changes its display name, `revoke <handle>` removes
access, and `logout` confirms revocation before clearing this device. These accept
`--json`. Settings → Connections exposes the same actions. Source checkouts can
set `kaioken plugin config connect set relayUrl https://kaioken.app` to target a
configured relay. Missing GitHub configuration is a service setup error; legacy
code pairing remains available. Repositories and provider credentials stay on
individual computers.
