---
name: codex-provider
description: "Diagnose BB-specific Codex session controls, model acceptance, and durable goals."
---

# Codex provider

Codex supports structured plan requests, editing and rerunning eligible messages,
and compaction through the corresponding core `kaioken thread` commands.
`kaioken thread clear-goal <id>` clears its durable active Goal and waits for provider
confirmation. Inspect the thread before recovery actions.

Unlisted model IDs are accepted by this provider; acceptance does not establish
account access. Inspect models on the actual execution host with
`kaioken provider models codex` using the machine or environment selector.

Codex sessions kaioken starts live in a private Codex home
(`~/.kaioken/codex-home`) that links login, config, plugins, skills, and
memories to `~/.codex`, so they stay out of the ChatGPT and Codex apps. The
`isolateCodexHome` plugin setting (default on) controls this;
`kaioken plugin config provider-codex set isolateCodexHome false` writes
sessions into the shared home instead.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.
