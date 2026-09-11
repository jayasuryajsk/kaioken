import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
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
import {
  OptionPicker,
  type PickerOption,
} from "@/components/pickers/OptionPicker";
import { BoardTaskDialog } from "./BoardTaskDialog";
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
const CARD_CLASS =
  "group/board-card relative flex flex-col gap-0.5 rounded-md py-1.5 pl-2.5 pr-1 text-sm transition-colors";

type BoardTone = "todo" | "working" | "done" | "neutral";

interface BoardColumn {
  id: string;
  sectionId: string | null;
  name: string;
  tone: BoardTone;
}

const TONE_ROW_CLASS: Record<BoardTone, string> = {
  todo: "border-l-2 border-timeline-accent/70 bg-timeline-accent/10 hover:bg-timeline-accent/15",
  working:
    "border-l-2 border-attention/70 bg-attention/10 hover:bg-attention/15",
  done: "border-l-2 border-success/70 bg-success/10 hover:bg-success/15",
  neutral: "border-l-2 border-border bg-surface-recessed hover:bg-state-hover",
};

const TONE_DOT_CLASS: Record<BoardTone, string> = {
  todo: "bg-timeline-accent",
  working: "bg-attention",
  done: "bg-success",
  neutral: "bg-muted-foreground/60",
};

function toneForColumnIndex(index: number): BoardTone {
  if (index === 0) return "todo";
  if (index === 1) return "working";
  if (index === 2) return "done";
  return "neutral";
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
    { id: TODO_COLUMN_ID, sectionId: null, name: "To do", tone: "todo" },
    ...[...sections]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((section, index) => ({
        id: section.id,
        sectionId: section.id,
        name: section.name,
        tone: toneForColumnIndex(index + 1),
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
  tone,
  onOpen,
}: {
  thread: ThreadListEntry;
  projectName: string;
  providers: readonly ProviderInfo[];
  tone: BoardTone;
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
          TONE_ROW_CLASS[tone],
          isDragging && "z-10 opacity-90",
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
        "border-l-2 border-dashed border-timeline-accent/50 hover:bg-timeline-accent/10",
        isDragging && "z-10 opacity-90",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground"
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
        <span className="ml-auto shrink-0 text-2xs text-subtle-foreground">
          draft
        </span>
      </div>
    </div>
  );
}

function BoardColumnView({
  column,
  count,
  children,
  onAddTask,
}: {
  column: BoardColumn;
  count: number;
  children: ReactNode;
  onAddTask?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: columnDroppableId(column),
  });
  return (
    <section
      ref={setNodeRef}
      data-testid={`board-column-${column.id}`}
      className={cn(
        "flex min-h-0 min-w-64 flex-1 flex-col rounded-lg border border-seam bg-surface-raised transition-colors",
        isOver && "border-ring/40 bg-state-hover",
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-seam px-3">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            TONE_DOT_CLASS[column.tone],
          )}
        />
        <span className="truncate text-sm font-medium">{column.name}</span>
        <span className="text-xs text-subtle-foreground">{count}</span>
        {onAddTask ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-6 text-subtle-foreground hover:text-foreground"
            aria-label={`New task in ${column.name}`}
            onClick={onAddTask}
          >
            <Icon name="Plus" className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
        {children}
      </div>
    </section>
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
  const [composer, setComposer] = useState<{
    sectionId: string | null | undefined;
  } | null>(null);
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

  const openComposer = useCallback(
    (sectionId?: string | null) => setComposer({ sectionId }),
    [],
  );
  const closeComposer = useCallback(() => setComposer(null), []);
  const repoOptions = useMemo<PickerOption<string>[]>(
    () => [
      { value: ALL_PROJECTS, label: "All repos" },
      ...projects.map((project) => ({
        value: project.id,
        label: project.name,
      })),
    ],
    [projects],
  );
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
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-5 pb-2 pt-4">
          <h1 className="text-base font-medium">Board</h1>
          <OptionPicker
            label="Repo"
            value={projectFilter}
            options={repoOptions}
            onChange={setProjectFilter}
            muted
          />
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
              onClick={() => (composer ? closeComposer() : openComposer())}
              aria-pressed={composer !== null}
            >
              <Icon name="MessageSquarePlus" className="size-3.5" />
              New task
            </Button>
          </span>
        </header>
        {composer ? (
          <BoardTaskDialog
            key={composer.sectionId ?? "todo"}
            open
            columns={columns}
            initialProjectId={composerProjectId}
            initialSectionId={composer.sectionId}
            onSaveDraft={saveDraft}
            onClose={closeComposer}
          />
        ) : null}
        {navigationQuery.isPending ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            Loading threads…
          </p>
        ) : (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-5 pt-1">
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
                    onAddTask={() => openComposer(column.sectionId)}
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
                        tone={column.tone}
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
                      <p className="px-2 py-1.5 text-xs text-subtle-foreground">
                        {isTodo ? "Nothing waiting." : "Drop a thread here."}
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
