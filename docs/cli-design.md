# CLI and MCP design

The CLI is `vtex-shop`. It uses the same shopping service as the MCP server and code-mode API. The first live profile is Super Muffato, sales channel 34.

## A session

```sh
vtex-shop init 'https://www.supermuffato.com.br/?sc=34'
vtex-shop search 'lasanha' --sort price --limit 8
vtex-shop product 313648
vtex-shop basket add 313648 --quantity 2
vtex-shop basket show
vtex-shop basket quote
vtex-shop basket sync
vtex-shop cart show
```

`basket` is a durable local draft. `basket quote` asks VTEX for current prices and availability. `basket sync` explicitly synchronizes the draft with a separate cart owned by this CLI. The interface does not expose order placement or payment submission.

## Search view

```text
  VTEX SHOP   Super Muffato · channel 34
  Search: lasanha                                 cheapest first

  SKU       PRODUCT                                 PRICE  PREPARATION
  123       Lasanha example 600 g                 R$ 14,90  Microwave confirmed
  456       Lasanha example Air Fryer 300 g         R$ 9,90  Needs review

  2 results · use `product <id>` to inspect the source description
  Prices are product quotes; delivery and cart promotions are calculated later.
```

Prices are numeric values sorted before formatting. Search results include seller, stock signal, unit multiplier, preparation evidence and a product link. Evidence comes from the store description; a frozen product is not automatically classified as microwave-ready.

## Basket view

```text
  LOCAL BASKET   2 items · 3 units

  QTY  PRODUCT                                      UNIT       TOTAL
    2  Ready-meal example                         R$ 14,90    R$ 29,80
    1  Shelf-stable example                        R$ 8,50     R$ 8,50

  Estimated products                                         R$ 38,30
  Shipping                                                   Not quoted
  VTEX cart                                                  Not synced
```

A quote shows item-level availability and VTEX's totals, warnings and shipping completeness. A sync returns the remote cart link. Repeating a sync reconciles quantities instead of adding the same groceries again.

## Commands and contracts

| Command | State change | Purpose |
| --- | --- | --- |
| `init URL` | Local | Save store origin and sales channel. |
| `status` | None | Show selected profile and draft/cart summary. |
| `search QUERY` | None | Browse products with optional numeric price sort and preparation filter. |
| `product ID` | None | Inspect SKUs, offers and preparation evidence. |
| `basket add SKU` | Local | Add a specific SKU and quantity to the draft. |
| `basket remove SKU` | Local | Remove a draft line. |
| `basket show` | None | Show the local draft and estimated merchandise total. |
| `basket quote` | None | Run a current VTEX cart simulation. |
| `basket sync` | Remote cart | Reconcile the draft into the CLI-owned cart. |
| `cart show` | None | Read the saved remote cart. |
| `tools` | None | List machine-callable tool names and schemas. |
| `call TOOL JSON` | Depends on tool | Execute the same typed operation used by MCP. |
| `batch` | Depends on tool | Read newline-delimited tool calls from stdin; emit one result per line. |
| `mcp` | Depends on tool | Run the Effect MCP server over stdio. |

All commands support root `--json`. Human output stays separate from machine output. MCP stdout contains only protocol traffic.

## Implementation boundaries

- Effect CLI for parsing/help; Effect MCP for stdio, schemas and cancellation.
- A shared `Shopping` service implements the behavior; CLI and MCP are adapters.
- Private profile state lives under `~/.local/state/vtex-shop`, or `VTEX_SHOP_HOME`. State files are mode 0600 and directories 0700.
- A profile lock serializes concurrent CLI/MCP state changes. Saved cart identity and session cookies stay local.
- Default live use is read-only. Draft mutations are local; remote cart writes require the explicit sync operation.
- Checkout and payment APIs remain available in the low-level SDK, outside the shopping tool surface.
