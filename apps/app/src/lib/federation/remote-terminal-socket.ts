import type { TerminalBrowserSocket } from "@kaioken/client-core";
import { createRemoteWebsocket } from "./remote-websocket";

export function remoteTerminalSocketUrl(
  serverUrl: string,
  path: string,
): string {
  const url = new URL(path, serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function createRemoteTerminalSocket(url: string): TerminalBrowserSocket {
  const inner = createRemoteWebsocket(url);
  const socket: TerminalBrowserSocket = {
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return inner.readyState;
    },
    close: () => inner.close(),
    send: (data) => inner.send(data),
  };
  inner.onopen = () => socket.onopen?.(new Event("open"));
  inner.onmessage = (event) =>
    socket.onmessage?.(new MessageEvent("message", { data: event.data }));
  inner.onerror = () => socket.onerror?.(new Event("error"));
  inner.onclose = () => socket.onclose?.(new CloseEvent("close"));
  return socket;
}
