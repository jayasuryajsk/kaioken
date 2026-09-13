import { describe, expect, it } from "vitest";
import { classifyLabelMemberId, resolveLabel } from "../commands/labels.js";

const sections = [
  { id: "sec_work", name: "Work", projectIds: [], createdAt: 1, updatedAt: 1 },
  { id: "sec_play", name: "Play", projectIds: [], createdAt: 1, updatedAt: 1 },
  { id: "sec_play2", name: "play", projectIds: [], createdAt: 1, updatedAt: 1 },
];

describe("labels command helpers", () => {
  it("resolves a label by id before name and ignores name case", () => {
    expect(resolveLabel(sections, "sec_work").id).toBe("sec_work");
    expect(resolveLabel(sections, " WORK ").id).toBe("sec_work");
  });

  it("refuses ambiguous names and explains unknown ones", () => {
    expect(() => resolveLabel(sections, "play")).toThrow(/ambiguous/);
    expect(() => resolveLabel(sections, "Nope")).toThrow(/Known labels: Work/);
    expect(() => resolveLabel([], "Nope")).toThrow(/kaioken labels add/);
  });

  it("classifies member ids and rejects everything else", () => {
    expect(classifyLabelMemberId("proj_abc")).toBe("repo");
    expect(classifyLabelMemberId("thr_abc")).toBe("thread");
    expect(() => classifyLabelMemberId("env_abc")).toThrow(/Unknown member id/);
  });
});
