// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkspaceEmbedding } from "./workspace-protocol";

const originalParent = Object.getOwnPropertyDescriptor(window, "parent")!;
const initialUrl = window.location.href;

afterEach(() => {
  Object.defineProperty(window, "parent", originalParent);
  window.name = "";
  window.history.replaceState(null, "", initialUrl);
  vi.restoreAllMocks();
});

describe("embedded workspace identity", () => {
  it("preserves the connection after internal navigation and module reload", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: frame.contentWindow,
    });
    frame.remove();
    vi.spyOn(document, "referrer", "get").mockReturnValue(
      "http://localhost:16606/",
    );
    const query = new URLSearchParams({
      connectionController: "http://localhost:16606",
      connectionNonce: "ab2d59e2-2f77-4272-9242-a3351d2ef44b",
      connectionServerId: "b36ad009-4c89-4e57-a2a9-716ea3a5ace4",
    });
    window.history.replaceState(null, "", `/?${query}`);
    const initial = readWorkspaceEmbedding();
    expect(initial?.serverId).toBe("b36ad009-4c89-4e57-a2a9-716ea3a5ace4");
    window.history.replaceState(null, "", "/threads/thread-1");
    vi.spyOn(document, "referrer", "get").mockReturnValue(
      window.location.origin,
    );
    expect(readWorkspaceEmbedding()).toEqual(initial);
    vi.spyOn(document, "referrer", "get").mockReturnValue(
      "https://unrelated.example/",
    );
    expect(readWorkspaceEmbedding()).toBeNull();
  });
});
