Point a coding agent at your own model endpoint instead of its built-in sign-in. Store an OpenRouter or DeepSeek API key, choose which harness uses it, and pick the model.

## What you get

- API keys for OpenRouter and DeepSeek, plus a custom Anthropic-compatible endpoint, stored as secrets that never reach the frontend or a log line.
- A per-harness route: leave a harness on **Default** and it signs in the way it always did, or send it to one of your keys.
- A model catalogue read from the endpoint itself, searchable, so you pick a model id instead of typing one.
- `kaioken model-routing status`, `models`, and `use` for the same three things from a terminal or an agent.

## What it routes

**Claude Code** goes through the endpoint's Anthropic Messages API. The plugin sets `ANTHROPIC_BASE_URL`, sends your key the way that endpoint expects, and sets `ANTHROPIC_MODEL` when you pick a model.

**Codex** goes through the endpoint's OpenAI Responses API, the only wire format the Codex CLI speaks. The plugin declares a `kaioken-custom` model provider and lets the CLI read the key itself, so the key never appears in a command line.

Each harness is routed separately: you can leave Claude Code on your subscription and send only Codex to OpenRouter, or the other way round.

## Requirements

An API key with credit on the endpoint you choose. A custom endpoint needs whichever shape the harness speaks: the Anthropic Messages API for Claude Code, the OpenAI Responses API for Codex. There are separate base URL settings for each.
