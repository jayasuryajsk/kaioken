import {
  findLocalPathProjectSourceForHost,
  type ProjectSource,
} from "@kaioken/domain";

interface ProjectWithSources {
  sources: readonly ProjectSource[];
}

export function projectAvailableOnHost(
  sources: readonly ProjectSource[],
  hostId: string | null,
): boolean {
  const hasCheckout = sources.some((source) => source.type === "local_path");
  if (!hasCheckout) return true;
  return (
    hostId !== null &&
    findLocalPathProjectSourceForHost(sources, hostId) !== undefined
  );
}

export function selectProjectsForHost<T extends ProjectWithSources>(
  projects: readonly T[],
  hostId: string | null,
): T[] {
  return projects.filter((project) =>
    projectAvailableOnHost(project.sources, hostId),
  );
}
