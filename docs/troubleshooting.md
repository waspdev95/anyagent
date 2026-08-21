# Troubleshooting

Start here:

```bash
anyagent          # the menu has a "check my setup" entry
anyagent doctor   # or run it directly
```

One screen: where your config and keys live, which agents are installed and at
what version, how old the catalog is, and whether anyagent currently has any
uncommitted changes to an agent's config.

---

## "X cannot use Y"

Not a bug. An agent can only use a provider that speaks its protocol.

```bash
anyagent compat                      # the full matrix
anyagent providers --agent claude    # providers this agent can actually use
```

- **Claude Code** speaks only the Anthropic Messages API. Groq, Cerebras, Mistral
  and most inference hosts serve OpenAI Chat Completions and nothing else. Use a
  provider that serves both — OpenRouter is the usual answer — or a local Ollama.
- **Codex** and **Copilot CLI** need the OpenAI _Responses_ API. Codex removed
  `wire_api = "chat"` in the 0.14x line; a chat-only provider genuinely cannot
  drive it any more.

If you know a provider added an endpoint we do not list yet, open a PR — see
[CONTRIBUTING](../CONTRIBUTING.md#verifying-an-endpoint-claim).

## The agent starts but every request fails

Check the key and the endpoint separately:

```bash
anyagent auth test openrouter     # one cheap authenticated request
anyagent claude --dry-run         # the exact endpoint, model and variables
```

Common causes:

- **Key from somewhere you forgot.** `anyagent auth list` shows the _source_ of
  each key. An `OPENROUTER_API_KEY` exported in your shell profile beats the one
  you saved with `anyagent key`.
- **Model not available on your account.** Many providers gate large models.
  `anyagent auth test` succeeding while the agent fails usually means this.
- **Corporate proxy or TLS interception.** anyagent uses Node's `fetch`; set
  `NODE_EXTRA_CA_CERTS` to your CA bundle.

## Claude Code says the model is not recognised

```
[claude-code:unrecognized_model] {"model":"deepseek/deepseek-v4-pro", ...}
```

Harmless. Claude Code keeps an internal list of Anthropic model ids and logs this
when it sees anything else, for a background task like naming your session. The
actual conversation runs on the model you chose.

## Claude Code warns that connectors are disabled

```
claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth
source is set and takes precedence over your claude.ai login
```

Expected: pointing Claude Code at a third-party endpoint means it is not using
your claude.ai account, so account-scoped features are unavailable. Your normal
`claude` command is unaffected — anyagent sets those variables for the launched
process only.

## Codex: "unknown configuration field"

Codex validates its configuration strictly and its schema moves between releases.
anyagent adapts to the version it finds, but if you see this after a Codex
upgrade, please open an issue with:

```bash
codex --version
anyagent codex --dry-run
```

## The agent is installed but anyagent cannot find it

```bash
anyagent doctor    # shows the resolved path for each agent it did find
```

anyagent searches `PATH` first, then the directories installers commonly use:
`~/.local/bin`, `~/.bun/bin`, `~/.opencode/bin`, `~/.claude/local`,
`%APPDATA%\npm`. If your agent lives somewhere else, add that directory to `PATH`.

On Windows, a freshly installed global npm package is not visible to an already
open terminal. Open a new one.

## Windows

**A prompt containing `&`, `|` or `>` gets truncated.** This was the classic
`.cmd` shim bug and anyagent quotes for `cmd.exe` explicitly. If you still see it,
please report the exact command — that is a real bug.

**`config.json is not valid JSON`.** PowerShell's `Set-Content` and `Out-File`
write a UTF-8 BOM by default, which breaks most JSON parsers. anyagent strips BOMs
from every file it reads; if another tool wrote the file, rewrite it with
`-Encoding utf8NoBOM`.

**Credentials file permissions.** POSIX modes do nothing on Windows, so
`credentials.json` inherits your user profile's ACL — which already excludes other
standard users. anyagent does not rewrite ACLs on purpose; see
[SECURITY.md](../SECURITY.md). For stronger protection use the DPAPI store:

```bash
anyagent config set credentialStore keychain
```

## Nothing works offline

It should. A catalog snapshot ships inside the package, and launching never
requires the network. To make that explicit:

```bash
anyagent config set autoRefreshCatalog false
# or, per invocation
ANYAGENT_CATALOG_OFFLINE=1 anyagent claude
```

`anyagent doctor` reports where the catalog came from: `cache`, `network` or
`bundled`.

## I want my agent's config back

```bash
anyagent restore --all      # or: anyagent restore droid
```

Restores the state from before anyagent's _first_ launch, from
`~/.anyagent/backups/`. Seven of the twelve agents are never written to at all, so
there is usually nothing to restore.

## Non-interactive use (CI, scripts)

anyagent never prompts without a TTY; it fails with an explanation instead. Supply
everything up front:

```bash
export OPENROUTER_API_KEY=...      # or ANYAGENT_OPENROUTER_API_KEY
anyagent claude --provider openrouter -m deepseek/deepseek-v4-pro -- -p "review this diff"
```

`--json` is available on `ls`, `providers`, `models`, `compat`, `doctor`, `key`,
`env` and `--dry-run`.

## A flag went to the wrong program

anyagent's own flags come **before** the agent name; everything after it belongs
to the agent. This is the same rule git, docker and kubectl use.

```bash
anyagent --json claude --dry-run   # anyagent prints JSON
anyagent claude --help             # Claude Code's help, not anyagent's
anyagent codex exec --json         # codex's --json, untouched
```

`-m/--model`, `--provider`, `--small`, `--base-url`, `--api-key`, `--save`,
`--dry-run` and `--print-env` are anyagent's even after the name, because they
decide what to launch. Everything else is forwarded. If one of those ever
collides with a flag an agent needs, `--` ends the argument list for good:

```bash
anyagent claude -- --model something-anyagent-should-not-resolve
```

## Something else

Open an issue with the output of:

```bash
anyagent doctor
anyagent <the command that failed> --dry-run
```

Both mask credentials.
