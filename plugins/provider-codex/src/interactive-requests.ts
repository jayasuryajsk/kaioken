import {
  ProviderRequestDecodeError as ProviderRequestDecodeErrorValue,
  ProviderResponseEncodeError,
  approvalInteractionOutcomeSchema,
  experimental_presentationDetail as presentationDetail,
  userQuestionInteractionOutcomeSchema,
  type ApprovalInteractionOutcome,
  type ApprovalPendingInteractionPayload,
  type DecodedInteractiveRequest,
  type DeltaPresentation,
  type ProviderInboundRequest,
  type PendingInteractionApprovalDecision,
  type PendingInteractionGrantablePermissionProfile,
  type PendingInteractionGrantedPermissionProfile,
  type PendingInteractionRequestedPermissionProfile,
  type PendingInteractionUserQuestionQuestion,
  type UserQuestionInteractionOutcome,
  type UserQuestionPendingInteractionPayload,
  type UserQuestionPendingInteractionResolution,
} from "@get-kaioken/plugin-sdk/provider-bridge";
import type { CodexMacOsPermissionItem } from "./extension-kinds.js";
import { normalizePendingInteractionRequestedPermissionProfile } from "./pending-interaction-normalization.js";
import type { CommandExecutionRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/CommandExecutionRequestApprovalResponse.js";
import type { FileChangeRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/FileChangeRequestApprovalResponse.js";
import type { PermissionsRequestApprovalResponse } from "./generated/codex-app-server/schema/v2/PermissionsRequestApprovalResponse.js";
import {
  codexCommandExecutionRequestApprovalParamsSchema,
  codexFileChangeRequestApprovalParamsSchema,
  codexMcpElicitationRequestParamsSchema,
  codexPermissionsRequestApprovalParamsSchema,
  codexToolRequestUserInputParamsSchema,
} from "./schemas.js";
import type {
  CodexAdditionalPermissions,
  CodexCommandApprovalDecision,
  CodexElicitationProperty,
  CodexMcpElicitationRequestParams,
  CodexRequestedPermissionProfile,
  CodexSimpleCommandApprovalDecision,
  CodexToolRequestUserInputParams,
} from "./schemas.js";

export const CODEX_MCP_ELICITATION_REQUEST_METHOD =
  "mcpServer/elicitation/request";
export const CODEX_TOOL_REQUEST_USER_INPUT_METHOD =
  "item/tool/requestUserInput";

const USER_QUESTION_MAX_QUESTIONS = 4;
const USER_QUESTION_MAX_OPTIONS = 4;

export interface CodexMcpElicitationResponse {
  action: "accept" | "decline" | "cancel";
  content: Record<string, unknown> | null;
  _meta?: { persist: "session" };
}

export interface CodexToolRequestUserInputResponse {
  answers: Record<string, { answers: string[] }>;
}

type CodexInteractiveResponse =
  | CommandExecutionRequestApprovalResponse
  | FileChangeRequestApprovalResponse
  | PermissionsRequestApprovalResponse
  | CodexMcpElicitationResponse
  | CodexToolRequestUserInputResponse;

export type CodexInteractiveContext =
  | {
      kind: "elicitation";
      persist: readonly string[];
      properties: Record<string, CodexElicitationProperty>;
    }
  | {
      kind: "user_input";
      optionLabels: Record<string, Record<string, string>>;
    };

export interface CodexDecodedInteractiveRequest extends DecodedInteractiveRequest {
  context?: CodexInteractiveContext;
}

export type CodexApprovalInteractiveOutcome = ApprovalInteractionOutcome & {
  context?: CodexInteractiveContext;
};

export type CodexUserQuestionInteractiveOutcome =
  UserQuestionInteractionOutcome & {
    context?: CodexInteractiveContext;
  };

type UserQuestionOption = NonNullable<
  PendingInteractionUserQuestionQuestion["options"]
>[number];

const DECLINED_ELICITATION_RESPONSE: CodexMcpElicitationResponse = {
  action: "decline",
  content: null,
};

function assertNever(value: never): never {
  throw new ProviderResponseEncodeError(`Unexpected value: ${String(value)}`);
}

function requireGrantedPermissions(
  args: Extract<
    ApprovalInteractionOutcome["resolution"],
    { decision: "allow_once" | "allow_for_session" }
  >,
) {
  if (args.grantedPermissions === null) {
    throw new ProviderResponseEncodeError(
      "Permission grant approval must include granted permissions",
    );
  }
  return args.grantedPermissions;
}

function hasGrantablePermissions(
  permissions: PendingInteractionGrantablePermissionProfile | null,
): boolean {
  const fileSystem = permissions?.fileSystem ?? null;
  return (
    permissions?.network?.enabled === true ||
    (fileSystem !== null &&
      (fileSystem.read.length > 0 || fileSystem.write.length > 0))
  );
}

function filterSessionDecisionWithoutGrant(
  decisions: PendingInteractionApprovalDecision[],
  sessionGrant: PendingInteractionGrantablePermissionProfile | null,
): PendingInteractionApprovalDecision[] {
  if (hasGrantablePermissions(sessionGrant)) {
    return decisions;
  }

  const filtered = decisions.filter(
    (decision) => decision !== "allow_for_session",
  );
  if (filtered.length === 0) {
    throw new ProviderRequestDecodeErrorValue(
      "Approval request did not include decisions compatible with the requested permissions",
    );
  }
  return filtered;
}

export function decodeCodexInteractiveRequest(
  request: ProviderInboundRequest,
): CodexDecodedInteractiveRequest | null {
  if (typeof request.id !== "string" && typeof request.id !== "number") {
    return null;
  }

  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const parsed = codexCommandExecutionRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const availableDecisions = parseCodexAvailableDecisions(
        parsed.data.availableDecisions,
      );
      if (!parsed.data.command) {
        throw new ProviderRequestDecodeErrorValue(
          "Command approval request did not include a command subject",
        );
      }
      const sessionGrant = parsed.data.additionalPermissions
        ? toPendingInteractionGrantablePermissionProfile(
            parsed.data.additionalPermissions,
          )
        : null;
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: parsed.data.itemId,
            command: parsed.data.command,
            cwd: parsed.data.cwd ?? null,
            actions: parsed.data.commandActions ?? [],
            sessionGrant: hasGrantablePermissions(sessionGrant)
              ? sessionGrant
              : null,
          },
          reason: parsed.data.reason ?? null,
          availableDecisions: filterSessionDecisionWithoutGrant(
            availableDecisions,
            sessionGrant,
          ),
        },
      };
    }
    case "item/fileChange/requestApproval": {
      const parsed = codexFileChangeRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const sessionGrant: PendingInteractionGrantablePermissionProfile | null =
        parsed.data.grantRoot
          ? {
              network: null,
              fileSystem: {
                read: [],
                write: [parsed.data.grantRoot],
              },
            }
          : null;
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "file_change",
            itemId: parsed.data.itemId,
            writeScope: parsed.data.grantRoot ?? null,
            sessionGrant,
          },
          reason: parsed.data.reason ?? null,
          availableDecisions: filterSessionDecisionWithoutGrant(
            ["allow_once", "allow_for_session", "deny"],
            sessionGrant,
          ),
        },
      };
    }
    case "item/permissions/requestApproval": {
      const parsed = codexPermissionsRequestApprovalParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      const permissions = toPendingInteractionGrantablePermissionProfile(
        parsed.data.permissions,
      );
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.threadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "permission_grant",
            itemId: parsed.data.itemId,
            toolName: null,
            permissions,
          },
          reason: parsed.data.reason,
          availableDecisions: ["allow_once", "allow_for_session", "deny"],
        },
      };
    }
    case CODEX_MCP_ELICITATION_REQUEST_METHOD: {
      const parsed = codexMcpElicitationRequestParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success || parsed.data.mode !== "form") {
        return null;
      }
      return decodeElicitationForm(request.id, request.method, parsed.data);
    }
    case CODEX_TOOL_REQUEST_USER_INPUT_METHOD: {
      const parsed = codexToolRequestUserInputParamsSchema.safeParse(
        request.params,
      );
      if (!parsed.success) {
        return null;
      }
      return decodeToolUserInput(request.id, request.method, parsed.data);
    }
    default:
      return null;
  }
}

