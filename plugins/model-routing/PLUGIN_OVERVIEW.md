Put models from your own endpoints into the composer's model picker. Store an OpenRouter or DeepSeek API key (or a custom endpoint), choose which of their models you want to see, then pick the harness and the model in the composer like any other thread.

## What you get

- API keys for OpenRouter and DeepSeek, plus a custom endpoint, stored as secrets that never reach the frontend or a log line.
- A searchable catalogue read from the endpoint itself, with a switch per model that puts it in the picker.
- Endpoint models listed in the Claude Code and Codex model menus, tagged with the endpoint name, so the harness choice and the model choice happen where every other thread makes them.
- Per-thread routing: a thread on an endpoint model is routed to that endpoint with your key, and every request it makes stays on that model, including background ones. A thread on a native model is untouched.
- `kaioken model-routing status`, `models`, `enable`, and `disable` for the same things from a terminal or an agent.

## What it routes

**Claude Code** goes through the endpoint's Anthropic Messages API. The plugin sets `ANTHROPIC_BASE_URL`, sends your key the way that endpoint expects, and pins every Claude Code model variable to the model you picked.

**Codex** goes through the endpoint's OpenAI Responses API, the only wire format the Codex CLI speaks. The plugin declares a `kaioken-custom` model provider and lets the CLI read the key itself, so the key never appears in a command line.

## Requirements

An API key with credit on the endpoint you choose. A custom endpoint needs whichever shape the harness speaks: the Anthropic Messages API for Claude Code, the OpenAI Responses API for Codex. There are separate base URL settings for each, and its model ids are typed into the Custom endpoint models setting.
