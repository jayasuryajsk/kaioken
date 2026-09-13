import type {
  CodexHandoffResponse,
  CodexSessionListResponse,
  CodexSyncResponse,
  CodexThreadLinkResponse,
  ImportCodexSessionRequest,
  ThreadResponse,
} from "@kaioken/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface CodexSessionListArgs {
  includeArchived?: boolean;
  signal?: AbortSignal;
}

export interface CodexSessionImportArgs extends Omit<
  ImportCodexSessionRequest,
  "origin"
> {
  origin?: ImportCodexSessionRequest["origin"];
}

export interface CodexThreadArgs {
  threadId: string;
  signal?: AbortSignal;
}

export type CodexSessionListResult = CodexSessionListResponse;
export type CodexSessionImportResult = ThreadResponse;
export type CodexThreadLinkResult = CodexThreadLinkResponse;
export type CodexHandoffResult = CodexHandoffResponse;
export type CodexSyncResult = CodexSyncResponse;

export interface CodexSessionsArea {
  list(args?: CodexSessionListArgs): Promise<CodexSessionListResult>;
  import(args: CodexSessionImportArgs): Promise<CodexSessionImportResult>;
}

export interface CodexArea {
  sessions: CodexSessionsArea;
}

export interface ThreadCodexArea {
  link(args: CodexThreadArgs): Promise<CodexThreadLinkResult>;
  handoff(args: CodexThreadArgs): Promise<CodexHandoffResult>;
  sync(args: CodexThreadArgs): Promise<CodexSyncResult>;
}

export function createCodexArea(args: CreateSdkAreaArgs): CodexArea {
  const { transport } = args;
  return {
    sessions: {
      async list(input) {
        return transport.readJson(
          transport.api.v1.codex.sessions.$get(
            {
              query:
                input?.includeArchived === undefined
                  ? {}
                  : {
                      includeArchived: input.includeArchived ? "true" : "false",
                    },
            },
            ...signalRequestArgs(input?.signal),
          ),
        );
      },
      async import(input) {
        return transport.readJson(
          transport.api.v1.codex.sessions.import.$post({
            json: {
              id: input.id,
              ...(input.projectId !== undefined
                ? { projectId: input.projectId }
                : {}),
              origin: input.origin ?? "sdk",
            },
          }),
        );
      },
    },
  };
}

export function createThreadCodexArea(
  args: CreateSdkAreaArgs,
): ThreadCodexArea {
  const { transport } = args;
  return {
    async link(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].codex.$get(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async handoff(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].codex.handoff.$post(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async sync(input) {
      return transport.readJson(
        transport.api.v1.threads[":id"].codex.sync.$post(
          { param: { id: input.threadId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}
