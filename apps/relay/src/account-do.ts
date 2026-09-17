import { z } from "zod";
import { AccountStorage } from "./account-storage.js";
import { accountCommandSchema } from "./account-store.js";
import { sha256Hex } from "./auth.js";
import { RelayStore, type ServerRecord } from "./store.js";
import { defaultHandle } from "./topology.js";
import type { Env } from "./tunnel-do.js";

const attachmentSchema = z.object({
  origin: z.string().url(),
  hash: z.string(),
  subject: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("server"), handle: z.string() }),
    z.object({ kind: z.literal("machine"), machineId: z.string() }),
  ]),
});
const presenceSchema = z.object({
  live: z.boolean(),
  lastSeenAt: z.number().nullable(),
});

export class AccountDO {
  private readonly storage: AccountStorage;
  private readonly store: RelayStore;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    this.storage = new AccountStorage(state.storage);
    this.store = new RelayStore(this.storage, defaultHandle(env));
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("kaioken:ping", "kaioken:pong"),
    );
    state.blockConcurrencyWhile(async () => {
      if (await state.storage.get<boolean>("imported")) return;
      let cursor: string | undefined;
      do {
        const page = await env.STATE.list({ ...(cursor ? { cursor } : {}) });
        for (const key of page.keys) {
          if (
            key.name !== "server" &&
            !/^(server|machine|token|code):/u.test(key.name)
          )
            continue;
          const value = await env.STATE.get(key.name);
          if (value !== null)
            await this.storage.put(
              key.name,
              value,
              key.expiration
                ? {
                    expirationTtl: Math.max(
                      1,
                      key.expiration - Math.floor(Date.now() / 1000),
                    ),
                  }
                : undefined,
            );
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      await this.store.listServers();
      await state.storage.put("imported", true);
    });
  }

  fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(() => this.route(request));
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/connect/u, "");
    if (path === "/command") {
      const command = accountCommandSchema.parse(await request.json());
      const result = await this.command(command);
      if (
        [
          "pairServer",
          "unpairServer",
          "removeMachine",
          "registerDevice",
          "cancelRegistration",
        ].includes(command.method)
      ) {
        await this.closeRevokedSubscribers();
        if (command.method !== "removeMachine") await this.publish();
      }
      return Response.json(result ?? null);
    }
    if (path === "/presence") {
      const { handle } = z
        .object({ handle: z.string() })
        .parse(await request.json());
      if (await this.store.getServer(handle)) await this.publish();
      return new Response(null, { status: 204 });
    }
    if (
      path !== "/events" &&
      path !== "/servers" &&
      !path.startsWith("/devices/")
    )
      return new Response(null, { status: 404 });
    const credential = request.headers.get("x-bb-connect-machine") ?? "";
    const subject = await this.store.resolveCredential(credential);
    if (!subject) return new Response(null, { status: 401 });
    if (path.startsWith("/devices/")) {
      if (subject.kind !== "server")
        return Response.json({ error: "unauthorized" }, { status: 403 });
      const handle = path.slice(9);
      if (!(await this.store.getServer(handle)))
        return Response.json({ error: "Device not found" }, { status: 404 });
      if (request.method === "PATCH") {
        const parsed = z
          .object({ name: z.string().trim().min(1).max(80) })
          .safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json(
            { error: "Enter a computer name" },
            { status: 400 },
          );
        await this.store.renameServer(handle, parsed.data.name);
      } else if (request.method === "DELETE") {
        await this.store.unpairServer(handle);
        await this.closeRevokedSubscribers();
        await this.env.TUNNEL_DO.get(
          this.env.TUNNEL_DO.idFromName(handle),
        ).fetch("https://tunnel/__control/close");
      } else return new Response(null, { status: 405 });
      await this.publish();
      return Response.json({ ok: true });
    }
    if (request.method !== "GET") return new Response(null, { status: 405 });
    if (path === "/servers")
      return Response.json(await this.snapshot(url.origin));
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response(null, { status: 426 });
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({
      origin: url.origin,
      hash: await sha256Hex(credential),
      subject,
    });
    pair[1].send(
      JSON.stringify({
        type: "snapshot",
        ...(await this.snapshot(url.origin)),
      }),
    );
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async snapshot(origin: string) {
    const servers = await this.store.listServers();
    return {
      servers: await Promise.all(
        servers.map(async ({ handle, name }) => {
          const stub = this.env.TUNNEL_DO.get(
            this.env.TUNNEL_DO.idFromName(handle),
          );
          const response = await stub.fetch("https://tunnel/__control/status");
          if (!response.ok) throw new Error("Tunnel status unavailable");
          const status = presenceSchema.parse(await response.json());
          return {
            handle,
            name,
            ...status,
            url: this.env.BASE_DOMAIN
              ? `${new URL(origin).protocol}//${handle}.${this.env.BASE_DOMAIN}`
              : origin,
          };
        }),
      ),
    };
  }

  private async broadcast(): Promise<void> {
    const sockets = this.state
      .getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN);
    if (sockets.length === 0) return;
    const first = attachmentSchema.parse(sockets[0]!.deserializeAttachment());
    const payload = JSON.stringify({
      type: "snapshot",
      ...(await this.snapshot(first.origin)),
    });
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "discovery unavailable");
      }
    }
  }

  private async retrySoon(): Promise<void> {
    const alarm = await this.state.storage.getAlarm();
    const retryAt = Date.now() + 5_000;
    if (alarm === null || alarm > retryAt)
      await this.state.storage.setAlarm(retryAt);
  }

  private async publish(): Promise<void> {
    try {
      await this.broadcast();
      await this.state.storage.delete("broadcastPending");
    } catch {
      await this.state.storage.put("broadcastPending", true);
      await this.retrySoon();
    }
  }

  private async closeMachineStreams(machineId: string): Promise<void> {
    await this.state.storage.put(`revocation:${machineId}`, true);
    try {
      for (const server of await this.store.listServers()) {
        const url = new URL("https://tunnel/__control/revoke-machine");
        url.searchParams.set("machineId", machineId);
        const response = await this.env.TUNNEL_DO.get(
          this.env.TUNNEL_DO.idFromName(server.handle),
        ).fetch(url);
        if (!response.ok) throw new Error("Revocation notification failed");
      }
      await this.state.storage.delete(`revocation:${machineId}`);
    } catch {
      await this.retrySoon();
    }
  }

  private async closeRevokedSubscribers(): Promise<void> {
    for (const socket of this.state.getWebSockets()) {
      const parsed = attachmentSchema.safeParse(socket.deserializeAttachment());
      if (!parsed.success) {
        socket.close(4001, "unauthorized");
        continue;
      }
      const { subject, hash } = parsed.data;
      const valid =
        subject.kind === "server"
          ? (await this.store.getServer(subject.handle))?.credentialHash ===
            hash
          : await this.store.machineExists(subject.machineId);
      if (!valid && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "revoked" }));
        socket.close(4001, "revoked");
      }
    }
  }

  private async command(command: z.infer<typeof accountCommandSchema>) {
    switch (command.method) {
      case "registerDevice": {
        const [name, hash, previous] = command.args;
        return this.state.storage.transaction(async (transaction) => {
          const storage = new AccountStorage(transaction);
          const store = new RelayStore(storage, defaultHandle(this.env));
          const receipt = await storage.get<ServerRecord>(
            `registration:${hash}`,
            "json",
          );
          if (receipt)
            return (await store.getServer(receipt.handle))?.credentialHash ===
              hash
              ? receipt
              : null;
          let handle =
            previous &&
            (await store.getServer(previous.handle))?.credentialHash ===
              previous.hash
              ? previous.handle
              : null;
          if (!handle) {
            const slug =
              name
                .toLowerCase()
                .replace(/[^a-z0-9]+/gu, "-")
                .replace(/^-+|-+$/gu, "")
                .slice(0, 20) || "computer";
            do {
              handle = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
            } while (await store.getServer(handle));
          }
          const server = await store.pairServerWithHash(handle, name, hash);
          await storage.put(`registration:${hash}`, JSON.stringify(server), {
            expirationTtl: 660,
          });
          return server;
        });
      }
      case "cancelRegistration": {
        const [hash] = command.args;
        const receipt = await this.storage.get<ServerRecord>(
          `registration:${hash}`,
          "json",
        );
        if (
          !receipt ||
          (await this.store.getServer(receipt.handle))?.credentialHash !== hash
        )
          return null;
        await this.store.unpairServer(receipt.handle);
        return receipt.handle;
      }
      case "getServer":
        return this.store.getServer(...command.args);
      case "listServers":
        return this.store.listServers();
      case "pairServer":
        return this.store.pairServer(...command.args);
      case "unpairServer":
        return this.store.unpairServer(...command.args);
      case "createMachineCode":
        return this.store.createMachineCode(...command.args);
      case "consumeMachineCode":
        return this.store.consumeMachineCode(...command.args);
      case "addMachine":
        return this.store.addMachine(...command.args);
      case "removeMachine": {
        const removed = await this.store.removeMachine(...command.args);
        if (removed) await this.closeMachineStreams(command.args[0]);
        return removed;
      }
      case "machineExists":
        return this.store.machineExists(...command.args);
      case "resolveCredential":
        return this.store.resolveCredential(...command.args);
    }
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      await this.storage.expireEphemeralRecords();
      for (const key of (
        await this.state.storage.list({ prefix: "revocation:" })
      ).keys())
        await this.closeMachineStreams(key.slice(11));
      if (await this.state.storage.get("broadcastPending"))
        await this.publish();
    });
  }
  webSocketMessage(socket: WebSocket): void {
    socket.close(1008, "read-only subscription");
  }
  webSocketClose(socket: WebSocket): void {
    socket.close(1000, "closed");
  }
  webSocketError(socket: WebSocket): void {
    socket.close(1011, "socket error");
  }
}
