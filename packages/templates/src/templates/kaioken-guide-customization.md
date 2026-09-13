---
kind: instruction
title: kaioken Guide — Customization
summary: Command reference for customizing the kaioken app color palette, keyboard shortcuts, and mobile push notifications.
intent: Explain the CLI theme surface, server-backed app customization, and push-notification device registration.
editingNotes: Keep flags accurate against the CLI implementation. Theme details live in the kaioken-cli skill's references/theming.md.
---

Customization commands

Theming — the app-wide color palette

`kaioken theme` controls a set of CSS-variable overrides, persisted server-side and
applied live to every open window. This is the palette only; light/dark mode is a
separate per-client setting the palette layers on top of. Custom themes live on
disk, one folder per theme, at <kaioken-data-dir>/theme/<name>/theme.css (the packaged
app uses ~/.kaioken/theme/…). The folder name is the theme id.

kaioken theme list Built-in and custom themes; shows the active one
kaioken theme dir Print the custom-theme directory (where to author)
kaioken theme set <id> [--favicon-color <color>]
Activate a theme, preserving the favicon color
unless the flag supplies the complete selection
kaioken theme show [id] [--css] Print the active palette, or resolve <id> without
activating it; --css dumps the CSS
kaioken theme reset Back to the default theme; preserve favicon color
kaioken theme favicon set <color> Set favicon color; preserve the active theme
kaioken theme favicon reset Reset favicon color; preserve the active theme

To author a custom theme, run `kaioken theme dir`, write <that-dir>/<name>/theme.css,
then `kaioken theme set <name>`. Optional `pierre-dark.json` / `pierre-light.json`
(or a `theme.json` `codeTheme` field) ship the matching code colors. Built-in
palettes use the matching Shiki pair. The full design-token reference is in
the kaioken-cli skill (references/theming.md).

Favicon colors are `default`, `red`, `orange`, `yellow`, `green`, `teal`,
`blue`, `purple`, and `pink`. Theme and favicon-only commands carry the other
appearance value forward explicitly.

Hovering a palette in Settings → Appearance previews it live in that window
without saving; `kaioken theme show <id>` is the CLI counterpart.

Add --json to any theme command for machine-readable output.

Packaged launcher settings

`kaioken-app config` and `kaioken-app env` reload runtime settings in a running server,
but the CLI identifies server and launcher settings that are startup-only,
including binding/ports, data and the dev-app port, telemetry, inherited skill
roots, and `KAIOKEN_FF_*` flags. `KAIOKEN_LOG_LEVEL` is also startup-only. Use
`kaioken-app config`, not `kaioken-app env`, to change `KAIOKEN_APP_URL`, `KAIOKEN_INFERENCE`,
`KAIOKEN_INFERENCE_FALLBACK`, or `KAIOKEN_TRANSCRIPTION` live. After a startup-only
change, run `kaioken-app stop && kaioken-app start` or restart the desktop app. Until
then, changing or unsetting `KAIOKEN_SERVER_BIND_HOST` does not close a previous
`0.0.0.0` listener.

With `--server-bind-host 0.0.0.0`, the startup listener and `app` rows show
`http://0.0.0.0:<port>`. Health checks and the colocated daemon still connect
through loopback; this does not narrow the IPv4 wildcard listener. Containers
must also publish the port to the host.

Server helper completions use `KAIOKEN_INFERENCE` first, then
`KAIOKEN_INFERENCE_FALLBACK` after a transient timeout, rate limit, or
service-unavailable failure. Their defaults are `codex/gpt-5.6-luna` and
`codex/gpt-5.4-mini`, respectively.

kaioken-app config set KAIOKEN_INFERENCE <provider/model>
kaioken-app config set KAIOKEN_INFERENCE_FALLBACK <provider/model>

Server-backed General settings

Settings → General includes app-wide preferences stored server-side so every
window and restart sees the same value. Keep Awake is instead owned by its
builtin plugin: use its autosaving page under Settings → Installed plugins or run
`kaioken keep-awake enable` or `kaioken keep-awake disable`. Choose every host with `kaioken
keep-awake hosts all`, or name individual host ids after `kaioken keep-awake hosts`.
On macOS it prevents system idle sleep while kaioken is running; closing the lid or
choosing Sleep still sleeps the Mac.

Concurrency limit is also owned by its builtin plugin. Its autosaving page
under Settings → Installed plugins leaves the overall limit unlimited by default and
uses an automatic per-host limit of one thread per available processor. Use
`kaioken concurrency-limit global [unlimited|<limit>]` and `kaioken
concurrency-limit host <host-id> [auto|<limit>]`; 0 pauses new work.

Settings → Keyboard also includes `showKeyboardHints`, which defaults to true.
Turn it off to hide the delayed shortcut badges shown while holding Command or
Control on macOS, or Control on Windows/Linux. Shortcut commands continue to
work.

Settings → General includes `showDiagnosticEvents`, which defaults to false
in all builds. Turn it on to show provider environment resolution and unhandled
provider events. Warnings, errors, and model fallback stay visible. Existing
unhandled-event preferences are preserved. Set it with
`kaioken settings general showDiagnosticEvents <true|false>`.

