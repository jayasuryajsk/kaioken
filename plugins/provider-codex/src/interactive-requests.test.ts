import { describe, expect, it } from "vitest";

import {
  buildCodexDeclinedElicitationResponse,
  buildCodexInteractiveResponse,
  buildCodexInteractiveResponseForResolution,
  buildCodexUserQuestionResponse,
  decodeCodexInteractiveRequest,
  extractCodexMacOsPermissionRequest,
} from "./interactive-requests.js";
import { ProviderRequestDecodeError } from "@kaioken/provider-bridge-protocol/bridge-kit";

describe("decodeCodexInteractiveRequest", () => {
  it("maps command approval requests into pending interaction payloads", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 8,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-1",
          itemId: "item-1",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [
            {
              type: "unknown",
              command: "git push",
            },
          ],
          additionalPermissions: {
            network: { enabled: true },
            fileSystem: null,
            macos: null,
          },
          availableDecisions: ["accept", "acceptForSession", "decline"],
        },
      }),
    ).toEqual({
      requestId: 8,
      method: "item/commandExecution/requestApproval",
      providerThreadId: "t1",
      turnId: "turn-1",
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          itemId: "item-1",
          command: "git push",
          cwd: "/tmp/project",
          actions: [
            {
              type: "unknown",
              command: "git push",
            },
          ],
          sessionGrant: {
            network: { enabled: true },
            fileSystem: null,
          },
        },
        reason: "Needs approval",
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      },
    });
  });

  it("omits command session approval without session grants", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 80,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-1",
          itemId: "item-1",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [],
          availableDecisions: ["accept", "acceptForSession", "decline"],
        },
      }),
    ).toEqual({
      requestId: 80,
      method: "item/commandExecution/requestApproval",
      providerThreadId: "t1",
      turnId: "turn-1",
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          itemId: "item-1",
          command: "git push",
          cwd: "/tmp/project",
          actions: [],
          sessionGrant: null,
        },
        reason: "Needs approval",
        availableDecisions: ["allow_once", "deny"],
      },
    });
  });

  it("rejects empty command approval decisions as invalid params", () => {
    expect(() =>
      decodeCodexInteractiveRequest({
        id: 8,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-1",
          itemId: "item-1",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [],
          availableDecisions: [],
        },
      }),
    ).toThrowError(ProviderRequestDecodeError);
  });

  it("maps cancel-only command approval decisions to deny", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 8,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-1",
          itemId: "item-1",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [],
          availableDecisions: ["cancel"],
        },
      }),
    ).toMatchObject({
      payload: {
        availableDecisions: ["deny"],
      },
    });
  });

  it("keeps a command approval that asks for macOS permissions and surfaces the profile beside it", () => {
    const request = {
      id: 8,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "t1",
        turnId: "turn-1",
        itemId: "item-1",
        reason: "Needs approval",
        command: "osascript -e 'tell app \"Finder\" to activate'",
        cwd: "/tmp/project",
        commandActions: [],
        additionalPermissions: {
          network: { enabled: true },
          fileSystem: null,
          macos: {
            preferences: "read_only",
            automations: {
              bundle_ids: ["com.apple.finder"],
            },
            launchServices: true,
            accessibility: true,
            calendar: false,
            reminders: false,
            contacts: "none",
          },
        },
        availableDecisions: ["accept", "acceptForSession", "decline"],
      },
    };

    const decoded = decodeCodexInteractiveRequest(request);
    expect(decoded?.payload).toMatchObject({
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item-1",
        sessionGrant: { network: { enabled: true }, fileSystem: null },
      },
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
    });

    expect(extractCodexMacOsPermissionRequest(request)).toEqual({
      providerThreadId: "t1",
      turnId: "turn-1",
      item: {
        approvalItemId: "item-1",
        reason: "Needs approval",
        permissions: {
          preferences: "read_only",
          automations: { kind: "bundle_ids", bundleIds: ["com.apple.finder"] },
          launchServices: true,
          accessibility: true,
          calendar: false,
          reminders: false,
          contacts: "none",
        },
      },
    });
  });

  it("extracts no macOS profile from approvals that carry none", () => {
    expect(
      extractCodexMacOsPermissionRequest({
        id: 81,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-1",
          itemId: "item-1",
          reason: null,
          command: "open -a Finder",
          cwd: "/tmp/project",
          commandActions: [],
          additionalPermissions: { network: null, fileSystem: null },
          availableDecisions: ["accept", "decline"],
        },
      }),
    ).toBeNull();
    expect(
      extractCodexMacOsPermissionRequest({
        id: 82,
        method: "item/permissions/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-1",
          itemId: "item-1",
          reason: null,
          permissions: { network: { enabled: true }, fileSystem: null },
        },
      }),
    ).toBeNull();
  });

  it("ignores unsupported policy-amendment decisions when simple decisions remain", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 9,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-2",
          itemId: "item-2",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [],
          additionalPermissions: null,
          availableDecisions: [
            {
              acceptWithExecpolicyAmendment: {
                execpolicy_amendment: ["allow", "git", "push"],
              },
            },
            {
              applyNetworkPolicyAmendment: {
                network_policy_amendment: {
                  host: "api.openai.com",
                  action: "allow",
                },
              },
            },
            "decline",
          ],
        },
      }),
    ).toMatchObject({
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          command: "git push",
        },
        availableDecisions: ["deny"],
      },
    });
  });

  it("rejects policy-amendment-only command approval decisions", () => {
    expect(() =>
      decodeCodexInteractiveRequest({
        id: 90,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-network-amendment",
          itemId: "item-network-amendment",
          reason: "Needs network policy approval",
          command: "curl https://api.openai.com",
          cwd: "/tmp/project",
          commandActions: [],
          additionalPermissions: null,
          availableDecisions: [
            {
              acceptWithExecpolicyAmendment: {
                execpolicy_amendment: ["allow", "git", "push"],
              },
            },
            {
              applyNetworkPolicyAmendment: {
                network_policy_amendment: {
                  host: "api.openai.com",
                  action: "allow",
                },
              },
            },
          ],
        },
      }),
    ).toThrowError(ProviderRequestDecodeError);
  });

  it("preserves deny when policy amendments are paired with cancel", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-network-amendment-deny",
          itemId: "item-network-amendment-deny",
          reason: "Needs network policy approval",
          command: "curl https://api.openai.com",
          cwd: "/tmp/project",
          commandActions: [],
          additionalPermissions: null,
          availableDecisions: [
            {
              applyNetworkPolicyAmendment: {
                network_policy_amendment: {
                  host: "api.openai.com",
                  action: "allow",
                },
              },
            },
            "cancel",
          ],
        },
      }),
    ).toMatchObject({
      payload: {
        availableDecisions: ["deny"],
      },
    });
  });

  it("maps file-change approvals into pending interactions", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 10,
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-file-change",
          itemId: "item-file-change",
          reason: "Review generated file changes",
          grantRoot: "/tmp/project",
        },
      }),
    ).toEqual({
      requestId: 10,
      method: "item/fileChange/requestApproval",
      providerThreadId: "t1",
      turnId: "turn-file-change",
      payload: {
        kind: "approval",
        subject: {
          kind: "file_change",
          itemId: "item-file-change",
          writeScope: "/tmp/project",
          sessionGrant: {
            network: null,
            fileSystem: {
              read: [],
              write: ["/tmp/project"],
            },
          },
        },
        reason: "Review generated file changes",
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      },
    });
  });

  it("omits file-change session approval without grant root", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 11,
        method: "item/fileChange/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-file-change",
          itemId: "item-file-change",
          reason: "Review generated file changes",
          grantRoot: null,
        },
      }),
    ).toEqual({
      requestId: 11,
      method: "item/fileChange/requestApproval",
      providerThreadId: "t1",
      turnId: "turn-file-change",
      payload: {
        kind: "approval",
        subject: {
          kind: "file_change",
          itemId: "item-file-change",
          writeScope: null,
          sessionGrant: null,
        },
        reason: "Review generated file changes",
        availableDecisions: ["allow_once", "deny"],
      },
    });
  });

  it("maps permission approvals into pending interactions", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 11,
        method: "item/permissions/requestApproval",
        params: {
          threadId: "t1",
          turnId: "turn-permissions",
          itemId: "item-permissions",
          reason: "Need network access",
          permissions: {
            network: { enabled: true },
            fileSystem: {
              read: ["/tmp/project/README.md"],
              write: [],
            },
          },
        },
      }),
    ).toEqual({
      requestId: 11,
      method: "item/permissions/requestApproval",
      providerThreadId: "t1",
      turnId: "turn-permissions",
      payload: {
        kind: "approval",
        subject: {
          kind: "permission_grant",
          itemId: "item-permissions",
          toolName: null,
          permissions: {
            network: { enabled: true },
            fileSystem: {
              read: ["/tmp/project/README.md"],
              write: [],
            },
          },
        },
        reason: "Need network access",
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      },
    });
  });
});

