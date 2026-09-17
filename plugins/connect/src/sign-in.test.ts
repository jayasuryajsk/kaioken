import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectCredential } from "@kaioken/connect-client";
import { ConnectSignIn } from "./sign-in.js";
import {
  clearPrivateState,
  readPrivateState,
  writePrivateState,
} from "./private-state.js";
import { connectCredentialSchema } from "@kaioken/connect-client";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "kaioken-sign-in-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "pending.json");
  const credentialPath = join(directory, "credential.json");
  let phase = "pending";
  let completeCalls = 0;
  let failComplete = false;
  let releaseComplete: (() => void) | null = null;
  let holdComplete = false;
  const requests: { path: string; body: string; proof: string | undefined }[] =
    [];
  const sockets = new WebSocketServer({ noServer: true });
  let origin = "";
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const proof = request.headers["x-kaioken-login-proof"];
    requests.push({
      path: request.url!,
      body,
      proof: typeof proof === "string" ? proof : undefined,
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/connect/login")
      response.end(
        JSON.stringify({
          id: "a".repeat(32),
          browserUrl: `${origin}/auth/github?login=${"a".repeat(32)}`,
          expiresAt: Date.now() + 600_000,
        }),
      );
    else if (request.url?.endsWith("/complete")) {
      completeCalls += 1;
      if (holdComplete)
        await new Promise<void>((resolve) => {
          releaseComplete = resolve;
        });
      if (failComplete) {
        failComplete = false;
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "Try again" }));
      } else
        response.end(
          JSON.stringify({
            handle: "studio",
            name: "Mac Studio",
            serverUrl: origin,
            account: { githubId: "42", login: "owner" },
          }),
        );
    } else response.end(JSON.stringify({ ok: true }));
  });
  server.on("upgrade", (request, socket, head) =>
    sockets.handleUpgrade(request, socket, head, (client) => {
      client.send(JSON.stringify({ phase }));
      client.on("message", (data) => {
        if (data.toString() === "kaioken:ping") client.send("kaioken:pong");
      });
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  origin = `http://127.0.0.1:${address.port}`;
  cleanup.push(async () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  let credential: ConnectCredential | null = null;
  const accept = vi.fn(async (value: ConnectCredential) => {
    await writePrivateState(credentialPath, value);
    credential = value;
  });
  const create = () => {
    const signIn = new ConnectSignIn({
      path,
      tunnel: {
        getCredential: () => credential,
        signInBaseUrl: () => origin,
        acceptAccountCredential: accept,
      },
      onChange: vi.fn(),
    });
    cleanup.push(async () => signIn.stop());
    return signIn;
  };
  return {
    create,
    path,
    credentialPath,
    requests,
    accept,
    origin,
    completeCalls: () => completeCalls,
    failNextComplete: () => {
      failComplete = true;
    },
    hold: () => {
      holdComplete = true;
    },
    release: () => {
      releaseComplete?.();
    },
    approve: () => {
      phase = "approved";
      for (const socket of sockets.clients)
        socket.send(JSON.stringify({ phase }));
    },
    waitForSocket: () =>
      vi.waitFor(() => expect(sockets.clients.size).toBeGreaterThan(0)),
  };
}

describe("account sign-in lifecycle", () => {
  it("resumes a pending sign-in after restart, receives approval, and persists a private device credential", async () => {
    const f = await fixture();
    const initial = f.create();
    const result = await initial.begin("Mac Studio");
    expect(result.state).toBe("waiting");
    const pending = JSON.parse(await readFile(f.path, "utf8"));
    expect(result.browserUrl).not.toContain(pending.proof);
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    initial.stop();
    const resumed = f.create();
    await resumed.resume();
    await f.waitForSocket();
    f.approve();
    await vi.waitFor(() => expect(resumed.status().state).toBe("signed-in"));
    expect(f.accept).toHaveBeenCalledExactlyOnceWith({
      credential: pending.proof,
      handle: "studio",
      serverUrl: f.origin,
      account: { githubId: "42", login: "owner" },
    });
    expect(f.completeCalls()).toBe(1);
    expect(
      await readPrivateState(f.credentialPath, connectCredentialSchema),
    ).toMatchObject({ credential: pending.proof });
    expect((await stat(f.credentialPath)).mode & 0o777).toBe(0o600);
    await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reconnects and completes after a temporary exchange failure without restarting GitHub authorization", async () => {
    const f = await fixture();
    const signIn = f.create();
    await signIn.begin();
    await f.waitForSocket();
    f.failNextComplete();
    f.approve();
    await vi.waitFor(() => expect(signIn.status().state).toBe("signed-in"), {
      timeout: 4000,
    });
    expect(
      f.requests.filter((request) => request.path === "/api/connect/login"),
    ).toHaveLength(1);
    expect(f.completeCalls()).toBe(2);
  });

  it("does not install credentials from a completion that arrives after cancellation", async () => {
    const f = await fixture();
    const signIn = f.create();
    await signIn.begin();
    await f.waitForSocket();
    f.hold();
    f.approve();
    await vi.waitFor(() => expect(f.completeCalls()).toBe(1));
    await signIn.cancel();
    f.release();
    await vi.waitFor(() =>
      expect(
        f.requests.some((request) => request.path.endsWith("/cancel")),
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(signIn.status().state).toBe("idle");
    expect(f.accept).not.toHaveBeenCalled();
    await clearPrivateState(f.path);
  });
});
