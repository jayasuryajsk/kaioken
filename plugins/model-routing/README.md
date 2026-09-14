# kaioken-plugin-model-routing

Bring-your-own-key routing for Kaioken's coding agents.

## Settings

| Setting              | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| Claude Code endpoint | `Default`, `OpenRouter`, `DeepSeek`, or `Custom endpoint`                  |
| Claude Code model    | Model id sent as `ANTHROPIC_MODEL`; empty means the endpoint's own default |
| OpenRouter API key   | Secret; sent as a bearer token                                             |
| DeepSeek API key     | Secret; sent as the Anthropic API key                                      |
| Custom endpoint name | Label used when describing the route                                       |
| Custom base URL      | Must speak the Anthropic Messages API                                      |
| Custom API key       | Secret; sent as a bearer token                                             |

Keys are stored by the host as plugin secrets, outside the database and outside
anything the frontend can read.

## Environment contributed to Claude Code

Nothing is contributed on the `Default` route, or when the chosen endpoint has
no key, or when a custom base URL is missing or malformed.

| Endpoint   | Variables                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| OpenRouter | `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_API_KEY=`          |
| DeepSeek   | `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, `ANTHROPIC_API_KEY=<key>`, `ANTHROPIC_AUTH_TOKEN=` |
| Custom     | `ANTHROPIC_BASE_URL=<your url>`, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_API_KEY=`                         |

`ANTHROPIC_MODEL` is added when a model is chosen. Only the credential entry is
marked secret.

## CLI

```bash
kaioken model-routing status
kaioken model-routing models openrouter
kaioken model-routing use anthropic/claude-sonnet-4.5
```

## Codex

Not supported yet. `plugins/provider-codex/src/bridge/bridge.ts` builds one
hardcoded model provider with `wire_api="responses"` and
`requires_openai_auth=true`, keyed off `CODEX_OPENAI_BASE_URL` and
`CODEX_POOL_AUTH_TOKEN`, and passes the token as the
`x-bb-account-pool-token` header. OpenRouter and DeepSeek need
`wire_api="chat"` and a bearer `Authorization` header, so routing Codex means
generalising that override inside the Codex provider.

## Tests

```bash
pnpm --filter kaioken-plugin-model-routing test
```
