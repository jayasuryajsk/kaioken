import { z } from "zod";
import type { ConnectCredential } from "./credential.js";
import {
  accountServersResponseSchema,
  withAccountServerUrls,
  type ListAccountServersResult,
} from "./list-servers.js";

export const ACCOUNT_SERVERS_CHANNEL = "account-servers";
const snapshotSchema = accountServersResponseSchema.extend({
  type: z.literal("snapshot"),
});
const eventSchema = z.discriminatedUnion("type", [
  snapshotSchema,
  z.object({ type: z.literal("revoked") }),
]);

export interface AccountEventSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(event: "open", listener: () => void): void;
  addEventListener(
    event: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(
    event: "close",
    listener: (event: { code: number }) => void,
  ): void;
  addEventListener(event: "error", listener: () => void): void;
}

export function subscribeAccountServers(args: {
  credential: ConnectCredential;
  createSocket: (
    url: string,
    headers: Record<string, string>,
    onRejected: (status: number) => void,
  ) => AccountEventSocket;
  onSnapshot: (snapshot: ListAccountServersResult) => void;
  onDisconnected: () => void;
  onRevoked: () => void;
}): () => void {
  let stopped = false;
  let socket: AccountEventSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let attempts = 0;
  let lastMessageAt = Date.now();

  function clearTimers() {
    clearTimeout(deadline);
    clearInterval(heartbeat);
  }

  function connect(): void {
    if (stopped) return;
    const url = new URL("/api/connect/events", args.credential.serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let current: AccountEventSocket;
    let failed = false;
    let connectedAt: number | null = null;
    const disconnected = (revoked = false) => {
      if (failed || stopped) return;
      failed = true;
      clearTimers();
      socket = null;
      current?.close();
      args.onDisconnected();
      if (revoked) {
        stopped = true;
        args.onRevoked();
        return;
      }
      if (connectedAt !== null && Date.now() - connectedAt > 10_000)
        attempts = 0;
      const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts++, 6));
      retry = setTimeout(
        connect,
        delay + Math.floor(Math.random() * delay * 0.2),
      );
    };
    try {
      current = args.createSocket(
        url.href,
        {
          "x-bb-connect-machine": args.credential.credential,
        },
        (status) => disconnected(status === 401 || status === 403),
      );
      socket = current;
      if (failed || stopped) {
        current.close();
        socket = null;
        return;
      }
    } catch {
      disconnected();
      return;
    }
    deadline = setTimeout(() => disconnected(), 15_000);
    current.addEventListener("open", () => {
      if (failed || stopped) return;
      lastMessageAt = Date.now();
      heartbeat = setInterval(() => {
        if (Date.now() - lastMessageAt > 65_000) {
          disconnected();
          return;
        }
        try {
          current.send("kaioken:ping");
        } catch {
          disconnected();
        }
      }, 30_000);
    });
    current.addEventListener("message", (event) => {
      if (failed || stopped || typeof event.data !== "string") return;
      if (event.data === "kaioken:pong") {
        lastMessageAt = Date.now();
        return;
      }
      try {
        const message = eventSchema.parse(JSON.parse(event.data));
        if (message.type === "revoked") {
          disconnected(true);
          return;
        }
        clearTimeout(deadline);
        lastMessageAt = Date.now();
        connectedAt ??= lastMessageAt;
        args.onSnapshot({
          servers: withAccountServerUrls(message.servers, args.credential),
          selfHandle: args.credential.handle,
        });
      } catch {
        disconnected();
      }
    });
    current.addEventListener("close", (event) =>
      disconnected(event.code === 4001),
    );
    current.addEventListener("error", () => disconnected());
  }

  connect();
  return () => {
    stopped = true;
    clearTimers();
    clearTimeout(retry);
    socket?.close();
    socket = null;
  };
}
