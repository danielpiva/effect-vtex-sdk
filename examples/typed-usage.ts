// Typechecked examples; importing this file has no network side effects.
import { Effect, Stream } from "effect";
import { Checkout, IntelligentSearch, LegacySearch, Payments, Vtex } from "../src/index.js";

export const publicSearch = LegacySearch.search({
  ft: "arroz", fq: ["P:[5 TO 30]"], sc: "1", _from: 0, _to: 19,
}).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: "https://www.supermuffato.com.br" })));

export const limitedSearch = IntelligentSearch.stream({
  facets: "trade-policy/1", query: "arroz", sc: "1",
}, { pageSize: 24, maxPages: 3 }).pipe(Stream.take(30), Stream.runCollect);

export const cartProgram = Effect.gen(function*() {
  const cart = yield* Checkout.getOrCreateCart({});
  return yield* Checkout.addItems({
    orderFormId: cart.orderFormId,
    body: { orderItems: [{ id: "A_REAL_SKU_ID", seller: "1", quantity: 1 }] },
  });
});

export const submitPayment = (transactionId: string, orderId: string) => Payments.sendPayments({
  an: "your-vtex-account", orderId, transactionId,
  body: [{
    paymentSystem: 125, installments: 1, currencyCode: "BRL", value: 1000, referenceValue: 1000,
    transaction: { id: transactionId, merchantName: "your-vtex-account" },
  }],
});
