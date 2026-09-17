import { z } from "zod";
import {
  connectAccountSchema,
  connectLoginDeviceSchema,
  type ConnectAccount,
} from "@kaioken/connect-client";
import { AccountStore } from "./account-store.js";
import {
  constantTimeEqual,
  parseCookie,
  randomToken,
  sha256Hex,
} from "./auth.js";
import type { Env } from "./tunnel-do.js";

export const LOGIN_TTL_MS = 10 * 60_000;
export const loginIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/u);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const loginInputSchema = z.object({
  challenge: hashSchema,
  name: z.string().trim().min(1).max(80),
  previous: z
    .object({ handle: z.string().min(1), hash: hashSchema })
    .nullable(),
});
const startSchema = loginInputSchema.extend({
  id: loginIdSchema,
  origin: z.string().url(),
});
const recordSchema = startSchema.extend({
  expiresAt: z.number(),
  phase: z.enum(["pending", "authorizing", "approved", "denied", "complete"]),
  browserHash: z.string().nullable(),
  oauthState: z.string().nullable(),
  oauthVerifier: z.string().nullable(),
  account: connectAccountSchema.nullable(),
  device: connectLoginDeviceSchema.nullable(),
});
type LoginRecord = z.infer<typeof recordSchema>;

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
function page(
  title: string,
  body: string,
  status = 200,
  cookie?: string,
): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Kaioken</title><style>body{font:16px system-ui;--canvas:#171717;--ink:#eee;background:var(--canvas);color:var(--ink);max-width:440px;margin:15vh auto;padding:24px;line-height:1.6}h1{font-size:28px;line-height:1.2}button,a{font:inherit}button{background:var(--ink);color:var(--canvas);border:0;border-radius:8px;padding:12px 20px;cursor:pointer}p{color:color-mix(in oklab,var(--ink) 75%,transparent)}small{color:color-mix(in oklab,var(--ink) 65%,transparent)}</style><body><small>Kaioken</small><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        ...(cookie ? { "set-cookie": cookie } : {}),
      },
    },
  );
}
const errorResponse = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );

