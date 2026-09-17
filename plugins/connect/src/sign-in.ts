import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { WebSocket } from "ws";
import { z } from "zod";
import {
  connectLoginStartSchema,
  connectLoginDeviceSchema,
  connectLoginRequest,
  deriveConnectBaseUrl,
  type ConnectLoginStatus,
} from "@kaioken/connect-client";
import type { ConnectTunnel } from "./tunnel.js";
import {
  clearPrivateState,
  readPrivateState,
  writePrivateState,
} from "./private-state.js";

const pendingSchema = connectLoginStartSchema.extend({
  baseUrl: z.string().url(),
  proof: z.string().regex(/^bbcred_[A-Za-z0-9_-]{43}$/u),
});
type Pending = z.infer<typeof pendingSchema>;
const phaseSchema = z.object({
  phase: z.enum(["pending", "authorizing", "approved", "complete", "denied"]),
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class ConnectSignIn {
  private pending: Pending | null = null;
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private attempts = 0;
  private error: string | null = null;
  private epoch = 0;
  private completing = false;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      tunnel: Pick<
        ConnectTunnel,
        "getCredential" | "signInBaseUrl" | "acceptAccountCredential"
      >;
      path: string;
      onChange: (status: ConnectLoginStatus) => void;
    },
  ) {}

  status(): ConnectLoginStatus {
    const account = this.options.tunnel.getCredential()?.account ?? null;
    return {
      state: this.pending
        ? "waiting"
        : this.error
          ? "error"
          : account
            ? "signed-in"
            : "idle",
      browserUrl: this.pending?.browserUrl ?? null,
      expiresAt: this.pending?.expiresAt ?? null,
      error: this.error,
      account,
    };
  }
  private publish() {
    this.options.onChange(this.status());
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.operation.then(action, action);
    this.operation = next.catch(() => undefined);
    return next;
  }
  async resume(): Promise<void> {
    await this.serialize(async () => {
      this.pending = await readPrivateState(this.options.path, pendingSchema);
      if (this.pending && this.pending.expiresAt <= Date.now()) {
        this.pending = null;
        await clearPrivateState(this.options.path);
      }
      if (this.pending) this.watch();
      this.publish();
    });
  }
  begin(
    name = hostname().replace(/\.local$/u, ""),
  ): Promise<ConnectLoginStatus> {
    return this.serialize(async () => {
      await this.cancelPending();
      const baseUrl = this.options.tunnel.signInBaseUrl();
      const previous = this.options.tunnel.getCredential();
      const proof = `bbcred_${randomBytes(32).toString("base64url")}`;
      const started = await connectLoginRequest(
        baseUrl,
        "/api/connect/login",
        connectLoginStartSchema,
        {
          name,
          challenge: hash(proof),
          previous:
            previous &&
            deriveConnectBaseUrl(previous.serverUrl) === new URL(baseUrl).origin
              ? { handle: previous.handle, hash: hash(previous.credential) }
              : null,
        },
      );
      if (new URL(started.browserUrl).origin !== new URL(baseUrl).origin)
        throw new Error("Unexpected sign-in origin");
      const pending = { ...started, baseUrl, proof };
      await writePrivateState(this.options.path, pending);
      this.pending = pending;
      this.error = null;
      this.attempts = 0;
      this.watch();
      this.publish();
      return this.status();
    });
  }
  cancel(): Promise<ConnectLoginStatus> {
    return this.serialize(async () => {
      await this.cancelPending();
      this.error = null;
      this.publish();
      return this.status();
    });
  }
  private async cancelPending(): Promise<void> {
    const pending = this.pending;
    this.stop();
    this.pending = null;
    await clearPrivateState(this.options.path);
    if (pending)
      await connectLoginRequest(
        pending.baseUrl,
        `/api/connect/login/${pending.id}/cancel`,
        z.object({ ok: z.literal(true) }),
        null,
        pending.proof,
      ).catch(() => undefined);
  }
  stop(): void {
    this.epoch += 1;
    clearTimeout(this.retry);
    clearTimeout(this.expiry);
    clearInterval(this.heartbeat);
    this.socket?.terminate();
    this.socket = null;
  }
  private watch(): void {
    this.stop();
    const pending = this.pending;
    if (!pending) return;
    const epoch = this.epoch;
    this.expiry = setTimeout(
      () => {
        void this.fail("Sign-in expired. Try again.", epoch);
      },
      Math.max(1, pending.expiresAt - Date.now()),
    );
    this.expiry.unref();
    const url = new URL(
      `/api/connect/login/${pending.id}/events`,
      pending.baseUrl,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, {
      headers: { "x-kaioken-login-proof": pending.proof },
      handshakeTimeout: 15_000,
    });
    this.socket = socket;
    let failed = false;
    let lastMessage = Date.now();
    const retry = () => {
      if (failed || epoch !== this.epoch) return;
      failed = true;
      clearInterval(this.heartbeat);
      socket.terminate();
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5));
      this.retry = setTimeout(
        () => this.watch(),
        delay + Math.random() * delay * 0.2,
      );
      this.retry.unref();
    };
    socket.on("open", () => {
      if (epoch !== this.epoch) return;
      this.heartbeat = setInterval(() => {
        if (Date.now() - lastMessage > 65_000) {
          retry();
          return;
        }
        try {
          socket.send("kaioken:ping");
        } catch {
          retry();
        }
      }, 30_000);
      this.heartbeat.unref();
    });
    socket.on("message", (data) => {
      if (failed || epoch !== this.epoch) return;
      lastMessage = Date.now();
      if (data.toString() === "kaioken:pong") return;
      let event;
      try {
        event = phaseSchema.parse(JSON.parse(data.toString()));
      } catch {
        retry();
        return;
      }
      if (event.phase === "denied") {
        void this.fail(
          "Sign-in was denied. Use the configured GitHub account and try again.",
          epoch,
        );
        return;
      }
      if (event.phase === "approved" || event.phase === "complete") {
        void this.finish(pending, epoch).catch(() => {
          if (epoch === this.epoch) retry();
        });
      }
    });
    socket.on("error", retry);
    socket.on("close", retry);
    socket.on("unexpected-response", (_request, response) => {
      response.resume();
      if (
        response.statusCode === 401 ||
        response.statusCode === 403 ||
        response.statusCode === 410
      )
        void this.fail("Sign-in expired or was cancelled. Try again.", epoch);
      else retry();
    });
  }
  private async finish(pending: Pending, epoch: number): Promise<void> {
    if (this.completing) return;
    this.completing = true;
    try {
      const device = await connectLoginRequest(
        pending.baseUrl,
        `/api/connect/login/${pending.id}/complete`,
        connectLoginDeviceSchema,
        null,
        pending.proof,
      );
      await this.serialize(async () => {
        if (epoch !== this.epoch || this.pending !== pending) return;
        await this.options.tunnel.acceptAccountCredential({
          credential: pending.proof,
          handle: device.handle,
          serverUrl: device.serverUrl,
          account: device.account,
        });
        this.stop();
        this.pending = null;
        this.error = null;
        await clearPrivateState(this.options.path);
        this.publish();
      });
    } finally {
      this.completing = false;
    }
  }
  private fail(message: string, epoch: number): Promise<void> {
    return this.serialize(async () => {
      if (epoch !== this.epoch) return;
      this.stop();
      this.pending = null;
      this.error = message;
      await clearPrivateState(this.options.path);
      this.publish();
    });
  }
}