Settings → General also includes `steerActiveThreadOnEnter`, which defaults to
true for a new install. An earlier install with saved settings or work keeps
false. Outside an open typeahead menu, enabling it makes Enter steer a running
thread and Command+Enter queue a follow-up; when disabled, those actions are
reversed. Shift+Enter inserts a newline. On coarse-pointer touch devices, the
software-keyboard Return path inserts a newline. iPadOS WebKit preserves these
Enter shortcuts for a connected Magic Keyboard.

Settings → General also includes `streamerMode`, which defaults to false. Turn
it on to hide every `customModels` entry from `~/.kaioken/config.json` in all model
lists (pickers, `kaioken provider models`, and the SDK) during a screen share. The
entries stay in the config file.

Settings → General includes `managedBranchPrefix`, which defaults to
`kaioken/`. kaioken puts it in front of every branch name it creates for a worktree, so
the default gives `kaioken/fix-login-flow-thr_ab12cd34ef`. Set `sawyer/wt-` to get
`sawyer/wt-fix-login-flow-thr_ab12cd34ef`, or clear it for no prefix. kaioken rejects
a prefix that cannot start a valid git branch name. The new prefix applies to
branches kaioken creates after the change.

kaioken settings show
kaioken settings ai-services
kaioken settings general <key> <value>
kaioken settings experiment <key> <value>
kaioken settings usage [--machine <id-or-name>]
kaioken settings version [--force]
kaioken settings reload

`kaioken settings ai-services` shows the helper-inference and voice-transcription
settings (`KAIOKEN_INFERENCE`, `KAIOKEN_INFERENCE_FALLBACK`, `KAIOKEN_TRANSCRIPTION`, set with
`kaioken-app config`) and the plugin-registered AI services they may name as
`<service>/<model>`.

`kaioken settings general` accepts any key from `generalSettings` in
`kaioken settings show`. Boolean preferences take `true`, `false`, `on`, or `off`,
and `null` clears a preference that can be unset.

The default-off `changelogPreview` experiment shows the latest release notes
as a compact, dismissible card on Settings → Updates.
Message editing is available for eligible, accepted
root user messages in Codex, Claude Code, and Pi threads, including failed or
incomplete turns. Opening the editor is
client-local; submitting stops and settles a running thread, then replaces the
selected turn and all later conversation history while retaining workspace side
effects. Grouped multi-message requests are not yet editable.

Kaioken releases restorable provider sessions after 30 idle minutes. The daemon
checks for these sessions every five minutes. Active turns, commands, agents,
workflows, and monitors keep their sessions loaded.

The default-off `sidebarProgressiveDisclosure` experiment shows the first five
groups in the current sort order in **By project** and **By machine**, keeps
attention groups visible, and reveals ten more per **Show more** click. Revealed
groups stay visible through activity and sort-order changes.
**Manually** is unchanged. Enable it with `kaioken settings experiment
sidebarProgressiveDisclosure true`.

The default-off `timelineWindowing` experiment mounts only nearby rows in long
timelines and large expanded timeline details. Enable it with
`kaioken settings experiment timelineWindowing true`.

Thread timeline pages select complete conversation groups using
`KAIOKEN_FF_TIMELINE_WINDOW_EVENT_BUDGET` (default 1500) as a selection budget.
Oversized groups paginate their contents with stable summary identities.
Grouping can load more than the budget to preserve lifecycle and delegation
context; it is not a hard CPU or memory cap. Older activity loads on scroll.
A walk keeps its initial history snapshot. Edits invalidate it, and a new live
snapshot can require loading older pages again.

Server-backed keyboard shortcuts

Settings → Keyboard records per-command shortcut overrides. They are persisted
server-side, applied live to every connected window, and survive restarts.
Reset removes an override and returns to kaioken's current default; Clear explicitly
disables a command. `Mod` means Command on macOS and Control on Windows/Linux.
Bindings for non-native actions apply in browser and desktop clients. Command
contexts and native-only availability remain server-owned, and desktop menu
accelerators for New Thread, New Window, New Tab, Close, and Settings use the
same resolved bindings. The complete default table is in docs/configuration.md.

kaioken settings keyboard list
kaioken settings keyboard hints <true|false>
kaioken settings keyboard set <command> <shortcut|disabled>
kaioken settings keyboard reset [command]

Push notifications

The built-in Push notifications plugin sends mobile updates through Expo and
system notifications to connected web and desktop clients. Web tabs or desktop
windows must stay open; browser permission is requested in the plugin settings.

kaioken push-notifications list
kaioken push-notifications add --token <expo-push-token>
--platform <ios|android> --label <device-name>
kaioken push-notifications remove <id>
kaioken push-notifications status
kaioken push-notifications test <web|desktop>
kaioken plugin config push-notifications set <mobileEnabled|webEnabled|desktopEnabled> <true|false>

