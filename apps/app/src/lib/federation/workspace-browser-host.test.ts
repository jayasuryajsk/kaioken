// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import type { KaiokenDesktopBrowserStateHandler } from "@kaioken/desktop-contract";
import { createNoopDesktopBrowserApi } from "@/test/kaioken-desktop-test-utils";
import { createWorkspaceBrowserHost } from "./workspace-browser-host";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("isolates frame browser tabs, clips and translates bounds, and hides views when inactive", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(
    new DOMRect(280, 40, 900, 600),
  );
  const api = createNoopDesktopBrowserApi();
  const attach = vi.spyOn(api, "attach");
  const detach = vi.spyOn(api, "detach");
  const navigate = vi.spyOn(api, "navigate");
  const visible = vi.spyOn(api, "setVisibleWithoutFocus");
  const stateListeners = new Set<KaiokenDesktopBrowserStateHandler>();
  api.onState = (listener) => {
    stateListeners.add(listener);
    return () => {
      stateListeners.delete(listener);
    };
  };
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const nonce = crypto.randomUUID(),
    serverId = crypto.randomUUID(),
    origin = "https://remote.kaioken.app";
  const host = createWorkspaceBrowserHost({
    frame,
    api,
    nonce,
    serverId,
    origin,
    active: true,
  });
  const command = {
    method: "attach",
    request: {
      tabId: "tab",
      threadId: "task",
      url: "https://example.com",
      bounds: { x: 750, y: 100, width: 400, height: 600 },
      visible: true,
    },
  };
  const emit = (
    overrides: Record<string, unknown> = {},
    source: MessageEventSource | null = frame.contentWindow,
    eventOrigin = origin,
  ) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        origin: eventOrigin,
        data: {
          type: "kaioken:workspace-browser-request",
          nonce,
          serverId,
          command,
          ...overrides,
        },
      }),
    );
  emit({}, window);
  emit({}, frame.contentWindow, "https://unrelated.example");
  emit({ nonce: crypto.randomUUID() });
  emit({ serverId: crypto.randomUUID() });
  expect(attach).not.toHaveBeenCalled();
  emit();
  const nativeId = `workspace:${serverId}:${nonce}:tab`;
  expect(attach).toHaveBeenCalledWith(
    expect.objectContaining({
      tabId: nativeId,
      threadId: `workspace:${serverId}:${nonce}:task`,
      bounds: { x: 1030, y: 140, width: 150, height: 500 },
      visible: true,
    }),
  );
  emit({
    command: {
      method: "navigate",
      request: { tabId: "another-tab", url: "https://example.org" },
    },
  });
  expect(navigate).not.toHaveBeenCalled();
  host.setActive(false);
  expect(visible).toHaveBeenLastCalledWith({ tabId: nativeId, visible: false });
  emit({
    command: {
      method: "setVisibleWithoutFocus",
      request: { tabId: "tab", visible: true },
    },
  });
  expect(visible).toHaveBeenLastCalledWith({ tabId: nativeId, visible: false });
  host.setActive(true);
  expect(visible).toHaveBeenLastCalledWith({ tabId: nativeId, visible: true });
  const state = {
    tabId: "local-tab",
    url: "https://example.com",
    title: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
  };
  for (const listener of stateListeners) listener(state);
  expect(post).not.toHaveBeenCalled();
  for (const listener of stateListeners)
    listener({ ...state, tabId: nativeId });
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "state",
      value: { ...state, tabId: "tab" },
    }),
    origin,
  );
  host.dispose();
  expect(detach).toHaveBeenCalledWith(nativeId);
  expect(stateListeners.size).toBe(0);
  emit();
  expect(attach).toHaveBeenCalledTimes(1);
});
