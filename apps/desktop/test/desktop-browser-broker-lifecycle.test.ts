import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  session: { fromPartition: () => ({}) },
  nativeImage: { createFromBuffer: () => ({}) },
}));

import { createDesktopBrowserBroker } from "../src/desktop-browser-broker.js";
import type { DesktopBrowserViewManager } from "../src/desktop-browser-view.js";

function createFakeManager(listTabs: () => never[] = () => []) {
  const manager: Pick<
    DesktopBrowserViewManager,
    "listTabs" | "subscribeAutomationTabs" | "profileSession" | "destroyAll"
  > = {
    listTabs,
    subscribeAutomationTabs: () => () => undefined,
    profileSession: (() =>
      ({}) as unknown) as DesktopBrowserViewManager["profileSession"],
    destroyAll: () => undefined,
  };
  return manager as DesktopBrowserViewManager;
}

function createFakeWindow(id: number) {
  let destroyed = false;
  return {
    destroy: () => {
      destroyed = true;
    },
    webContents: {
      get id() {
        if (destroyed) throw new TypeError("Object has been destroyed");
        return id;
      },
      isDestroyed: () => destroyed,
      send: () => undefined,
    },
    isDestroyed: () => destroyed,
    contentView: {
      addChildView: () => undefined,
      removeChildView: () => undefined,
    },
  };
}

describe("desktop browser broker window lifecycle", () => {
  it("drops a destroyed window instead of reading its web contents", () => {
    const broker = createDesktopBrowserBroker({
      manager: createFakeManager(),
      product: "Chrome/1",
    });
    const closing = createFakeWindow(7);
    const surviving = createFakeWindow(9);
    broker.registerWindow(closing as never);
    broker.registerWindow(surviving as never);
    expect(broker.listInstances()).toHaveLength(2);

    closing.destroy();

    expect(() => broker.setHostId("host_1")).not.toThrow();
    expect(broker.listInstances()).toHaveLength(1);
    expect(() => broker.setHostId(null)).not.toThrow();
    expect(() => broker.resetServer()).not.toThrow();
    expect(() => broker.getTarget(9)).not.toThrow();
  });

  it("survives every window being destroyed at once", () => {
    const broker = createDesktopBrowserBroker({
      manager: createFakeManager(),
      product: "Chrome/1",
    });
    const window = createFakeWindow(3);
    broker.registerWindow(window as never);

    window.destroy();

    expect(() => broker.setHostId("host_2")).not.toThrow();
    expect(broker.listInstances()).toEqual([]);
  });
});