export function buildCodexDeclinedElicitationResponse(
  method: string,
): CodexMcpElicitationResponse | null {
  return method === CODEX_MCP_ELICITATION_REQUEST_METHOD
    ? DECLINED_ELICITATION_RESPONSE
    : null;
}

function formatDisplayValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function elicitationApprovalPayload(
  requestId: string | number,
  params: CodexMcpElicitationRequestParams,
  persist: readonly string[],
): ApprovalPendingInteractionPayload {
  const meta = params._meta ?? null;
  const connector = meta?.connector_name ?? params.serverName;
  const detailLines = (meta?.tool_params_display ?? []).map(
    (param) => `${param.display_name}: ${formatDisplayValue(param.value)}`,
  );
  const presentation: DeltaPresentation = {
    label: {
      pending: `Waiting for ${connector} approval`,
      completed: `Answered ${connector} approval`,
    },
    icon: { glyph: "Toolbox" },
    title: connector,
    ...(detailLines.length > 0
      ? { detail: presentationDetail(detailLines.join("\n")) }
      : {}),
  };
  const message = params.message.trim();
  return {
    kind: "approval",
    subject: {
      kind: "tool_use",
      itemId:
        meta?.callId ?? `${params.serverName}:elicitation:${String(requestId)}`,
      tool: meta?.tool_name ?? params.serverName,
      presentation,
    },
    reason: message.length > 0 ? message : null,
    availableDecisions: persist.includes("session")
      ? ["allow_once", "allow_for_session", "deny"]
      : ["allow_once", "deny"],
  };
}

