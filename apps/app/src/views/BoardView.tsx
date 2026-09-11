import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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
import {
  PERSONAL_PROJECT_ID,
  type ProviderInfo,
  type ThreadListEntry,
} from "@kaioken/domain";
import type { ThreadSectionResponse } from "@kaioken/server-contract";
import { Button } from "@kaioken/shared-ui/button";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { Textarea } from "@kaioken/shared-ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@kaioken/shared-ui/toggle-group";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
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
import { useSystemProviders } from "@/hooks/queries/system-queries";
import {
  boardIdeaTitle,
  boardIdeasAtom,
  createBoardIdea,
  removeBoardIdea,
  type BoardIdea,
} from "@/lib/board-ideas";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { getThreadRoutePath } from "@/lib/route-paths";
import { isListedThread } from "@/lib/sidebar-timeline";
import { getThreadDisplayTitle } from "@/lib/thread-title";

const TODO_COLUMN_ID = "todo";
const DEFAULT_COLUMN_NAMES = ["Working", "Done"] as const;
const ALL_PROJECTS = "all";
const CHIP_CLASS =
  "h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-state-active data-[state=on]:text-foreground";
const CARD_CLASS =
  "group/board-card relative flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm shadow-sm transition-[background-color,box-shadow,border-color] hover:border-ring/40 hover:bg-state-hover";

interface BoardColumn {
  id: string;
  sectionId: string | null;
  name: string;
}

interface BoardProject {
  id: string;
  name: string;
}