`add` is an upsert by token: a known token refreshes its label and last-seen
time and keeps its id. Expo tokens that are no longer registered are removed
automatically after a failed delivery. Use `kaioken plugin disable
push-notifications` to stop delivery. Change the relay URL with `kaioken plugin
config push-notifications set expoPushUrl <url>`. Add `--json` to `list` or
`status` for machine-readable output. The list returns token suffixes only.
The three channel switches default to true and apply immediately across this
server. `test` broadcasts to all connected clients of the selected type with
permission; OS notification settings still control whether a banner appears.

Host files and voice transcription

kaioken file read|write|list|paths|mkdir|move|remove ...
kaioken voice transcribe <audio-file> [--prompt <context>]

Voice transcription uses the `KAIOKEN_TRANSCRIPTION` model, which defaults to
`codex/gpt-transcribe`. Override it with
`kaioken-app config set KAIOKEN_TRANSCRIPTION <provider/model>`.

`kaioken file` supports `--host` for remote machines and `--root` on mutating
commands to confine access beneath an absolute directory. `kaioken file list` and
`kaioken file paths` include dot-prefixed entries; pass `--no-hidden` to skip them.
Both skip a default set of dependency and cache directories such as
`node_modules`, `.venv`, `.pnpm-store`, and root-relative `.claude/worktrees`;
`--exclude <names...>` replaces that set. Entries match basenames at any depth
or exact root-relative paths using `/` separators. Use
`--json` for metadata and machine-readable results.

Server-backed sidebar preferences

Sidebar layout lives on the server in a keyed, revisioned registry so every
window, device, and the CLI share it: organization mode, chronological sort,
section orders, collapsed rows and sections, navigation entry order and
visibility, and the navigation and thread-list provider pickers. The sidebar
waits for them alongside the project list, and an upgrade uploads the old
browser-stored layout once.

kaioken settings ui list [--json]
kaioken settings ui get <key> [--json]
kaioken settings ui set <key> <value> [--json]
kaioken settings ui reset <key> [--json]

`kaioken settings ui list` prints every key with its value, revision, and a short
description. `set` takes plain strings for enum and provider keys and JSON for
lists and `null`; it reads the current revision, writes with it, and retries
once on a conflict. `reset` writes the default. The SDK offers
`sdk.system.uiPreferences.list()`, `.set()`, and `.reset()`.

The default sidebar layout is Unified (Settings > Appearance > Layout): one
list that starts with two attention tiers shown only when non-empty: Needs
you (longest wait first; each card names the repo and machine, shows the
pending command or question with its wait time, and offers Allow / Deny,
Allow for session under its menu, Reply, or Open inline) and Running
(newest first, with the thread's current state). Then Pinned, one
collapsible group per section, Projects, and Recents. Recents holds only
projectless chats, grouped by day; threads that belong to a project appear
under that project. Project rows show the repo and, for repos on another
machine, the machine name with a green dot while it is connected; each
project row collapses with its chevron, lists its three newest threads with
Show more, and the Projects section itself collapses from its header and
shows eight projects with Show more. The Projects header's menu sorts by
Recent activity, Name, or Machine (`sidebar.projectsSort`) and offers New
section; its + adds a project. The title row's bell shows how many threads
need you and scrolls to Needs you; the footer names the server machine.

The Timeline and Projects layouts remain selectable. In the Projects layout
every thread-list header's actions menu offers New project, New section,
Organize, and Sort by. Organize selects By project, By machine, By connection,
or Custom; Sort by selects a field, and selecting it again reverses its
arrow/direction. By connection shows one collapsible group per machine (the
primary machine first) holding that machine's repos with their threads, plus
one group per section above them. A section is a global label: it can hold
repos and threads from any machine, and a labelled repo or thread appears
under its section instead of its machine. Move a repo from its actions menu
(Move to section) and a thread from its menu; removing a section returns its
members to their machines. `sidebar.connectionSectionOrder` stores the
top-level order for this mode.

Labels from the CLI

kaioken labels list [--json]
kaioken labels add <name> [--json]
kaioken labels rename <label> <name> [--json]
kaioken labels remove <label> [--yes] [--json]
kaioken labels move <label> <id...> [--json]
kaioken labels unlabel <id...> [--json]

`<label>` is a section id or its exact name. `move` accepts repo ids
(`proj_...`) and thread ids (`thr_...`) in one call; each member belongs to at
most one label. The same sections back `kaioken thread section` and the
sidebar's Custom mode. The SDK exposes `sdk.threadSections.list()` (each entry
carries `projectIds`), `sdk.projects.update({ projectId, sectionId })`, and
`sdk.threads.update({ threadId, sectionId })`.
`sidebar.sortDirection` accepts `ascending`, `descending`, or `default`.
The default preserves each field's original order (newest first for dates,
A–Z for titles). For example: `kaioken settings ui set sidebar.sortDirection ascending`.

Client-local UI preferences

Some Settings values live only in the current browser/client. Sidebar width
and open state stay local because they depend on the window size. The Voice Input
microphone picker stores the selected browser MediaDevices device id in
localStorage as `bb.voiceInput.audioInputDeviceId`; it does not have a `kaioken`
command and does not change the server-side transcription model.