function elicitationOptions(
  property: CodexElicitationProperty,
): UserQuestionOption[] {
  if (property.type === "boolean") {
    return [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ];
  }
  const titled = property.oneOf ?? property.items?.oneOf;
  if (titled !== undefined) {
    return titled
      .filter((option) => option.const.length > 0 && option.title.length > 0)
      .map((option) => ({ value: option.const, label: option.title }));
  }
  const values = property.enum ?? property.items?.enum;
  if (values !== undefined) {
    return values
      .filter((value) => value.length > 0)
      .map((value, index) => {
        const name = property.enumNames?.[index];
        return {
          value,
          label: name !== undefined && name.length > 0 ? name : value,
        };
      });
  }
  return [];
}

function elicitationQuestionPayload(
  params: CodexMcpElicitationRequestParams,
  properties: Record<string, CodexElicitationProperty>,
): UserQuestionPendingInteractionPayload | null {
  const entries = Object.entries(properties);
  if (entries.length > USER_QUESTION_MAX_QUESTIONS) {
    return null;
  }
  const message = params.message.trim();
  const questions: PendingInteractionUserQuestionQuestion[] = [];
  for (const [index, [key, property]] of entries.entries()) {
    const title = property.title?.trim();
    const label = title !== undefined && title.length > 0 ? title : key;
    const description = property.description?.trim();
    const promptLine =
      description !== undefined && description.length > 0
        ? `${label}: ${description}`
        : label;
    const options = elicitationOptions(property);
    if (options.length > USER_QUESTION_MAX_OPTIONS) {
      return null;
    }
    questions.push({
      id: key,
      prompt:
        index === 0 && message.length > 0
          ? `${message}\n\n${promptLine}`
          : promptLine,
      shortLabel: label,
      multiSelect: property.type === "array",
      ...(options.length > 0 ? { options } : {}),
      allowFreeText: options.length === 0,
    });
  }
  return { kind: "user_question", questions };
}

function decodeElicitationForm(
  requestId: string | number,
  method: string,
  params: CodexMcpElicitationRequestParams,
): CodexDecodedInteractiveRequest | null {
  const properties = params.requestedSchema?.properties ?? {};
  const persist = params._meta?.persist ?? [];
  const payload =
    Object.keys(properties).length === 0
      ? elicitationApprovalPayload(requestId, params, persist)
      : elicitationQuestionPayload(params, properties);
  if (payload === null) {
    return null;
  }
  return {
    requestId,
    method,
    providerThreadId: params.threadId,
    turnId: params.turnId ?? null,
    payload,
    context: { kind: "elicitation", persist, properties },
  };
}

