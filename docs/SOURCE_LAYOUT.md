# Source conventions

JavaScript SDK and adapter implementations live in `packages/` as TypeScript.
Builds emit ESM JavaScript and declarations into ignored `dist/` directories.
Do not maintain handwritten JavaScript copies of TypeScript implementation files.

Package tests cover public behavior with injected fetch or loopback servers.
`tests/` contains shared transport and standalone-command tests.
`tests/distribution-smoke.mjs` intentionally uses plain JavaScript to check built
exports under Node, Bun and Deno without a TypeScript loader.

See [INTEGRATION.md](../INTEGRATION.md) for local commands. Tests must not require
service credentials, an external source checkout, a database or a physical device.
