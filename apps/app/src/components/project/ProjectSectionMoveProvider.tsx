import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ProjectResponse } from "@kaioken/server-contract";
import { useMoveProjectToSection } from "@/hooks/mutations/project-mutations";

export interface ProjectSectionMoveDestination {
  label: string;
  sectionId: string | null;
}

interface ProjectSectionMoveContextValue {
  destinations: readonly ProjectSectionMoveDestination[];
  currentSectionId: (project: ProjectResponse) => string | null;
  moveProject: (project: ProjectResponse, sectionId: string | null) => void;
  requestNewSection?: () => void;
}

const ProjectSectionMoveContext =
  createContext<ProjectSectionMoveContextValue | null>(null);

export function useProjectSectionMove(): ProjectSectionMoveContextValue | null {
  return useContext(ProjectSectionMoveContext);
}

export function ProjectSectionMoveProvider({
  children,
  destinations,
  sectionIdByProjectId,
  requestNewSection,
}: {
  children: ReactNode;
  destinations: readonly ProjectSectionMoveDestination[];
  sectionIdByProjectId: ReadonlyMap<string, string>;
  requestNewSection?: () => void;
}) {
  const moveProjectToSection = useMoveProjectToSection();
  const value = useMemo<ProjectSectionMoveContextValue>(
    () => ({
      destinations,
      currentSectionId: (project) =>
        sectionIdByProjectId.get(project.id) ?? null,
      moveProject: (project, sectionId) => {
        if ((sectionIdByProjectId.get(project.id) ?? null) === sectionId)
          return;
        moveProjectToSection({ projectId: project.id, sectionId });
      },
      requestNewSection,
    }),
    [
      destinations,
      moveProjectToSection,
      requestNewSection,
      sectionIdByProjectId,
    ],
  );

  return (
    <ProjectSectionMoveContext.Provider value={value}>
      {children}
    </ProjectSectionMoveContext.Provider>
  );
}