interface StartTaskArgs {
  text: string;
  projectId: string;
  sectionId: string | null;
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

function dragStyle(
  transform: { x: number; y: number } | null,
): CSSProperties | undefined {
  return transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
}

function ProviderGlyph({
  providerId,
  providers,
}: {
  providerId: string;
  providers: readonly ProviderInfo[];
}) {
  const provider = providers.find((candidate) => candidate.id === providerId);
  const info = provider ? getProviderIconInfo(providerId, provider) : undefined;
  if (!provider || !info?.icon) {
    return null;
  }
  return (
    <ProviderIconMark
      provider={provider}
      icon={info.icon}
      className="size-3.5 shrink-0 text-muted-foreground"
    />
  );
}

function ThreadCard({
  thread,
  projectName,
  providers,
  onOpen,
}: {
  thread: ThreadListEntry;
  projectName: string;
  providers: readonly ProviderInfo[];
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
  return (
    <ThreadActionsContextMenu thread={thread} onOpenInSplit={openInSplit}>
      <div
        ref={setNodeRef}
        style={dragStyle(transform)}
        data-testid="board-thread-card"
        className={cn(
          CARD_CLASS,
          isDragging && "z-10 opacity-90 shadow-lift",
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
              "line-clamp-2 min-w-0 flex-1 text-left leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring",
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
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ProviderGlyph providerId={thread.providerId} providers={providers} />
          <span className="min-w-0 truncate">{projectName}</span>
          {thread.environmentBranchName ? (
            <>
              <span className="shrink-0 text-subtle-foreground">·</span>
              <span className="min-w-0 truncate font-mono text-2xs">
                {thread.environmentBranchName}
              </span>
            </>
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
  return (
    <div
      ref={setNodeRef}
      style={dragStyle(transform)}
      data-testid="board-idea-card"
      className={cn(
        CARD_CLASS,
        "border-dashed bg-card/60",
        isDragging && "z-10 opacity-90 shadow-lift",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="line-clamp-2 min-w-0 flex-1 leading-snug"
          title={idea.text}
        >
          {boardIdeaTitle(idea.text)}
        </span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover/board-card:inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Start this task"
            onClick={onStart}
          >
            <Icon name="Play" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Remove this task"
            onClick={onRemove}
          >
            <Icon name="X" className="size-3.5" />
          </Button>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="Folder" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{projectName}</span>
        <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-2xs uppercase tracking-wide text-subtle-foreground">
          Draft
        </span>
      </div>
    </div>
  );
}

function BoardColumnView({
  column,
  count,
  children,
}: {
  column: BoardColumn;
  count: number;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: columnDroppableId(column),
  });
  return (
    <section
      ref={setNodeRef}
      data-testid={`board-column-${column.id}`}
      className={cn(
        "flex min-h-0 min-w-64 flex-1 flex-col rounded-xl border border-transparent bg-surface-recessed transition-colors",
        isOver && "border-ring/50 bg-state-hover",
      )}
    >
      <div className="flex items-center gap-2 px-3 pb-1 pt-3">
        <span className="text-sm font-medium">{column.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {children}
      </div>
    </section>
  );
}

function NewTaskComposer({
  projects,
  initialProjectId,
  columns,
  isCreating,
  onStart,
  onSaveDraft,
  onClose,
}: {
  projects: readonly BoardProject[];
  initialProjectId: string;
  columns: readonly BoardColumn[];
  isCreating: boolean;
  onStart: (args: StartTaskArgs) => Promise<void>;
  onSaveDraft: (args: { text: string; projectId: string }) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [sectionId, setSectionId] = useState<string | null>(
    columns.find((column) => column.sectionId !== null)?.sectionId ?? null,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  const hasText = text.trim().length > 0;
  const start = async () => {
    if (!hasText || isCreating) return;
    await onStart({ text, projectId, sectionId });
    setText("");
    onClose();
  };
  const saveDraft = () => {
    if (!hasText) return;
    onSaveDraft({ text, projectId });
    setText("");
    onClose();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void start();
    }
  };
  return (
    <div
      data-testid="board-new-task"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What should the agent do? Write it like a message to a teammate."
        aria-label="Task description"
        rows={3}
        className="min-h-20 resize-y text-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">Repo</span>
        <ToggleGroup
          type="single"
          value={projectId}
          onValueChange={(value) => {
            if (value) setProjectId(value);
          }}
          aria-label="Repo"
          className="flex flex-wrap gap-1"
        >
          {projects.map((project) => (
            <ToggleGroupItem
              key={project.id}
              value={project.id}
              className={CHIP_CLASS}
            >
              {project.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {columns.length > 1 ? (
          <>
            <span className="ml-2 text-xs text-muted-foreground">Column</span>
            <ToggleGroup
              type="single"
              value={sectionId ?? TODO_COLUMN_ID}
              onValueChange={(value) => {
                if (!value) return;
                setSectionId(value === TODO_COLUMN_ID ? null : value);
              }}
              aria-label="Column"
              className="flex flex-wrap gap-1"
            >
              {columns.map((column) => (
                <ToggleGroupItem
                  key={column.id}
                  value={column.id}
                  className={CHIP_CLASS}
                >
                  {column.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasText}
            onClick={saveDraft}
          >
            Save as draft
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasText || isCreating}
            onClick={() => void start()}
          >
            <Icon name="Play" className="size-3.5" />
            Start
            <span className="ml-1 text-2xs opacity-70">⌘↩</span>
          </Button>
        </span>
      </div>
    </div>
  );
}

export function BoardView() {
  const navigate = useNavigate();
  const navigationQuery = useSidebarNavigation();
  const providersQuery = useSystemProviders();
  const providers = providersQuery.data ?? [];
  const [ideas, setIdeas] = useAtom(boardIdeasAtom);
  const [rootComposeProjectId] = useRootComposeProjectId();
  const [projectFilter, setProjectFilter] = useState<string>(ALL_PROJECTS);
  const [composerOpen, setComposerOpen] = useState(false);
  const createSection = useCreateThreadSection();
  const createThread = useCreateThread();
  const moveThreadToSection = useMoveThreadToSection();

  const projects = useMemo<BoardProject[]>(() => {
    const data = navigationQuery.data;
    if (!data) return [];
    return [
      ...data.projects.map((project) => ({
        id: project.id,
        name: project.name,
      })),
      { id: PERSONAL_PROJECT_ID, name: "No repo" },
    ];
  }, [navigationQuery.data]);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const projectNameFor = useCallback(
    (projectId: string) => projectNames.get(projectId) ?? "No repo",
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
  const firstStartColumn = columns.find((column) => column.sectionId !== null);

  const composerProjectId =
    projectFilter !== ALL_PROJECTS
      ? projectFilter
      : projectNames.has(rootComposeProjectId)
        ? rootComposeProjectId
        : (projects[0]?.id ?? PERSONAL_PROJECT_ID);

  const startTask = useCallback(
    async ({ text, projectId, sectionId }: StartTaskArgs) => {
      await createThread.mutateAsync({
        projectId,
        input: [{ type: "text", text: text.trim(), mentions: [] }],
        environment:
          projectId === PERSONAL_PROJECT_ID
            ? { type: "host", workspace: { type: "personal" } }
            : { type: "project-default" },
        ...(sectionId === null ? {} : { sectionId }),
      });
    },
    [createThread],
  );

  const saveDraft = useCallback(
    ({ text, projectId }: { text: string; projectId: string }) => {
      const idea = createBoardIdea(text, projectId);
      if (idea === null) return;
      setIdeas((current) => [idea, ...current]);
    },
    [setIdeas],
  );

  const startIdea = useCallback(
    async (idea: BoardIdea, sectionId: string | null) => {
      await startTask({
        text: idea.text,
        projectId: idea.projectId,
        sectionId,
      });
      setIdeas((current) => removeBoardIdea(current, idea.id));
    },
    [setIdeas, startTask],
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

  return (
    <ThreadSectionMoveProvider destinations={moveDestinations}>
      <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-5 py-3">
          <h1 className="text-base font-medium">Board</h1>
          <ToggleGroup
            type="single"
            value={projectFilter}
            onValueChange={(value) => {
              if (value) setProjectFilter(value);
            }}
            aria-label="Filter by repo"
            className="flex flex-wrap gap-1"
          >
            <ToggleGroupItem value={ALL_PROJECTS} className={CHIP_CLASS}>
              All
            </ToggleGroupItem>
            {projects.map((project) => (
              <ToggleGroupItem
                key={project.id}
                value={project.id}
                className={CHIP_CLASS}
              >
                {project.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
              aria-label="Add column"
            >
              <Icon name="Plus" className="size-3.5" />
              Column
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setComposerOpen((open) => !open)}
              aria-pressed={composerOpen}
            >
              <Icon name="MessageSquarePlus" className="size-3.5" />
              New task
            </Button>
          </span>
        </header>
        {composerOpen ? (
          <div className="shrink-0 px-5 pt-4">
            <NewTaskComposer
              projects={projects}
              initialProjectId={composerProjectId}
              columns={columns}
              isCreating={createThread.isPending}
              onStart={startTask}
              onSaveDraft={saveDraft}
              onClose={() => setComposerOpen(false)}
            />
          </div>
        ) : null}
        {navigationQuery.isPending ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Loading threads…
          </p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-5">
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
                                firstStartColumn?.sectionId ?? null,
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
                        providers={providers}
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
                      <button
                        type="button"
                        onClick={() => setComposerOpen(true)}
                        className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground transition-colors hover:border-ring/40 hover:text-foreground"
                      >
                        {isTodo
                          ? "No tasks waiting. Add one."
                          : "Empty. Drop a card here or add a task."}
                      </button>
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
