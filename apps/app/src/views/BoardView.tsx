import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
} from "@kaioken/client-core";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@kaioken/domain";
import type { ThreadSectionResponse } from "@kaioken/server-contract";
import { Button } from "@kaioken/shared-ui/button";
import { Icon } from "@kaioken/shared-ui/icon";
import { Input } from "@kaioken/shared-ui/input";
import { cn } from "@kaioken/shared-ui/lib/utils";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import {
  ThreadSectionMoveProvider,
  type ThreadSectionMoveDestination,
} from "@/components/thread/ThreadSectionMoveProvider";
import { ThreadStatusGlyph } from "@/components/sidebar/ThreadRow";
import { useThreadRowSplitDrag } from "@/components/sidebar/useThreadRowSplitDrag";
import { useCreateThreadSection } from "@/hooks/mutations/thread-section-mutations";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import { useMoveThreadToSection } from "@/hooks/mutations/thread-state-mutations";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  boardIdeaTitle,
  boardIdeasAtom,
  createBoardIdea,
  removeBoardIdea,
  type BoardIdea,
} from "@/lib/board-ideas";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { getThreadRoutePath } from "@/lib/route-paths";
import { isListedThread } from "@/lib/sidebar-timeline";
import { getThreadDisplayTitle } from "@/lib/thread-title";

const TODO_COLUMN_ID = "todo";
const DEFAULT_COLUMN_NAMES = ["Working", "Done"] as const;
const ALL_PROJECTS = "all";

interface BoardColumn {
  id: string;
  sectionId: string | null;
  name: string;
}

interface BoardProject {
  id: string;
  name: string;
}

function columnDroppableId(column: BoardColumn): string {
  return `column:${column.id}`;
}

function threadDraggableId(thread: ThreadListEntry): string {
  return `thread:${thread.id}`;
}

function ideaDraggableId(idea: BoardIdea): string {
  return `idea:${idea.id}`;
}

export function buildBoardColumns(
  sections: readonly ThreadSectionResponse[],
): BoardColumn[] {
  return [
    { id: TODO_COLUMN_ID, sectionId: null, name: "To do" },
    ...[...sections]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((section) => ({
        id: section.id,
        sectionId: section.id,
        name: section.name,
      })),
  ];
}

export function threadsForColumn(
  threads: readonly ThreadListEntry[],
  column: BoardColumn,
): ThreadListEntry[] {
  return threads
    .filter((thread) => thread.sectionId === column.sectionId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function ThreadCard({
  thread,
  projectName,
  onOpen,
}: {
  thread: ThreadListEntry;
  projectName: string;
  onOpen: () => void;
}) {
  const title = getThreadDisplayTitle(thread);
  const unread = isUnreadDoneThread(thread);
  const [menuOpen, setMenuOpen] = useState(false);
  const { openInSplit } = useThreadRowSplitDrag({
    projectId: thread.projectId,
    threadId: thread.id,
    title,
  });
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: threadDraggableId(thread) });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <ThreadActionsContextMenu thread={thread} onOpenInSplit={openInSplit}>
      <div
        ref={setNodeRef}
        style={style}
        data-testid="board-thread-card"
        className={cn(
          "group/board-card relative flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:bg-state-hover",
          isDragging && "z-10 opacity-80 shadow-lift",
          menuOpen && "bg-state-hover",
        )}
        {...attributes}
        {...listeners}
      >
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey) {
                openInSplit();
                return;
              }
              onOpen();
            }}
            className={cn(
              "min-w-0 flex-1 truncate text-left outline-none focus-visible:ring-1 focus-visible:ring-ring",
              unread && "font-medium",
            )}
          >
            {title}
          </button>
          <span className="flex shrink-0 items-center">
            <span className="inline-flex size-6 items-center justify-center group-hover/board-card:hidden">
              <ThreadStatusGlyph
                hasPendingInteraction={thread.hasPendingInteraction}
                hasUnsubmittedDraft={false}
                hasUnreadError={unread && thread.status === "error"}
                hasUnreadSuccess={unread && thread.status !== "error"}
                isBackgroundAgentActive={hasActiveBackgroundAgentActivity(
                  thread,
                )}
                isBackgroundCommandActive={hasActiveBackgroundCommandActivity(
                  thread,
                )}
                isGoalActive={hasActiveGoalActivity(thread)}
                isPlanModeActive={hasActivePlanModeActivity(thread)}
                isRuntimeActive={isRuntimeBusyThread(thread)}
                isWorkflowActive={hasActiveWorkflowActivity(thread)}
                queuedWork={thread.queuedWork}
              />
            </span>
            <span
              className={cn(
                "hidden group-hover/board-card:inline-flex",
                menuOpen && "inline-flex",
              )}
            >
              <ThreadActionsMenu
                thread={thread}
                onOpenInSplit={openInSplit}
                triggerClassName="size-6"
                onOpenChange={setMenuOpen}
              />
            </span>
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Icon name="Folder" className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{projectName}</span>
          {thread.environmentBranchName ? (
            <span className="min-w-0 truncate">
              · {thread.environmentBranchName}
            </span>
          ) : null}
        </div>
      </div>
    </ThreadActionsContextMenu>
  );
}

