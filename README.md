<div align="center">

# anyagent

**Run Claude Code, Codex and other coding agents on any AI model.**

[![npm](https://img.shields.io/npm/v/anyagent?color=%230b7285)](https://www.npmjs.com/package/anyagent)
[![CI](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml/badge.svg)](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520.10-brightgreen)](https://nodejs.org)

</div>

You like your coding agent. You want to choose its model separately — a cheaper
one today, a faster one tomorrow. Every agent has its own way of pointing
somewhere else, and none of them agree. This is one command for all of them.

```bash
npm install -g anyagent
anyagent
```

That opens a menu. Pick something, it runs.

```
  anyagent - pick what to run

❯ claude    Claude Code       ✔ deepseek/deepseek-chat
  codex     Codex             ✔ deepseek/deepseek-chat
  opencode  OpenCode          ✔ deepseek/deepseek-chat
  droid     Droid               not installed

  model     Choose the AI model    openrouter / deepseek-chat
  key       Add an API key         1 saved
  check     Check my setup
  quit      Exit
```

Prefer typing? Every menu entry is also a command.

```bash
anyagent claude                  # run it with your saved model
anyagent codex -m openai/gpt-5   # different model, just this once
anyagent model                   # change the model for everything
anyagent key openrouter          # save an API key
```

## Setup

One key, one model, once:

```bash
anyagent key openrouter    # paste it when asked
anyagent model             # pick from a list
anyagent claude            # go
```

Already have `OPENROUTER_API_KEY` (or `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, …) in
your environment? Then there is nothing to set up — anyagent reads it.

Needs Node.js 20.10+. Works on macOS, Linux and Windows, including `cmd.exe` and
PowerShell. **Zero dependencies.**

## What it runs

**12 agents:** `claude` (Claude Code), `codex`, `opencode`, `copilot`, `droid`,
`dsh` (DeepSeek Harness), `pi`, `openclaw`, `hermes`, `cline`, `qwen`, `pool`.

**183 providers, 7,000+ models:** OpenRouter, DeepSeek, Z.ai, Moonshot, MiniMax,
Groq, Cerebras, Together, Fireworks, xAI, OpenAI, Anthropic and the rest of the
[models.dev](https://models.dev) catalog — plus local **Ollama**, **LM Studio**,
**llama.cpp** and **vLLM**, which need no key at all.

Anything else works too:

```bash
anyagent opencode --base-url http://localhost:8080/v1 -m my-model
anyagent exec -- aider --model deepseek/deepseek-chat   # tools with no integration
```

## The one thing to know

Not every agent works with every provider — they use different APIs. anyagent
checks before it starts, and tells you what to use instead:

```console
$ anyagent claude --provider groq

✖ Claude Code cannot use Groq.
  Groq does not offer the kind of API that Claude Code needs.

  Try one of these instead: openrouter, deepseek, zai, moonshotai, xai
    anyagent claude --provider openrouter
```

`anyagent compat` shows the grid. The short version: **Claude Code** needs an
Anthropic-style API (21 providers have one), **Codex** and **Copilot CLI** need
OpenAI's Responses API (13 do), and everything else works nearly everywhere.

## Your files stay yours

Seven of the twelve agents are never written to — they are configured through the
launched process only, so `anyagent claude` and a plain `claude` can run side by
side on different models. When a file does have to change, the original is backed
up first, and `anyagent restore <agent>` puts it back exactly.

Keys live in `~/.anyagent/credentials.json` (mode `0600`), or your OS keychain if
you prefer. They are never printed in full and never appear on a command line.

## Everything else

|                                            |                                            |
| ------------------------------------------ | ------------------------------------------ |
| [Agents](docs/agents.md)                   | every agent and the compatibility grid     |
| [Providers](docs/providers.md)             | all 183, and which APIs they serve         |
| [Troubleshooting](docs/troubleshooting.md) | the errors people actually hit             |
| [Architecture](docs/architecture.md)       | how it works, and why it is built this way |
| [Security](SECURITY.md)                    | exactly where your keys go                 |
| `anyagent help --all`                      | every command                              |

## Contributing

New agents and provider corrections are the most useful contributions — both go
stale the moment a vendor ships a release. A new agent is about forty lines; see
[CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/waspdev95/anyagent
cd anyagent && npm install && npm run verify
```

## License

[MIT](LICENSE)
