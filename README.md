<div align="center">

# anyagent

**Pick a provider, pick a model, run your coding agent.**

[![npm](https://img.shields.io/npm/v/%40waspdev95%2Fanyagent?color=%230b7285&label=npm)](https://www.npmjs.com/package/@waspdev95/anyagent)
[![CI](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml/badge.svg)](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Claude Code, Codex, OpenCode and nine others — on OpenRouter, DeepSeek, Groq, a
local Ollama, or anywhere else. Each of them has its own way of pointing
somewhere else. This is one command for all of them.

```bash
npm install -g @waspdev95/anyagent
anyagent
```

```
  anyagent - pick one, and I will ask for a key and a model

❯ claude    Claude Code       ✔ deepseek/deepseek-v4-pro
  codex     Codex             ✔ openai/gpt-5.6-sol
  opencode  OpenCode          ✔ moonshotai/kimi-k3
  droid     Droid               not installed

  model     Choose the AI model    openrouter / deepseek-v4-pro
  key       Add an API key         1 saved
  check     Check my setup
  quit      Exit
```

Pick one and it runs. It asks for a key the first time, then never again.

That is the whole thing. Everything below is optional.

## Typing instead

```bash
anyagent claude                        # run it
anyagent codex -m openai/gpt-5.6-sol   # different model, just this once
anyagent model                         # change the model for everything
anyagent key openrouter                # save a key
anyagent ls                            # what you have
```

Flags anyagent does not recognise go straight to the agent:
`anyagent claude --resume`, `anyagent codex -- exec "fix the build"`.

Already have `OPENROUTER_API_KEY` (or `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, …)
exported? Then there is nothing to set up — anyagent uses it.

## Instead of doing this by hand

Every guide for pointing an agent somewhere else reads like this. It is
OpenRouter's, for Claude Code:

```bash
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
export ANTHROPIC_API_KEY=""              # must be empty, or Claude Code
                                         # authenticates against Anthropic instead
export ANTHROPIC_DEFAULT_OPUS_MODEL="..."
export ANTHROPIC_DEFAULT_SONNET_MODEL="..."
export ANTHROPIC_DEFAULT_HAIKU_MODEL="..."
export CLAUDE_CODE_SUBAGENT_MODEL="..."
```

Then the same problem again, solved differently, for every other agent: Codex
needs a TOML profile with `wire_api = "responses"`, OpenCode wants JSON, Droid
wants an entry in `~/.factory/settings.json`, DeepSeek Harness wants a YAML
patch.

```bash
anyagent claude    # this
```

Two things anyagent does that the manual route does not:

- **Nothing is exported into your shell.** The variables exist for the launched
  process only, so a plain `claude` still uses your Anthropic account, and two
  terminals can run two models at once.
- **The real context window is passed through.** Claude Code assumes 200K for a
  model it does not recognise, so a 1M-token model compacts far too early and a
  small one too late. anyagent reads the actual limit from the catalog and sets
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS`.

### Common pairings

|                               |                                                    |
| ----------------------------- | -------------------------------------------------- |
| Claude Code on DeepSeek       | `anyagent claude -m deepseek/deepseek-v4-pro`      |
| Claude Code on Kimi           | `anyagent claude -m moonshotai/kimi-k3`            |
| Claude Code on GLM / Z.ai     | `anyagent claude --provider zai`                   |
| Claude Code on a local Ollama | `anyagent claude --provider ollama -m qwen3-coder` |
| Codex on GPT-5.6              | `anyagent codex -m openai/gpt-5.6-sol`             |
| Codex on Groq                 | `anyagent codex --provider groq`                   |
| OpenCode on anything          | `anyagent opencode -m <model>`                     |

Claude Code needs an Anthropic-compatible endpoint and Codex needs OpenAI's
Responses API, so not every pairing exists. `anyagent compat` says which do,
before you start rather than three turns in.

## What it works with

**Agents:** `claude` · `codex` · `opencode` · `copilot` · `droid` · `dsh` ·
`pi` · `openclaw` · `hermes` · `cline` · `qwen` · `pool`

**Providers:** 183 with 7,000+ models, from the [models.dev](https://models.dev)
catalog — OpenRouter, DeepSeek, Z.ai, Moonshot, Groq, Cerebras, Together, xAI,
OpenAI, Anthropic and the rest. Local **Ollama**, **LM Studio**, **llama.cpp**
and **vLLM** need no key at all.

Anything else works with an explicit endpoint:

```bash
anyagent opencode --base-url http://localhost:8080/v1 -m my-model
anyagent exec -- aider --model deepseek/deepseek-v4-pro  # tools with no integration
```

## Your files stay yours

- Seven of the twelve agents are never written to — the settings live in the
  launched process, so `anyagent claude` and a plain `claude` can run at the
  same time on different models.
- When a file must change, the original is backed up and `anyagent restore`
  puts it back.
- Keys sit in `~/.anyagent/credentials.json` (mode `0600`), or your OS keychain.
  They are never printed in full and never appear on a command line.

## More

|                                                                |                                  |
| -------------------------------------------------------------- | -------------------------------- |
| `anyagent help --all`                                          | every command                    |
| [Agents](docs/agents.md) · [Providers](docs/providers.md)      | the full lists                   |
| [Troubleshooting](docs/troubleshooting.md)                     | when something is off            |
| [Architecture](docs/architecture.md) · [Security](SECURITY.md) | how it works, where keys go      |
| [Contributing](CONTRIBUTING.md)                                | a new agent is about forty lines |

MIT licensed.
