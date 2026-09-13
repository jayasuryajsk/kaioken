import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import type { CodexSession } from "@kaioken/server-contract";
import { Button } from "@kaioken/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kaioken/shared-ui/dialog";
import { Icon } from "@kaioken/shared-ui/icon";
import { Input } from "@kaioken/shared-ui/input";
import { Label } from "@kaioken/shared-ui/label";
import { Switch } from "@kaioken/shared-ui/switch";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { useCodexSessions } from "@/hooks/queries/codex-queries";
import { useImportCodexSession } from "@/hooks/mutations/codex-mutations";
import { codexImportDialogOpenAtom } from "@/lib/codex-import/atoms";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadRoutePath } from "@/lib/route-paths";

interface CodexImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CodexSessionGroup {
  cwd: string;
  name: string;
  sessions: CodexSession[];
}

const TITLE_MAX_LENGTH = 140;

function promptLine(session: CodexSession): string | null {
  const firstLine = session.firstPrompt
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return null;
  return firstLine.length > TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : firstLine;
}

export function codexSessionTitle(session: CodexSession): string {
  return (
    session.name ??
    promptLine(session) ??
    `Codex session ${session.id.slice(0, 8)}`
  );
}

export function codexSessionSubtitle(session: CodexSession): string | null {
  return session.name === null ? null : promptLine(session);
}

function folderName(cwd: string): string {
  const segments = cwd.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? cwd;
}

export function groupCodexSessions(
  sessions: readonly CodexSession[],
  query: string,
): CodexSessionGroup[] {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, CodexSessionGroup>();
  for (const session of sessions) {
    if (
      needle.length > 0 &&
      !codexSessionTitle(session).toLowerCase().includes(needle) &&
      !(session.firstPrompt ?? "").toLowerCase().includes(needle) &&
      !(session.section ?? "").toLowerCase().includes(needle) &&
      !session.cwd.toLowerCase().includes(needle) &&
      !session.id.toLowerCase().includes(needle)
    ) {
      continue;
    }
    const group = groups.get(session.cwd) ?? {
      cwd: session.cwd,
      name: folderName(session.cwd),
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(session.cwd, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    .sort(
      (a, b) =>
        (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0),
    );
}

function CodexSessionRow({
  session,
  now,
  pending,
  onImport,
}: {
  session: CodexSession;
  now: number;
  pending: boolean;
  onImport: (session: CodexSession) => void;
}) {
  const imported = session.importedThreadId !== null;
  const subtitle = codexSessionSubtitle(session);
  return (
    <li>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() => onImport(session)}
        className={cn(
          "group flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors",
          "hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-60",
        )}
      >
        <Icon
          name={pending ? "Spinner" : imported ? "Check" : "Terminal"}
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-subtle-foreground",
            pending && "animate-spin",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm text-foreground">
            {codexSessionTitle(session)}
          </span>
          {subtitle !== null ? (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              {formatRelativeTime({ timestamp: session.updatedAt, now })}
            </span>
            {session.pinned ? <span>Pinned</span> : null}
            {session.section !== null ? <span>{session.section}</span> : null}
            {session.archived ? <span>Archived</span> : null}
            {imported ? (
              <span className="text-subtle-foreground">Imported</span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export function CodexImportDialog({
  open,
  onOpenChange,
}: CodexImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open ? <CodexImportDialogContent onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CodexImportDialogContent({
  onOpenChange,
}: Pick<CodexImportDialogProps, "onOpenChange">) {
  const navigate = useNavigate();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const sessionsQuery = useCodexSessions({ includeArchived });
  const importSession = useImportCodexSession();
  const [now] = useState(() => Date.now());
  const groups = useMemo(
    () => groupCodexSessions(sessionsQuery.data?.sessions ?? [], query),
    [query, sessionsQuery.data?.sessions],
  );

  const openThread = (projectId: string, threadId: string) => {
    onOpenChange(false);
    void navigate(getThreadRoutePath({ projectId, threadId }));
  };

  const handleImport = (session: CodexSession) => {
    if (pendingId !== null) return;
    setPendingId(session.id);
    importSession.mutate(
      { id: session.id },
      {
        onSuccess: (thread) => openThread(thread.projectId, thread.id),
        onSettled: () => setPendingId(null),
      },
    );
  };

  const sessionCount = sessionsQuery.data?.sessions.length ?? 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import from Codex</DialogTitle>
        <DialogDescription>
          Continue a Codex CLI session here. Its history becomes a thread and
          the next message picks up where Codex left off.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search Codex sessions"
          placeholder="Search by prompt or folder"
          value={query}
          className="min-w-0 flex-1"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={includeArchived}
            aria-label="Show archived"
            onCheckedChange={setIncludeArchived}
          />
          Show archived
        </Label>
      </div>
      <div className="max-h-[min(26rem,60vh)] min-h-32 overflow-y-auto">
        {sessionsQuery.isPending ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Reading Codex sessions…
          </p>
        ) : sessionsQuery.isError ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
            <p className="text-sm text-destructive">
              {getMutationErrorMessage({
                error: sessionsQuery.error,
                fallbackMessage: "Couldn't read Codex sessions.",
              })}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void sessionsQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : sessionCount === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No Codex sessions found in ~/.codex/sessions
          </p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No sessions match “{query.trim()}”
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.cwd} aria-label={group.name}>
                <h3
                  className="truncate px-2 pb-1 text-xs font-medium text-subtle-foreground"
                  title={group.cwd}
                >
                  {group.name}
                </h3>
                <ul className="flex flex-col">
                  {group.sessions.map((session) => (
                    <CodexSessionRow
                      key={session.id}
                      session={session}
                      now={now}
                      pending={pendingId === session.id}
                      onImport={handleImport}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      {sessionsQuery.data ? (
        <p className="truncate text-xs text-muted-foreground">
          Reading {sessionsQuery.data.sharedHome}
        </p>
      ) : null}
    </>
  );
}

export function CodexImportDialogHost() {
  const [open, setOpen] = useAtom(codexImportDialogOpenAtom);
  return <CodexImportDialog open={open} onOpenChange={setOpen} />;
}
