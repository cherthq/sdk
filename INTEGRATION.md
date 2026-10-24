# Local SDK checks

From the repository root:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run test:integration
bun run test:package
bun run test:distribution
```

`test` builds the SDK and runs package and transport tests. `test:integration`
is a compatibility command for the same public SDK contract suite, with a clean
child environment. It accepts no arguments and requires no service credentials,
external source checkout, database or device.

Tests use injected fetch implementations or local loopback servers with
synthetic responses. They check request construction, response validation,
credential isolation, cancellation, uncertainty handling and adapter mappings.
They do not send real messages or calls.

`test:package` checks a packed npm consumer. `test:distribution` checks built ESM
exports under Node, Bun and Deno; install those runtimes separately. These checks
do not publish packages or establish production service availability.
