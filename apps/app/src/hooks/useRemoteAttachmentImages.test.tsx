// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRemoteAttachmentImages } from "./useRemoteAttachmentImages";

const mocks = vi.hoisted(() => ({
  server: { url: "https://mini.kaioken.app" },
  fetch: vi.fn(),
}));
vi.mock("@/lib/federation/remote-server-context", () => ({
  useRemoteServer: () => mocks.server,
}));
vi.mock("@/lib/federation/remote-fetch", () => ({
  createRemoteFetch: () => mocks.fetch,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads remote images through authenticated fetch and drops URLs when the machine changes", async () => {
  const create = vi
    .fn()
    .mockReturnValueOnce("blob:mini")
    .mockReturnValueOnce("blob:laptop");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revoke,
  });
  mocks.fetch.mockResolvedValue(
    new Response("image", { headers: { "content-type": "image/png" } }),
  );
  const path = "/api/v1/projects/proj_1/attachments/content?path=photo.png";
  const items = [{ src: path }, { src: "https://images.example/photo.png" }];
  const view = renderHook(() => useRemoteAttachmentImages(items));
  await waitFor(() => expect(view.result.current[0]?.src).toBe("blob:mini"));
  expect(String(mocks.fetch.mock.calls[0]?.[0])).toBe(
    `https://mini.kaioken.app${path}`,
  );
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(view.result.current[1]?.src).toBe(items[1]?.src);
  mocks.fetch.mockResolvedValue(new Response("second image"));
  mocks.server.url = "https://laptop.kaioken.app";
  view.rerender();
  expect(view.result.current[0]?.src).not.toBe("blob:mini");
  await waitFor(() => expect(view.result.current[0]?.src).toBe("blob:laptop"));
  expect(revoke).toHaveBeenCalledWith("blob:mini");
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:laptop");
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});
