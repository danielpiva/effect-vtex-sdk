// Read-only smoke test. No cart creation, shopper identity or payment data.
import { Effect } from "effect";
import { Checkout, IntelligentSearch, LegacySearch, Vtex } from "../dist/index.js";

const baseUrl = process.env.VTEX_BASE_URL;
if (!baseUrl) throw new Error("Set VTEX_BASE_URL to a public VTEX storefront origin.");
const live = Vtex.layerFetch({ baseUrl, maxReadRetries: 0 });

const program = Effect.gen(function*() {
  const legacy = yield* LegacySearch.search({ ft: "arroz", _from: 0, _to: 2 });
  console.log(JSON.stringify({ api: "LegacySearch", products: legacy.map((p) => ({ productId: p.productId, productName: p.productName })) }));
  const intelligent = yield* IntelligentSearch.search({ facets: "trade-policy/1", query: "arroz", count: 2 }).pipe(Effect.result);
  if (intelligent._tag === "Success") {
    console.log(JSON.stringify({ api: "IntelligentSearch", count: intelligent.success.products?.length, products: intelligent.success.products?.slice(0, 3).map((p) => ({ productId: p.productId, productName: p.productName })) }));
  } else {
    console.log(JSON.stringify({ api: "IntelligentSearch", error: intelligent.failure._tag, message: intelligent.failure.message }));
  }
  const address = yield* Checkout.getAddress({ countryCode: "BRA", postalCode: "01001000" });
  console.log(JSON.stringify({ api: "Checkout.getAddress", city: address.city, state: address.state }));
});

await Effect.runPromise(program.pipe(Effect.provide(live)));
