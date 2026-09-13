# Codex sessions

Kaioken runs Codex threads in a private Codex home (`~/.kaioken/codex-home`) so
the Codex CLI and the Codex desktop app never see Kaioken's sessions and Kaioken
never sees theirs. This page covers the three commands that move a session
across that boundary.

The Codex CLI stores every session as a rollout: one JSONL file under
`$CODEX_HOME/sessions/YYYY/MM/DD/` (or `archived_sessions/`). `$CODEX_HOME`
defaults to `~/.codex`. Kaioken reads and writes those files directly; it never
asks the Codex CLI to export anything.

## In the app

The new-thread page has an "Import from Codex" link under the composer, and
the command palette offers the same action. The picker groups sessions by the
folder they ran in, newest first, marks sessions that are already imported, and
can include Codex's archived sessions. Picking a session opens its thread.

A thread's actions menu shows "Continue in Codex" once the thread has a Codex
session; it runs the handoff and shows the `codex resume` command with a copy
button. "Sync from Codex" appears while the thread is handed off.

## Import a Codex session

```sh
kaioken codex sessions list            # top-level sessions, newest first
kaioken codex sessions list --archived # include Codex's archived sessions
kaioken codex sessions import <id> [<id>...] [--project <id>]
```

`list` skips subagent rollouts (guardian and other delegated sessions) and
sessions Kaioken itself created. Each row shows the session id, its date, the
folder it ran in, the name Codex shows for it, and the Kaioken thread it was
already imported as, if any. Names, pins, sections, and archived flags come
from Codex's own index (`state_<n>.sqlite` in the Codex home) when it exists;
without it the first prompt stands in for the name. Imported threads take the
Codex name as their title.

`import` creates an idle Codex thread whose timeline is the session's history:
user prompts, assistant replies, reasoning summaries, commands, file changes,
MCP tool calls, and web searches. Provider-native details Kaioken has no item
for (subagent activity, plan steps without text) are skipped. The thread is
bound to the Codex session id, so the next message you send continues the same
Codex conversation with its full context instead of starting over.

The project comes from the session's working folder: an existing project whose
checkout is that folder (or contains it) is reused, an existing folder with no
project becomes a new project, and anything else lands in the personal project.
Pass `--project` to choose explicitly. The rollout is copied into Kaioken's
private Codex home; the original stays where Codex left it.

Importing the same session twice returns the existing thread.

## Continue a thread in the Codex CLI

```sh
kaioken thread codex handoff <thread-id>
codex resume <session-id>              # printed by the handoff
kaioken thread codex sync <thread-id>  # when you come back
```

`handoff` copies the thread's rollout into `$CODEX_HOME` so `codex resume`
finds it, and marks the thread as handed off. Kaioken keeps its copy; nothing is
deleted. `sync` reads the rollout Codex appended to, adds the new turns to the
thread's timeline, copies the file back into the private home, and clears the
handoff mark.

Both run on the machine the thread's environment lives on. For a thread on an
enrolled machine the server asks that machine's host daemon to locate, copy, and
read the rollout, so `codex resume` must be run there; the handoff output and
the app's toast name the machine. `kaioken codex sessions list` and `import`
only see sessions on the Kaioken server machine.

Drive a session from one side at a time. After a handoff, send messages from
Codex until you sync; after a sync, send messages from Kaioken until the next
handoff. Both tools append to the same session id, and the last writer's
rollout is the one the other tool will read on its next handoff or sync.

`kaioken thread codex show <thread-id>` prints the session id, where the thread
was imported from, and whether it is currently handed off.

## API and SDK

| Route                                                     | SDK                                            |
| --------------------------------------------------------- | ---------------------------------------------- |
| `GET /api/v1/codex/sessions?includeArchived=true`         | `sdk.codex.sessions.list({ includeArchived })` |
| `POST /api/v1/codex/sessions/import` `{ id, projectId? }` | `sdk.codex.sessions.import({ id, projectId })` |
| `GET /api/v1/threads/:id/codex`                           | `sdk.threads.codex.link({ threadId })`         |
| `POST /api/v1/threads/:id/codex/handoff`                  | `sdk.threads.codex.handoff({ threadId })`      |
| `POST /api/v1/threads/:id/codex/sync`                     | `sdk.threads.codex.sync({ threadId })`         |

`import` answers with the thread, new or already imported.
`handoff` and `sync` refuse threads that are not Codex threads
(`codex_thread_required`), threads that are still running (`thread_busy`), and
threads with no Codex session yet (`codex_session_unavailable`). `sync` also
refuses a thread that was never imported or handed off (`codex_sync_not_ready`),
because it would have no point to sync from.
