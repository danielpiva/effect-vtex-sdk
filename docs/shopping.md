# Shopping interfaces

`Shopping` is the shared Effect service behind `vtex-shop`, the typed tool dispatcher and the MCP server. `@effect/platform-node` is an optional runtime dependency used by the CLI; the low-level SDK remains available when optional dependencies are omitted.

## Code-mode

```ts
import { Effect, Layer } from "effect";
import { Shopping, ShoppingTools } from "effect-vtex-sdk";
import * as NodeRepository from "effect-vtex-sdk/shopping/NodeRepository";

const live = Shopping.layer.pipe(
  Layer.provide(NodeRepository.layer("/path/to/private/profile")),
);

const program = Effect.gen(function*() {
  const shop = yield* Shopping.Shopping;
  yield* shop.initialize("https://www.supermuffato.com.br/?sc=34");
  return yield* shop.search({ query: "lasanha", sort: "price", limit: 8 });
});

const results = await Effect.runPromise(program.pipe(Effect.provide(live)));

// The same dispatcher used by the CLI and MCP:
const state = await Effect.runPromise(
  ShoppingTools.execute("shop_status", {}).pipe(Effect.provide(live)),
);
```

## MCP client configuration

Launch the built CLI as a stdio server:

```json
{
  "mcpServers": {
    "vtex-shop": {
      "command": "node",
      "args": ["/absolute/path/effect-vtex-sdk/dist/bin/vtex-shop.js", "mcp"]
    }
  }
}
```

For Codex, use `codex mcp add vtex-shop -- node /absolute/path/effect-vtex-sdk/dist/bin/vtex-shop.js mcp`. Client configuration formats differ; the server itself uses standard MCP stdio and advertises the 2025-11-25 and 2025-06-18 protocols.

| Tool | Changes |
| --- | --- |
| `shop_status` | None |
| `shop_search` | None |
| `shop_product` | None |
| `shop_basket_add` | Local draft; quantity is incremented |
| `shop_basket_remove` | Local draft |
| `shop_basket_quote` | None; remote simulation |
| `shop_basket_sync` | Remote profile-owned cart |
| `shop_cart` | None |

## Preparation and prices

Preparation labels cite the store's description. `microwave-ready` requires explicit microwave text; `recipe-needed` catches preparation ingredients and assembly instructions; `other-equipment` covers explicit stove, oven or air-fryer preparation without microwave evidence; `unverified` means the available description does not establish microwave suitability. These labels are conservative heuristics, not dietary or allergen certification. Inspect the product's packaging instructions before cooking.

All machine prices use integer centavos. Human CLI prices are formatted as BRL. Search prices are estimates, and unit multipliers are included in draft totals. `basket quote` sends the basket to VTEX using the selected channel. Shipping and delivery remain unconfirmed until an address and delivery option are supplied. The current high-level tool surface does not collect personal address or payment data.

## Persistence and concurrency

State is written atomically while holding a per-profile lock. Separate CLI and MCP processes sharing a profile serialize local changes and remote synchronization. A sync saves its newly created cart ID before adding items; subsequent runs re-read the remote cart and reconcile quantities. This prevents duplicate additions after an ambiguous response. Quantities rejected or changed by the store leave the draft unsynchronized and produce a message. Cart operations are not automatically retried.

Tests use synthetic local HTTP fixtures. Live interface verification performs only public product reads. The low-level SDK retains checkout and payments APIs, but they are not registered as shopping tools.