describe("buildCodexInteractiveResponse", () => {
  it("maps kaioken command approvals back to Codex responses", () => {
    expect(
      buildCodexInteractiveResponse({
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item-1",
            command: "git push",
            cwd: "/tmp/project",
            actions: [],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        },
        resolution: {
          decision: "allow_for_session",
          grantedPermissions: null,
        },
      }),
    ).toEqual({
      decision: "acceptForSession",
    });
  });

  it("maps command denial back to Codex responses", () => {
    expect(
      buildCodexInteractiveResponse({
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item-3",
            command: "git push",
            cwd: "/tmp/project",
            actions: [],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: ["allow_once", "deny"],
        },
        resolution: {
          decision: "deny",
        },
      }),
    ).toEqual({
      decision: "decline",
    });
  });

  it("maps file-change approvals back to Codex responses", () => {
    expect(
      buildCodexInteractiveResponse({
        payload: {
          kind: "approval",
          subject: {
            kind: "file_change",
            itemId: "item-file-change",
            writeScope: null,
            sessionGrant: null,
          },
          reason: "Review generated file changes",
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        },
        resolution: {
          decision: "allow_for_session",
          grantedPermissions: null,
        },
      }),
    ).toEqual({
      decision: "acceptForSession",
    });
  });

  it("maps permission grants back to Codex responses", () => {
    expect(
      buildCodexInteractiveResponse({
        payload: {
          kind: "approval",
          subject: {
            kind: "permission_grant",
            itemId: "item-permissions",
            toolName: null,
            permissions: {
              network: { enabled: true },
              fileSystem: {
                read: ["/tmp/project/README.md"],
                write: [],
              },
            },
          },
          reason: "Need network access",
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        },
        resolution: {
          decision: "allow_for_session",
          grantedPermissions: {
            network: { enabled: true },
            fileSystem: {
              read: ["/tmp/project/README.md"],
              write: [],
            },
          },
        },
      }),
    ).toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: ["/tmp/project/README.md"],
          write: null,
        },
      },
      scope: "session",
    });
  });
});

