# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-21

First release.

### Added

- Launch twelve coding agents against any compatible provider: Claude Code,
  Codex, OpenCode, Copilot CLI, Droid, DeepSeek Harness, Pi, OpenClaw, Hermes,
  Cline, Qwen Code and Pool.
- Provider and model catalog built on [models.dev](https://models.dev): 183
  providers and 7,000+ models, with a bundled snapshot so a fresh install works
  offline.
- A curated overlay for what a generic catalog cannot express - Anthropic-
  compatible and OpenAI Responses endpoints, hard-coded base URLs, attribution
  headers - with a recorded verification source for every endpoint claim.
- Protocol negotiation with `anyagent compat`: incompatible agent/provider pairs
  are refused up front, with alternatives, instead of failing mid-session.
- Layered configuration: user config, per-project `.anyagent.json`, `ANYAGENT_*`
  variables and flags, with per-agent overrides.
- Credential storage with a `0600` file store, an opt-in OS keychain store, and
  environment-first resolution so CI needs no configuration.
- Backups and `anyagent restore` for every file anyagent writes.
- `anyagent exec` and `anyagent env` as an escape hatch for tools without a
  first-class integration.
- `anyagent doctor` for a single-screen diagnosis.
- Windows support that accounts for `.cmd` shims, `PATHEXT`, `cmd.exe`
  metacharacter quoting and UTF-8 BOMs in existing config files.
