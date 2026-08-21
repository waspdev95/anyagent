# Security

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/waspdev95/anyagent/security/advisories/new),
not a public issue.

## Where your keys go

**Stored** in `~/.anyagent/credentials.json`, created with mode `0600` (and the
directory `0700`) on macOS and Linux. On Windows the file inherits your user
profile's ACL, which already excludes other standard users; anyagent does not
rewrite ACLs, because `icacls /inheritance:r` is a known way to lock an owner out
of their own file when an account name does not resolve as expected.

**Or in your OS keychain**, if you prefer:

```bash
anyagent config set credentialStore keychain
```

macOS Keychain, libsecret on Linux, DPAPI on Windows. Secrets are passed to those
tools on stdin, never in an argument vector, so they cannot be read from the
process list.

**Never stored:** keys given with `--api-key` or read from an environment
variable (`ANYAGENT_<PROVIDER>_API_KEY`, or the provider's own). They are used for
that invocation only.

**In transit to an agent:** through the child process environment only. Your
shell is not modified and no key appears on a command line. Where an agent can
reference a key by variable _name_ - Codex's `env_key`, DeepSeek Harness's
`apiKeyEnv` - anyagent uses that, so nothing is written to a config file. Four
agents (`droid`, `pi`, `openclaw`, `cline`) have no such mechanism, so the key is
written into their own config exactly as it would be if you configured them by
hand; `anyagent restore <agent>` removes it again.

**In output:** always masked - in `--dry-run`, in `key`, in banners. Error
messages pass through a redactor that strips key-shaped strings, because HTTP
clients like to echo request headers back. `--print-env` prints real values,
because that is what it is for; do not pipe it into a log.

## Network

Two requests exist in the whole tool:

1. `https://models.dev/api.json`, to refresh the model catalog. No credentials
   are sent, and it can be turned off entirely with
   `anyagent config set autoRefreshCatalog false` or `ANYAGENT_CATALOG_OFFLINE=1`.
   A fresh install works with no network: a snapshot ships in the package.
2. `anyagent key test <provider>`, which makes one authenticated request to the
   provider you name.

No telemetry, no analytics, no crash reporting.

## Installing agents

anyagent offers to install a missing agent with the vendor's own documented
command, only after an explicit yes, and never from a source the vendor does not
publish.

## Supply chain

Zero runtime dependencies. The published package is compiled JavaScript plus one
gzipped data file.
