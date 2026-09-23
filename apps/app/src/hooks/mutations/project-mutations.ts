import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateProjectRequest,
  CreateProjectSourceRequest,
  ReorderProjectRequest,
  UpdateProjectRequest,
  UploadedPromptAttachment,
} from "@kaioken/server-contract";
import { useScopedSdk } from "@/lib/federation/remote-server-context";
import { registerLocalAttachmentPreview } from "@/lib/attachment-local-previews";
import {
  applyProjectCreateResult,
  applyProjectDeleteResult,
} from "../cache-owners/project-cache-owner";
import {
  invalidateProjectListQueries,
  invalidateProjectSourceQueries,
  invalidateProjectUpdateQueries,
} from "../cache-owners/mutation-cache-effects";

interface AddLocalProjectSourceRequest {
  projectId: string;
  hostId: string;
  path: string;
}

interface UpdateLocalProjectSourceRequest {
  projectId: string;
  sourceId: string;
  path: string;
}

interface DeleteLocalProjectSourceRequest {
  projectId: string;
  sourceId: string;
}

interface UpdateProjectMutationRequest extends UpdateProjectRequest {
  id: string;
}

interface ReorderProjectMutationRequest extends ReorderProjectRequest {
  id: string;
}

interface UploadPromptAttachmentRequest {
  projectId: string;
  file: File;
}

export function useCreateProject() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to create project.",
    },
    mutationFn: (request: CreateProjectRequest) => sdk.projects.create(request),
    onSuccess: (project) => {
      applyProjectCreateResult({ project, queryClient });
      invalidateProjectListQueries({ queryClient });
    },
  });
}

export function useUpdateProject() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update project.",
    },
    mutationFn: ({ id, ...request }: UpdateProjectMutationRequest) =>
      sdk.projects.update({ projectId: id, ...request }),
    onSuccess: (_data, variables) => {
      invalidateProjectUpdateQueries({ projectId: variables.id, queryClient });
    },
  });
}

interface MoveProjectToSectionRequest {
  projectId: string;
  sectionId: string | null;
}

export function useMoveProjectToSection() {
  const { mutate: updateProject } = useUpdateProject();
  return useCallback(
    ({ projectId, sectionId }: MoveProjectToSectionRequest) => {
      updateProject({ id: projectId, sectionId });
    },
    [updateProject],
  );
}

export function useReorderProject() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to reorder project.",
    },
    mutationFn: ({ id, ...request }: ReorderProjectMutationRequest) =>
      sdk.projects.reorder({ projectId: id, ...request }),
    onSuccess: () => {
      invalidateProjectListQueries({ queryClient });
    },
  });
}

export function useDeleteProject() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove project.",
    },
    mutationFn: async (projectId: string): Promise<void> => {
      await sdk.projects.delete({ projectId });
    },
    onSuccess: (_data, projectId) => {
      applyProjectDeleteResult({ projectId, queryClient });
    },
  });
}

export function useAddLocalProjectSource() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to add local source.",
    },
    mutationFn: ({ projectId, hostId, path }: AddLocalProjectSourceRequest) =>
      sdk.projects.sources.add({
        projectId,
        type: "local_path",
        hostId,
        path,
      }),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

interface AddProjectSourceMutationRequest {
  projectId: string;
  request: CreateProjectSourceRequest;
}

export function useAddProjectSource() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      showErrorToast: false,
    },
    mutationFn: ({ projectId, request }: AddProjectSourceMutationRequest) =>
      sdk.projects.sources.add({ projectId, ...request }),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useUpdateLocalProjectSource() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update local source.",
    },
    mutationFn: ({
      projectId,
      sourceId,
      path,
    }: UpdateLocalProjectSourceRequest) =>
      sdk.projects.sources.update({
        projectId,
        sourceId,
        type: "local_path",
        path,
      }),
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useDeleteLocalProjectSource() {
  const sdk = useScopedSdk();
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to remove source.",
    },
    mutationFn: async ({
      projectId,
      sourceId,
    }: DeleteLocalProjectSourceRequest): Promise<void> => {
      await sdk.projects.sources.delete({ projectId, sourceId });
    },
    onSuccess: (_data, variables) => {
      invalidateProjectSourceQueries({
        projectId: variables.projectId,
        queryClient,
      });
    },
  });
}

export function useUploadPromptAttachment() {
  const sdk = useScopedSdk();
  return useMutation({
    meta: {
      errorMessage: "Failed to upload attachment.",
      showErrorToast: false,
    },
    mutationFn: async ({
      projectId,
      file,
    }: UploadPromptAttachmentRequest): Promise<UploadedPromptAttachment> => {
      const uploaded = await sdk.projects.attachments.upload({
        projectId,
        clientFile: file,
      });
      registerLocalAttachmentPreview(uploaded.path, file);
      return uploaded;
    },
    retry: false,
  });
}
