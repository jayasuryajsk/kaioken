// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY } from "@kaioken/client-core";
import type { ThreadStatus } from "@kaioken/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_SUMMARY_PROMPT, useProviderHandoff } from "./provider-handoff";

const mocks = vi.hoisted(() => ({
  output: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { output: mocks.output } },
}));

function renderHandoff(initialStatus: ThreadStatus) {
  const navigate = vi.fn();
  const mutateAsync = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    ({ status }: { status: ThreadStatus }) =>
      useProviderHandoff({
        thread: {
          id: "thr_source",
          projectId: "proj_1",
          environmentId: "env_1",
          status,
        },
        sourceThreadTitle: "Source thread",
        providerOptions: [
          { value: "codex", label: "Codex" },
          { value: "claude-code", label: "Claude Code" },
        ],
        execution: {
          model: "gpt-5",
          supportsServiceTier: false,
          serviceTier: undefined,
          reasoningLevel: "medium",
          permissionMode: "auto",
          executionInputSources: {},
        },
        sendMessage: { mutateAsync },
        navigate,
      }),
    { initialProps: { status: initialStatus } },
  );
  return { ...hook, navigate, mutateAsync };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useProviderHandoff", () => {
  it("sends the summary request, waits for the turn to finish, then opens compose with the summary and target", async () => {
    mocks.output.mockResolvedValue({ output: "Goal: ship it. Next: tests." });
    const { result, rerender, navigate, mutateAsync } = renderHandoff("idle");

    act(() => {
      result.current.request({
        providerId: "claude-code",
        model: "claude-opus-5",
        reasoningLevel: "high",
      });
    });
    expect(result.current.state?.phase.kind).toBe("confirm");
    expect(result.current.state?.target.providerLabel).toBe("Claude Code");

    await act(async () => {
      await result.current.confirm();
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      id: "thr_source",
      input: [{ type: "text", text: HANDOFF_SUMMARY_PROMPT }],
    });
    expect(result.current.state?.phase.kind).toBe("summarizing");
    expect(navigate).not.toHaveBeenCalled();

    rerender({ status: "active" });
    expect(navigate).not.toHaveBeenCalled();

    rerender({ status: "idle" });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledTimes(1);
    });
    expect(mocks.output).toHaveBeenCalledWith({ threadId: "thr_source" });
    expect(navigate).toHaveBeenCalledWith("/projects/proj_1", {
      state: {
        focusPrompt: true,
        reuseEnvironmentId: "env_1",
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          environmentId: "env_1",
          projectId: "proj_1",
          sourceThreadId: "thr_source",
          sourceThreadTitle: "Source thread",
          summary: "Goal: ship it. Next: tests.",
          target: {
            providerId: "claude-code",
            model: "claude-opus-5",
            reasoningLevel: "high",
          },
        },
      },
    });
    expect(result.current.state).toBeNull();
  });

  it("does not navigate when the thread was already idle before the summary turn started", async () => {
    mocks.output.mockResolvedValue({ output: "stale" });
    const { result, rerender, navigate } = renderHandoff("idle");

    act(() => {
      result.current.request({ providerId: "claude-code", model: "m" });
    });
    await act(async () => {
      await result.current.confirm();
    });
    rerender({ status: "idle" });

    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.state?.phase.kind).toBe("summarizing");
  });

  it("reports a failed summary turn instead of handing off", async () => {
    const { result, rerender, navigate } = renderHandoff("idle");

    act(() => {
      result.current.request({ providerId: "claude-code", model: "m" });
    });
    await act(async () => {
      await result.current.confirm();
    });
    rerender({ status: "active" });
    rerender({ status: "error" });

    expect(result.current.state?.phase).toEqual({
      kind: "failed",
      message: "The thread stopped with an error before writing the summary.",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refuses to start while the thread is busy and cancels cleanly", () => {
    const { result } = renderHandoff("active");
    expect(result.current.canStart).toBe(false);
    act(() => {
      result.current.request({ providerId: "claude-code", model: "m" });
    });
    expect(result.current.state).not.toBeNull();
    act(() => {
      result.current.cancel();
    });
    expect(result.current.state).toBeNull();
  });
});
