import type {
  KaiokenRealtimeSocket,
  KaiokenRealtimeSocketFactory,
} from "@kaioken/sdk/browser";
import { getBbDesktopInfo } from "@/lib/kaioken-desktop";
import { readConnectionIdentity } from "./connection-identities";

export const createRemoteWebsocket: KaiokenRealtimeSocketFactory = (url) => {
  const target = new URL(url);
  const origin = new URL(target);
  origin.protocol = target.protocol === "wss:" ? "https:" : "http:";
  const serverId = readConnectionIdentity(origin.origin);
  if (serverId) target.searchParams.set("connectionServerId", serverId);
  url = target.toString();
  const bridge = getBbDesktopInfo()?.federatedSocket;
  if (!bridge) {
    const socket = new WebSocket(url);
    const adapter: KaiokenRealtimeSocket = {
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      get readyState() {
        return socket.readyState;
      },
      send: (data) => socket.send(data),
      close: () => socket.close(),
    };
    socket.onopen = () => adapter.onopen?.();
    socket.onclose = () => adapter.onclose?.();
    socket.onerror = () => adapter.onerror?.();
    socket.onmessage = (event) => adapter.onmessage?.({ data: event.data });
    return adapter;
  }
  const id = crypto.randomUUID();
  let readyState = 0;
  let unsubscribe = () => {};
  const finish = () => {
    if (readyState === 3) return;
    readyState = 3;
    unsubscribe();
    socket.onclose?.();
  };
  const socket: KaiokenRealtimeSocket = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    get readyState() {
      return readyState;
    },
    send(data) {
      if (readyState !== 1) throw new Error("Remote connection is not open");
      bridge.send({ id, data });
    },
    close() {
      if (readyState === 3) return;
      bridge.close({ id });
      finish();
    },
  };
  unsubscribe = bridge.subscribe((event) => {
    if (event.id !== id || readyState === 3) return;
    switch (event.type) {
      case "open":
        readyState = 1;
        socket.onopen?.();
        break;
      case "message":
        socket.onmessage?.({ data: event.data });
        break;
      case "error":
        socket.onerror?.();
        break;
      case "close":
        finish();
        break;
    }
  });
  void bridge.open({ id, url }).catch(() => {
    if (readyState === 3) return;
    socket.onerror?.();
    finish();
  });
  return socket;
};
