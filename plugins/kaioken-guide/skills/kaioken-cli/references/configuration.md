# Configuration and skill management

## Environment Setup And Teardown Scripts

- To make a repo work with kaioken worktrees, run `kaioken guide environments`. It
  documents the repo-level `.kaioken-env-setup.sh` and `.kaioken-env-teardown.sh` hooks,
  and the `.worktreeinclude` file.
- A new worktree checks out tracked files only. Commit a `.worktreeinclude`
  file at the repo root to list untracked files, such as `.env`, that kaioken must
  copy from the source checkout. It uses gitignore pattern syntax. kaioken copies
  the matches before it runs `.kaioken-env-setup.sh`.

- Hooks require ownership confirmed by successful provider creation. Attached
  checkout and personal-workspace paths skip both hooks. Server restart resumes
  the saved hook operation; cleanup waits for daemon-confirmed termination
  after a transport failure and retries while the daemon is unreachable.

- Missing default environment plugins cause creation to fail before a thread is
  inserted. Enable the plugin or explicitly select another environment.
- Host-dependent environment preflight requires a connected machine. Directory
  switching creates a core-owned attachment without claiming plugin provenance.

## App settings

- Read `references/app-settings.md` for every general key, experiment, default,
  and effect.
- Use `kaioken settings show` and `kaioken settings ai-services` for current values.
- Use `kaioken settings general <key> <value>` or
  `kaioken settings experiment <key> <value>` for updates.
- Use `kaioken settings keyboard list`, `set`, and `reset` for shortcut overrides.
- Use `kaioken settings usage [--machine <id-or-name>]` for provider limits.
  `--host` is an alias for `--machine`.
- Use `kaioken settings version [--force]` for release information.
- Use `kaioken settings reload` to reload BB-managed configuration.
- These commands support `--json`.

## Agent Instructions

- Add `AGENTS.md` to the kaioken data dir (usually `~/.kaioken/AGENTS.md`) to inject
  user-level default instructions for every provider-backed thread across all
  projects.
- Add `.kaioken/AGENTS.md` at a workspace root to inject repo-specific instructions
  into every thread that runs there. Track the workspace file with git so fresh
  managed worktrees include it.
- kaioken appends data-dir instructions first, then workspace instructions, to the
  thread system prompt for all providers when a provider session starts.
- Only the plural `AGENTS.md` is read, only from those exact locations (no
  parent-directory walk); an empty file is ignored. Run
  `kaioken guide agent-configuration` for details (it also covers project
  `.kaioken/skills/`).

## Skills

- Use `kaioken skill list` to inspect installed and discovered skills. It defaults to
  `KAIOKEN_PROJECT_ID`, then the personal project; pass `--project` or
  `--environment` to select another workspace.
- Copy the opaque ID from `kaioken skill list`, then use `kaioken skill show <skill-id>`
  or `kaioken skill files <skill-id>` to read that exact skill.
- `kaioken skill show <skill-id> --json` returns the revision. Pass that revision,
  plus `--file`, to `kaioken skill update <skill-id>`. Use update or delete only when
  the list says editable.
- Use `kaioken skill search [query]` for live skills.sh results. With no query it
  lists what is trending. The page defaults to zero, and the page size defaults
  to 24. The `ranking` field names the selected leaderboard.
- In JSON, `installs` is the ranking-window count. `lifetimeInstalls` is the
  resolved lifetime count or `null`. Resolution covers at most 48 rows and can
  fail at any page size. Human output prints `—` for an unresolved lifetime
  count.
- Inspect metadata and the bounded file preview with
  `kaioken skill registry detail <registry-skill-id>`.
  Install with `kaioken skill install <registry-skill-id>`; never infer an install
  source from a display name.
- `kaioken skill install-cli-skills` copies kaioken's built-in CLI skills into a machine's
  global agent skill roots (`~/.agents/skills` and `~/.claude/skills`) so agents
  outside kaioken can drive kaioken. It targets every connected machine unless you pass
  the repeatable `--machine <id-or-name>`, and reports each machine's outcome.
  Settings → Skills has the same action; it confirms first, and asks which
  machines only when more than one is enrolled.
- `kaioken skill cli-skills-status` reports per machine whether the installed copy is
  `installed`, `outdated`, `missing`, or `unknown` (disconnected or unreachable).

## Kaioken guide instructions and skills

Settings → Installed plugins → Kaioken guide controls the Kaioken introduction and the
four bundled skills. All settings default to true. Use
`kaioken plugin config kaioken-guide set <key> true|false` with `introduction`, `skills`
(the master skill switch), `kaiokenCli`, `pluginAuthoring`, `skillCreator`, or `submitPlugin`.
Disabling the plugin removes its introduction and skills. Changes apply when
agent configuration is next assembled; independently installed copies remain
available through their own sources.
