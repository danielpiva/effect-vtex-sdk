import * as S from "effect/Schema";
import { BasketView, CartView, ProductOutput, QuoteView, SearchOutput } from "../Shopping.js";

const safe = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
const cut = (s: string, n: number) => safe(s).length > n ? safe(s).slice(0, n - 1) + "…" : safe(s);
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const prep = (status: string) => ({ "microwave-ready": "Microwave ✓", "recipe-needed": "Recipe needed", "other-equipment": "Other equipment", unverified: "Needs review" })[status] ?? status;
const heading = (name: string, channel: string) => `\n  VTEX SHOP  ·  ${safe(name)}  ·  channel ${safe(channel)}\n`;

export function render(value: unknown): string {
  if (S.is(SearchOutput)(value)) {
    return heading(value.store.name, value.store.salesChannel) +
      `  Search: ${safe(value.query)}\n\n` +
      `  ${"SKU".padEnd(12)} ${"PRODUCT".padEnd(44)} ${"PRICE".padStart(11)}  PREPARATION\n` +
      value.options.map((o) => `  ${cut(o.sku, 12).padEnd(12)} ${cut(o.name, 44).padEnd(44)} ${money(o.priceCents).padStart(11)}  ${prep(o.preparation.status)}`).join("\n") +
      `\n\n  ${value.options.length} offers · ${value.inspectedProducts} products inspected\n  Inspect with: vtex-shop product PRODUCT_ID\n  ${value.note}\n`;
  }
  if (S.is(BasketView)(value)) {
    return heading(value.store.name, value.store.salesChannel) +
      `  LOCAL BASKET  ·  ${value.lines.length} lines  ·  ${value.units} units\n\n` +
      `  QTY  ${"SKU".padEnd(12)} ${"PRODUCT".padEnd(39)} ${"UNIT".padStart(11)} ${"TOTAL".padStart(11)}\n` +
      value.lines.map(({ option: o, quantity: q }) => `  ${String(q).padStart(3)}  ${cut(o.sku, 12).padEnd(12)} ${cut(o.name, 39).padEnd(39)} ${money(o.priceCents).padStart(11)} ${money(Math.round(o.priceCents * o.unitMultiplier) * q).padStart(11)}`).join("\n") +
      `\n\n  Estimated merchandise: ${money(value.estimatedMerchandiseCents)}\n  Shipping: not quoted\n  Store cart: ${value.remoteCartId ? value.synced ? "synced" : "draft has changes" : "not synced"}\n` +
      (value.lines.length ? "\n  Next: basket quote → basket sync → cart show\n" : "\n  Start: vtex-shop search 'lasanha' --sort price\n");
  }
  if (S.is(ProductOutput)(value)) {
    return heading("Product details", "—") + `  ${safe(value.name)}\n  Product ID: ${safe(value.productId)}\n  ${safe(value.url)}\n\n` +
      `  ${safe(value.description) || "No preparation description is available."}\n\n` +
      value.options.map((o) => `  SKU ${safe(o.sku)} · seller ${safe(o.seller)} · ${money(o.priceCents)} · stock ${o.availableQuantity}\n  ${prep(o.preparation.status)}${o.preparation.evidence.map((e) => `\n    Evidence: ${safe(e)}`).join("")}`).join("\n\n") + "\n";
  }
  if (S.is(CartView)(value)) {
    return heading(value.store.name, value.store.salesChannel) + `  STORE CART  ·  ${value.items.length} lines\n\n` +
      value.items.map((i) => `  ${String(i.quantity).padStart(3)} × ${cut(i.name, 55).padEnd(55)} ${money(i.unitPriceCents).padStart(11)}`).join("\n") +
      `\n\n  Store total: ${money(value.valueCents)}\n  ${safe(value.url)}\n` + value.messages.map((m) => `  ${safe(m)}\n`).join("");
  }
  if (S.is(QuoteView)(value)) {
    return heading(value.store.name, value.store.salesChannel) + "  LIVE QUOTE\n\n" +
      value.items.map((i) => `  ${safe(i.sku).padEnd(12)} × ${i.quantity}   ${i.unitPriceCents === null ? "—" : money(i.unitPriceCents)}   ${safe(i.availability)}`).join("\n") +
      `\n\n  Merchandise: ${money(value.merchandiseCents)}\n  Shipping: not confirmed\n` + value.messages.map((m) => `  ${safe(m)}\n`).join("");
  }
  return JSON.stringify(value, null, 2);
}
