Open your kaioken from a phone or another computer. After you pair, this kaioken answers at `https://<handle>.kaioken.app` for anyone signed in to your kaioken.app account. One account holds many Kaiokens: every Mac pairs under its own handle, and a paired phone or browser can reach all of them.

## What you get

- Remote access to the full kaioken app through a tunnel. Your kaioken makes an outbound connection, so you do not open ports or change your router.
- Port shares. Publish a local HTTP server, such as a dev server, at a share URL. The link opens from any device with your session.
- Pairing for the kaioken mobile app with a QR code or a one-time code.
- A Remote access section in Settings, and a sidebar shortcut to it, with the connection state and the remote URL.

## How it works

Enter the relay's pairing code in Settings, or run `kaioken connect --code <PAIR_CODE> --base-url https://kaioken.app --handle <name>` on each Mac. The handle is the name that Mac answers to (`https://<name>.kaioken.app`); the Handle setting fixes it, and an empty setting uses the machine's hostname. `--server <url>` still overrides the derived URL. The plugin keeps the tunnel open in the background and reconnects after a drop. Disable the plugin to cut all remote access at once. `kaioken connect off` also disconnects and forgets the pairing.

## For agents

When you view kaioken remotely, agents are told to share servers with `kaioken connect expose <port>`. A localhost link would not open. The `share-server-links` skill explains the flow. Other commands: `kaioken connect status`, `kaioken connect unexpose <port>`, `kaioken connect shares`, `kaioken connect servers`, and `kaioken connect machine-code`.

## Requirements

A kaioken.app account. Share links open only for viewers with your kaioken.app session; they are not public. Mobile pairing needs the "Mobile app" experiment.
