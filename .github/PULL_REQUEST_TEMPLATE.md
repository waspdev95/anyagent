## What and why

<!-- One or two sentences. Link an issue if there is one. -->

## How it was verified

<!--
Concrete beats thorough. For an integration, the command you actually ran and
what came back:

    anyagent codex -m openai/gpt-5.6-sol -- exec "say hi"   # replied

Note the agent and provider versions you tested against.
-->

## Checklist

- [ ] `npm run verify` passes
- [ ] Tests cover the change
- [ ] For a new agent: `plan()` does no I/O, and `ctx.passthrough` is forwarded
- [ ] For a provider endpoint: evidence is in the description and
      `anthropicSource` / `responsesSource` is set
- [ ] No new runtime dependencies
