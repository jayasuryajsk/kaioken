import {
  clampBbDesktopBrowserViewBounds,
  type KaiokenDesktopBrowserApi,
  type KaiokenDesktopBrowserViewBounds,
} from "@kaioken/desktop-contract";
import {
  workspaceBrowserRequestSchema,
  type WorkspaceBrowserEvent,
} from "./workspace-browser-protocol";

export function createWorkspaceBrowserHost(args: {
  api: KaiokenDesktopBrowserApi;
  frame: HTMLIFrameElement;
  origin: string;
  nonce: string;
  serverId: string;
  active: boolean;
}) {
  const { api, frame, origin, nonce, serverId } = args;
  const prefix = `workspace:${serverId}:${nonce}:`;
  const tabs = new Map<
    string,
    {
      threadId: string;
      bounds: KaiokenDesktopBrowserViewBounds;
      visible: boolean;
    }
  >();
  let active = args.active;
  const bounds = (relative: KaiokenDesktopBrowserViewBounds) => {
    const rect = frame.getBoundingClientRect();
    const clipped = clampBbDesktopBrowserViewBounds({
      bounds: relative,
      viewport: { width: rect.width, height: rect.height },
    });
    return {
      ...clipped,
      x: Math.round(rect.x + clipped.x),
      y: Math.round(rect.y + clipped.y),
    };
  };
  const send = (event: WorkspaceBrowserEvent) =>
    frame.contentWindow?.postMessage(event, origin);
  const localTab = (id: string) =>
    id.startsWith(prefix) && tabs.has(id.slice(prefix.length))
      ? id.slice(prefix.length)
      : null;
  const subscriptions = [
    api.onState((value) => {
      const tabId = localTab(value.tabId);
      if (tabId !== null)
        send({
          type: "kaioken:workspace-browser-event",
          nonce,
          serverId,
          event: "state",
          value: { ...value, tabId },
        });
    }),
    api.onScopedOpenTab?.((value) => {
      const tabId = localTab(value.tabId);
      if (tabId !== null && active)
        send({
          type: "kaioken:workspace-browser-event",
          nonce,
          serverId,
          event: "openTab",
          value: { ...value, tabId },
        });
    }),
    api.onFocus?.((id) => {
      const tabId = localTab(id);
      if (tabId !== null && active)
        send({
          type: "kaioken:workspace-browser-event",
          nonce,
          serverId,
          event: "focus",
          value: { tabId },
        });
    }),
    api.onSnapshot?.((value) => {
      const tabId = localTab(value.tabId);
      if (tabId !== null)
        send({
          type: "kaioken:workspace-browser-event",
          nonce,
          serverId,
          event: "snapshot",
          value: { ...value, tabId },
        });
    }),
    api.onFindResult?.((value) => {
      const tabId = localTab(value.tabId);
      if (tabId !== null)
        send({
          type: "kaioken:workspace-browser-event",
          nonce,
          serverId,
          event: "findResult",
          value: { ...value, tabId },
        });
    }),
  ];
  const reset = () => {
    for (const id of tabs.keys()) api.detach(`${prefix}${id}`);
    tabs.clear();
  };
  const listener = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const parsed = workspaceBrowserRequestSchema.safeParse(event.data);
    if (
      !parsed.success ||
      parsed.data.nonce !== nonce ||
      parsed.data.serverId !== serverId
    )
      return;
    const command = parsed.data.command;
    const id = command.request.tabId;
    const tabId = `${prefix}${id}`;
    if (command.method === "attach") {
      const previous = tabs.get(id);
      if (previous && previous.threadId !== command.request.threadId) return;
      tabs.set(id, {
        threadId: command.request.threadId,
        bounds: command.request.bounds,
        visible: command.request.visible,
      });
      api.attach({
        ...command.request,
        tabId,
        threadId: `${prefix}${command.request.threadId}`,
        bounds: bounds(command.request.bounds),
        visible: active && command.request.visible,
      });
      return;
    }
    const tab = tabs.get(id);
    if (!tab) return;
    switch (command.method) {
      case "detach":
        api.detach(tabId);
        tabs.delete(id);
        break;
      case "navigate":
        api.navigate({ ...command.request, tabId });
        break;
      case "setBounds":
        tab.bounds = command.request.bounds;
        api.setBounds({ tabId, bounds: bounds(tab.bounds) });
        break;
      case "setVisible":
      case "setVisibleWithoutFocus":
        tab.visible = command.request.visible;
        (command.method === "setVisibleWithoutFocus"
          ? (api.setVisibleWithoutFocus ?? api.setVisible)
          : api.setVisible)({ tabId, visible: active && tab.visible });
        break;
      case "focus":
        if (active) api.focus?.(tabId);
        break;
      case "findInPage":
        api.findInPage?.({ ...command.request, tabId });
        break;
      case "stopFindInPage":
        api.stopFindInPage?.({ ...command.request, tabId });
        break;
      default:
        api[command.method](tabId);
    }
  };
  const updateBounds = () => {
    for (const [id, tab] of tabs)
      api.setBounds({ tabId: `${prefix}${id}`, bounds: bounds(tab.bounds) });
  };
  const observer = new ResizeObserver(updateBounds);
  observer.observe(frame);
  window.addEventListener("message", listener);
  window.addEventListener("resize", updateBounds);
  return {
    reset,
    setActive(value: boolean) {
      active = value;
      for (const [id, tab] of tabs) {
        api.setBounds({ tabId: `${prefix}${id}`, bounds: bounds(tab.bounds) });
        (api.setVisibleWithoutFocus ?? api.setVisible)({
          tabId: `${prefix}${id}`,
          visible: active && tab.visible,
        });
      }
    },
    dispose() {
      reset();
      observer.disconnect();
      window.removeEventListener("message", listener);
      window.removeEventListener("resize", updateBounds);
      for (const unsubscribe of subscriptions) unsubscribe?.();
    },
  };
}