function decodeToolUserInput(
  requestId: string | number,
  method: string,
  params: CodexToolRequestUserInputParams,
): CodexDecodedInteractiveRequest | null {
  if (
    params.questions.length === 0 ||
    params.questions.length > USER_QUESTION_MAX_QUESTIONS
  ) {
    return null;
  }
  const optionLabels: Record<string, Record<string, string>> = {};
  const questions: PendingInteractionUserQuestionQuestion[] = [];
  for (const question of params.questions) {
    const labels: Record<string, string> = {};
    const options: UserQuestionOption[] = [];
    for (const [index, option] of (question.options ?? []).entries()) {
      if (option.label.length === 0) {
        continue;
      }
      const value = `${question.id}:option-${index + 1}`;
      labels[value] = option.label;
      const description = option.description?.trim();
      options.push({
        value,
        label: option.label,
        ...(description !== undefined && description.length > 0
          ? { description }
          : {}),
      });
    }
    if (options.length > USER_QUESTION_MAX_OPTIONS) {
      return null;
    }
    optionLabels[question.id] = labels;
    const header = question.header.trim();
    questions.push({
      id: question.id,
      prompt: question.question,
      ...(header.length > 0 ? { shortLabel: header } : {}),
      multiSelect: false,
      ...(options.length > 0 ? { options } : {}),
      allowFreeText: options.length === 0 || question.isOther === true,
    });
  }
  return {
    requestId,
    method,
    providerThreadId: params.threadId,
    turnId: params.turnId,
    payload: { kind: "user_question", questions },
    context: { kind: "user_input", optionLabels },
  };
}

function elicitationAnswerValue(
  property: CodexElicitationProperty,
  answer: UserQuestionPendingInteractionResolution["answers"][string],
): unknown {
  const text = answer.freeText ?? answer.selected[0];
  switch (property.type) {
    case "boolean":
      return text === "true" ? true : text === "false" ? false : undefined;
    case "number":
    case "integer": {
      if (text === undefined) {
        return undefined;
      }
      const numeric = Number(text);
      return Number.isFinite(numeric) ? numeric : undefined;
    }
    case "array":
      return answer.selected;
    default:
      return text;
  }
}

function elicitationFormContent(
  properties: Record<string, CodexElicitationProperty>,
  resolution: UserQuestionPendingInteractionResolution,
): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    const answer = resolution.answers[key];
    if (answer === undefined) {
      continue;
    }
    const value = elicitationAnswerValue(property, answer);
    if (value !== undefined) {
      content[key] = value;
    }
  }
  return content;
}

function toolUserInputAnswers(
  questionId: string,
  answer:
    | UserQuestionPendingInteractionResolution["answers"][string]
    | undefined,
  optionLabels: Record<string, Record<string, string>>,
): string[] {
  if (answer === undefined) {
    return [];
  }
  const labels = optionLabels[questionId] ?? {};
  const selected = answer.selected.map((value) => labels[value] ?? value);
  return answer.freeText === undefined
    ? selected
    : [...selected, answer.freeText];
}

export function buildCodexUserQuestionResponse(
  args: CodexUserQuestionInteractiveOutcome,
): CodexInteractiveResponse {
  const context = args.context;
  if (context === undefined) {
    throw new ProviderResponseEncodeError(
      "Codex user question responses require the originating request context",
    );
  }
  switch (context.kind) {
    case "elicitation": {
      const response: CodexMcpElicitationResponse = {
        action: "accept",
        content: elicitationFormContent(context.properties, args.resolution),
      };
      return response;
    }
    case "user_input": {
      const response: CodexToolRequestUserInputResponse = {
        answers: Object.fromEntries(
          args.payload.questions.map((question) => [
            question.id,
            {
              answers: toolUserInputAnswers(
                question.id,
                args.resolution.answers[question.id],
                context.optionLabels,
              ),
            },
          ]),
        ),
      };
      return response;
    }
    default:
      return assertNever(context);
  }
}