function IdeaCard({
  idea,
  projectName,
  onStart,
  onRemove,
}: {
  idea: BoardIdea;
  projectName: string;
  onStart: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: ideaDraggableId(idea) });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="board-idea-card"
      className={cn(
        "group/board-card flex flex-col gap-1 rounded-md border border-dashed border-border bg-card/60 px-3 py-2 text-sm transition-colors hover:bg-state-hover",
        isDragging && "z-10 opacity-80 shadow-lift",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 truncate" title={idea.text}>
          {boardIdeaTitle(idea.text)}
        </span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover/board-card:inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Start this idea"
            onClick={onStart}
          >
            <Icon name="Play" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Remove this idea"
            onClick={onRemove}
          >
            <Icon name="X" className="size-3.5" />
          </Button>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <Icon name="Folder" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{projectName}</span>
        <span className="ml-auto shrink-0">not started</span>
      </div>
    </div>
  );
}

function BoardColumnView({
  column,
  count,
  children,
  header,
}: {
  column: BoardColumn;
  count: number;
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: columnDroppableId(column),
  });
  return (
    <section
      ref={setNodeRef}
      data-testid={`board-column-${column.id}`}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-recessed transition-colors",
        isOver && "border-ring bg-state-hover",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{column.name}</span>
        <span className="ml-auto rounded-sm bg-muted px-1.5 py-0.5 text-2xs">
          {count}
        </span>
      </div>
      {header}
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
      </div>
    </section>
  );
}

