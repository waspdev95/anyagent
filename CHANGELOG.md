# Changelog

Notable changes, newest first. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-08-21

### Fixed

- An empty credential rendered as `****` in `--dry-run` and `key`, which made
  the deliberately blanked `ANTHROPIC_API_KEY` look like a key that was set.
  Empty values now read `(empty)`.

## [0.1.2] - 2026-08-21

### Fixed

- Claude Code was given both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.
  They are not interchangeable: the first is sent as `x-api-key` and treated as
  a direct-Anthropic credential, which made Claude Code report conflicting auth.
  A gateway now gets the bearer token and an explicitly empty api key, as
  OpenRouter's own guide instructs; `api.anthropic.com` still gets `x-api-key`.

### Added

- README shows the manual setup anyagent replaces, and a table of common
  agent/provider pairings.

## [0.1.1] - 2026-08-21

- Published as `@waspdev95/anyagent`, matching the GitHub path. The command is
  still `anyagent`.
- Documentation examples name current models (`deepseek/deepseek-v4-pro`,
  `openai/gpt-5.6-sol`, `moonshotai/kimi-k3`) instead of superseded ones.
- Bundled catalog snapshot refreshed: 7,230 models.

## [0.1.0] - 2026-08-21

First release.

- Run twelve coding agents - Claude Code, Codex, OpenCode, Copilot CLI, Droid,
  DeepSeek Harness, Pi, OpenClaw, Hermes, Cline, Qwen Code, Pool - against any
  compatible provider.
- 183 providers and 7,000+ models from [models.dev](https://models.dev), with a
  bundled snapshot so a fresh install works offline.
- A menu on `anyagent`, and a command for everything the menu does.
- Incompatible agent/provider pairs are refused up front, with alternatives.
- Keys stored at mode `0600` or in the OS keychain; never printed in full.
- Backups and `anyagent restore` for every file anyagent writes.
- Windows support that accounts for `.cmd` shims, `PATHEXT`, `cmd.exe` quoting
  and UTF-8 BOMs in existing config files.