export function buildCodexInteractiveResponseForResolution(
  request: CodexDecodedInteractiveRequest,
  resolution: unknown,
): CodexInteractiveResponse {
  if (request.payload.kind === "user_question") {
    const outcome = userQuestionInteractionOutcomeSchema.parse({
      payload: request.payload,
      resolution,
    });
    return buildCodexUserQuestionResponse({
      ...outcome,
      ...(request.context === undefined ? {} : { context: request.context }),
    });
  }
  const outcome = approvalInteractionOutcomeSchema.parse({
    payload: request.payload,
    resolution,
  });
  return buildCodexInteractiveResponse({
    ...outcome,
    ...(request.context === undefined ? {} : { context: request.context }),
  });
}

export function buildCodexInteractiveResponse(
  args: CodexApprovalInteractiveOutcome,
): CodexInteractiveResponse {
  switch (args.payload.subject.kind) {
    case "command": {
      const response: CommandExecutionRequestApprovalResponse = {
        decision: toCodexCommandApprovalDecision(args.resolution.decision),
      };
      return response;
    }
    case "file_change": {
      const response: FileChangeRequestApprovalResponse = {
        decision:
          pendingInteractionToCodexFileChangeApprovalDecision[
            args.resolution.decision
          ],
      };
      return response;
    }
    case "permission_grant": {
      if (args.resolution.decision === "deny") {
        const response: PermissionsRequestApprovalResponse = {
          permissions: {},
          scope: "turn",
        };
        return response;
      }
      const response: PermissionsRequestApprovalResponse = {
        permissions: toCodexGrantedPermissionProfile(
          requireGrantedPermissions(args.resolution),
        ),
        scope:
          args.resolution.decision === "allow_for_session" ? "session" : "turn",
      };
      return response;
    }
    case "plan":
      throw new ProviderResponseEncodeError(
        "Codex plan-review interactive requests are unsupported",
      );
    case "tool_use": {
      if (args.context?.kind !== "elicitation") {
        throw new ProviderResponseEncodeError(
          "tool_use approval subjects require an MCP elicitation context",
        );
      }
      if (args.resolution.decision === "deny") {
        return DECLINED_ELICITATION_RESPONSE;
      }
      const response: CodexMcpElicitationResponse = {
        action: "accept",
        content: {},
        ...(args.resolution.decision === "allow_for_session" &&
        args.context.persist.includes("session")
          ? { _meta: { persist: "session" } }
          : {}),
      };
      return response;
    }
    default:
      return assertNever(args.payload.subject);
  }
}

const codexToPendingInteractionApprovalDecision = {
  accept: "allow_once",
  acceptForSession: "allow_for_session",
  decline: "deny",
  cancel: "deny",
} satisfies Record<
  CodexSimpleCommandApprovalDecision,
  PendingInteractionApprovalDecision
>;

const pendingInteractionToCodexSimpleApprovalDecision = {
  allow_once: "accept",
  allow_for_session: "acceptForSession",
  deny: "decline",
} satisfies Record<
  PendingInteractionApprovalDecision,
  Exclude<CodexSimpleCommandApprovalDecision, "cancel">
>;

const pendingInteractionToCodexFileChangeApprovalDecision = {
  allow_once: "accept",
  allow_for_session: "acceptForSession",
  deny: "decline",
} satisfies Record<
  PendingInteractionApprovalDecision,
  FileChangeRequestApprovalResponse["decision"]
>;

function toPendingInteractionPermissionProfile(
  permissions: CodexAdditionalPermissions | CodexRequestedPermissionProfile,
): PendingInteractionRequestedPermissionProfile {
  return normalizePendingInteractionRequestedPermissionProfile({
    network: permissions.network
      ? { enabled: permissions.network.enabled }
      : null,
    fileSystem: permissions.fileSystem
      ? {
          read: permissions.fileSystem.read ?? [],
          write: permissions.fileSystem.write ?? [],
        }
      : null,
    macos:
      "macos" in permissions && permissions.macos
        ? {
            preferences: permissions.macos.preferences,
            automations: permissions.macos.automations,
            launchServices: permissions.macos.launchServices,
            accessibility: permissions.macos.accessibility,
            calendar: permissions.macos.calendar,
            reminders: permissions.macos.reminders,
            contacts: permissions.macos.contacts,
          }
        : null,
  });
}

