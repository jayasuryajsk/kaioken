import { expect, it } from "vitest";
import { resolveLegacyRemotePath } from "./LegacyRemoteRoute";

it("migrates bookmarked remote workspaces to native task and compose routes", () => {
  expect(
    resolveLegacyRemotePath(
      "mini",
      "/projects/proj_1/threads/thr_1?tab=history",
    ),
  ).toBe("/servers/mini/threads/thr_1?tab=history");
  expect(resolveLegacyRemotePath("mini", "/threads/thr_2")).toBe(
    "/servers/mini/threads/thr_2",
  );
  expect(
    resolveLegacyRemotePath("mini", "/projects/proj_1?connectionDraft=abc"),
  ).toBe("/servers/mini/projects/proj_1?connectionDraft=abc");
  expect(resolveLegacyRemotePath("mini", "/")).toBe("/");
  expect(resolveLegacyRemotePath("mini", "//other.example")).toBe("/");
});