const COMPUTER_USE_ELICITATION_PARAMS = {
  threadId: "t1",
  turnId: "turn-cua",
  serverName: "cua_repl",
  mode: "form",
  _meta: {
    callId: "call_cua",
    codex_approval_kind: "mcp_tool_call",
    connector_id: "computer-use",
    connector_name: "Computer Use",
    persist: ["session", "always"],
    riskLevel: "low",
    tool_name: "get_app_state",
    tool_params: { app: "dev.kaioken.desktop" },
    tool_params_display: [
      { display_name: "App", name: "app", value: "Kaioken" },
    ],
  },
  message: 'Allow Computer Use to use "Kaioken"?',
  requestedSchema: { type: "object", properties: {} },
};

describe("MCP elicitation requests", () => {
  it("maps an empty-form elicitation into a tool_use approval", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 21,
        method: "mcpServer/elicitation/request",
        params: COMPUTER_USE_ELICITATION_PARAMS,
      }),
    ).toEqual({
      requestId: 21,
      method: "mcpServer/elicitation/request",
      providerThreadId: "t1",
      turnId: "turn-cua",
      payload: {
        kind: "approval",
        subject: {
          kind: "tool_use",
          itemId: "call_cua",
          tool: "get_app_state",
          presentation: {
            label: {
              pending: "Waiting for Computer Use approval",
              completed: "Answered Computer Use approval",
            },
            icon: { glyph: "Toolbox" },
            title: "Computer Use",
            detail: "App: Kaioken",
          },
        },
        reason: 'Allow Computer Use to use "Kaioken"?',
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      },
      context: {
        kind: "elicitation",
        persist: ["session", "always"],
        properties: {},
      },
    });
  });

  it("omits session approval and falls back to the server name without metadata", () => {
    const decoded = decodeCodexInteractiveRequest({
      id: 22,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "t1",
        turnId: null,
        serverName: "docs",
        mode: "form",
        message: "Continue?",
        requestedSchema: { type: "object", properties: {} },
      },
    });
    expect(decoded?.turnId).toBeNull();
    expect(decoded?.payload).toEqual({
      kind: "approval",
      subject: {
        kind: "tool_use",
        itemId: "docs:elicitation:22",
        tool: "docs",
        presentation: {
          label: {
            pending: "Waiting for docs approval",
            completed: "Answered docs approval",
          },
          icon: { glyph: "Toolbox" },
          title: "docs",
        },
      },
      reason: "Continue?",
      availableDecisions: ["allow_once", "deny"],
    });
  });

  it("maps a form with fields into a user question", () => {
    const decoded = decodeCodexInteractiveRequest({
      id: 23,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "t1",
        turnId: "turn-form",
        serverName: "deploy",
        mode: "form",
        message: "Configure the deploy",
        requestedSchema: {
          type: "object",
          properties: {
            confirm: { type: "boolean", title: "Confirm deploy" },
            region: {
              type: "string",
              enum: ["us", "eu"],
              enumNames: ["United States", "Europe"],
            },
            tags: {
              type: "array",
              items: { oneOf: [{ const: "a", title: "Alpha" }] },
            },
            note: { type: "string", description: "Release note" },
          },
          required: ["confirm"],
        },
      },
    });
    expect(decoded?.payload).toEqual({
      kind: "user_question",
      questions: [
        {
          id: "confirm",
          prompt: "Configure the deploy\n\nConfirm deploy",
          shortLabel: "Confirm deploy",
          multiSelect: false,
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
          allowFreeText: false,
        },
        {
          id: "region",
          prompt: "region",
          shortLabel: "region",
          multiSelect: false,
          options: [
            { value: "us", label: "United States" },
            { value: "eu", label: "Europe" },
          ],
          allowFreeText: false,
        },
        {
          id: "tags",
          prompt: "tags",
          shortLabel: "tags",
          multiSelect: true,
          options: [{ value: "a", label: "Alpha" }],
          allowFreeText: false,
        },
        {
          id: "note",
          prompt: "note: Release note",
          shortLabel: "note",
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    });
  });

  it("declines elicitation modes it cannot render instead of failing the request", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 24,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "t1",
          turnId: "turn-url",
          serverName: "auth",
          mode: "url",
          message: "Sign in",
          url: "https://example.com",
          elicitationId: "e1",
        },
      }),
    ).toBeNull();
    expect(
      buildCodexDeclinedElicitationResponse("mcpServer/elicitation/request"),
    ).toEqual({ action: "decline", content: null });
    expect(
      buildCodexDeclinedElicitationResponse("item/tool/requestUserInput"),
    ).toBeNull();
  });

  it("answers tool_use approvals with accept, session persistence, or decline", () => {
    const decoded = decodeCodexInteractiveRequest({
      id: 25,
      method: "mcpServer/elicitation/request",
      params: COMPUTER_USE_ELICITATION_PARAMS,
    });
    if (decoded === null) throw new Error("expected a decoded request");
    expect(
      buildCodexInteractiveResponseForResolution(decoded, {
        decision: "allow_once",
        grantedPermissions: null,
      }),
    ).toEqual({ action: "accept", content: {} });
    expect(
      buildCodexInteractiveResponseForResolution(decoded, {
        decision: "allow_for_session",
        grantedPermissions: null,
      }),
    ).toEqual({
      action: "accept",
      content: {},
      _meta: { persist: "session" },
    });
    expect(
      buildCodexInteractiveResponseForResolution(decoded, {
        decision: "deny",
      }),
    ).toEqual({ action: "decline", content: null });
  });

  it("rejects tool_use approvals that lack an elicitation context", () => {
    expect(() =>
      buildCodexInteractiveResponse({
        payload: {
          kind: "approval",
          subject: {
            kind: "tool_use",
            itemId: "item",
            tool: "tool",
            presentation: {
              label: { pending: "Waiting", completed: "Done" },
              icon: { glyph: "Toolbox" },
            },
          },
          reason: null,
          availableDecisions: ["allow_once", "deny"],
        },
        resolution: { decision: "allow_once", grantedPermissions: null },
      }),
    ).toThrow(/elicitation context/);
  });

  it("encodes form answers using the requested property types", () => {
    const decoded = decodeCodexInteractiveRequest({
      id: 26,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "t1",
        turnId: "turn-form",
        serverName: "deploy",
        mode: "form",
        message: "",
        requestedSchema: {
          type: "object",
          properties: {
            confirm: { type: "boolean" },
            count: { type: "integer" },
            tags: { type: "array", items: { enum: ["a", "b"] } },
            note: { type: "string" },
          },
        },
      },
    });
    if (decoded === null) throw new Error("expected a decoded request");
    expect(
      buildCodexInteractiveResponseForResolution(decoded, {
        kind: "user_answer",
        answers: {
          confirm: { selected: ["true"] },
          count: { selected: [], freeText: "3" },
          tags: { selected: ["a", "b"] },
        },
      }),
    ).toEqual({
      action: "accept",
      content: { confirm: true, count: 3, tags: ["a", "b"] },
    });
  });
});