function toPendingInteractionGrantablePermissionProfile(
  permissions: CodexAdditionalPermissions | CodexRequestedPermissionProfile,
): PendingInteractionGrantablePermissionProfile {
  const normalized = toPendingInteractionPermissionProfile(permissions);
  return {
    network: normalized.network,
    fileSystem: normalized.fileSystem,
  };
}

export interface CodexMacOsPermissionRequest {
  providerThreadId: string;
  turnId: string;
  item: CodexMacOsPermissionItem;
}

export function extractCodexMacOsPermissionRequest(
  request: ProviderInboundRequest,
): CodexMacOsPermissionRequest | null {
  if (request.method !== "item/commandExecution/requestApproval") {
    return null;
  }
  const parsed = codexCommandExecutionRequestApprovalParamsSchema.safeParse(
    request.params,
  );
  if (!parsed.success) {
    return null;
  }
  const macos = parsed.data.additionalPermissions?.macos;
  if (macos === null || macos === undefined) {
    return null;
  }
  return {
    providerThreadId: parsed.data.threadId,
    turnId: parsed.data.turnId,
    item: {
      approvalItemId: parsed.data.itemId,
      reason: parsed.data.reason ?? null,
      permissions: macos,
    },
  };
}

function toCodexGrantedPermissionProfile(
  args: PendingInteractionGrantedPermissionProfile,
): PermissionsRequestApprovalResponse["permissions"] {
  return {
    ...(args.network ? { network: { enabled: args.network.enabled } } : {}),
    ...(args.fileSystem
      ? {
          fileSystem: {
            read: args.fileSystem.read.length > 0 ? args.fileSystem.read : null,
            write:
              args.fileSystem.write.length > 0 ? args.fileSystem.write : null,
          },
        }
      : {}),
  };
}

function fromCodexCommandApprovalDecision(
  decision: CodexSimpleCommandApprovalDecision,
): PendingInteractionApprovalDecision {
  return codexToPendingInteractionApprovalDecision[decision];
}

type CodexPolicyAmendmentDecision = Extract<
  CodexCommandApprovalDecision,
  object
>;

function isCodexPolicyAmendmentDecision(
  decision: CodexCommandApprovalDecision,
): decision is CodexPolicyAmendmentDecision {
  return (
    typeof decision === "object" &&
    decision !== null &&
    ("acceptWithExecpolicyAmendment" in decision ||
      "applyNetworkPolicyAmendment" in decision)
  );
}

function toCodexCommandApprovalDecision(
  decision: PendingInteractionApprovalDecision,
): CommandExecutionRequestApprovalResponse["decision"] {
  return pendingInteractionToCodexSimpleApprovalDecision[decision];
}

function parseCodexAvailableDecisions(
  decisions: CodexCommandApprovalDecision[] | null | undefined,
): PendingInteractionApprovalDecision[] {
  if (!decisions) {
    return ["allow_once", "allow_for_session", "deny"];
  }
  if (decisions.length === 0) {
    throw new ProviderRequestDecodeErrorValue(
      "Command approval requests must include at least one available decision",
    );
  }

  const mappedDecisions: PendingInteractionApprovalDecision[] = [];
  for (const decision of decisions) {
    if (isCodexPolicyAmendmentDecision(decision)) {
      continue;
    }
    mappedDecisions.push(fromCodexCommandApprovalDecision(decision));
  }
  const uniqueDecisions = [...new Set(mappedDecisions)];
  if (uniqueDecisions.length === 0) {
    throw new ProviderRequestDecodeErrorValue(
      "Command approval request did not include provider-neutral decisions",
    );
  }
  return uniqueDecisions;
}
