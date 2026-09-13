import { describe, expect, it } from "vitest";
import type { ProjectSource } from "@kaioken/domain";
import {
  projectAvailableOnHost,
  selectProjectsForHost,
} from "./projects-for-host";

function checkout(hostId: string): ProjectSource {
  return {
    id: `src_${hostId}`,
    type: "local_path",
    hostId,
    path: `/repos/${hostId}`,
  } as ProjectSource;
}

describe("selectProjectsForHost", () => {
  it("keeps projects checked out on the machine and projects with no checkout at all", () => {
    const projects = [
      { id: "macbook-only", sources: [checkout("macbook")] },
      { id: "both", sources: [checkout("macbook"), checkout("mini")] },
      { id: "mini-only", sources: [checkout("mini")] },
      { id: "remote-only", sources: [] },
    ];
    expect(
      selectProjectsForHost(projects, "mini").map((project) => project.id),
    ).toEqual(["both", "mini-only", "remote-only"]);
    expect(
      selectProjectsForHost(projects, "macbook").map((project) => project.id),
    ).toEqual(["macbook-only", "both", "remote-only"]);
    expect(
      selectProjectsForHost(projects, null).map((project) => project.id),
    ).toEqual(["remote-only"]);
    expect(projectAvailableOnHost([checkout("mini")], "macbook")).toBe(false);
  });
});
