import { execFile, spawn, type ChildProcess } from "node:child_process";
import { globSync } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";
import {
  sshAliasSchema,
  type SshConnection,
  type SshConnectionList,
  type SshHttpRequest,
  type SshHttpResponse,
} from "@kaioken/host-daemon-contract";

const execFileAsync = promisify(execFile);
const SSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=10",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=3",
];
const savedTargetsSchema = z.array(
  z.object({
    alias: sshAliasSchema,
    remotePort: z.number().int().min(1).max(65535),
    startupCommand: z.string().optional(),
  }),
);

export function sshConfigEntries(source: string): {
  hosts: string[];
  includes: string[];
} {
  const hosts: string[] = [];
  const includes: string[] = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*(Host|Include)(?:\s*=\s*|\s+)(.*)$/iu.exec(line);
    if (!match) continue;
    const values = match[2]!.match(/"[^"]*"|[^\s#]+|#.*/gu) ?? [];
    for (const token of values) {
      if (token.startsWith("#")) break;
      const value = token.replace(/^"|"$/gu, "");
      if (match[1]!.toLowerCase() === "include") includes.push(value);
      else if (sshAliasSchema.safeParse(value).success) hosts.push(value);
    }
  }
  return { hosts, includes };
}

export async function discoverSshAliases(home = homedir()): Promise<string[]> {
  const visited = new Set<string>();
  const aliases = new Set<string>();
  async function visit(path: string, base: string): Promise<void> {
    let canonical: string;
    let source: string;
    try {
      canonical = await realpath(path);
      if (visited.has(canonical)) return;
      visited.add(canonical);
      source = await readFile(canonical, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    const entries = sshConfigEntries(source);
    for (const alias of entries.hosts) aliases.add(alias);
    for (let pattern of entries.includes) {
      pattern = pattern
        .replace(/^~(?=\/|$)/u, home)
        .replace(
          /\$\{([^}]+)\}/gu,
          (_match, key: string) => process.env[key] ?? "",
        )
        .replace(/%d/gu, home)
        .replace(/%%/gu, "%");
      if (!pattern || /%[a-zA-Z]/u.test(pattern)) continue;
      const files = globSync(
        isAbsolute(pattern) ? pattern : resolve(base, pattern),
      ).sort();
      for (const file of files) await visit(file, base);
    }
  }
  await visit(join(home, ".ssh/config"), join(home, ".ssh"));
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Could not allocate an SSH tunnel port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export function sshErrorMessage(stderr: string): string {
  if (/host key|REMOTE HOST IDENTIFICATION HAS CHANGED/iu.test(stderr))
    return "SSH host key needs attention. Verify this computer with ssh in your terminal, then retry.";
  if (/Permission denied|authentication failed/iu.test(stderr))
    return "SSH sign-in failed. Unlock your SSH key or sign in with ssh in your terminal, then retry.";
  if (/KAIOKEN_RUNTIME_MISSING/u.test(stderr))
    return "Kaioken is not installed in the remote login shell. Install kaioken-app on that computer, then retry.";
  return (
    stderr.trim().slice(-2000) ||
    "SSH connection closed. Check the computer's address and network connection."
  );
}

interface SshRuntime {
  bootstrap(alias: string, command: string, signal: AbortSignal): Promise<void>;
  forward(alias: string, port: number, remotePort: number): ChildProcess;
  check(url: string, signal: AbortSignal): Promise<boolean>;
  port(): Promise<number>;
}

const defaultRuntime: SshRuntime = {
  async bootstrap(alias, command, signal) {
    await execFileAsync("ssh", [...SSH_OPTIONS, "-T", alias, command], {
      timeout: 60_000,
      maxBuffer: 64 * 1024,
      signal,
    });
  },
  forward(alias, port, remotePort) {
    return spawn(
      "ssh",
      [
        ...SSH_OPTIONS,
        "-o",
        "ExitOnForwardFailure=yes",
        "-N",
        "-L",
        `127.0.0.1:${port}:127.0.0.1:${remotePort}`,
        alias,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  },
  async check(url, signal) {
    const response = await fetch(`${url}/api/v1/system/config`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
      redirect: "error",
    });
    await response.body?.cancel();
    return response.ok;
  },
  port: availablePort,
};

interface Entry {
  view: SshConnection;
  generation: number;
  process: ChildProcess | null;
  retry: ReturnType<typeof setTimeout> | null;
  startupCommand: string;
  abort: AbortController | null;
  failures: number;
}

export class SshConnections {
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  private saveQueue = Promise.resolve();
  private loading: Promise<void> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly runtime: SshRuntime = defaultRuntime,
  ) {}

  private load(): Promise<void> {
    this.loading ??= this.restore();
    return this.loading;
  }

  private async restore(): Promise<void> {
    let saved: z.infer<typeof savedTargetsSchema> = [];
    try {
      saved = savedTargetsSchema.parse(
        JSON.parse(
          await readFile(join(this.dataDir, "ssh-connections.json"), "utf8"),
        ),
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    for (const target of saved) {
      const entry: Entry = {
        view: {
          alias: target.alias,
          remotePort: target.remotePort,
          state: "offline",
          url: null,
          error: null,
        },
        generation: 0,
        process: null,
        retry: null,
        startupCommand: target.startupCommand ?? "",
        abort: null,
        failures: 0,
      };
      this.entries.set(target.alias, entry);
      if (!this.closed && entry.startupCommand) {
        entry.view.state = "reconnecting";
        void this.start(entry);
      }
    }
  }

  async list(): Promise<SshConnectionList> {
    const aliases = await discoverSshAliases();
    await this.load();
    return {
      aliases,
      connections: [...this.entries.values()].map((entry) => ({
        ...entry.view,
      })),
    };
  }

  async connect(input: {
    alias: string;
    remotePort: number;
    startupCommand: string;
  }): Promise<SshConnection> {
    if (this.closed) throw new Error("SSH connection manager is closed");
    sshAliasSchema.parse(input.alias);
    await this.load();
    if (this.closed) throw new Error("SSH connection manager is closed");
    const existing = this.entries.get(input.alias);
    if (
      existing &&
      ["ready", "connecting", "reconnecting"].includes(existing.view.state) &&
      existing.view.remotePort === input.remotePort
    )
      return { ...existing.view };
    if (existing) this.stopEntry(existing);
    const entry: Entry = {
      view: {
        alias: input.alias,
        remotePort: input.remotePort,
        url: null,
        state: "connecting",
        error: null,
      },
      generation: 0,
      process: null,
      retry: null,
      startupCommand: input.startupCommand,
      abort: null,
      failures: 0,
    };
    this.entries.set(input.alias, entry);
    try {
      await this.save();
    } catch (error) {
      this.stopEntry(entry);
      if (this.entries.get(input.alias) === entry)
        this.entries.delete(input.alias);
      throw error;
    }
    if (!this.closed && this.entries.get(input.alias) === entry)
      void this.start(entry);
    return { ...entry.view };
  }

  async disconnect(alias: string): Promise<{ ok: true }> {
    await this.load();
    const entry = this.entries.get(alias);
    if (entry) this.stopEntry(entry);
    this.entries.delete(alias);
    await this.save();
    return { ok: true };
  }

  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) this.stopEntry(entry);
  }

  async request(input: SshHttpRequest): Promise<SshHttpResponse> {
    await this.load();
    const entry = this.entries.get(input.alias);
    if (
      this.closed ||
      !entry ||
      entry.view.state !== "ready" ||
      !entry.view.url ||
      !entry.abort
    )
      throw new Error("The SSH computer is unavailable");
    const url = new URL(input.path, entry.view.url);
    if (url.origin !== entry.view.url || !url.pathname.startsWith("/api/v1/"))
      throw new Error("SSH requests must target the connected Kaioken API");
    const headers = new Headers(input.headers);
    for (const name of [...headers.keys()]) {
      if (
        /^(?:authorization|cookie|host|origin|referer|connection|content-length|proxy-|sec-|x-forwarded-)/iu.test(
          name,
        )
      )
        headers.delete(name);
    }
    const body =
      input.body === null ? undefined : Buffer.from(input.body, "base64");
    if (body && body.byteLength > 32 * 1024 * 1024)
      throw new Error("SSH request is too large");
    const response = await fetch(url, {
      method: input.method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.any([
        entry.abort.signal,
        AbortSignal.timeout(60_000),
      ]),
    });
    const bytes: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 32 * 1024 * 1024)
            throw new Error("SSH response is too large");
          bytes.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
    }
    const responseHeaders = new Headers(response.headers);
    for (const name of [
      "set-cookie",
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "connection",
    ])
      responseHeaders.delete(name);
    return {
      status: response.status,
      headers: Object.fromEntries(responseHeaders),
      body: Buffer.concat(bytes).toString("base64"),
    };
  }

  private stopEntry(entry: Entry) {
    entry.generation++;
    if (entry.retry) clearTimeout(entry.retry);
    entry.retry = null;
    entry.abort?.abort();
    entry.abort = null;
    entry.process?.kill("SIGTERM");
    entry.process = null;
    entry.view.state = "offline";
  }

  private save(): Promise<void> {
    const targets = [...this.entries.values()].map(
      ({ view, startupCommand }) => ({
        alias: view.alias,
        remotePort: view.remotePort,
        startupCommand,
      }),
    );
    const operation = this.saveQueue.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      const path = join(this.dataDir, "ssh-connections.json");
      await writeFile(`${path}.tmp`, JSON.stringify(targets), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    this.saveQueue = operation.catch(() => {});
    return operation;
  }

  private fail(entry: Entry, detail: string): void {
    this.stopEntry(entry);
    entry.view.error = sshErrorMessage(detail);
    const needsAttention =
      /host key|REMOTE HOST IDENTIFICATION HAS CHANGED|Permission denied|authentication failed|KAIOKEN_RUNTIME_MISSING|KAIOKEN_NODE_MISSING|spawn ssh ENOENT|did not become ready|unknown option|Bad configuration/iu.test(
        detail,
      );
    entry.view.state = needsAttention ? "error" : "reconnecting";
    if (!needsAttention && !this.closed) {
      const backoff = Math.min(
        30_000,
        1000 * 2 ** Math.min(entry.failures++, 5),
      );
      entry.retry = setTimeout(() => {
        entry.retry = null;
        void this.start(entry);
      }, backoff);
    }
  }

  private async start(entry: Entry): Promise<void> {
    if (this.closed) return;
    const generation = ++entry.generation;
    const current = () => !this.closed && entry.generation === generation;
    const abort = new AbortController();
    entry.abort = abort;
    let stderr = "";
    try {
      await this.runtime.bootstrap(
        entry.view.alias,
        entry.startupCommand,
        abort.signal,
      );
      if (!current()) return;
      const port =
        entry.view.url === null
          ? await this.runtime.port()
          : Number(new URL(entry.view.url).port);
      if (!current()) return;
      entry.view.url = `http://127.0.0.1:${port}`;
      const child = this.runtime.forward(
        entry.view.alias,
        port,
        entry.view.remotePort,
      );
      entry.process = child;
      child.stderr?.on("data", (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-8192);
      });
      child.on("error", (error) => {
        if (current()) this.fail(entry, error.message);
      });
      child.once("close", () => {
        if (current()) this.fail(entry, stderr);
      });
      const deadline = Date.now() + 60_000;
      while (current() && Date.now() < deadline) {
        try {
          if (
            (await this.runtime.check(entry.view.url, abort.signal)) &&
            current()
          ) {
            entry.view.state = "ready";
            entry.view.error = null;
            entry.failures = 0;
            return;
          }
        } catch {}
        await delay(250, undefined, { signal: abort.signal });
      }
      if (current())
        throw new Error(
          "Kaioken did not become ready on the remote computer. Check its startup log and retry.",
        );
    } catch (error) {
      if (!current()) return;
      const detail =
        error instanceof Error &&
        "stderr" in error &&
        typeof error.stderr === "string"
          ? error.stderr
          : error instanceof Error
            ? error.message
            : "SSH connection failed";
      this.fail(entry, detail);
    }
  }
}
