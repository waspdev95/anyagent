# Changelog

Notable changes, newest first. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-08-21

- Published as `@anyagenthq/cli`; the npm badge pointed at a name that does not
  exist. The command is still `anyagent`.
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
