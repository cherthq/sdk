# Standalone and server integration checks

From this repository, `bun install --frozen-lockfile`, `bun run test`, and
`bun run typecheck` need no Chert server checkout, credentials or device. The
unit command selects package unit tests and the core transport tests explicitly;
server fixtures remain preserved under `tests/`. `bun run test:distribution`
checks the built exports in installed Node, Bun and Deno. It requires those
runtimes but does not install or modify them.

## Explicit server integration

The preserved route/database fixtures consume Chert server source that is not
part of this SDK repository. Set an absolute path to the reviewed monorepo:

```sh
CHERT_MONOREPO_ROOT=/absolute/path/to/chert-facetime bun scripts/test-integration.ts --check
CHERT_MONOREPO_ROOT=/absolute/path/to/chert-facetime bun run test:integration
```

The runner rejects an absent, relative, incomplete or source-mismatched checkout
before creating the stage or starting services. `scripts/test-integration-source.json`
records the SHA-256 over sorted relative paths and exact source bytes for the
server app, libraries, native source, migrations, server tests, relevant manifests
and three disposable-service runners. A changed server revision requires an
explicit reviewed lock refresh; it is never accepted automatically. The lock is
an integrity/version compatibility check, not a signature or deployment proof.
Install the monorepo's locked dependencies separately first.

A private temporary layout copies this SDK and links the selected external
source/dependency directories. The original fixtures are unchanged. The three
shell runners are copied so their relative root resolves inside the stage.
The stage is removed on normal completion/failure. No caller-supplied CLI live
flags, credentials, remote database URLs or `.env` files are forwarded. The
integration command exercises local fixture boundaries; it does not authorize
live acceptance scripts or contact an Apple/provider account.

Optional disposable PostgreSQL/PostgREST checks require explicit executable
paths in `CHERT_TEST_JOURNAL_PG_BIN` and `CHERT_TEST_JOURNAL_POSTGREST`.
Storage additionally requires `CHERT_TEST_STORAGE_ENTRYPOINT` and
`CHERT_TEST_STORAGE_NODE`. Compiled language helpers use the existing
`CHERT_TEST_CPP_CLIENT`, `CHERT_TEST_RUST_CLIENT`, their `_TYPED_CLIENT` and
`_REACTION_CLIENT` variants. Offline guarded pipeline helpers use the exact
`CHERT_PIPELINE_RUST_CLIENT` and `CHERT_PIPELINE_CPP_CLIENT` tool-path variables;
`CHERT_PIPELINE_CONFIG`, `CHERT_PIPELINE_RECEIPT` and live flags are not forwarded.
`CHERT_TEST_PYTHON`,
`CHERT_TEST_NATIVE_WEBHOOK_CLIENT`, `CHERT_TEST_DEVICE_LIFECYCLE_BUNDLE` and
`CHERT_TEST_URL_MEDIA_PIXEL_MANIFEST` retain their existing explicit fixture
semantics. Missing optional tools produce explicit skips; source/auth/HTTP
fixture failures still fail the command. These files must be supplied by the
operator; this repository does not download binaries or ship private receipts.

Actual-device acceptance is separate, requires a reviewed one-use plan, and is
never a default test. See [device evidence limits](docs/DEVICE_ACCEPTANCE.md).
