import { describe, expect, it, vi } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import { createProject, markProjectDeleted } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  createThreadSection,
  deleteThreadSection,
  getProjectThreadSectionId,
  listThreadSectionProjectIds,
  setProjectThreadSection,
} from "../../src/data/thread-sections.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "alpha",
    source: { type: "local_path", hostId: host.id, path: "/tmp/alpha" },
  });
  const { project: other } = createProject(db, noopNotifier, {
    name: "beta",
    source: { type: "local_path", hostId: host.id, path: "/tmp/beta" },
  });
  const created = createThreadSection(db, noopNotifier, { name: "Work" });
  if (created.status !== "created") throw new Error("section not created");
  return { db, project, other, section: created.section };
}

describe("project thread sections", () => {
  it("assigns a project to at most one section and lists members", () => {
    const { db, project, other, section } = setup();
    const second = createThreadSection(db, noopNotifier, { name: "Play" });
    if (second.status !== "created") throw new Error("section not created");

    expect(
      setProjectThreadSection(db, noopNotifier, {
        projectId: project.id,
        sectionId: section.id,
      }),
    ).toEqual({ status: "updated", previousSectionId: null });
    setProjectThreadSection(db, noopNotifier, {
      projectId: other.id,
      sectionId: section.id,
    });
    expect(listThreadSectionProjectIds(db).get(section.id)).toEqual([
      project.id,
      other.id,
    ]);

    expect(
      setProjectThreadSection(db, noopNotifier, {
        projectId: project.id,
        sectionId: second.section.id,
      }),
    ).toEqual({ status: "updated", previousSectionId: section.id });
    expect(getProjectThreadSectionId(db, project.id)).toBe(second.section.id);
    expect(listThreadSectionProjectIds(db).get(section.id)).toEqual([other.id]);

    expect(
      setProjectThreadSection(db, noopNotifier, {
        projectId: project.id,
        sectionId: null,
      }),
    ).toEqual({ status: "updated", previousSectionId: second.section.id });
    expect(getProjectThreadSectionId(db, project.id)).toBeNull();
  });

  it("rejects unknown projects, deleted projects, and unknown sections", () => {
    const { db, project, section } = setup();
    expect(
      setProjectThreadSection(db, noopNotifier, {
        projectId: "proj_missing",
        sectionId: section.id,
      }),
    ).toEqual({ status: "project_not_found" });
    expect(
      setProjectThreadSection(db, noopNotifier, {
        projectId: project.id,
        sectionId: "sec_missing",
      }),
    ).toEqual({ status: "section_not_found" });
    markProjectDeleted(db, noopNotifier, { projectId: project.id });
    expect(
      setProjectThreadSection(db, noopNotifier, {
        projectId: project.id,
        sectionId: section.id,
      }),
    ).toEqual({ status: "project_not_found" });
  });

  it("returns projects to their machines when the section is deleted", () => {
    const { db, project, section } = setup();
    const notifier: DbNotifier = { ...noopNotifier, notifyProject: vi.fn() };
    setProjectThreadSection(db, noopNotifier, {
      projectId: project.id,
      sectionId: section.id,
    });

    const result = deleteThreadSection(db, notifier, { id: section.id });
    expect(result).toEqual({
      id: section.id,
      name: "Work",
      updatedThreadCount: 0,
      updatedProjectCount: 1,
    });
    expect(getProjectThreadSectionId(db, project.id)).toBeNull();
    expect(listThreadSectionProjectIds(db).size).toBe(0);
    expect(notifier.notifyProject).toHaveBeenCalledWith(project.id, [
      "project-updated",
    ]);
  });
});
