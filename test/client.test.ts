import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Checkout, IntelligentSearch, IntelligentSearchLegacy, LegacySearch, Payments, Vtex, VtexClient, Catalog } from "../src/index.js";
import { configuration } from "../src/Config.js";
import { cart, product, json, serverTest } from "./helpers.js";

const payment = { paymentSystem: 125, installments: 1, currencyCode: "BRL", value: 1000, referenceValue: 1000, transaction: { id: "transaction-1", merchantName: "store" } };

describe("protocol and schemas", () => {
  it("serializes repeated filters, zero pagination and reserved search characters", async () => {
    await serverTest((request, response) => {
      expect(request.method).toBe("GET");
      expect(request.url.pathname).toBe("/api/catalog_system/pub/products/search");
      expect(request.url.searchParams.getAll("fq")).toEqual(["P:[10 TO 30]", "C:/1/2/"]);
      expect(request.url.searchParams.get("ft")).toBe("arroz & feijão");
      expect(request.url.searchParams.get("_from")).toBe("0");
      json(response, [product], 206);
    }, async ({ origin }) => {
      const result = await Effect.runPromise(LegacySearch.search({ ft: "arroz & feijão", fq: ["P:[10 TO 30]", "C:/1/2/"], _from: 0, _to: 9, sc: "1" }).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(result[0]?.productName).toBe("Frozen lunch");
    });
  });

  it("encodes facet segments independently and keeps v1 context explicit", async () => {
    await serverTest((request, response) => {
      expect(request.url.pathname).toBe("/api/intelligent-search/v1/product-search/brand/A%26B/trade-policy/1");
      expect(request.url.searchParams.get("hideUnavailableItems")).toBe("false");
      expect(request.url.searchParams.get("sc")).toBe("2");
      json(response, { products: [], recordsFiltered: 0 });
    }, async ({ origin }) => {
      await Effect.runPromise(IntelligentSearch.search({ facets: "/brand/A&B/trade-policy/1", sc: "2", query: "rice", hideUnavailableItems: false }).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
    });
  });

  it("routes legacy Intelligent Search pickup availability to its separate v0 origin path", () => {
    expect(IntelligentSearchLegacy.pickupPointAvailability.definition.path).toBe("/api/intelligent-search/v0/pickup-point-availability/{facets}");
  });

  it("preserves unknown merchant product and cart fields", async () => {
    await serverTest((_, response) => json(response, [{ ...product, merchantLabel: "local", items: [{ itemId: "84", merchantUnit: "tray" }] }]), async ({ origin }) => {
      const result = await Effect.runPromise(LegacySearch.search({}).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(result[0]?.merchantLabel).toBe("local");
      expect(result[0]?.items[0]?.merchantUnit).toBe("tray");
    });
  });

  it("rejects invalid inputs before making a network request", async () => {
    await serverTest((_, response) => json(response, []), async ({ origin, requests }) => {
      const invalid = LegacySearch.search({ _from: -1 }).pipe(Effect.result, Effect.provide(Vtex.layerFetch({ baseUrl: origin })));
      const result = await Effect.runPromise(invalid);
      expect(Result.isFailure(result) && result.failure._tag).toBe("RequestValidationError");
      expect(requests).toHaveLength(0);
    });
  });

  it("rejects misspelled top-level parameters and path traversal", async () => {
    await serverTest((_, response) => json(response, []), async ({ origin, requests }) => {
      const results = await Effect.runPromise(Effect.all([
        LegacySearch.search({ fulltext: "rice" } as never).pipe(Effect.result),
        LegacySearch.searchByPath({ search: "../orders" }).pipe(Effect.result),
      ]).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(results.every((r) => Result.isFailure(r) && r.failure._tag === "RequestValidationError")).toBe(true);
      expect(requests).toHaveLength(0);
    });
  });

  it("reports malformed success data with redacted details", async () => {
    await serverTest((_, response) => json(response, [{ productId: 42, productName: "PRIVATE-VALUE", items: [] }]), async ({ origin }) => {
      const result = await Effect.runPromise(LegacySearch.search({}).pipe(Effect.result, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("ResponseValidationError");
        expect(JSON.stringify(result.failure)).not.toContain("PRIVATE-VALUE");
      }
    });
  });

  it("decodes the actual placement envelope", async () => {
    await serverTest((_, response) => json(response, { orderForm: null, transactionData: { merchantTransactions: [{ transactionId: "tx", merchantName: "store" }], receiverUri: "https://store.vtexpayments.com.br/split/order/payments" }, orders: [{ orderId: "order-01", orderGroup: "order" }] }), async ({ origin }) => {
      const result = await Effect.runPromise(Checkout.placeOrderFromCart({ orderFormId: "cart-1", body: { referenceId: "cart-1", value: 1000, referenceValue: 1000, interestValue: 0 } }).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(result.transactionData.merchantTransactions[0]?.transactionId).toBe("tx");
    });
  });

  it("validates required fields of cart additions and permits optional index", () => {
    expect(Schema.is(Checkout.addItems.input)({ orderFormId: "cart", body: { orderItems: [{ id: "42", seller: "1", quantity: 1 }] } })).toBe(true);
    expect(Schema.is(Checkout.addItems.input)({ orderFormId: "cart", body: { orderItems: [{ id: "42", seller: "1", quantity: -1 }] } })).toBe(false);
    expect(Schema.is(Checkout.addItems.input)({ orderFormId: "cart", body: {} })).toBe(false);
  });

  it("supports the public payment request and bodyless 201 response", async () => {
    await serverTest((request, response) => {
      expect(request.url.pathname).toBe("/api/payments/transactions/transaction-1/payments");
      expect(request.url.searchParams.get("an")).toBe("store");
      expect(request.body).toEqual([payment]);
      json(response, undefined, 201);
    }, async ({ origin }) => {
      const result = await Effect.runPromise(Payments.sendPayments({ an: "store", orderId: "order-1", transactionId: "transaction-1", body: [payment] }).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin, paymentsBaseUrl: origin }))));
      expect(result).toBeUndefined();
    });
  });

  it("requires a payment origin instead of sending payment data to the storefront", async () => {
    await serverTest((_, response) => json(response, undefined, 201), async ({ origin, requests }) => {
      const result = await Effect.runPromise(Payments.sendPayments({ an: "store", orderId: "order-1", transactionId: "tx", body: [payment] }).pipe(Effect.result, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(Result.isFailure(result) && result.failure._tag).toBe("ConfigurationError");
      expect(requests).toHaveLength(0);
    });
  });

  it("has 74 inspectable operations and excludes private management endpoints", () => {
    expect(Catalog.operations).toHaveLength(74);
    expect(new Set(Catalog.operations.map((op) => op.id)).size).toBe(74);
    expect(Catalog.operations.every((op) => !op.path.includes("/pvt/"))).toBe(true);
    expect(Catalog.operations.filter((op) => op.kind === "payment")).toHaveLength(1);
  });
});

describe("session, concurrency and retry policy", () => {
  it("retains cookies per client and exposes them only as Redacted", async () => {
    await serverTest((request, response, index) => {
      if (index === 0) json(response, cart, 200, { "set-cookie": "checkout.vtex.com=__ofid=cart-1; Path=/; HttpOnly" });
      else { expect(request.headers.cookie).toContain("__ofid=cart-1"); json(response, cart); }
    }, async ({ origin }) => {
      const cookies = await Effect.runPromise(Effect.gen(function*() {
        yield* Checkout.getOrCreateCart({});
        yield* Checkout.getCart({ orderFormId: "cart-1" });
        return yield* (yield* VtexClient).sessionCookies;
      }).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(Redacted.isRedacted(cookies)).toBe(true);
      expect(JSON.stringify(cookies)).not.toContain("cart-1");
      expect(Redacted.value(cookies)).toHaveLength(1);
    });
  });

  it("isolates cookies between client layers", async () => {
    await serverTest((request, response, index) => {
      if (index === 0) json(response, [], 200, { "set-cookie": "session=private; Path=/" });
      else { expect(request.headers.cookie).toBeUndefined(); json(response, []); }
    }, async ({ origin }) => {
      await Effect.runPromise(LegacySearch.search({}).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      await Effect.runPromise(LegacySearch.search({}).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
    });
  });

  it("serializes concurrent cart mutations through one client", async () => {
    let active = 0;
    let maximum = 0;
    await serverTest(async (_, response) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      json(response, cart);
    }, async ({ origin, requests }) => {
      await Effect.runPromise(Effect.all([1, 2, 3].map((quantity) => Checkout.addItems({ orderFormId: "cart-1", body: { orderItems: [{ id: "84", seller: "1", quantity }] } })), { concurrency: "unbounded" }).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(requests).toHaveLength(3);
      expect(maximum).toBe(1);
    });
  });

  it("retries transient reads but preserves query parameters", async () => {
    await serverTest((request, response, index) => {
      expect(request.url.searchParams.get("ft")).toBe("rice");
      json(response, index === 0 ? { error: "temporarily unavailable" } : [], index === 0 ? 503 : 200);
    }, async ({ origin, requests }) => {
      await Effect.runPromise(LegacySearch.search({ ft: "rice" }).pipe(Effect.provide(Vtex.layerFetch({ baseUrl: origin, retryDelayMs: 0 }))));
      expect(requests).toHaveLength(2);
    });
  });

  it.each(["cart", "payment", "order", "create"])("does not retry %s mutations, even for 503", async (kind) => {
    await serverTest((_, response) => json(response, { error: "unavailable" }, 503), async ({ origin, requests }) => {
      const operation = kind === "cart" ? Checkout.addCoupons({ orderFormId: "cart", body: { text: "coupon" } }) :
        kind === "payment" ? Payments.sendPayments({ an: "store", orderId: "order", transactionId: "tx", body: [payment] }) :
        kind === "order" ? Checkout.placeOrderFromCart({ orderFormId: "cart", body: { referenceId: "cart", value: 1000, referenceValue: 1000, interestValue: 0 } }) : Checkout.getOrCreateCart({});
      await Effect.runPromise(operation.pipe(Effect.result, Effect.provide(Vtex.layerFetch({ baseUrl: origin, paymentsBaseUrl: origin, retryDelayMs: 0 }))));
      expect(requests).toHaveLength(1);
    });
  });

  it.each([401, 403, 404, 409, 400])("does not retry nontransient HTTP %s or expose its body", async (status) => {
    await serverTest((_, response) => json(response, { error: "PRIVATE-TOKEN" }, status), async ({ origin, requests }) => {
      const result = await Effect.runPromise(LegacySearch.search({}).pipe(Effect.result, Effect.provide(Vtex.layerFetch({ baseUrl: origin, retryDelayMs: 0 }))));
      expect(requests).toHaveLength(1);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(JSON.stringify(result.failure)).not.toContain("PRIVATE-TOKEN");
    });
  });

  it("respects Retry-After and does not retry earlier than a long server hint", async () => {
    await serverTest((_, response) => json(response, {}, 429, { "retry-after": "120" }), async ({ origin, requests }) => {
      const result = await Effect.runPromise(LegacySearch.search({}).pipe(Effect.result, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
      expect(requests).toHaveLength(1);
      expect(Result.isFailure(result) && result.failure._tag === "RateLimitError" && result.failure.retryAfterMs).toBe(120_000);
    });
  });

  it("fails a stalled response with a typed timeout", async () => {
    await serverTest(() => {}, async ({ origin }) => {
      const result = await Effect.runPromise(LegacySearch.search({}).pipe(Effect.result, Effect.provide(Vtex.layerFetch({ baseUrl: origin, timeoutMs: 25, maxReadRetries: 0 }))));
      expect(Result.isFailure(result) && result.failure._tag).toBe("RequestTimeoutError");
    });
  });
});

it.each([
  { baseUrl: "https://user:password@example.com" }, { baseUrl: "file:///tmp/data" },
  { baseUrl: "https://example.com/a" }, { baseUrl: "https://example.com", maxReadRetries: -1 },
  { baseUrl: "https://example.com", timeoutMs: 0 }, { baseUrl: "https://example.com", account: "bad/name" },
])("validates configuration without disclosing the supplied value", async (options) => {
  const result = await Effect.runPromise(configuration(options).pipe(Effect.result));
  expect(Result.isFailure(result) && result.failure._tag).toBe("ConfigurationError");
  expect(JSON.stringify(result)).not.toContain("password");
});
