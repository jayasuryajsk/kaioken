import {
  clientNotificationSchema,
  type ClientNotification,
} from "./contract.js";

export type ClientChannel = "web" | "desktop";

export function clientChannel(): ClientChannel | null {
  if ("kaiokenDesktop" in window) return "desktop";
  if (
    "kaioken" in window &&
    typeof window.kaioken === "object" &&
    window.kaioken !== null &&
    "native" in window.kaioken
  )
    return null;
  return "web";
}

export function notificationPermission():
  | NotificationPermission
  | "unsupported" {
  return typeof Notification === "undefined" || !window.isSecureContext
    ? "unsupported"
    : Notification.permission;
}

export function createClientDelivery(navigate: (threadId: string) => void) {
  const active = new Set<Notification>();
  let disposed = false;

  function display(message: ClientNotification): void {
    if (disposed || notificationPermission() !== "granted") return;
    const isMacDesktop =
      "kaiokenDesktop" in window &&
      typeof window.kaiokenDesktop === "object" &&
      window.kaiokenDesktop !== null &&
      "platform" in window.kaiokenDesktop &&
      window.kaiokenDesktop.platform === "macos";
    const notification = new Notification(message.title, {
      body: message.body,
      ...(isMacDesktop
        ? {}
        : { icon: new URL("/icon-192.png", window.location.origin).href }),
      tag: `kaioken-${message.threadId ?? message.id}`,
    });
    active.add(notification);
    notification.onclose = () => active.delete(notification);
    notification.onclick = () => {
      if (disposed) return;
      window.focus();
      if (message.threadId !== null) navigate(message.threadId);
      notification.close();
      active.delete(notification);
    };
  }

  async function deliver(payload: unknown, enabled: boolean): Promise<void> {
    const parsed = clientNotificationSchema.safeParse(payload);
    const channel = clientChannel();
    if (
      !enabled ||
      disposed ||
      channel === null ||
      !parsed.success ||
      !parsed.data.channels.includes(channel) ||
      notificationPermission() !== "granted"
    )
      return;
    const message = parsed.data;
    const claim = () => {
      if (disposed) return;
      const key = `bb.push-notifications.seen.${channel}`;
      let ids: string[] = [];
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
        ids = Array.isArray(stored)
          ? stored.filter((id): id is string => typeof id === "string")
          : [];
        if (ids.includes(message.id)) return;
      } catch {
        ids = [];
      }
      display(message);
      try {
        localStorage.setItem(
          key,
          JSON.stringify([...ids.slice(-99), message.id]),
        );
      } catch {
        return;
      }
    };
    if (navigator.locks)
      await navigator.locks.request(`kaioken-notifications-${channel}`, claim);
    else claim();
  }

  return {
    deliver,
    dispose() {
      disposed = true;
      for (const notification of active) notification.close();
      active.clear();
    },
  };
}
