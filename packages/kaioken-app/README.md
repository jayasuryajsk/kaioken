<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/e40bda56-54a4-47f8-a417-6bbadf2e5b40">
    <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/4d9d02fb-c179-449b-a38a-041955143232">
    <img alt="kaioken" src="https://github.com/user-attachments/assets/4d9d02fb-c179-449b-a38a-041955143232" width="128">
  </picture>
</p>

# kaioken

[![npm version](https://img.shields.io/npm/v/kaioken-app.svg)](https://www.npmjs.com/package/kaioken-app)

kaioken is an agentic IDE that builds itself. It can control, customize, and automate
itself, laying the groundwork for your own software factory.

This package provides the `npx kaioken-app` launcher, bundled `kaioken` CLI entry, and
Node SDK export. Every surface — the web app, CLI, and HTTP API — is a
first-class way to drive kaioken. Work runs in threads you can follow live, steer at
any point, or hand off to another agent.

> Note: kaioken is in active development. Workflows and surfaces are still evolving.

## Quick Start

kaioken runs from npm and orchestrates coding agents you already have installed.

### Prerequisites

- Node.js 22.19, 24, or 26.
- Git.
- At least one supported agent provider: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://developers.openai.com/codex/cli), Cursor via ACP, [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent), or another ACP-compatible agent.

If you already use one of these providers, kaioken will pick up your existing
credentials. If you use multiple providers, you can mix and match per task.

### Supported host environments

- macOS
- Linux

<details>
<summary>Windows via Ubuntu on WSL2</summary>

Run all `kaioken` commands inside WSL2, install Node.js, Git, and your provider CLIs
inside that WSL2 distro, and use Linux-style paths such as `/home/me/repo` or
`/mnt/c/Users/me/repo`.

Native Windows PowerShell, CMD, drive-letter paths, and UNC paths are not
supported product paths. Repos inside the WSL filesystem are recommended;
`/mnt/c/...` is intentionally supported so you can keep an existing Windows
checkout, but it is slower and less reliable for file watching.

</details>

### Install and run

```bash
npx kaioken-app@latest
```

Then open: `http://localhost:38886`

To opt into the automated nightly channel:

```bash
npx kaioken-app@nightly
```

Nightly versions are built from `main` and may be unstable. The `nightly`
dist-tag moves independently of the stable `latest` tag.

npm 12 and later block dependency install scripts by default. kaioken needs those
scripts to build its native add-ons (`better-sqlite3`, `node-pty`,
`@parcel/watcher`). Without them kaioken stops at startup with
`Could not locate the bindings file`. If your npm version is 12 or later, allow
the scripts for the install:

```bash
npx --allow-scripts=better-sqlite3,node-pty,@parcel/watcher kaioken-app@latest
```

Or set the policy once for all global installs:

```bash
npm config set allow-scripts=better-sqlite3,node-pty,@parcel/watcher --location=user
```

`npx kaioken-app@latest` downloads the published `kaioken-app` package, starts the server and
local host daemon, and serves the web app. It stores kaioken-managed state under
`~/.kaioken/` by default. If either managed child process exits unexpectedly, the
launcher restarts that child without stopping the other one. Press `Ctrl+C` in
the terminal to stop both processes and exit with status `0`.

Server and host-daemon output goes directly to `logs/server-stdio.log` and
`logs/host-daemon-stdio.log` under the data directory, including startup errors
and console output. These files append across restarts; they are separate from
the rotating application logs. The launcher prints status and log locations
without forwarding service output to the terminal, so a stalled terminal cannot
block service logging. To follow output with the default data directory:

```bash
tail -F ~/.kaioken/logs/server-stdio.log ~/.kaioken/logs/host-daemon-stdio.log
```

The same output capture applies to `kaioken-server` and `kaioken-host-daemon`.

To stop a kaioken that runs in another terminal or in the background:

```bash
npx kaioken-app stop
```

`stop` reads `kaioken-app-runtime.json` from the data directory, confirms that the
recorded process really is that launcher, then stops it. Pass `--data-dir` when
the kaioken you want to stop does not use the default `~/.kaioken/`.

From the app, add or open a project, start a thread, and choose the provider
you want that thread to use.

## CLI

The package also exposes the `kaioken` CLI for an already-running kaioken server:

```bash
npx --package kaioken-app kaioken --help
```

The CLI uses the same `KAIOKEN_SERVER_URL` and kaioken config resolution as the SDK. When
unset, it targets the default local packaged server at
`http://127.0.0.1:38886`.

## Scripting with the SDK

The package also exposes a Node SDK for scripts that drive an already-running
kaioken server:

```ts
import { BBSdk } from "kaioken-app";

const bb = new BBSdk();
const thread = await bb.threads.spawn({
  projectId: "proj_personal",
  environment: { type: "host", workspace: { type: "personal" } },
  prompt: "Summarize my active kaioken work.",
});
await bb.threads.wait({ threadId: String(thread.id), status: "idle" });
console.log(await bb.threads.output({ threadId: String(thread.id) }));
```

`new BBSdk()` uses the same `KAIOKEN_SERVER_URL` and kaioken config resolution as the
CLI. Pass `new BBSdk({ baseUrl: "http://host:38886" })` for remote or test
targets (see the remote-access note below). Scripts launched by kaioken already receive `KAIOKEN_SERVER_URL` and
`KAIOKEN_THREAD_ID` in their environment.

## Provider Credentials

kaioken uses whichever providers you have configured. Common providers:

| Provider       | Setup                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`        | Install the [Codex CLI](https://developers.openai.com/codex/cli). Then run `codex login` or configure credentials per the Codex docs.                                                     |
| `claude-code`  | Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and authenticate per its docs.                                                                                      |
| `cursor`       | Install [Cursor's agent CLI](https://cursor.com/cli) (`cursor-agent`) and authenticate per Cursor's docs.                                                                                 |
| `pi`           | Install [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) with `npm install -g @earendil-works/pi-coding-agent` (0.84.0 or newer) and authenticate per its docs; Kaioken can run the install from Settings.          |
| `opencode`     | Install [opencode](https://opencode.ai/) and authenticate per its docs.                                                                                                                   |
| `grok`         | Install [Grok Build](https://docs.x.ai/build/overview) and authenticate with `grok login` or `XAI_API_KEY`.                                                                               |
| `hermes-agent` | Install [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation), configure credentials with `hermes model`, then verify ACP with `hermes acp --check`.    |

Kaioken indexes the documented native skill roots for Codex, Claude Code, Pi,
Cursor, OpenCode, omp, Grok Build, and Hermes Agent. It includes user roots,
project roots, and compatibility roots such as `.agents/skills`. These skills
appear in the selected provider's `/` command menu. The Skills page and
`kaioken skill list` show native skills for Claude Code, Codex, and Cursor. Kaioken also
reads configured Pi, omp, Grok, and Hermes skill directories, plus enabled
provider plugin skills.

Kaioken reads Pi's global `~/.pi/agent` files and each workspace's `.pi` files.
This includes settings, credentials, models, packages, extensions, skills,
prompts, themes, and context files. Pi extensions can add models and tools.
Kaioken loads project resources only after Pi's saved or global trust policy approves
the workspace. An unresolved `ask` decision stays untrusted because Kaioken has no Pi
trust prompt.
You can still use the Pi CLI and `/login` to create this configuration.

Custom ACP agents are configured through the ACP providers plugin's
`customAgents` setting: `kaioken plugin config provider-acp set customAgents
'[...]'`. See the configuration docs for the optional `modelCli` and
`reasoningCli` or `nativeReasoning` reasoning settings. The optional
`nativeSkillRoots` field adds provider-native skills to the composer. Its
`user` paths resolve from the target host home directory. Its `project` paths
resolve from the selected workspace. The `customAcpAgents` array in
`~/.kaioken/config.json` is the deprecated form of the same list; kaioken reads it, warns
about each entry, and stops reading it in 0.41.
Top-level `sharedSkillRoots` uses the same `user` and `project` path format.
Kaioken lists these sources as read-only skills. Kaioken injects them into Codex, Claude,
Pi, and ACP threads. This permits one physical skill collection for Kaioken and a
standalone provider CLI.

## Configuration

Use `kaioken-app config` for persistent non-secret package settings under
`~/.kaioken/config.json`:

```bash
npx kaioken-app config set KAIOKEN_APP_URL https://<machine>.<tailnet>.ts.net
npx kaioken-app config set KAIOKEN_INFERENCE codex/gpt-5.6-luna
npx kaioken-app config set KAIOKEN_INFERENCE_FALLBACK codex/gpt-5.4-mini
npx kaioken-app config set KAIOKEN_TRANSCRIPTION codex/gpt-transcribe
npx kaioken-app config list
npx kaioken-app config refresh
```

For remote access, use kaioken connect or publish the default loopback listener with
Tailscale Serve. Direct tailnet or LAN access to port `38886` requires the
explicit, security-sensitive `--server-bind-host 0.0.0.0` compatibility option;
see the multiple-devices guide.

Use `kaioken-app client ssh-target` to configure local editor opens for remote
kaioken servers under `~/.kaioken/client.json`. The target is the value that works after
`ssh`, such as `devbox` or `user@devbox`:

```bash
npx kaioken-app client ssh-target set https://kaioken.example.test devbox --host-id host_abc
npx kaioken-app client ssh-target list
```

Use `kaioken-app env` for provider credentials under `~/.kaioken/env.json`:

```bash
npx kaioken-app env set OPENAI_API_KEY <key>
npx kaioken-app env list
npx kaioken-app env unset OPENAI_API_KEY
```

`env list` redacts all values. Config and env writes ask a running local kaioken
server to reload; if kaioken is stopped, the values apply on the next start.

For all config keys, precedence, startup flags, and source-development `.env`
behavior, see the
[configuration docs](https://github.com/get-bb/bb/blob/main/docs/configuration.md).

## Further Reading

- [Main README](https://github.com/get-bb/bb#readme)
- [Platform support](https://github.com/get-bb/bb/blob/main/docs/platform-support.md)
- [Configuration](https://github.com/get-bb/bb/blob/main/docs/configuration.md)
- [Using kaioken on multiple devices](https://github.com/get-bb/bb/blob/main/docs/multiple-devices.md)
- [Worktree setup and teardown scripts](https://github.com/get-bb/bb/blob/main/docs/worktrees.md)
