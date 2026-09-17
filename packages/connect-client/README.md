# Connect client

`listAccountServers(credential)` provides an authenticated HTTP snapshot.
`subscribeAccountServers` maintains live discovery for trusted Node/Electron
clients. Browser views receive the Connect plugin's local realtime signals
instead of receiving the account credential or opening another cloud socket.

```ts
import { WebSocket } from "ws";
import { subscribeAccountServers } from "@kaioken/connect-client";

const stop = subscribeAccountServers({
  credential,
  createSocket: (url, headers, onRejected) => {
    const socket = new WebSocket(url, { headers });
    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      onRejected(response.statusCode ?? 502);
    });
    return socket;
  },
  onSnapshot: updateDeviceList,
  onDisconnected: markDevicesUnavailable,
  onRevoked: clearSavedCredential,
});

stop();
```

Snapshots include `servers` and `selfHandle`, matching `listAccountServers`.
Keep one subscription per local runtime and dispose it when stopping or changing
credentials. The adapter must pass HTTP handshake failures to `onRejected`:
401/403 and a `revoked` event stop retries; transient failures use exponential
backoff with jitter. A fresh snapshot is delivered on every connection. Opening
has a 15-second deadline, and automatic ping/pong detects stalled connections.

The Connect plugin publishes the same payload on `ACCOUNT_SERVERS_CHANNEL`
(`account-servers`). Its existing `listAccountServers` RPC and
`kaioken connect servers` command use the cached live snapshot; no CLI flags or
configuration changes are needed.
