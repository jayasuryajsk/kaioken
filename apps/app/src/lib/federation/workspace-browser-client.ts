import type { KaiokenDesktopBrowserApi } from "@kaioken/desktop-contract";
import {
  workspaceBrowserEventSchema,
  type WorkspaceBrowserCommand,
  type WorkspaceBrowserEvent,
} from "./workspace-browser-protocol";
import {
  getWorkspaceBrowserApi,
  setWorkspaceBrowserApi,
} from "./workspace-browser-store";

export function installWorkspaceBrowserApi(embedding: {
  origin: string;
  nonce: string;
  serverId: string;
}): () => void {
  const listeners = new Set<(event: WorkspaceBrowserEvent) => void>();
  const send = (command: WorkspaceBrowserCommand) =>
    window.parent.postMessage(
      {
        type: "kaioken:workspace-browser-request",
        nonce: embedding.nonce,
        serverId: embedding.serverId,
        command,
      },
      embedding.origin,
    );
  const subscribe = (listener: (event: WorkspaceBrowserEvent) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const listener = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== embedding.origin)
      return;
    const parsed = workspaceBrowserEventSchema.safeParse(event.data);
    if (
      !parsed.success ||
      parsed.data.nonce !== embedding.nonce ||
      parsed.data.serverId !== embedding.serverId
    )
      return;
    for (const subscriber of listeners) subscriber(parsed.data);
  };
  const api: KaiokenDesktopBrowserApi = {
    attach: (request) => send({ method: "attach", request }),
    detach: (tabId) => send({ method: "detach", request: { tabId } }),
    navigate: (request) => send({ method: "navigate", request }),
    goBack: (tabId) => send({ method: "goBack", request: { tabId } }),
    goForward: (tabId) => send({ method: "goForward", request: { tabId } }),
    reload: (tabId) => send({ method: "reload", request: { tabId } }),
    stop: (tabId) => send({ method: "stop", request: { tabId } }),
    focus: (tabId) => send({ method: "focus", request: { tabId } }),
    setBounds: (request) => send({ method: "setBounds", request }),
    setVisible: (request) => send({ method: "setVisible", request }),
    setVisibleWithoutFocus: (request) =>
      send({ method: "setVisibleWithoutFocus", request }),
    findInPage: (request) => send({ method: "findInPage", request }),
    stopFindInPage: (request) => send({ method: "stopFindInPage", request }),
    onState: (handler) =>
      subscribe((event) => {
        if (event.event === "state") handler(event.value);
      }),
    onOpenTab: (handler) =>
      subscribe((event) => {
        if (event.event === "openTab") handler({ url: event.value.url });
      }),
    onScopedOpenTab: (handler) =>
      subscribe((event) => {
        if (event.event === "openTab") handler(event.value);
      }),
    onFocus: (handler) =>
      subscribe((event) => {
        if (event.event === "focus") handler(event.value.tabId);
      }),
    onSnapshot: (handler) =>
      subscribe((event) => {
        if (event.event === "snapshot") handler(event.value);
      }),
    onFindResult: (handler) =>
      subscribe((event) => {
        if (event.event === "findResult") handler(event.value);
      }),
  };
  setWorkspaceBrowserApi(api);
  window.addEventListener("message", listener);
  return () => {
    window.removeEventListener("message", listener);
    listeners.clear();
    if (getWorkspaceBrowserApi() === api) setWorkspaceBrowserApi(null);
  };
}
