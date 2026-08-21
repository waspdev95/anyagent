<div align="center">

# anyagent

**Any coding agent. Any model. One command.**

Run Claude Code, Codex, OpenCode, Droid, Pi and more against OpenRouter, DeepSeek,
Groq, a local Ollama — or any OpenAI- or Anthropic-compatible endpoint.

[![npm](https://img.shields.io/npm/v/anyagent?color=%230b7285)](https://www.npmjs.com/package/anyagent)
[![CI](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml/badge.svg)](https://github.com/waspdev95/anyagent/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520.10-brightgreen)](https://nodejs.org)

</div>

```console
$ npm install -g anyagent

$ anyagent auth add openrouter          # once
$ anyagent use openrouter/deepseek/deepseek-chat

$ anyagent claude                       # Claude Code, running on DeepSeek
$ anyagent codex                        # same key, same model, different agent
$ anyagent opencode -m moonshotai/kimi-k2
```

---

## Why

You picked your agent because you like how it works — its diffs, its planning, its
keybindings. You want to pick your model separately, because that changes every
few weeks.

Today those two choices are welded together. Each agent invents its own way to
point somewhere else: an environment variable here, a TOML profile there, a JSON
file with a schema you have to reverse-engineer, and at least one that silently
requires a protocol the provider does not serve. So people keep a folder of shell
aliases, or give up and use whatever the vendor shipped.

anyagent is that folder of aliases, done properly: one command, one place for your
keys, and a compatibility model that tells you _before_ you start whether the pair
you asked for can actually talk.

## Install

```bash
npm install -g anyagent          # or: pnpm add -g anyagent / bun add -g anyagent
```

No install, one-off run:

```bash
npx anyagent claude
```

Requires Node.js 20.10 or newer. Works on macOS, Linux and Windows — including
`cmd.exe` and PowerShell. **Zero runtime dependencies.**

## Quick start

```bash
anyagent auth add openrouter                   # paste a key, stored once
anyagent use openrouter/deepseek/deepseek-chat # your default
anyagent claude                                # go
```

Or skip the setup entirely — anyagent asks for whatever it still needs:

```bash
anyagent claude
#   Which provider should Claude Code use?  ❯ openrouter …
#   Paste your API key: ********
#   Which OpenRouter model?  ❯ deepseek/deepseek-chat  163K  in $0.28/M …
```

Already have `OPENROUTER_API_KEY` (or `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, …) in
your environment? Then there is nothing to set up at all — anyagent reads it.

## Supported agents

| Agent                                                               | Command             | Protocol it speaks | How anyagent configures it            |
| ------------------------------------------------------------------- | ------------------- | ------------------ | ------------------------------------- |
| [Claude Code](https://code.claude.com/docs)                         | `anyagent claude`   | Anthropic Messages | environment only                      |
| [Codex](https://developers.openai.com/codex/cli/)                   | `anyagent codex`    | OpenAI Responses   | `-c` overrides, config file untouched |
| [OpenCode](https://opencode.ai)                                     | `anyagent opencode` | OpenAI Chat        | inline config in one variable         |
| [Copilot CLI](https://github.com/features/copilot/cli)              | `anyagent copilot`  | OpenAI Responses   | environment only                      |
| [Droid](https://docs.factory.ai/cli)                                | `anyagent droid`    | Chat / Anthropic   | merges `~/.factory/settings.json`     |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `anyagent dsh`      | OpenAI Chat        | `--patch` layer                       |
| [Pi](https://github.com/earendil-works/pi)                          | `anyagent pi`       | OpenAI Chat        | merges `~/.pi/agent/*.json`           |
| [OpenClaw](https://docs.openclaw.ai)                                | `anyagent openclaw` | Chat / Anthropic   | merges `~/.openclaw/openclaw.json`    |
| [Hermes](https://hermes-agent.nousresearch.com/docs)                | `anyagent hermes`   | OpenAI Chat        | isolated profile                      |
| [Cline](https://cline.bot)                                          | `anyagent cline`    | OpenAI Chat        | merges `~/.cline/…/providers.json`    |
| [Qwen Code](https://github.com/QwenLM/qwen-code)                    | `anyagent qwen`     | OpenAI Chat        | environment only                      |
| [Pool](https://github.com/poolsideai/pool)                          | `anyagent pool`     | OpenAI Chat        | environment only                      |

Anything else — aider, a script, your own tool — works through the escape hatch:

```bash
anyagent exec -- aider --model deepseek/deepseek-chat
eval "$(anyagent env --provider groq)"
```

Not installed yet? anyagent offers to run the vendor's own documented install
command, and never runs it without asking.

## Supported providers

**183 providers, 7,000+ models**, from the [models.dev](https://models.dev)
catalog that also backs OpenCode — plus a curated layer for the things a generic
catalog cannot know, like which providers serve an Anthropic-compatible endpoint.

```bash
anyagent providers                 # browse
anyagent providers --agent claude  # only the ones this agent can use
anyagent models kimi               # search models
```

Includes OpenRouter, DeepSeek, Z.ai, Moonshot, MiniMax, Groq, Cerebras, Together,
Fireworks, xAI, Mistral, OpenAI, Anthropic, SiliconFlow, Novita, Alibaba, Vercel
AI Gateway, and local runtimes: **Ollama**, **LM Studio**, **llama.cpp**, **vLLM**.

Anything not in the catalog still works:

```bash
anyagent opencode --base-url http://localhost:8080/v1 -m my-model
```

## The part everyone gets wrong

An agent can only use a provider that speaks its protocol. This is not a
preference — it is a hard requirement, and it is why "point Claude Code at Groq"
quietly fails for so many people.

```console
$ anyagent compat

  AGENT     SPEAKS                       OPENROUTER  DEEPSEEK  GROQ  OPENAI  ANTHROPIC  OLLAMA
  claude    Anthropic Messages           ✔           ✔         ✖     ✖       ✔          ✔
  codex     OpenAI Responses             ✔           ✔         ✔     ✔       ✖          ✖
  opencode  OpenAI Chat Completions      ✔           ✔         ✔     ✔       ✖          ✔
  droid     OpenAI Chat, Anthropic       ✔           ✔         ✔     ✔       ✔          ✔
```

- **Claude Code** speaks only the Anthropic Messages API. It works with any
  provider that serves one — OpenRouter, DeepSeek, Z.ai, Moonshot, MiniMax,
  xAI, SiliconFlow, Novita, a local Ollama — and with nothing else.
- **Codex** requires the OpenAI _Responses_ API. `wire_api = "chat"` was removed
  from Codex in the 0.14x line and now fails at config load, so anyagent only
  offers Codex the providers that genuinely serve `/responses`.

Ask for a pair that cannot work and you get an explanation and a list of
providers that can, instead of a stack trace three turns into a session.

Every Anthropic endpoint in the curated layer records how it was established —
`probe` (the route was confirmed to exist) or `docs` (published by the provider).
See [`src/data/overlay.ts`](src/data/overlay.ts).

## Everyday use

```bash
# launch
anyagent claude                          # saved defaults
anyagent codex -m openai/gpt-5           # different model, once
anyagent opencode --provider groq        # different provider, once
anyagent claude --save -m deepseek/deepseek-chat   # and remember it

# anything anyagent does not recognise goes straight to the agent
anyagent claude --resume --add-dir src
anyagent claude -- -p "explain this repo"

# look before you leap
anyagent claude --dry-run                # exact command, env and files
anyagent claude --print-env              # just the variables

# browse
anyagent ls                              # agents, installed or not
anyagent models deepseek --provider openrouter
anyagent compat claude

# keys
anyagent auth add groq
anyagent auth test groq                  # one cheap authenticated request
anyagent auth list                       # always masked

# housekeeping
anyagent doctor                          # one screen: what is set, what is not
anyagent restore droid                   # undo every file anyagent wrote
anyagent update                          # refresh the model catalog
```

### Per-project defaults

Drop a `.anyagent.json` next to your code:

```json
{
  "provider": "openrouter",
  "model": "deepseek/deepseek-chat",
  "agents": {
    "claude": { "model": "anthropic/claude-sonnet-4.6" },
    "codex": { "model": "openai/gpt-5-mini", "args": ["--sandbox", "workspace-write"] }
  }
}
```

Precedence, lowest to highest: built-in defaults → `~/.anyagent/config.json` →
`.anyagent.json` → `ANYAGENT_*` environment variables → command-line flags.
Per-agent sections beat the global ones.

## Your machine, your files

anyagent is a launcher, not an installer that rearranges your home directory.

- **Seven of twelve agents are never written to at all.** They are configured
  through environment variables or an inline config that lives only in the
  launched process. Run `anyagent claude` in one terminal and plain `claude` in
  another, against different models, at the same time.
- **When a file must be written**, the original is copied to
  `~/.anyagent/backups/` first, and `anyagent restore <agent>` puts it back
  exactly — reverting to the state before anyagent's _first_ launch, not its last.
- **Merges are surgical.** Entries under the `anyagent` key are replaced; every
  other provider and hand-written model you configured is carried across
  untouched.
- **Writes are atomic** — temp file, then rename. A full disk or a Ctrl-C never
  leaves half a config behind.

`anyagent doctor` always tells you whether anything is currently modified.

## Keys

| Where a key can come from                              | Persisted? |
| ------------------------------------------------------ | ---------- |
| `--api-key` on the command line                        | no         |
| `ANYAGENT_<PROVIDER>_API_KEY`                          | no         |
| the provider's own variable, e.g. `OPENROUTER_API_KEY` | no         |
| the credential store                                   | yes        |

The default store is `~/.anyagent/credentials.json`, created with mode `0600` on
macOS and Linux. An opt-in OS-backed store is available:

```bash
anyagent config set credentialStore keychain   # Keychain / libsecret / DPAPI
```

Keys are never printed in full — not by `--dry-run`, not by `auth list`, not in a
stack trace. Errors are passed through a redactor before they reach your terminal.
Agents receive credentials through their own environment, never through a command
line that would show up in `ps`.

See [SECURITY.md](SECURITY.md).

## How it works

Launching is two phases, and the split is the whole design:

```
plan()   pure    →  which command, which variables, which files
apply()  effect  →  back up, write, spawn
```

`plan()` performs no I/O, so every integration is covered by fast tests that never
touch a real home directory or start a process. `apply()` is small, linear and
reversible. Adding an agent means writing one `plan()` and one test.

Read [docs/architecture.md](docs/architecture.md), then
[CONTRIBUTING.md](CONTRIBUTING.md) — a new agent is about forty lines.

## Compared with

- **`ollama launch`** — the direct inspiration, and excellent, but it points
  agents at _your local Ollama_. anyagent points them at any of 183 providers,
  local Ollama included.
- **Per-agent router proxies** — a proxy that translates protocols is powerful and
  adds a process, a port and a failure mode to every session. anyagent uses each
  provider's _native_ endpoint and is honest about what does not pair.
- **Shell aliases** — what most people have now. This is that, with a model
  catalog, key storage, backups and a compatibility check.

## Documentation

- [Agents](docs/agents.md) — every agent, its protocol, and the compatibility matrix
- [Providers](docs/providers.md) — all 183, with the Anthropic and Responses endpoint tables
- [Architecture](docs/architecture.md) — how plan/apply works, and why
- [Troubleshooting](docs/troubleshooting.md) — the errors people actually hit
- [Security](SECURITY.md) — where your keys go, precisely

Both reference tables are generated from the registry (`npm run docs`), so they
cannot drift from the code.

## Contributing

Issues and pull requests are welcome — especially new agents, new provider
endpoints, and corrections when a vendor changes something.

```bash
git clone https://github.com/waspdev95/anyagent
cd anyagent
npm install
npm run verify     # typecheck, lint, format, tests, build
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the layout, how to add an agent, and
how the endpoint claims in the curated layer are verified.

## License

[MIT](LICENSE)
