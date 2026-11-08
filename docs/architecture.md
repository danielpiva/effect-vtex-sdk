# Architecture

The package has three layers:

1. **Pinned protocol definitions.** `specs/manifest.json` records the upstream commit and Git blob hash of each OpenAPI source. The generator verifies the local snapshots before generating code. `scripts/overrides.mjs` contains visible, reviewed corrections.
2. **Generated operations and schemas.** Each API family has an operation module and a model module under `src/generated`. Explicit TypeScript types and lazy Effect schemas share the same normalized source. Lazy construction avoids materializing every deep schema during import. Extra merchant-defined object fields survive decoding.
3. **Shared runtime.** `VtexClient` owns the HTTP client, cookie jar, serialization semaphore, timeouts, and retry policy. Operations contain method, path, origin, parameter binding, response mode, and effect classification. Parameter values and bodies enter request construction after schema validation.

`LegacySearch.stream` and `IntelligentSearch.stream` add bounded, pull-driven pagination. There is no automatically executed ordering sequence. A caller can compose the primitive operations with `Effect.gen`, `Stream`, `Layer`, and a custom `HttpClient`.

## Session and concurrency boundary

One provided client corresponds to one shopper session. Its cookie jar is host/path/expiry aware. All writes share one semaphore; a timeout or interruption releases the permit. Multiple client instances do not share cookies or a write queue. Applications accessing the same cart must reuse one instance or coordinate externally.

GET is not equated with harmlessness: cart creation and personal-data clearing are classified as writes. Simulation uses POST but is classified as a read. Payment writes use a separately configured origin and never participate in automatic retries.

## Validation boundary

Requests reject unrecognized top-level keys; nested objects permit merchant additions. Responses validate modeled fields and preserve additional fields. Unknown or unspecified upstream shapes remain `unknown` rather than acquiring invented field types. Every generated schema is inspectable on the operation, and the endpoint catalog allows a future MCP/code-mode adapter to select capabilities by effect classification.

## Packaging

The published tarball includes compiled ESM, declarations, source maps, source, README and license. Generation scripts, snapshots, tests and private local state are not needed at runtime. `sideEffects: false` and per-family exports allow consumers to avoid unused API families.

## Validation limits

Upstream example decoding checks schema compatibility; local HTTP tests verify serialization, state and failure behavior. Public live smoke tests establish compatibility only for the observed store routes. They do not prove an authenticated checkout, successful charge, payment settlement, inventory reservation, or delivery to a specific address.