describe("tool user input requests", () => {
  const params = {
    threadId: "t1",
    turnId: "turn-input",
    itemId: "item-input",
    isBlocking: true,
    questions: [
      {
        id: "env",
        header: "Environment",
        question: "Which environment?",
        options: [
          { label: "Staging", description: "Pre-production" },
          { label: "Production", description: "" },
        ],
        isOther: true,
      },
      { id: "reason", header: "", question: "Why?", options: null },
    ],
  };

  it("maps request_user_input questions into a user question", () => {
    expect(
      decodeCodexInteractiveRequest({
        id: 31,
        method: "item/tool/requestUserInput",
        params,
      }),
    ).toEqual({
      requestId: 31,
      method: "item/tool/requestUserInput",
      providerThreadId: "t1",
      turnId: "turn-input",
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "env",
            prompt: "Which environment?",
            shortLabel: "Environment",
            multiSelect: false,
            options: [
              {
                value: "env:option-1",
                label: "Staging",
                description: "Pre-production",
              },
              { value: "env:option-2", label: "Production" },
            ],
            allowFreeText: true,
          },
          {
            id: "reason",
            prompt: "Why?",
            multiSelect: false,
            allowFreeText: true,
          },
        ],
      },
      context: {
        kind: "user_input",
        optionLabels: {
          env: { "env:option-1": "Staging", "env:option-2": "Production" },
          reason: {},
        },
      },
    });
  });

  it("answers with option labels and free text, leaving unanswered questions empty", () => {
    const decoded = decodeCodexInteractiveRequest({
      id: 32,
      method: "item/tool/requestUserInput",
      params,
    });
    if (decoded === null) throw new Error("expected a decoded request");
    expect(
      buildCodexInteractiveResponseForResolution(decoded, {
        kind: "user_answer",
        answers: { env: { selected: ["env:option-2"], freeText: "with care" } },
      }),
    ).toEqual({
      answers: {
        env: { answers: ["Production", "with care"] },
        reason: { answers: [] },
      },
    });
  });

  it("requires the request context to answer user questions", () => {
    expect(() =>
      buildCodexUserQuestionResponse({
        payload: {
          kind: "user_question",
          questions: [
            { id: "q", prompt: "?", multiSelect: false, allowFreeText: true },
          ],
        },
        resolution: { kind: "user_answer", answers: {} },
      }),
    ).toThrow(/request context/);
  });
});
