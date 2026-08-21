# Architecture

anyagent is a launcher. It answers three questions and then gets out of the way:

1. **Where** should this agent send requests, and over which protocol?
2. **How** does this particular agent want to be told that?
3. **What** on disk has to change, and how do we put it back?

## Plan and apply

The central decision is that launching is two phases:

```
plan(ctx)  →  LaunchPlan     pure: no I/O, no clock, no spawning
apply(plan)                  effectful: back up, write, spawn
```

`PlanContext` carries everything a plan could need, including the current time
and the contents of any files the integration wants to merge into. Nothing is
read from the environment behind the caller's back.

The payoff is directly proportional to the risk involved. The dangerous half of
this tool is the half that edits someone's configuration, and that half is now a
single function in `runner.ts` that loops over a list of `{ path, contents }`.
Everything else — twelve vendors' worth of quirks — is pure data transformation
covered by tests that run in milliseconds.

```ts
// The whole contract, from src/types.ts
interface Agent {
  wires: Wire[]; // protocols this agent can consume
  reads?(ctx): string[]; // files to load before planning
  plan(ctx: PlanContext): LaunchPlan; // pure
  ownedFiles?(ctx): string[];
}
```

## Protocol negotiation

`Wire` is the type that keeps the whole thing honest:

```ts
type Wire = 'anthropic' | 'openai-chat' | 'openai-responses';
```

An agent declares the protocols it can speak, in preference order. A provider
declares a base URL per protocol it serves. `negotiateWire` picks the first
overlap; no overlap means the pair is refused with an explanation.

This is not pedantry. Claude Code speaks only the Anthropic Messages API, so
"point Claude Code at Groq" cannot work no matter how the base URL is spelled.
Codex requires the OpenAI Responses API — `wire_api = "chat"` was removed in the
0.14x line and now fails at config load. Modelling this explicitly turns a
confusing mid-session failure into a one-line error before anything starts.

## The catalog

