# Worktree

Creates an isolated Git worktree from the project checkout on an enrolled machine. The plugin supplies base-branch inputs, runs workspace setup, and removes owned worktrees after core retires them. Project sub-threads receive fresh worktrees by default.

After the worktree exists, the plugin prepares dependencies without any
per-repo configuration: it links `node_modules` and `.venv` from the project
checkout when the lockfile matches, runs the detected package manager (pnpm,
bun, yarn, or npm) when it does not, and steps aside when the repo ships its own
`.kaioken-env-setup.sh`. The `prepareDependencies` plugin setting chooses
`link` (default), `install`, or `off`.

Bundled and installed automatically. Select it through the environment picker or `kaioken thread spawn --environment-provider git-worktree`. Use `kaioken environment providers --json` for its inputs and availability.

The Plugin Guide documents the experimental environment-provider contract. Core owns durable launches, retries, cancellation, retirement, and teardown; this plugin owns resource creation and removal.
