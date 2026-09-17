import { afterEach, describe, expect, it, vi } from "vitest";
import {
  subscribeAccountServers,
  type AccountEventSocket,
} from "../src/account-events.js";

class Socket implements AccountEventSocket {
  private listeners = new Map<
    string,
    ((event: { data: unknown; code: number }) => void)[]
  >();
  sent: string[] = [];
  closed = false;
  addEventListener(
    type: string,
    listener: (event: { data: unknown; code: number }) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type: string, data: unknown = null, code = 1006) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data, code });
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

const snapshot = JSON.stringify({
  type: "snapshot",
  servers: [{ handle: "book", name: "MacBook", live: true }],
});

function fixture() {
  const sockets: Socket[] = [];
  const onSnapshot = vi.fn();
  const onDisconnected = vi.fn();
  const onRevoked = vi.fn();
  let rejectHandshake: (status: number) => void = () => undefined;
  const stop = subscribeAccountServers({
    credential: {
      serverUrl: "https://studio.kaioken.app",
      handle: "studio",
      credential: "test-credential",
    },
    createSocket: (url, headers, onRejected) => {
      rejectHandshake = onRejected;
      expect(url).toBe("wss://studio.kaioken.app/api/connect/events");
      expect(headers).toEqual({ "x-bb-connect-machine": "test-credential" });
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
    onSnapshot,
    onDisconnected,
    onRevoked,
  });
  return {
    sockets,
    onSnapshot,
    onDisconnected,
    onRevoked,
    stop,
    rejectHandshake: (status: number) => rejectHandshake(status),
  };
}

describe("account discovery subscription", () => {
  afterEach(() => vi.useRealTimers());

  it("resynchronizes after disconnect, ignores replaced sockets, and stops reconnecting on disposal", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.sockets[0]!.emit("open");
      f.sockets[0]!.emit("message", snapshot);
      expect(f.onSnapshot).toHaveBeenLastCalledWith({
        selfHandle: "studio",
        servers: [
          {
            handle: "book",
            name: "MacBook",
            live: true,
            url: "https://book.kaioken.app",
          },
        ],
      });
      f.sockets[0]!.emit("close");
      f.sockets[0]!.emit("error");
      expect(f.onDisconnected).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1300);
      expect(f.sockets).toHaveLength(2);
      f.sockets[0]!.emit("message", snapshot);
      expect(f.onSnapshot).toHaveBeenCalledTimes(1);
      f.sockets[1]!.emit("open");
      f.sockets[1]!.emit("message", snapshot);
      expect(f.onSnapshot).toHaveBeenCalledTimes(2);
      f.stop();
      f.sockets[1]!.emit("close");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(f.sockets).toHaveLength(2);
    } finally {
      f.stop();
    }
  });

  it("keeps idle connections alive without requesting directory snapshots", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      const socket = f.sockets[0]!;
      socket.emit("open");
      socket.emit("message", snapshot);
      for (let i = 0; i < 20; i += 1) {
        await vi.advanceTimersByTimeAsync(30_000);
        socket.emit("message", "kaioken:pong");
      }
      expect(f.sockets).toHaveLength(1);
      expect(f.onSnapshot).toHaveBeenCalledTimes(1);
      expect(socket.sent).toEqual(Array(20).fill("kaioken:ping"));
    } finally {
      f.stop();
    }
  });

  it("detects missing heartbeats and retries without accepting stale messages", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.sockets[0]!.emit("open");
      f.sockets[0]!.emit("message", snapshot);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(f.onDisconnected).toHaveBeenCalledTimes(1);
      expect(f.sockets[0]!.closed).toBe(true);
    } finally {
      f.stop();
    }
  });

  it("does not retry revoked access", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.sockets[0]!.emit("close", null, 4001);
      expect(f.onRevoked).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(f.sockets).toHaveLength(1);
    } finally {
      f.stop();
    }
  });

  it("stops immediately on a revocation message even before the close handshake finishes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.sockets[0]!.emit("message", JSON.stringify({ type: "revoked" }));
      expect(f.onRevoked).toHaveBeenCalledOnce();
      expect(f.sockets[0]!.closed).toBe(true);
      f.sockets[0]!.emit("message", snapshot);
      expect(f.onSnapshot).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(f.sockets).toHaveLength(1);
    } finally {
      f.stop();
    }
  });

  it("bounds opening time and retries malformed snapshots", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(f.sockets[0]!.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(1300);
      f.sockets[1]!.emit(
        "message",
        JSON.stringify({ type: "snapshot", servers: [{ handle: "book" }] }),
      );
      expect(f.onSnapshot).not.toHaveBeenCalled();
      expect(f.onDisconnected).toHaveBeenCalledTimes(2);
    } finally {
      f.stop();
    }
  });

  it("stops when credentials are rejected during the handshake but retries an outage", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.rejectHandshake(503);
      await vi.advanceTimersByTimeAsync(1300);
      expect(f.sockets).toHaveLength(2);
      f.rejectHandshake(401);
      expect(f.onRevoked).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(f.sockets).toHaveLength(2);
    } finally {
      f.stop();
    }
  });
});