Provider and model data comes from [models.dev](https://models.dev), the same
open catalog OpenCode uses: 183 providers, 7,000+ models, with context windows,
output limits, capabilities and pricing.

Three sources, in priority order:

| Source                           | When                                          |
| -------------------------------- | --------------------------------------------- |
| `~/.anyagent/cache/catalog.json` | fresh (under 24 hours)                        |
| `https://models.dev/api.json`    | cache stale, and the command needs fresh data |
| bundled snapshot                 | offline, or a brand-new install               |

Launching an agent never blocks on the network. The bundled snapshot is a trimmed,
gzipped copy of the upstream catalog — about 150 KB for 7,000 models — so a fresh
`npm install -g anyagent` on a plane still works.

### The overlay

models.dev describes providers through the lens of the Vercel AI SDK, which
cannot express two things anyagent needs:

- **Anthropic-compatible endpoints.** A provider's `api` field is its OpenAI
  endpoint. The separate Anthropic route (`/anthropic`, `/api/anthropic`, …) is
  the only way to run Claude Code, and nothing in the upstream schema records it.
- **Base URLs that the SDK hard-codes.** Twenty-six providers have no `api` field
  at all because `@ai-sdk/groq` and friends know the URL internally.

`src/data/overlay.ts` supplies both, plus headers, key prefixes and console URLs.
Every endpoint claim records how it was established (`probe` or `docs`) — see
[CONTRIBUTING.md](../CONTRIBUTING.md#verifying-an-endpoint-claim).

The mapping from SDK package name to protocol is what gives 150+ providers correct
routing with no hand-written entry each.

## Integration strategies

Ranked by how much of the user's machine they touch. Every agent uses the least
invasive option it supports.

| Strategy                      | Agents                        | Files touched         |
| ----------------------------- | ----------------------------- | --------------------- |
| Environment only              | claude, copilot, qwen, pool   | none                  |
| Inline config in a variable   | opencode                      | none                  |
| Config layer passed as a flag | codex (`-c`), dsh (`--patch`) | none of the user's    |
| Isolated profile directory    | hermes                        | none of the user's    |
| Merge the user's config       | droid, pi, openclaw, cline    | one or two, backed up |

Seven of twelve write nothing at all, which is why `anyagent claude` and a plain
`claude` can run side by side in two terminals against different models.

### Merging

When merging is unavoidable:

- entries under the `anyagent` key are replaced; everything else is preserved
- the original is copied to `~/.anyagent/backups/<agent>/` and recorded in a
  manifest
- `anyagent restore <agent>` replays the **oldest** manifest entry per file, so a
  file touched by five launches returns to its state before the first one
- writes are atomic: temp file in the same directory, then rename

## Cross-platform execution

`src/exec.ts` is small and deliberate, because this is where launchers usually
break.

- **Windows `.cmd` shims.** A global npm install produces `foo.cmd`, and Node has
  refused to spawn `.cmd` directly since CVE-2024-27980. Those go through
  `cmd.exe /d /s /c` with `windowsVerbatimArguments` and hand-rolled quoting that
  caret-escapes cmd metacharacters — without it, a prompt containing `&` silently
  truncates. Everything else spawns directly, with no shell.
- **`PATHEXT`.** Searched in order, lowercase first, so reported paths match what
  is actually on disk.
- **Directory indexing.** A naive `which` stats every
  directory × extension × agent combination — thousands of syscalls to list a
  dozen agents. Each directory is listed once instead, which is the difference
  between `anyagent ls` taking 200 ms and taking a second.
- **Installer directories.** `~/.local/bin`, `~/.bun/bin`, `~/.opencode/bin`,
  `%APPDATA%\npm` are searched after `PATH`, because installers routinely land
  there before a shell restart.
- **stdio is inherited** and SIGINT is forwarded rather than handled: agents are
  full-screen TUIs and must own the terminal, and Ctrl-C means whatever the agent
  says it means.

## Startup cost

The one command people type all day is `anyagent <agent>`, so it stays under
200 ms:

- the catalog is read from a memoised gzip, never from the network on a launch
- agent versions are only probed for agents whose config depends on them (Codex),
  and the answer is cached against the binary's mtime — `claude --version` alone
  costs seconds
- directory listings are cached for the lifetime of the process

## Configuration

Layered, lowest to highest:

```
built-in defaults
~/.anyagent/config.json
.anyagent.json          (nearest, walking up from cwd)
ANYAGENT_* environment variables
command-line flags
```

Per-agent sections beat global ones at the same level. `resolveDefaults` records
where each value came from, which is what `anyagent doctor` reports.

## Credentials

Resolution order, and only the last one persists:

```
--api-key  →  ANYAGENT_<PROVIDER>_API_KEY  →  provider's own variable  →  store
```

The store is an interface with two implementations: a `0600` JSON file (default)
and an OS-backed keychain (opt-in). See [SECURITY.md](../SECURITY.md).

## The front door

Typing `anyagent` with no arguments opens a menu rather than printing help. The
list is agents, ordered so that whatever will actually work right now is at the
top, followed by a few actions - choose a model, add a key, check the setup.
Selecting an agent runs it and the process becomes that agent.

Without a terminal there is nothing to select, so the same invocation prints
help instead. Every menu entry has a command behind it, and the short help screen
shows five of the thirteen commands: the rest are one `help --all` away. Command
names follow what they do (`model`, `key`) rather than the machinery underneath
(`use`, `auth`), and both spellings work.

The picker itself is about 120 lines over `node:readline` in raw mode, and it is
covered by tests that drive a fake terminal - arrow keys, wrapping, separators,
type-to-filter and cancellation all assert on the value it returns.

## Errors

Every user-facing failure is an `AnyAgentError` with a message and a hint: what
went wrong, then what to do about it. Unknown agents, providers, models and flags
all run through the same edit-distance suggester. Unexpected errors are passed
through a redactor before printing, because HTTP clients love to echo request
headers back.
