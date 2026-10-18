# Source conventions

The JS SDK and provider adapters have one implementation: TypeScript. New
implementation modules and unit tests use `.ts`; builds emit ESM `.js` and `.d.ts`
files under ignored `dist/` directories. Consumers can use either JavaScript or
TypeScript without running a TypeScript compiler in production.

The retained `.mjs` files are process entry points for backend/device fixtures,
PostgreSQL and Storage harnesses, and runtime distribution checks. They run directly
under Node or Bun. Some participate in frozen source manifests and private-device
plans; renaming them mechanically would invalidate those checks. They are not
parallel JavaScript implementations of the adapters.

`tests/distribution-smoke.mjs` intentionally stays plain JavaScript: it verifies
that built exports actually load and execute under Node, Bun and Deno without a
TypeScript loader. `bun run typecheck` checks production TypeScript and portable
unit tests; `bun run test:integration` executes the separate backend fixtures
against an explicitly matched platform checkout. Neither command silently turns
live-device testing on.

Use TypeScript for new SDK logic and ordinary tests. Keep plain JavaScript where
the test's purpose is direct JavaScript runtime or process compatibility. Do not
commit generated distributions or add a handwritten JavaScript copy of TS logic.
