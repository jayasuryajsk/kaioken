Point a coding agent at your own model endpoint instead of its built-in sign-in. Store an OpenRouter or DeepSeek API key, choose which harness uses it, and pick the model.

## What you get

- API keys for OpenRouter and DeepSeek, plus a custom Anthropic-compatible endpoint, stored as secrets that never reach the frontend or a log line.
- A per-harness route: leave a harness on **Default** and it signs in the way it always did, or send it to one of your keys.
- A model catalogue read from the endpoint itself, searchable, so you pick a model id instead of typing one.
- `kaioken model-routing status`, `models`, and `use` for the same three things from a terminal or an agent.

## What it routes today

**Claude Code** is fully routed. The plugin sets `ANTHROPIC_BASE_URL` for the chosen endpoint, sends your key the way that endpoint expects, and sets `ANTHROPIC_MODEL` when you pick a model.

**Codex is not routed yet.** Its bridge builds a single hardcoded model provider that speaks the OpenAI responses API, and both OpenRouter and DeepSeek speak chat-completions. Routing Codex needs a change inside the Codex provider, not this plugin.

## Requirements

An API key with credit on the endpoint you choose. A custom endpoint must speak the Anthropic Messages API; an OpenAI-shaped endpoint will not work with Claude Code without a translating proxy.
