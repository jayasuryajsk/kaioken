# kaioken-plugin-model-routing

Bring-your-own-key routing for Kaioken's coding agents. Claude Code and Codex
are routed independently.

## Settings

| Setting                       | Purpose                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| Claude Code endpoint          | `Default`, `OpenRouter`, `DeepSeek`, or `Custom endpoint`                  |
| Claude Code model             | Model id sent as `ANTHROPIC_MODEL`; empty means the endpoint's own default |
| Codex endpoint                | Same four choices, resolved independently                                  |
| Codex model                   | Model id Codex asks for; empty means the endpoint's own default            |
| OpenRouter API key            | Secret; sent as a bearer token                                             |
| DeepSeek API key              | Secret; sent as the Anthropic API key for Claude Code, bearer for Codex    |
| Custom endpoint name          | Label used when describing the route                                       |
| Custom base URL (Claude Code) | Must speak the Anthropic Messages API                                      |
| Custom base URL (Codex)       | Must speak the OpenAI Responses API                                        |
| Custom API key                | Secret                                                                     |

Keys are stored by the host as plugin secrets, outside the database and outside
anything the frontend can read.

## Claude Code

Nothing is contributed on the `Default` route, or when the chosen endpoint has
no key, or when a custom base URL is missing or malformed.

| Endpoint   | Variables                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| OpenRouter | `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_API_KEY=`          |
| DeepSeek   | `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, `ANTHROPIC_API_KEY=<key>`, `ANTHROPIC_AUTH_TOKEN=` |
| Custom     | your Anthropic base URL, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_API_KEY=`                                 |

`ANTHROPIC_MODEL` is added when a model is chosen.

## Codex

The Codex CLI only supports `wire_api = "responses"`, so the endpoint must
speak the OpenAI Responses API. Both OpenRouter and DeepSeek do.

| Endpoint   | `CODEX_CUSTOM_BASE_URL`        |
| ---------- | ------------------------------ |
| OpenRouter | `https://openrouter.ai/api/v1` |
| DeepSeek   | `https://api.deepseek.com`     |
| Custom     | your Responses base URL        |

The plugin contributes `CODEX_CUSTOM_BASE_URL`, `CODEX_CUSTOM_AUTH_TOKEN`
(secret), `CODEX_CUSTOM_NAME`, and `CODEX_CUSTOM_MODEL` when a model is chosen.
The Codex provider's bridge turns those into config overrides:

```
-c model_provider="kaioken-custom"
-c model_providers.kaioken-custom.name="OpenRouter"
-c model_providers.kaioken-custom.base_url="https://openrouter.ai/api/v1"
-c model_providers.kaioken-custom.wire_api="responses"
-c model_providers.kaioken-custom.env_key="CODEX_CUSTOM_AUTH_TOKEN"
-c model="anthropic/claude-sonnet-4.5"
```

`env_key` names the environment variable the CLI reads for itself and sends as
an `Authorization: Bearer` header, so the key never reaches a command line or a
process listing. The Account Pooler keeps priority: when it is routing Codex,
this plugin's variables are ignored.

Only the credential entry is marked secret in either harness.

## CLI

```bash
kaioken model-routing status
kaioken model-routing models openrouter
kaioken model-routing use codex deepseek-flash
kaioken model-routing use claude-code anthropic/claude-sonnet-4.5
```

## Tests

```bash
pnpm --filter kaioken-plugin-model-routing test
pnpm --filter kaioken-plugin-provider-codex test
```