export class LoginDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("kaioken:ping", "kaioken:pong"),
    );
  }

  fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(() => this.route(request));
  }

  private async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/start" && request.method === "POST") {
      if (await this.state.storage.get("login"))
        return errorResponse("Sign-in already started", 409);
      const parsed = startSchema.safeParse(await request.json());
      if (!parsed.success) return errorResponse("Invalid sign-in request", 400);
      const record: LoginRecord = {
        ...parsed.data,
        expiresAt: Date.now() + LOGIN_TTL_MS,
        phase: "pending",
        browserHash: null,
        oauthState: null,
        oauthVerifier: null,
        account: null,
        device: null,
      };
      await this.save(record);
      await this.state.storage.setAlarm(record.expiresAt);
      return Response.json(
        {
          id: record.id,
          browserUrl: `${record.origin}/auth/github?login=${record.id}`,
          expiresAt: record.expiresAt,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const parsed = recordSchema.safeParse(
      await this.state.storage.get("login"),
    );
    if (!parsed.success || parsed.data.expiresAt <= Date.now())
      return path === "/browser" || path === "/callback"
        ? page(
            "Sign-in expired",
            "<p>Return to Kaioken and start sign-in again.</p>",
            410,
          )
        : errorResponse("Sign-in expired. Start sign-in again.", 410);
    const record = parsed.data;
    if (path === "/browser") return this.browser(request, record);
    if (path === "/callback") return this.callback(request, record);
    const proof = request.headers.get("x-kaioken-login-proof") ?? "";
    if (
      !/^bbcred_[A-Za-z0-9_-]{43}$/u.test(proof) ||
      !constantTimeEqual(await sha256Hex(proof), record.challenge)
    )
      return errorResponse("Unauthorized sign-in request", 401);
    if (path === "/cancel" && request.method === "POST") {
      const handle = await new AccountStore(this.env).cancelRegistration(
        record.challenge,
      );
      if (handle)
        await this.env.TUNNEL_DO.get(
          this.env.TUNNEL_DO.idFromName(handle),
        ).fetch("https://tunnel/__control/close");
      record.phase = "denied";
      record.oauthVerifier = null;
      await this.save(record);
      this.notify(record);
      return Response.json({ ok: true });
    }
    if (path === "/events" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
        return errorResponse("Expected WebSocket", 426);
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ phase: record.phase }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === "/complete" && request.method === "POST") {
      if (record.phase === "denied")
        return errorResponse(
          "Sign-in was denied. Try again with the configured GitHub account.",
          403,
        );
      if (
        (record.phase !== "approved" && record.phase !== "complete") ||
        !record.account
      )
        return errorResponse("Sign-in is still waiting for approval", 409);
      const store = new AccountStore(this.env);
      if (!record.device) {
        const server = await store.registerDevice(
          record.name,
          record.challenge,
          record.previous,
        );
        if (!server)
          return errorResponse(
            "Device access was revoked. Start sign-in again.",
            410,
          );
        record.device = {
          handle: server.handle,
          name: server.name,
          account: record.account,
          serverUrl: this.env.BASE_DOMAIN
            ? `https://${server.handle}.${this.env.BASE_DOMAIN}`
            : record.origin,
        };
        record.phase = "complete";
        await this.save(record);
      } else if (
        (await store.getServer(record.device.handle))?.credentialHash !==
        record.challenge
      )
        return errorResponse(
          "Device access was revoked. Start sign-in again.",
          410,
        );
      return Response.json(record.device, {
        headers: { "cache-control": "no-store" },
      });
    }
    return errorResponse("Not found", 404);
  }

  private save(record: LoginRecord) {
    return this.state.storage.put("login", record);
  }
  private cookieName(record: LoginRecord) {
    return `__Host-kaioken-login-${record.id}`;
  }
  private async browserMatches(
    request: Request,
    record: LoginRecord,
  ): Promise<boolean> {
    const cookie = parseCookie(
      request.headers.get("cookie"),
      this.cookieName(record),
    );
    return (
      !!cookie &&
      record.browserHash !== null &&
      constantTimeEqual(await sha256Hex(cookie), record.browserHash)
    );
  }

  private async browser(
    request: Request,
    record: LoginRecord,
  ): Promise<Response> {
    if (record.phase !== "pending")
      return page(
        "Sign-in already started",
        "<p>Finish the GitHub sign-in in your original browser tab, or return to Kaioken to start again.</p>",
        409,
      );
    if (request.method === "GET") {
      let token = parseCookie(
        request.headers.get("cookie"),
        this.cookieName(record),
      );
      if (
        record.browserHash !== null &&
        !(await this.browserMatches(request, record))
      )
        return page(
          "Use your original browser",
          "<p>This sign-in is already open in another browser. Start again from Kaioken to switch browsers.</p>",
          409,
        );
      token ??= randomToken("");
      record.browserHash = await sha256Hex(token);
      await this.save(record);
      return page(
        `Connect ${record.name}`,
        `<p>Sign in with GitHub to add this computer to your Kaioken account. Your other signed-in computers will be able to open its projects and run tasks here.</p><form method="post" action="/auth/github?login=${record.id}"><input type="hidden" name="csrf" value="${escapeHtml(token)}"><button type="submit">Continue with GitHub</button></form><p>Only continue if you started this sign-in in Kaioken on this computer.</p>`,
        200,
        `${this.cookieName(record)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      );
    }
    if (
      request.method !== "POST" ||
      !(await this.browserMatches(request, record))
    )
      return errorResponse("Invalid browser session", 403);
    const body = await request.formData();
    const csrf = body.get("csrf");
    if (
      typeof csrf !== "string" ||
      !constantTimeEqual(await sha256Hex(csrf), record.browserHash!)
    )
      return errorResponse("Invalid browser session", 403);
    record.oauthState = randomToken("");
    record.oauthVerifier = randomToken("", 32);
    record.phase = "authorizing";
    await this.save(record);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(record.oauthVerifier),
    );
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, "");
    const github = new URL("https://github.com/login/oauth/authorize");
    github.search = new URLSearchParams({
      client_id: this.env.GITHUB_CLIENT_ID!,
      redirect_uri: `${record.origin}/auth/github/callback`,
      state: `${record.id}.${record.oauthState}`,
      code_challenge: challenge,
      code_challenge_method: "S256",
      allow_signup: "false",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        location: github.href,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  private async callback(
    request: Request,
    record: LoginRecord,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== "GET" ||
      record.phase !== "authorizing" ||
      !record.oauthState ||
      !record.oauthVerifier ||
      !constantTimeEqual(
        url.searchParams.get("state") ?? "",
        `${record.id}.${record.oauthState}`,
      ) ||
      !(await this.browserMatches(request, record))
    )
      return page(
        "Sign-in could not be verified",
        "<p>Return to Kaioken and start sign-in again.</p>",
        403,
      );
    const verifier = record.oauthVerifier;
    record.oauthState = null;
    record.oauthVerifier = null;
    record.phase = "denied";
    await this.save(record);
    const code = url.searchParams.get("code");
    if (code && !url.searchParams.has("error")) {
      try {
        const response = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              client_id: this.env.GITHUB_CLIENT_ID,
              client_secret: this.env.GITHUB_CLIENT_SECRET,
              code,
              redirect_uri: `${record.origin}/auth/github/callback`,
              code_verifier: verifier,
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) throw new Error("GitHub token exchange failed");
        const token = z
          .object({ access_token: z.string().min(1), token_type: z.string() })
          .parse(await response.json());
        const userResponse = await fetch("https://api.github.com/user", {
          headers: {
            authorization: `Bearer ${token.access_token}`,
            accept: "application/vnd.github+json",
            "user-agent": "Kaioken",
            "x-github-api-version": "2022-11-28",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!userResponse.ok) throw new Error("GitHub profile unavailable");
        const user = z
          .object({ id: z.number().int().positive(), login: z.string().min(1) })
          .parse(await userResponse.json());
        if (String(user.id) === this.env.GITHUB_ALLOWED_USER_ID) {
          const account: ConnectAccount = {
            githubId: String(user.id),
            login: user.login,
          };
          record.account = account;
          record.phase = "approved";
        }
      } catch {}
    }
    await this.save(record);
    this.notify(record);
    return record.phase === "approved"
      ? page(
          "You're signed in",
          `<p>Return to Kaioken on <strong>${escapeHtml(record.name)}</strong>. It will finish connecting automatically.</p><a href="kaioken://account/signed-in">Open Kaioken</a>`,
        )
      : page(
          "This account could not sign in",
          "<p>Use the GitHub account configured for this Kaioken service. If GitHub was unavailable, start sign-in again from Kaioken.</p>",
          403,
        );
  }

  private notify(record: LoginRecord): void {
    for (const socket of this.state.getWebSockets()) {
      try {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ phase: record.phase }));
      } catch {
        socket.close(1011, "Reconnect to resume sign-in");
      }
    }
  }
  async alarm(): Promise<void> {
    for (const socket of this.state.getWebSockets())
      socket.close(4001, "Sign-in expired");
    await this.state.storage.deleteAll();
  }
  webSocketMessage(socket: WebSocket): void {
    socket.close(1008, "Read-only sign-in");
  }
  webSocketClose(socket: WebSocket): void {
    socket.close(1000);
  }
  webSocketError(socket: WebSocket): void {
    socket.close(1011);
  }
}
