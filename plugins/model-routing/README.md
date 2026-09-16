# kaioken-plugin-model-routing

Bring-your-own-key models for Kaioken's coding agents. Endpoint models appear
in the composer's model picker for Claude Code and Codex; a thread that picks
one is routed to that endpoint with your key.

## Settings

| Setting                       | Purpose                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| OpenRouter API key            | Secret; sent as a bearer token                                             |
| DeepSeek API key              | Secret; sent as the Anthropic API key for Claude Code, bearer for Codex    |
| Custom endpoint name          | Tag shown beside custom models in the picker                               |
| Custom base URL (Claude Code) | Must speak the Anthropic Messages API                                      |
| Custom base URL (Codex)       | Must speak the OpenAI Responses API                                        |
| Custom API key                | Secret                                                                     |
| Custom endpoint models        | Comma-separated model ids the custom endpoint serves; all go in the picker |

Keys are stored by the host as plugin secrets, outside the database and outside
anything the frontend can read. Which OpenRouter and DeepSeek models are in the
picker is kept in the plugin's key-value storage.

## Picker models

The settings panel loads an endpoint's catalogue and offers a switch per
model. Enabled models are contributed to both harnesses through
`bb.providers.experimental_contributeModels` as `<endpoint>/<model-id>`, for
example `openrouter/meta/muse-spark-1.3-contributor`, tagged with the endpoint
name. A model is offered to a harness only when that harness can reach the
endpoint (a key, plus a base URL of the right shape for custom endpoints).

## Routing

The env resolver reads the thread's model from
`ExperimentalPluginProviderEnvContext.model`. A native id contributes nothing.
A `<endpoint>/<model-id>` id contributes:

### Claude Code

| Endpoint   | Variables                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| OpenRouter | `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_API_KEY=`          |
| DeepSeek   | `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, `ANTHROPIC_API_KEY=<key>`, `ANTHROPIC_AUTH_TOKEN=` |
| Custom     | your Anthropic base URL, `ANTHROPIC_AUTH_TOKEN=<key>`, `ANTHROPIC_API_KEY=`                                 |

plus the picked model on `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`,
`ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`,
`ANTHROPIC_SMALL_FAST_MODEL`, and `CLAUDE_CODE_SUBAGENT_MODEL`, so no request
from that thread falls back to an Anthropic model on the endpoint. The Claude
Code bridge sends `ANTHROPIC_MODEL` from the session environment instead of
the picker id whenever it is set.

### Codex

The Codex CLI only supports `wire_api = "responses"`, so the endpoint must
speak the OpenAI Responses API. Both OpenRouter and DeepSeek do.

| Endpoint   | `CODEX_CUSTOM_BASE_URL`        |
| ---------- | ------------------------------ |
| OpenRouter | `https://openrouter.ai/api/v1` |
| DeepSeek   | `https://api.deepseek.com`     |
| Custom     | your Responses base URL        |

The plugin contributes `CODEX_CUSTOM_BASE_URL`, `CODEX_CUSTOM_AUTH_TOKEN`
(secret), `CODEX_CUSTOM_NAME`, and `CODEX_CUSTOM_MODEL`. The Codex provider's
bridge turns those into config overrides and sends `CODEX_CUSTOM_MODEL` as the
turn model instead of the picker id:

```
-c model_provider="kaioken-custom"
-c model_providers.kaioken-custom.name="OpenRouter"
-c model_providers.kaioken-custom.base_url="https://openrouter.ai/api/v1"
-c model_providers.kaioken-custom.wire_api="responses"
-c model_providers.kaioken-custom.env_key="CODEX_CUSTOM_AUTH_TOKEN"
-c model="meta/muse-spark-1.3-contributor"
```

`env_key` names the environment variable the CLI reads for itself and sends as
an `Authorization: Bearer` header, so the key never reaches a command line or a
process listing. The Account Pooler keeps priority: when it is routing Codex,
this plugin's variables are ignored.

Only the credential entry is marked secret in either harness.

## CLI

```bash
kaioken model-routing status
kaioken model-routing models openrouter --refresh
kaioken model-routing enable openrouter meta/muse-spark-1.3-contributor
kaioken model-routing disable openrouter meta/muse-spark-1.3-contributor
```

## Tests

```bash
pnpm --filter kaioken-plugin-model-routing test
pnpm --filter kaioken-plugin-provider-codex test
pnpm --filter kaioken-plugin-provider-claude-code test
```
