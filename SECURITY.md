# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/anyagent/anyagent/security/advisories/new)
rather than a public issue. We aim to acknowledge within 72 hours.

## What anyagent does with your credentials

anyagent handles API keys, so it is worth being precise about where they go.

### Storage

The default store is `~/.anyagent/credentials.json`.

- On macOS and Linux it is created with mode `0600` and the directory with `0700`.
- On Windows the file inherits the ACL of your user profile, which already
  excludes other standard users. anyagent deliberately does **not** rewrite the
  ACL: `icacls /inheritance:r` is a well-known way to lock the owner out of their
  own file when an account name does not resolve as expected. `anyagent doctor`
  reports where the file lives so you can inspect it.

An opt-in OS-backed store is available:

```bash
anyagent config set credentialStore keychain
```

- macOS: Keychain, via `security`
- Linux: libsecret, via `secret-tool`
- Windows: DPAPI, bound to your account; the ciphertext is kept in the same file
  and cannot be decrypted by another account or on another machine

Secrets are passed to these tools on **stdin**, never in an argument vector, so
they cannot be read from the process list.

### Keys never persisted

Keys supplied through `--api-key` or through an environment variable
(`ANYAGENT_<PROVIDER>_API_KEY`, or the provider's own variable) are used for that
invocation and never written to disk.

### Where keys travel

- Agents receive credentials through the **environment of the child process
  only**. Your shell is not modified, and no key appears on a command line.
- Where an agent supports referencing a key by variable _name_ — Codex's
  `env_key`, DeepSeek Harness's `apiKeyEnv` — anyagent uses that, so the key is
  not written into any config file.
- Some agents have no such mechanism. For those (`droid`, `pi`, `openclaw`,
  `cline`) the key is written into the agent's own config file, exactly as it
  would be if you configured that agent by hand. `anyagent restore <agent>`
  removes it again. The relevant files are written with mode `0600` on POSIX.

### Output

- Keys are masked wherever they are displayed: `--dry-run`, `auth list`, banners.
- Error messages, including unexpected ones, pass through a redactor that strips
  key-shaped strings before printing.
- `--print-env` prints real values, because that is what it is for. Do not pipe it
  into a log.

## Network

anyagent makes exactly two kinds of request:

1. `https://models.dev/api.json`, to refresh the model catalog. No credentials are
   sent. It can be disabled entirely:

   ```bash
   anyagent config set autoRefreshCatalog false
   # or per invocation:
   ANYAGENT_CATALOG_OFFLINE=1 anyagent claude
   ```

   A fresh install works with no network at all: a catalog snapshot ships in the
   package.

2. `anyagent auth test`, which makes one authenticated request to the provider you
   name. Nothing else contacts a provider — the agent does that itself.

There is no telemetry, no analytics and no crash reporting.

## Installing agents

`anyagent` offers to install a missing agent using the vendor's own documented
command, and only after an explicit confirmation. It never installs anything
unattended, and it never installs from a source the vendor does not publish.

## Supply chain

anyagent has **zero runtime dependencies**. The published package contains
compiled JavaScript and one gzipped data file. Development dependencies are
limited to TypeScript, ESLint and Prettier.
