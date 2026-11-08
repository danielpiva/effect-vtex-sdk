# effect-vtex-sdk

Effect-native TypeScript for VTEX storefront APIs. Generated from a pinned snapshot of VTEX's OpenAPI definitions, with reviewed fixes for differences between the schemas and actual response shapes.

Inspired by [Distilled](https://github.com/alchemy-run/distilled). This is an independent package with Effect 4 as its only runtime dependency.

## API surface

| Module | Operations | Coverage |
| --- | ---: | --- |
| `LegacySearch` | 15 | Full-text search, filters, offers, facets, autocomplete, all seven cross-selling endpoints |
| `IntelligentSearch` | 9 | v1 search, single-product lookup, facets, suggestions, banners, spelling correction, pickup availability |
| `IntelligentSearchLegacy` | 8 | Older IO routes and the separate v0 pickup-availability route |
| `Checkout` | 41 | Simulation, carts, items, attachments, coupons, shipping, regions, installments, order placement and processing |
| `Payments` | 1 | Public transaction payment submission |

See the complete [endpoint table](docs/endpoints.md). Some public routes still require shopper authentication or merchant permissions for specific operations. The private gateway management APIs are outside this package's storefront scope.

## Install

The package is prepared for publication; an npm release has not been made.

```sh
git clone https://github.com/danielpiva/effect-vtex-sdk.git
cd effect-vtex-sdk
npm ci
npm run check
npm pack
# In a consuming project, install the resulting tarball and effect@^4.1.2.
```

ESM. Node 22+, Bun, and runtimes with Fetch. Browser use remains subject to the store's CORS and cookie policies. Server runtimes provide the most predictable session behavior.

## Shopping CLI and MCP

Version 0.2 adds `vtex-shop`, built with Effect CLI and Effect MCP. After installing the tarball, or running `npm link` from a built checkout:

```sh
vtex-shop init 'https://www.supermuffato.com.br/?sc=34'
vtex-shop search 'lasanha' --sort price --limit 8
vtex-shop search 'refeição' --microwave-only --max-price 20
vtex-shop product PRODUCT_ID
vtex-shop basket add SKU_ID --quantity 2
vtex-shop basket show
vtex-shop basket quote
vtex-shop basket sync
vtex-shop cart show
```

The basket is a private local draft. Only `basket sync` changes a remote cart. It creates a separate cart owned by the profile and reconciles quantities on subsequent runs. Unmanaged remote lines are preserved. A successful sync means managed quantities match the draft, not that payment or delivery is complete.

Use `--json` for structured output, `--profile NAME` for another session, and `--state-dir PATH` to isolate state. Default state is `~/.local/state/vtex-shop/default/state.json`, stored with mode 0600 in a directory with mode 0700. This includes session cookies after a sync; keep it private.

```sh
vtex-shop tools --json
vtex-shop call shop_search '{"query":"arroz","limit":5,"sort":"price"}' --json
printf '%s\n' '{"tool":"shop_status","arguments":{}}' | vtex-shop batch
vtex-shop mcp
```

`batch` executes NDJSON tool calls sequentially. For programmatic code-mode use, import `Shopping` and `ShoppingTools` and compose their Effects; both use the same service and schemas as the CLI. No JavaScript evaluation tool is exposed by the MCP server.

The MCP server advertises eight tools for search, product inspection, status, local basket changes, quoting and explicit synchronization. Its stdout contains protocol traffic only. It has no order-placement or payment tool.

See the [CLI design](docs/cli-design.md) and [integration guide](docs/shopping.md).

## Search

```ts
import { Effect } from "effect";
import { LegacySearch, Vtex } from "effect-vtex-sdk";

const products = await Effect.runPromise(
  LegacySearch.search({
    ft: "arroz",
    fq: ["P:[5 TO 30]", "isAvailablePerSalesChannel_1:1"],
    sc: "1",
    O: "OrderByPriceASC",
    _from: 0,
    _to: 19,
  }).pipe(
    Effect.provide(Vtex.layerFetch({
      baseUrl: "https://www.supermuffato.com.br",
    })),
  ),
);
```

Use individual entry points, such as `effect-vtex-sdk/LegacySearch`, to import just one API family.

```ts
import { Effect, Stream } from "effect";
import { IntelligentSearch, Vtex } from "effect-vtex-sdk";

const products = await Effect.runPromise(
  IntelligentSearch.stream(
    { facets: "trade-policy/1", query: "arroz", sc: "1" },
    { pageSize: 24, maxPages: 3 },
  ).pipe(
    Stream.take(30),
    Stream.runCollect,
    Effect.provide(Vtex.layerFetch({ baseUrl: "https://www.supermuffato.com.br" })),
  ),
);
```

Streams fetch pages on demand. Legacy search is capped at the first 2,500 results and 50 results per request. Intelligent Search pagination is bounded by `maxPages` and honors the response's `pagination.perPage` when a store overrides the requested page size. Pass the appropriate sales channel and regional context for the store: catalog prices and availability do not establish deliverability to a shopper's address.

## A session spans the whole program

Provide the client layer once around the entire shopping program. Each newly built client has its own in-memory cookie jar and write queue.

```ts
import { Effect } from "effect";
import { Checkout, Vtex } from "effect-vtex-sdk";

const program = Effect.gen(function*() {
  const cart = yield* Checkout.getOrCreateCart({});
  return yield* Checkout.addItems({
    orderFormId: cart.orderFormId,
    body: { orderItems: [{ id: "A_REAL_SKU_ID", seller: "1", quantity: 1 }] },
  });
});

// Running this example creates/updates a real cart on the configured store.
const result = await Effect.runPromise(
  program.pipe(Effect.provide(Vtex.layerFetch({ baseUrl: "https://your-store.example" }))),
);
```

All cart, order and payment writes are serialized per client, including cart creation and clearing personal data even though those routes use GET. Pure simulation and read operations can run concurrently. Share one client when multiple fibers access the same shopper session.

To seed an authenticated shopper session, pass `cookie: Redacted.make(cookieHeader)`. Cookies honor host, path, expiry, and secure attributes. Session export is explicit through `(yield* VtexClient).sessionCookies`, which returns a `Redacted` value. No cookies are written to disk.

## Public payments

`Payments.sendPayments` implements the documented `POST /api/payments/transactions/{transactionId}/payments` endpoint. Configure `account` to derive the payment gateway origin, or provide an explicit `paymentsBaseUrl`. It does not reuse the storefront origin for payment submission.

```ts
const layer = Vtex.layerFetch({
  baseUrl: "https://your-store.example",
  account: "your-vtex-account",
});
```

The sequence is: prepare and validate the cart, select payment data, place the order, submit payment data, then process the order. The SDK exposes these steps individually. Gateway/PSP redirects, 3DS, Pix authorization, saved-card authentication, and store-specific antifraud behavior still belong to the caller's checkout integration. An HTTP success alone does not establish payment settlement.

Search `commertialOffer.Price` uses a decimal currency amount; checkout `value` and payment amounts use integer minor units (centavos for BRL). The SDK preserves these wire formats. Prices for weighted items also involve `measurementUnit` and `unitMultiplier`.

## Effect services, errors and retries

- `Vtex.layerFetch(options)` provides the standard Fetch transport.
- `Vtex.layerWithConfig(options)` requires your own Effect `HttpClient` for testing or another transport.
- `Vtex.layer` requires both `VtexConfig` and `HttpClient`.
- Every operation exposes `.input`, `.output`, and `.definition` for adapters, validation, and schema inspection.
- `Catalog.operations` enumerates operations and classifies them as `read`, `cart`, `order`, or `payment`.

Failures use the `Errors.VtexError` union: configuration, request validation, response validation, transport, timeout, authentication, not-found, conflict, rate-limit, and API errors. Use `Effect.catchTag` to handle them. Response/error bodies and schema diagnostics are wrapped in `Redacted`; request bodies, cookies, and actual URLs are omitted from SDK spans. Spans contain only operation name, kind, and HTTP method. Explicitly unwrapping diagnostics can reveal sensitive data.

Reads retry transient network errors, timeouts, 408, 429, 500, 502, 503, and 504 up to two times by default. `Retry-After` is honored: a hint beyond the configured maximum fails without retrying early. Cart, order, and payment writes run once. Configure `timeoutMs`, `maxReadRetries`, `retryDelayMs`, and `maxRetryDelayMs` as needed. A failed or interrupted write can have an unknown server-side outcome; inspect the cart/transaction before explicitly retrying.

## Development

```sh
npm ci
npm run generate        # regenerate the SDK and endpoint table
npm run check           # generation drift, types, fixtures, transport tests, build
npm pack                # also runs all checks
VTEX_BASE_URL=https://www.supermuffato.com.br npm run smoke
```

The smoke script performs public search and a lookup for an example postal code. It makes no cart, order, or payment mutations. Normal tests use a local HTTP server and pinned upstream examples. See [schema corrections](docs/schema-corrections.md) and [architecture](docs/architecture.md).

To update the upstream API snapshot, review `specs/manifest.json`, fetch with `python3 scripts/fetch-specs.py`, regenerate, and run the checks. The downloader verifies Git blob hashes. Generation never fetches the network.

## License and attribution

Original SDK code is MIT. VTEX API names, protocol definitions and upstream snapshots originate from [vtex/openapi-schemas](https://github.com/vtex/openapi-schemas); see [NOTICE](NOTICE). VTEX and Distilled are not affiliated with this package.
