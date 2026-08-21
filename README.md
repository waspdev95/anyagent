<div align="center">

# anyagent

**Pick a provider, pick a model, run your coding agent.**

[![npm](https://img.shields.io/npm/v/anyagent?color=%230b7285)](https://www.npmjs.com/package/anyagent)
[![CI](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml/badge.svg)](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

Claude Code, Codex, OpenCode and nine others — on OpenRouter, DeepSeek, Groq, a
local Ollama, or anywhere else. Each of them has its own way of pointing
somewhere else. This is one command for all of them.

```bash
npm install -g @anyagent/cli
anyagent
```

```
  anyagent - pick one, and I will ask for a key and a model

❯ claude    Claude Code       ✔ deepseek/deepseek-chat
  codex     Codex             ✔ deepseek/deepseek-chat
  opencode  OpenCode          ✔ deepseek/deepseek-chat
  droid     Droid               not installed

  model     Choose the AI model    openrouter / deepseek-chat
  key       Add an API key         1 saved
  check     Check my setup
  quit      Exit
```

Pick one and it runs. It asks for a key the first time, then never again.

That is the whole thing. Everything below is optional.

## Typing instead

```bash
anyagent claude                  # run it
anyagent codex -m openai/gpt-5   # different model, just this once
anyagent model                   # change the model for everything
anyagent key openrouter          # save a key
anyagent ls                      # what you have
```

Flags anyagent does not recognise go straight to the agent:
`anyagent claude --resume`, `anyagent codex -- exec "fix the build"`.

Already have `OPENROUTER_API_KEY` (or `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, …)
exported? Then there is nothing to set up — anyagent uses it.

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
anyagent exec -- aider --model deepseek/deepseek-chat   # tools with no integration
```

One catch worth knowing: agents speak different APIs, so not every pair works.
anyagent checks before starting and tells you what to use instead. Run
`anyagent compat` for the grid.

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
