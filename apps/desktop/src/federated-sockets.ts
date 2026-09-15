import { WebSocket } from "ws";
import type { FederatedSocketEvent } from "@kaioken/desktop-contract";
import {
  isAllowedFederatedUrl,
  type FederatedFetchServer,
} from "./desktop-federation-main-ipc.js";

interface RemoteSocket {
  readyState: number;
  on(event: "open" | "close" | "error", listener: () => void): void;
  on(event: "message", listener: (data: { toString(): string }) => void): void;
  send(data: string): void;
  terminate(): void;
}

interface SocketEntry {
  socket: RemoteSocket | null;
  closed: boolean;
  emit: (event: FederatedSocketEvent) => void;
}

export function createFederatedSockets(args: {
  prepare: () => Promise<void>;
  listServers: () => readonly FederatedFetchServer[];
  cookieHeader: (url: string) => Promise<string>;
  createSocket?: (url: string, cookie: string) => RemoteSocket;
}) {
  const owners = new Map<string, Map<string, SocketEntry>>();
  const createSocket =
    args.createSocket ??
    ((url, cookie) =>
      new WebSocket(url, {
        headers: { Cookie: cookie },
        followRedirects: false,
        handshakeTimeout: 10_000,
        maxPayload: 32 * 1024 * 1024,
      }));

  function close(owner: string, id: string) {
    const entries = owners.get(owner);
    const entry = entries?.get(id);
    if (!entry) return;
    entry.closed = true;
    entries?.delete(id);
    if (entries?.size === 0) owners.delete(owner);
    entry.socket?.terminate();
  }

  return {
    async open(
      owner: string,
      id: string,
      target: string,
      emit: SocketEntry["emit"],
    ) {
      const entries = owners.get(owner) ?? new Map<string, SocketEntry>();
      if (entries.has(id)) throw new Error("Connection already exists");
      const entry: SocketEntry = { socket: null, closed: false, emit };
      entries.set(id, entry);
      owners.set(owner, entries);
      try {
        await args.prepare();
        const url = new URL(target);
        if (
          !["wss:", "ws:"].includes(url.protocol) ||
          url.username ||
          url.password
        ) {
          throw new Error("Remote realtime connection must use wss");
        }
        const httpUrl = new URL(url);
        httpUrl.protocol = url.protocol === "wss:" ? "https:" : "http:";
        if (!isAllowedFederatedUrl(httpUrl, args.listServers())) {
          throw new Error("Remote realtime connection is not a known computer");
        }
        const cookie = await args.cookieHeader(httpUrl.toString());
        if (entry.closed) return;
        const socket = createSocket(url.toString(), cookie);
        entry.socket = socket;
        const publish = (event: FederatedSocketEvent) => {
          if (!entry.closed) entry.emit(event);
        };
        socket.on("open", () => publish({ id, type: "open" }));
        socket.on("message", (data) =>
          publish({ id, type: "message", data: data.toString() }),
        );
        socket.on("error", () => publish({ id, type: "error" }));
        socket.on("close", () => {
          publish({ id, type: "close" });
          close(owner, id);
        });
      } catch (error) {
        close(owner, id);
        throw error;
      }
    },
    send(owner: string, id: string, data: string) {
      const socket = owners.get(owner)?.get(id)?.socket;
      if (socket?.readyState === WebSocket.OPEN) socket.send(data);
    },
    close,
    closeOwner(owner: string) {
      for (const id of owners.get(owner)?.keys() ?? []) close(owner, id);
    },
  };
}
