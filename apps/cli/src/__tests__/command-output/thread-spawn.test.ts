import { describe, expect, it, vi } from "vitest";
import * as domain from "@kaioken/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  getHelpOutput,
  resolveLocalHostIdMock,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("kaioken thread spawn command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  function captureCommanderErrors() {
    return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  }

  it("kaioken thread spawn sends project-default when the user relies on project defaults", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-1",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      ["thread", "spawn", "--project", "proj-1", "--prompt", "hello"],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: "proj-1",
        input: [{ type: "text", text: "hello", mentions: [] }],
        environment: { type: "project-default" },
      },
    });
    expect(resolveLocalHostIdMock).not.toHaveBeenCalled();
  });

  it("kaioken thread spawn forwards host-readable paths without reading them on the CLI machine", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-attachments",
      projectId: "proj-1",
      providerId: "codex",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--prompt",
        "review these",
        "--file",
        "/tmp/report.pdf",
        "--image",
        "/tmp/screenshot.png",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        input: [
          { type: "text", text: "review these", mentions: [] },
          { type: "localFile", path: "/tmp/report.pdf" },
          { type: "localImage", path: "/tmp/screenshot.png" },
        ],
      }),
    });
  });

  it("kaioken thread spawn --plan opens the thread with the composer's /plan command mention", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-plan",
      projectId: "proj-1",
      providerId: "claude-code",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--prompt",
        "add a README",
        "--plan",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        input: [
          {
            type: "text",
            text: "/plan add a README",
            mentions: [
              expect.objectContaining({
                start: 0,
                end: 5,
                resource: expect.objectContaining({
                  kind: "command",
                  trigger: "/",
                  name: "plan",
                }),
              }),
            ],
          },
        ],
      }),
    });
  });

  it("kaioken thread spawn requires an explicit --project", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", undefined);
    const post = vi.fn();
    const stderrWrite = captureCommanderErrors();
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(["thread", "spawn", "--prompt", "hello"], register),
    ).rejects.toThrow("process.exit:1");

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining(
        "error: required option '--project <id>' not specified",
      ),
    );
    expect(resolveLocalHostIdMock).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("kaioken thread spawn ignores KAIOKEN_PROJECT_ID when --project is omitted", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-env");
    const post = vi.fn();
    const stderrWrite = captureCommanderErrors();
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(["thread", "spawn", "--prompt", "hello"], register),
    ).rejects.toThrow("process.exit:1");

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining(
        "error: required option '--project <id>' not specified",
      ),
    );
    expect(resolveLocalHostIdMock).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("kaioken thread spawn lets the server resolve defaults for the personal project", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-personal",
      projectId: domain.PERSONAL_PROJECT_ID,
      providerId: "codex",
      status: "starting",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        domain.PERSONAL_PROJECT_ID,
        "--prompt",
        "hello",
      ],
      register,
    );

    expect(resolveLocalHostIdMock).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: domain.PERSONAL_PROJECT_ID,
        input: [{ type: "text", text: "hello", mentions: [] }],
        environment: { type: "project-default" },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain("  Project:  -");
  });

  it("kaioken thread spawn forwards explicit execution overrides", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-overrides",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
        "--reasoning-level",
        "high",
        "--service-tier",
        "fast",
        "--permission-mode",
        "auto",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: "proj-1",
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "fast",
        input: [{ type: "text", text: "hello", mentions: [] }],
        environment: { type: "project-default" },
      },
    });
  });

  it("kaioken thread spawn forwards hidden visibility", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-hidden",
      projectId: "proj-1",
      providerId: "codex",
      visibility: "hidden",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--prompt",
        "background work",
        "--visibility",
        "hidden",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({ visibility: "hidden" }),
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "  Visibility: hidden",
    );
  });

  it("kaioken thread spawn allows sections for hidden workers", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      sectionId: "sec_work",
      id: "thread-hidden-section",
      projectId: "proj-1",
      providerId: "codex",
      visibility: "hidden",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--prompt",
        "background work",
        "--visibility",
        "hidden",
        "--section",
        "sec_work",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        sectionId: "sec_work",
        visibility: "hidden",
      }),
    });
  });

  it("kaioken thread spawn help lists product permission modes", async () => {
    const helpOutput = await getHelpOutput(["thread", "spawn"], register);
    expect(helpOutput).toContain("--permission-mode <mode>");
    expect(helpOutput).toContain("--visibility <visibility>");
    expect(helpOutput).toContain("Exact Git ref");
    expect(helpOutput).toContain("origin/<branch> for a remote ref");
    expect(helpOutput).toContain("kaioken environment providers");
    expect(helpOutput).not.toContain("kaioken curl");
    expect(helpOutput).toMatch(/Permission mode: accept-edits, auto, or full/);
  });

  it("kaioken thread spawn reports invalid permission mode choices", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--prompt",
          "hello",
          "--permission-mode",
          "unsafe",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      "Error: Invalid permission mode 'unsafe'. Expected accept-edits, auto, or full.",
    );
  });

  it("kaioken thread spawn normalizes deprecated workspace-write to accept-edits", async () => {
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-legacy-permission",
      projectId: "proj-1",
      providerId: "codex",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--prompt",
        "hello",
        "--permission-mode",
        "workspace-write",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({ permissionMode: "accept-edits" }),
    });
  });

  it("kaioken thread spawn --json prints the raw thread", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-json-spawn",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--json",
        "--project",
        "proj-1",
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(thread);
  });

  it("kaioken thread spawn prefixes model-catalog failures with context", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const post = vi.fn(async () => {
      throw new Error(
        "HTTP 503: Unable to load codex models to resolve the default",
      );
    });
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        ["thread", "spawn", "--project", "proj-1", "--prompt", "hello"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: Failed to create thread: HTTP 503: Unable to load codex models to resolve the default",
    );
  });

  it("kaioken thread spawn with --parent-thread forwards parent thread id", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-2",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      parentThreadId: "thread-parent",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--parent-thread",
        "thread-parent",
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: "proj-1",
        providerId: "codex",
        model: "gpt-5",
        input: [{ type: "text", text: "hello", mentions: [] }],
        parentThreadId: "thread-parent",
        environment: { type: "project-default" },
      },
    });
  });

  it("kaioken thread spawn does not default parent thread id from KAIOKEN_THREAD_ID", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    vi.stubEnv("KAIOKEN_THREAD_ID", "thread-context-parent");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-2",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      parentThreadId: "thread-context-parent",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: "proj-1",
        providerId: "codex",
        model: "gpt-5",
        input: [{ type: "text", text: "hello", mentions: [] }],
        environment: { type: "project-default" },
      },
    });
  });

  it("kaioken thread spawn with --parent-self forwards KAIOKEN_THREAD_ID as parent thread id", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    vi.stubEnv("KAIOKEN_THREAD_ID", "thread-context-parent");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-2",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      parentThreadId: "thread-context-parent",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--parent-self",
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        parentThreadId: "thread-context-parent",
      }),
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "You will be notified when this thread is done.",
    );
  });

  it("kaioken thread spawn rejects --parent-self without KAIOKEN_THREAD_ID", async () => {
    const post = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-parent-self-missing-context",
        projectId: "proj-1",
        providerId: "codex",
      }),
    );
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--parent-self",
          "--prompt",
          "hello",
          "--provider",
          "codex",
          "--model",
          "gpt-5",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      "Error: --parent-self requires KAIOKEN_THREAD_ID to be set.",
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("kaioken thread spawn rejects combining --parent-thread and --parent-self", async () => {
    vi.stubEnv("KAIOKEN_THREAD_ID", "thread-context-parent");
    const post = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-conflicting-parent",
        projectId: "proj-1",
        providerId: "codex",
      }),
    );
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--parent-thread",
          "thread-parent",
          "--parent-self",
          "--prompt",
          "hello",
          "--provider",
          "codex",
          "--model",
          "gpt-5",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      "Error: Cannot combine --parent-thread with --parent-self.",
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("kaioken thread spawn rejects invalid parent-thread values", async () => {
    const post = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-invalid-parent",
        projectId: "proj-1",
        providerId: "codex",
      }),
    );
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--parent-thread",
          "thread/invalid",
          "--prompt",
          "hello",
          "--provider",
          "codex",
          "--model",
          "gpt-5",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      'Error: Invalid ID from --parent-thread: "thread/invalid". IDs must contain only letters, digits, hyphens, and underscores.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("kaioken thread spawn forwards a valid --environment ID", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-env-1",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      environmentId: "env-worktree-001",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--environment",
        "env-worktree-001",
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: "proj-1",
        providerId: "codex",
        model: "gpt-5",
        input: [{ type: "text", text: "hello", mentions: [] }],
        environment: { type: "reuse", environmentId: "env-worktree-001" },
      },
    });
  });

  it("kaioken thread spawn forwards an absolute --environment path as an unmanaged workspace", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const workspacePath = "/Users/michael/Projects/kaioken";
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-env-path-1",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      environmentId: "env-unmanaged-001",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--environment",
        workspacePath,
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(resolveLocalHostIdMock).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: "proj-1",
        providerId: "codex",
        model: "gpt-5",
        input: [{ type: "text", text: "hello", mentions: [] }],
        environment: {
          type: "host",
          hostId: "host-test-001",
          workspace: { type: "unmanaged", path: workspacePath },
        },
      },
    });
  });

  it("kaioken thread spawn rejects invalid non-path --environment IDs", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const post = vi.fn();
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--environment",
          "env:bad",
          "--prompt",
          "hello",
          "--provider",
          "codex",
          "--model",
          "gpt-5",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      'Error: Invalid ID from --environment flag: "env:bad". IDs must contain only letters, digits, hyphens, and underscores.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("kaioken thread spawn forwards --new-environment", async () => {
    vi.stubEnv("KAIOKEN_PROJECT_ID", "proj-1");
    const thread: domain.Thread = fixtures.makeThread({
      id: "thread-env-1",
      projectId: "proj-1",
      providerId: "codex",
      status: "starting",
      environmentId: "env-worktree-001",
      createdAt: 1,
      updatedAt: 1,
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.$post": post });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--new-environment",
        "worktree",
        "--prompt",
        "hello",
        "--provider",
        "codex",
        "--model",
        "gpt-5",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: {
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: null,
        projectId: "proj-1",
        providerId: "codex",
        model: "gpt-5",
        input: [{ type: "text", text: "hello", mentions: [] }],
        environment: {
          type: "host",
          hostId: "host-test-001",
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "default" },
          },
        },
      },
    });
  });

  it("kaioken thread spawn targets an unambiguous machine name", async () => {
    const thread = fixtures.makeThread({
      id: "thread-machine",
      projectId: "proj-1",
      providerId: "codex",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          type: "persistent",
          status: "connected",
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.threads.$post": post,
    });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--machine",
        "builder",
        "--prompt",
        "hello",
      ],
      register,
    );

    expect(resolveLocalHostIdMock).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        environment: {
          type: "host",
          hostId: "host-remote",
          workspace: { type: "unmanaged", path: null },
        },
      }),
    });
  });

  it("kaioken thread spawn combines --host with an unmanaged path", async () => {
    const post = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-machine-path",
        projectId: "proj-1",
        providerId: "codex",
      }),
    );
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          type: "persistent",
          status: "connected",
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.threads.$post": post,
    });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--host",
        "host-remote",
        "--environment",
        "/srv/alpha",
        "--prompt",
        "hello",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        environment: {
          type: "host",
          hostId: "host-remote",
          workspace: { type: "unmanaged", path: "/srv/alpha" },
        },
      }),
    });
  });

  it("kaioken thread spawn creates a managed worktree on the selected machine", async () => {
    const post = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-machine-worktree",
        projectId: "proj-1",
        providerId: "codex",
      }),
    );
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          type: "persistent",
          status: "connected",
          lastSeenAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.threads.$post": post,
    });

    await runCommand(
      [
        "thread",
        "spawn",
        "--project",
        "proj-1",
        "--machine",
        "builder",
        "--new-environment",
        "worktree",
        "--base-branch",
        "main",
        "--prompt",
        "hello",
      ],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      json: expect.objectContaining({
        environment: {
          type: "host",
          hostId: "host-remote",
          workspace: {
            type: "managed-worktree",
            baseBranch: { kind: "named", name: "main" },
          },
        },
      }),
    });
  });

  it("kaioken thread spawn rejects selecting a machine for a reused environment", async () => {
    const post = vi.fn();
    stubServerApi({ "v1.threads.$post": post });

    await expect(
      runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--machine",
          "builder",
          "--environment",
          "env-existing",
          "--prompt",
          "hello",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      "Error: Cannot combine --machine or --host with an existing environment ID; that environment already selects its machine.",
    );
    expect(post).not.toHaveBeenCalled();
  });

  describe("--environment-provider", () => {
    const providers = [
      {
        id: "git-worktree",
        displayName: "Worktree",
        icon: null,
        pluginId: "environment-git-worktree",
        acceptsEmptyInputs: false,
        machineAvailability: {},
        availability: null,
        requires: {
          projectCheckout: true,
          gitCheckout: true,
          gitRemote: false,
          projectless: false,
        },
        inputs: {
          type: "object",
          properties: { branch: { type: "object" } },
          required: ["branch"],
        },
      },
      {
        id: "plain",
        displayName: "Plain",
        icon: null,
        pluginId: "plain",
        acceptsEmptyInputs: true,
        machineAvailability: {},
        availability: null,
        requires: {
          projectCheckout: false,
          gitCheckout: false,
          gitRemote: false,
          projectless: false,
        },
        inputs: null,
      },
      {
        id: "optional",
        displayName: "Optional inputs",
        icon: null,
        pluginId: "optional",
        acceptsEmptyInputs: true,
        machineAvailability: {},
        availability: null,
        requires: {
          projectCheckout: false,
          gitCheckout: false,
          gitRemote: false,
          projectless: false,
        },
        inputs: {
          type: "object",
          properties: { region: { type: "string" } },
        },
      },
    ];

    function stubProviders(post: Parameters<typeof stubServerApi>[0][string]) {
      stubServerApi({
        "v1.threads.$post": post,
        "v1.system.environment-providers.$get": vi.fn(async () => ({
          providers,
        })),
      });
    }

    it("sends parsed --environment-inputs with the default machine for a host provider", async () => {
      const post = vi.fn(async () =>
        fixtures.makeThread({
          id: "thread-provider",
          projectId: "proj-1",
          providerId: "codex",
        }),
      );
      stubProviders(post);

      await runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--prompt",
          "hello",
          "--environment-provider",
          "git-worktree",
          "--environment-inputs",
          '{"branch":{"kind":"named","name":"release"}}',
        ],
        register,
      );

      expect(post).toHaveBeenCalledWith({
        json: expect.objectContaining({
          environment: {
            type: "provider",
            environmentProviderId: "git-worktree",
            machine: { type: "existing", hostId: "host-test-001" },
            inputs: { branch: { kind: "named", name: "release" } },
          },
        }),
      });
    });

    it("sends null inputs with the default machine for a provider without inputs", async () => {
      const post = vi.fn(async () =>
        fixtures.makeThread({
          id: "thread-provider",
          projectId: "proj-1",
          providerId: "codex",
        }),
      );
      stubProviders(post);

      await runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--prompt",
          "hello",
          "--environment-provider",
          "plain",
        ],
        register,
      );

      expect(post).toHaveBeenCalledWith({
        json: expect.objectContaining({
          environment: {
            type: "provider",
            environmentProviderId: "plain",
            machine: { type: "existing", hostId: "host-test-001" },
            inputs: null,
          },
        }),
      });
    });

    it("sends empty inputs when the server says the schema accepts them", async () => {
      const post = vi.fn(async () =>
        fixtures.makeThread({
          id: "thread-provider",
          projectId: "proj-1",
          providerId: "codex",
        }),
      );
      stubProviders(post);

      await runCommand(
        [
          "thread",
          "spawn",
          "--project",
          "proj-1",
          "--prompt",
          "hello",
          "--environment-provider",
          "optional",
        ],
        register,
      );

      expect(post).toHaveBeenCalledWith({
        json: expect.objectContaining({
          environment: {
            type: "provider",
            environmentProviderId: "optional",
            machine: { type: "existing", hostId: "host-test-001" },
            inputs: {},
          },
        }),
      });
    });

    it.each<[label: string, args: string[], error: string]>([
      [
        "a provider with inputs and none given",
        ["--environment-provider", "git-worktree"],
        "Error: The 'git-worktree' environment provider needs --environment-inputs <json>; `kaioken environment providers --json` shows its schema.",
      ],
      [
        "inputs given to a provider without any",
        ["--environment-provider", "plain", "--environment-inputs", "{}"],
        "Error: The 'plain' environment provider takes no --environment-inputs.",
      ],
      [
        "--base-branch with a provider",
        ["--environment-provider", "git-worktree", "--base-branch", "main"],
        "Error: --base-branch requires --new-environment worktree; an --environment-provider takes its branch through --environment-inputs.",
      ],
      [
        "inputs that are not JSON",
        [
          "--environment-provider",
          "git-worktree",
          "--environment-inputs",
          "{nope",
        ],
        "Error: --environment-inputs must be valid JSON.",
      ],
      [
        "inputs without a provider",
        ["--environment-inputs", "{}"],
        "Error: --environment-inputs requires --environment-provider <id>.",
      ],
    ])("refuses %s", async (_label, args, error) => {
      const post = vi.fn();
      stubProviders(post);

      await expect(
        runCommand(
          [
            "thread",
            "spawn",
            "--project",
            "proj-1",
            "--prompt",
            "hello",
            ...args,
          ],
          register,
        ),
      ).rejects.toThrow("process.exit:1");

      expect(console.error).toHaveBeenCalledWith(error);
      expect(post).not.toHaveBeenCalled();
    });
  });
});
