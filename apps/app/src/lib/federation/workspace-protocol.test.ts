import { workspaceControllerMessageSchema } from "@/lib/federation/workspace-messages";
import { describe, expect, it } from "vitest";
import { localWorkspacePath } from "./workspace-protocol";

describe("connected workspace navigation", () => {
  it("rejects navigation to external origins and recursive connected workspaces", () => {
    for (const path of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/servers/other/workspace/",
    ])
      expect(localWorkspacePath(path)).toBeNull();
    expect(
      localWorkspacePath("/projects/proj_1/threads/thr_1?tab=files#diff"),
    ).toBe("/projects/proj_1/threads/thr_1?tab=files#diff");
  });
  it("keeps controller credentials out of shared navigation URLs", () => {
    expect(
      localWorkspacePath(
        "/?connectionNonce=secret&connectionController=https://example.com&project=proj_1",
      ),
    ).toBe("/?project=proj_1");
    expect(
      workspaceControllerMessageSchema.safeParse({
        type: "kaioken:workspace-navigate",
        nonce: "wrong",
        path: "/",
        navigationId: "1",
      }).success,
    ).toBe(false);
  });
});