export function BoardView() {
  const navigate = useNavigate();
  const navigationQuery = useSidebarNavigation();
  const [ideas, setIdeas] = useAtom(boardIdeasAtom);
  const [rootComposeProjectId] = useRootComposeProjectId();
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [ideaText, setIdeaText] = useState("");
  const [ideaProjectId, setIdeaProjectId] = useState<string | null>(null);
  const createSection = useCreateThreadSection();
  const createThread = useCreateThread();
  const moveThreadToSection = useMoveThreadToSection();

  const projects = useMemo<BoardProject[]>(() => {
    const data = navigationQuery.data;
    if (!data) return [];
    return [
      { id: PERSONAL_PROJECT_ID, name: "Kaioken" },
      ...data.projects.map((project) => ({
        id: project.id,
        name: project.name,
      })),
    ];
  }, [navigationQuery.data]);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectNameFor = useCallback(
    (projectId: string) => projectNames.get(projectId) ?? "Kaioken",
    [projectNames],
  );

  const threads = useMemo(() => {
    const data = navigationQuery.data;
    if (!data) return [];
    const all = [
      ...data.personalProject.threads,
      ...data.projects.flatMap((project) => project.threads),
    ];
    return all.filter(
      (thread) =>
        isListedThread(thread) &&
        thread.parentThreadId === null &&
        (projectFilter === ALL_PROJECTS || thread.projectId === projectFilter),
    );
  }, [navigationQuery.data, projectFilter]);
  const visibleIdeas = useMemo(
    () =>
      ideas.filter(
        (idea) =>
          projectFilter === ALL_PROJECTS || idea.projectId === projectFilter,
      ),
    [ideas, projectFilter],
  );

  const sections = navigationQuery.data?.sections;
  const hasSections = (sections?.length ?? 0) > 0;
  const columns = useMemo(() => buildBoardColumns(sections ?? []), [sections]);
  const moveDestinations = useMemo<ThreadSectionMoveDestination[]>(
    () =>
      columns.map((column) => ({
        label: column.name,
        sectionId: column.sectionId,
      })),
    [columns],
  );

  const effectiveIdeaProjectId =
    ideaProjectId ??
    (projectFilter !== ALL_PROJECTS ? projectFilter : rootComposeProjectId);

  const addIdea = useCallback(() => {
    const idea = createBoardIdea(ideaText, effectiveIdeaProjectId);
    if (idea === null) return;
    setIdeas((current) => [idea, ...current]);
    setIdeaText("");
  }, [effectiveIdeaProjectId, ideaText, setIdeas]);

  const startIdea = useCallback(
    async (idea: BoardIdea, sectionId: string | null) => {
      await createThread.mutateAsync({
        projectId: idea.projectId,
        input: [{ type: "text", text: idea.text, mentions: [] }],
        environment:
          idea.projectId === PERSONAL_PROJECT_ID
            ? { type: "host", workspace: { type: "personal" } }
            : { type: "project-default" },
        ...(sectionId === null ? {} : { sectionId }),
      });
      setIdeas((current) => removeBoardIdea(current, idea.id));
    },
    [createThread, setIdeas],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const overId = event.over?.id;
      if (typeof overId !== "string" || !overId.startsWith("column:")) {
        return;
      }
      const column = columns.find(
        (candidate) => columnDroppableId(candidate) === overId,
      );
      if (!column) return;
      const activeId = String(event.active.id);
      if (activeId.startsWith("thread:")) {
        const threadId = activeId.slice("thread:".length);
        const thread = threads.find((candidate) => candidate.id === threadId);
        if (!thread || thread.sectionId === column.sectionId) return;
        moveThreadToSection({
          thread: {
            id: thread.id,
            pinnedAt: thread.pinnedAt,
            sectionId: thread.sectionId,
          },
          sectionId: column.sectionId,
        });
        return;
      }
      if (activeId.startsWith("idea:")) {
        const ideaId = activeId.slice("idea:".length);
        const idea = ideas.find((candidate) => candidate.id === ideaId);
        if (!idea || column.sectionId === null) return;
        void startIdea(idea, column.sectionId);
      }
    },
    [columns, ideas, moveThreadToSection, startIdea, threads],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const createDefaultColumns = useCallback(async () => {
    for (const name of DEFAULT_COLUMN_NAMES) {
      await createSection.mutateAsync({ name });
    }
  }, [createSection]);
  const addColumn = useCallback(async () => {
    const name = window.prompt("Column name");
    if (!name || name.trim().length === 0) return;
    await createSection.mutateAsync({ name: name.trim() });
  }, [createSection]);

  const handleIdeaKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      addIdea();
    }
  };

  return (
    <ThreadSectionMoveProvider destinations={moveDestinations}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-medium">Board</h1>
          <select
            aria-label="Filter by project"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <span className="ml-auto flex items-center gap-2">
            {!hasSections ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={createSection.isPending}
                onClick={() => void createDefaultColumns()}
              >
                Create Working and Done columns
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={createSection.isPending}
              onClick={() => void addColumn()}
            >
              <Icon name="Plus" className="size-3.5" />
              Column
            </Button>
          </span>
        </div>
        {navigationQuery.isPending ? (
          <p className="text-sm text-muted-foreground">Loading threads…</p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
              {columns.map((column) => {
                const columnThreads = threadsForColumn(threads, column);
                const isTodo = column.sectionId === null;
                const count =
                  columnThreads.length + (isTodo ? visibleIdeas.length : 0);
                return (
                  <BoardColumnView
                    key={column.id}
                    column={column}
                    count={count}
                    header={
                      isTodo ? (
                        <div className="flex items-center gap-1 px-2 pb-2">
                          <Input
                            aria-label="New idea"
                            placeholder="Type an idea, press Enter"
                            value={ideaText}
                            onChange={(event) =>
                              setIdeaText(event.target.value)
                            }
                            onKeyDown={handleIdeaKeyDown}
                            className="h-7 text-xs"
                          />
                          <select
                            aria-label="Idea project"
                            value={effectiveIdeaProjectId}
                            onChange={(event) =>
                              setIdeaProjectId(event.target.value)
                            }
                            className="h-7 max-w-24 rounded-md border border-border bg-background px-1 text-xs"
                          >
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : undefined
                    }
                  >
                    {isTodo
                      ? visibleIdeas.map((idea) => (
                          <IdeaCard
                            key={idea.id}
                            idea={idea}
                            projectName={projectNameFor(idea.projectId)}
                            onStart={() =>
                              void startIdea(
                                idea,
                                columns[1]?.sectionId ?? null,
                              )
                            }
                            onRemove={() =>
                              setIdeas((current) =>
                                removeBoardIdea(current, idea.id),
                              )
                            }
                          />
                        ))
                      : null}
                    {columnThreads.map((thread) => (
                      <ThreadCard
                        key={thread.id}
                        thread={thread}
                        projectName={projectNameFor(thread.projectId)}
                        onOpen={() =>
                          void navigate(
                            getThreadRoutePath({
                              projectId: thread.projectId,
                              threadId: thread.id,
                            }),
                          )
                        }
                      />
                    ))}
                    {count === 0 ? (
                      <p className="px-1 py-2 text-xs text-muted-foreground">
                        {isTodo
                          ? "Nothing waiting. Type an idea above."
                          : "Drop threads here."}
                      </p>
                    ) : null}
                  </BoardColumnView>
                );
              })}
            </div>
          </DndContext>
        )}
      </div>
    </ThreadSectionMoveProvider>
  );
}
