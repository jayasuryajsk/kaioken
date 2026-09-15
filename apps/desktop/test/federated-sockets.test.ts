import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createFederatedSockets } from "../src/federated-sockets.js";

function fixture(prepare = async () => {}) {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    terminate: vi.fn(),
  });
  const createSocket = vi.fn(() => socket);
  const cookieHeader = vi.fn(async () => "session=test");
  const connections = createFederatedSockets({
    prepare,
    createSocket,
    cookieHeader,
    listServers: () => [{ url: "https://mini.example.com" }],
  });
  return { connections, socket, createSocket, cookieHeader };
}

describe("desktop connected realtime", () => {
  it("uses the authenticated session and isolates a connection by its owning frame", async () => {
    const { connections, socket, createSocket } = fixture();
    const events = vi.fn();
    await connections.open(
      "window-1:frame-1",
      "socket",
      "wss://mini.example.com/ws",
      events,
    );
    expect(createSocket).toHaveBeenCalledWith(
      "wss://mini.example.com/ws",
      "session=test",
    );
    socket.emit("open");
    socket.emit("message", Buffer.from("update"));
    expect(events.mock.calls.map(([event]) => event)).toEqual([
      { id: "socket", type: "open" },
      { id: "socket", type: "message", data: "update" },
    ]);
    connections.send("window-2:frame-1", "socket", "wrong owner");
    connections.closeOwner("window-2:frame-1");
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
    connections.send("window-1:frame-1", "socket", "subscribe");
    expect(socket.send).toHaveBeenCalledWith("subscribe");
    connections.closeOwner("window-1:frame-1");
    expect(socket.terminate).toHaveBeenCalledOnce();
    socket.emit("message", Buffer.from("late update"));
    expect(events).toHaveBeenCalledTimes(2);
  });

  it("rejects an undiscovered origin before reading cookies", async () => {
    const { connections, cookieHeader, createSocket } = fixture();
    await expect(
      connections.open(
        "owner",
        "socket",
        "wss://other.example.com/ws",
        vi.fn(),
      ),
    ).rejects.toThrow("not a known computer");
    expect(cookieHeader).not.toHaveBeenCalled();
    expect(createSocket).not.toHaveBeenCalled();
  });

  it("does not open a socket when its frame closes during authentication", async () => {
    let finish: () => void = () => {};
    const { connections, createSocket } = fixture(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = connections.open(
      "owner",
      "socket",
      "wss://mini.example.com/ws",
      vi.fn(),
    );
    connections.closeOwner("owner");
    finish();
    await pending;
    expect(createSocket).not.toHaveBeenCalled();
  });
});
