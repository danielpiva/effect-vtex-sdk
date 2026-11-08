# Working on effect-vtex-sdk

- Use Effect 4 and its built-in HTTP modules. Keep the runtime dependency set small.
- Edit the generator or reviewed overrides, then regenerate. Do not hand-edit `src/generated` or `docs/endpoints.md`.
- Preserve upstream snapshots and their pinned commit/blob hashes. Generation must remain deterministic and offline.
- Run `npm run check` for changes affecting the SDK, generator, or protocol definitions.
- Keep fixtures synthetic or taken from public API documentation. Never commit browser cookies, customer records, cards, tokens, or personal shopping state.
- Normal tests use local HTTP fixtures. `npm run smoke` performs only public searches and a sample postal-code lookup. Live cart/payment tests require an explicitly selected test environment and scope.
- Preserve write serialization, cancellation and no automatic write retries. Keep detailed diagnostics redacted.
