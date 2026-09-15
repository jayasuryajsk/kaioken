import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  discoverSshAliases,
  sshConfigEntries,
  sshErrorMessage,
  SshConnections,
} from "./ssh-connections.js";

describe("SSH connection discovery", () => {
  it("finds concrete aliases across includes and stops include cycles", async () => {
    const home = await mkdtemp(join(tmpdir(), "kaioken-ssh-test-"));
    try {
      await mkdir(join(home, ".ssh/conf.d"), { recursive: true });
      await writeFile(
        join(home, ".ssh/config"),
        'Host studio build-? !excluded *\nInclude "conf.d/*.conf"\n',
      );
      await writeFile(
        join(home, ".ssh/conf.d/remote.conf"),
        "Host=work mini # comment\nInclude config\nHostName=private.example\n",
      );
      expect(await discoverSshAliases(home)).toEqual([
        "mini",
        "studio",
        "work",
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it("does not treat options, patterns, hostnames or comments as selectable hosts", () => {
    expect(
      sshConfigEntries(
        "Host good -oProxyCommand=bad *.prod !foo # hidden\nHostName target\n",
      ),
    ).toEqual({ hosts: ["good"], includes: [] });
    expect(sshErrorMessage("Host key verification failed")).toContain(
      "Verify this computer",
    );
    expect(sshErrorMessage("Permission denied (publickey)")).toContain(
      "Unlock your SSH key",
    );
  });
  it("rejects connections after shutdown without launching SSH", async () => {
    const manager = new SshConnections("/unused-test-path");
    manager.close();
    await expect(
      manager.connect({
        alias: "work",
        remotePort: 38886,
        startupCommand: "true",
      }),
    ).rejects.toThrow("closed");
  });
});

describe("SSH connection lifecycle", () => {
  it("forwards binary API traffic only through a ready tunnel and strips controller credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kaioken-ssh-http-"));
    const received: {
      path: string | undefined;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push({
        path: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      if (request.url === "/api/v1/redirect") {
        response.writeHead(302, { location: "/outside" }).end();
        return;
      }
      response
        .writeHead(201, {
          "content-type": "application/octet-stream",
          "set-cookie": "private=value",
        })
        .end(Buffer.from([0, 255, 128, 10]));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing test port");
    const runtime = {
      bootstrap: async () => {},
      forward: () => {
        const child = new ChildProcess();
        vi.spyOn(child, "kill").mockReturnValue(true);
        return child;
      },
      check: async () => true,
      port: async () => address.port,
    };
    const manager = new SshConnections(directory, runtime);
    const input = {
      alias: "work",
      path: "/api/v1/upload",
      method: "POST" as const,
      headers: {
        authorization: "controller-secret",
        cookie: "controller=value",
        "x-kaioken-server-id": "expected-installation",
        "content-type": "application/octet-stream",
      },
      body: Buffer.from([255, 0, 13, 10]).toString("base64"),
    };
    try {
      await expect(manager.request(input)).rejects.toThrow("unavailable");
      await manager.connect({
        alias: "work",
        remotePort: 38886,
        startupCommand: "start-runtime",
      });
      await vi.waitFor(async () =>
        expect((await manager.list()).connections[0]?.state).toBe("ready"),
      );
      const response = await manager.request(input);
      expect(response.status).toBe(201);
      expect(Buffer.from(response.body, "base64")).toEqual(
        Buffer.from([0, 255, 128, 10]),
      );
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(received[0]?.body).toEqual(Buffer.from([255, 0, 13, 10]));
      expect(received[0]?.headers.authorization).toBeUndefined();
      expect(received[0]?.headers.cookie).toBeUndefined();
      expect(received[0]?.headers["x-kaioken-server-id"]).toBe(
        "expected-installation",
      );
      await expect(
        manager.request({
          ...input,
          path: "http://other.invalid/api/v1/upload",
        }),
      ).rejects.toThrow("connected Kaioken API");
      await expect(
        manager.request({ ...input, path: "/api/v1/redirect" }),
      ).rejects.toThrow();
      expect(received.map((request) => request.path)).toEqual([
        "/api/v1/upload",
        "/api/v1/redirect",
      ]);
      await manager.disconnect("work");
      await expect(manager.request(input)).rejects.toThrow("unavailable");
    } finally {
      manager.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("recovers after consecutive network failures and forgets a disconnected target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kaioken-ssh-lifecycle-"));
    const children: ChildProcess[] = [];
    const runtime = {
      bootstrap: vi.fn(
        async (_alias: string, _command: string, _signal: AbortSignal) => {},
      ),
      forward: vi.fn(() => {
        const child = new ChildProcess();
        vi.spyOn(child, "kill").mockReturnValue(true);
        children.push(child);
        return child;
      }),
      check: vi.fn(async () => true),
      port: vi.fn(async () => 41234),
    };
    const manager = new SshConnections(directory, runtime);
    try {
      await manager.connect({
        alias: "work",
        remotePort: 38886,
        startupCommand: "start-runtime",
      });
      await vi.waitFor(async () =>
        expect((await manager.list()).connections[0]?.state).toBe("ready"),
      );
      runtime.bootstrap.mockRejectedValueOnce(
        new Error("Network is unreachable"),
      );
      children[0]!.emit("close", 255);
      await vi.waitFor(async () =>
        expect((await manager.list()).connections[0]?.state).toBe(
          "reconnecting",
        ),
      );
      await vi.waitFor(
        async () =>
          expect((await manager.list()).connections[0]?.state).toBe("ready"),
        { timeout: 5000 },
      );
      expect(runtime.port).toHaveBeenCalledTimes(1);
      expect(runtime.forward).toHaveBeenLastCalledWith("work", 41234, 38886);
      await manager.disconnect("work");
      expect(children[1]!.kill).toHaveBeenCalledWith("SIGTERM");
      expect((await manager.list()).connections).toEqual([]);
      const restarted = new SshConnections(directory, runtime);
      expect((await restarted.list()).connections).toEqual([]);
      restarted.close();
    } finally {
      manager.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cancels bootstrap before opening a tunnel and restores a remembered connection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kaioken-ssh-cancel-"));
    let finish: () => void = () => {};
    const runtime = {
      bootstrap: vi.fn(
        (_alias: string, _command: string, _signal: AbortSignal) =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
      forward: vi.fn(() => new ChildProcess()),
      check: vi.fn(async () => true),
      port: vi.fn(async () => 41235),
    };
    const manager = new SshConnections(directory, runtime);
    let restarted: SshConnections | null = null;
    try {
      await manager.connect({
        alias: "work",
        remotePort: 38886,
        startupCommand: "start-runtime",
      });
      expect(runtime.bootstrap).toHaveBeenCalledTimes(1);
      const signal = runtime.bootstrap.mock.calls[0]![2];
      manager.close();
      expect(signal.aborted).toBe(true);
      finish();
      await Promise.resolve();
      expect(runtime.forward).not.toHaveBeenCalled();
      restarted = new SshConnections(directory, runtime);
      expect((await restarted.list()).connections[0]?.state).toBe(
        "reconnecting",
      );
      expect(runtime.bootstrap).toHaveBeenLastCalledWith(
        "work",
        "start-runtime",
        expect.any(AbortSignal),
      );
      await restarted.disconnect("work");
      expect(runtime.bootstrap.mock.calls[1]![2].aborted).toBe(true);
    } finally {
      manager.close();
      restarted?.close();
      finish();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps authentication failures actionable instead of repeatedly retrying", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kaioken-ssh-auth-"));
    const runtime = {
      bootstrap: vi.fn(async () => {
        throw new Error("Permission denied (publickey)");
      }),
      forward: vi.fn(() => new ChildProcess()),
      check: vi.fn(async () => true),
      port: vi.fn(async () => 41236),
    };
    const manager = new SshConnections(directory, runtime);
    try {
      await manager.connect({
        alias: "work",
        remotePort: 38886,
        startupCommand: "start-runtime",
      });
      await vi.waitFor(async () =>
        expect((await manager.list()).connections[0]?.state).toBe("error"),
      );
      expect((await manager.list()).connections[0]?.error).toContain(
        "SSH sign-in failed",
      );
      expect(runtime.forward).not.toHaveBeenCalled();
    } finally {
      manager.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
