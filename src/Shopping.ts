import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Cookies from "effect/http/Cookies";
import * as Checkout from "./Checkout.js";
import * as LegacySearch from "./LegacySearch.js";
import { VtexClient, layerFetch } from "./VtexClient.js";
import type { VtexError } from "./Errors.js";
import { ShoppingRepository } from "./shopping/Repository.js";
import { productView } from "./shopping/Products.js";
import { basketView, lineKey, ShoppingError, type ShopState, type StoredCookie, type SearchInput, type SearchOutput, type ProductOutput, type CartView, type QuoteView } from "./shopping/Models.js";
export * from "./shopping/Models.js";

const failure = (error: VtexError) => new ShoppingError({ code: error._tag, message: error.message });
const hydrate = (cookies: ReadonlyArray<StoredCookie>) => cookies.map((c) => Cookies.makeCookieUnsafe(c.name, c.value, {
  ...c.options, ...(c.options?.expires ? { expires: new Date(c.options.expires) } : { expires: undefined }),
}));
const storeCookies = (cookies: ReadonlyArray<Cookies.Cookie>): StoredCookie[] => cookies.map(({ name, value, options }) => ({
  name, value,
  ...(options ? { options: {
    ...(options.domain ? { domain: options.domain } : {}), ...(options.path ? { path: options.path } : {}),
    ...(options.expires ? { expires: options.expires.toISOString() } : {}),
    ...(options.secure !== undefined ? { secure: options.secure } : {}),
    ...(options.httpOnly !== undefined ? { httpOnly: options.httpOnly } : {}),
    ...(options.hostOnly !== undefined ? { hostOnly: options.hostOnly } : {}),
    ...(options.sameSite !== undefined ? { sameSite: options.sameSite } : {}),
  } } : {}),
}));

const run = <A>(state: ShopState, effect: Effect.Effect<A, VtexError | ShoppingError, VtexClient>) => effect.pipe(
  Effect.mapError((error) => error instanceof ShoppingError ? error : failure(error)),
  Effect.provide(layerFetch({ baseUrl: state.config.baseUrl, initialCookies: Redacted.make(hydrate(state.cookies)), maxReadRetries: 1 })),
  Effect.mapError((error) => error instanceof ShoppingError ? error : failure(error)),
);

const messages = (items: ReadonlyArray<string | { readonly text?: string; readonly status?: string }> | undefined) =>
  (items ?? []).map((item) => typeof item === "string" ? item : item.text ?? item.status ?? "Store message");

const cartView = (cart: Checkout.GetCartOutput, state: ShopState): CartView => {
  const url = new URL("/checkout/", state.config.baseUrl);
  url.searchParams.set("orderFormId", cart.orderFormId);
  url.searchParams.set("sc", state.config.salesChannel);
  url.hash = "/cart";
  return {
    store: state.config, id: cart.orderFormId, url: url.toString(), valueCents: cart.value,
    items: cart.items.map((item) => ({ sku: item.id ?? "", name: item.name ?? "", quantity: item.quantity ?? 0, seller: item.seller ?? "", unitPriceCents: item.sellingPrice ?? item.price ?? 0 })),
    messages: messages(cart.messages),
  };
};

const make = Effect.gen(function*() {
  const repository = yield* ShoppingRepository;
  const search = (input: SearchInput) => Effect.gen(function*() {
    const state = yield* repository.read;
    const limit = input.limit ?? 12;
    const products = yield* run(state, LegacySearch.search({
      ft: input.query, sc: state.config.salesChannel, _from: 0,
      _to: input.microwaveOnly ? 49 : Math.min(49, limit - 1),
      ...(input.sort === "relevance" ? {} : { O: "OrderByPriceASC" }),
    }));
    const options = products.flatMap((product) => productView(product, state.config).options)
      .filter((option) => option.availableQuantity > 0 && option.priceCents > 0)
      .filter((option) => !input.microwaveOnly || option.preparation.status === "microwave-ready")
      .filter((option) => input.maxPriceCents === undefined || option.priceCents <= input.maxPriceCents);
    if (input.sort !== "relevance") options.sort((a, b) => a.priceCents - b.priceCents);
    return { store: state.config, query: input.query, options: options.slice(0, limit), inspectedProducts: products.length,
      note: "Prices and stock are catalog signals. Quote the basket for current checkout pricing; delivery needs address and SLA selection." } satisfies SearchOutput;
  });

  const product = (id: string) => Effect.gen(function*() {
    const state = yield* repository.read;
    const products = yield* run(state, LegacySearch.search({ fq: `productId:${id}`, sc: state.config.salesChannel, _from: 0, _to: 9 }));
    const found = products.find((p) => p.productId === id);
    if (!found) return yield* new ShoppingError({ code: "PRODUCT_NOT_FOUND", message: "No product with that ID was returned for this sales channel." });
    return productView(found, state.config) satisfies ProductOutput;
  });

  return {
    initialize: (url: string) => Effect.gen(function*() {
      const config = yield* Effect.try({ try: () => {
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/") throw new Error();
        const sc = parsed.searchParams.get("sc") ?? "1";
        if (!/^\d+$/.test(sc)) throw new Error();
        return { baseUrl: parsed.origin, name: parsed.hostname.includes("supermuffato") ? "Super Muffato" : parsed.hostname, salesChannel: sc, country: "BRA" };
      }, catch: () => new ShoppingError({ code: "INVALID_STORE", message: "Use a storefront origin, optionally with ?sc=34." }) });
      const state = yield* repository.initialize({ version: 1, config, basket: [], revision: 0, cookies: [], managedKeys: [] });
      return basketView(state);
    }),
    search,
    product,
    basket: repository.read.pipe(Effect.map(basketView)),
    add: (sku: string, quantity: number, seller?: string) => repository.withState((state, save) => Effect.gen(function*() {
      if (!Number.isSafeInteger(quantity) || quantity < 1) return yield* new ShoppingError({ code: "INVALID_QUANTITY", message: "Quantity must be a positive integer." });
      const products = yield* run(state, LegacySearch.search({ fq: `skuId:${sku}`, sc: state.config.salesChannel, _from: 0, _to: 9 }));
      const options = products.flatMap((p) => productView(p, state.config).options).filter((o) => o.sku === sku && o.availableQuantity > 0 && (!seller || o.seller === seller));
      options.sort((a, b) => a.priceCents - b.priceCents);
      const option = options[0];
      if (!option) return yield* new ShoppingError({ code: "SKU_UNAVAILABLE", message: "This SKU/seller is not available on the selected sales channel." });
      const key = lineKey(sku, option.seller);
      const current = state.basket.find((line) => lineKey(line.option.sku, line.option.seller) === key);
      const next = { ...state, revision: state.revision + 1, basket: [...state.basket.filter((line) => lineKey(line.option.sku, line.option.seller) !== key), { option, quantity: (current?.quantity ?? 0) + quantity }] };
      yield* save(next);
      return basketView(next);
    })),
    remove: (sku: string) => repository.withState((state, save) => Effect.gen(function*() {
      const basket = state.basket.filter((line) => line.option.sku !== sku);
      const next = { ...state, basket, revision: state.revision + (basket.length === state.basket.length ? 0 : 1) };
      yield* save(next);
      return basketView(next);
    })),
    quote: Effect.gen(function*() {
      const state = yield* repository.read;
      if (!state.basket.length) return yield* new ShoppingError({ code: "EMPTY_BASKET", message: "Add a SKU before requesting a quote." });
      const quote = yield* run(state, Checkout.simulate({ sc: Number(state.config.salesChannel), body: {
        items: state.basket.map((line) => ({ id: line.option.sku, seller: line.option.seller, quantity: line.quantity })),
        country: state.config.country, ...(state.config.postalCode ? { postalCode: state.config.postalCode } : {}),
      } }));
      const merchandiseCents = quote.items.reduce((sum, item) => sum + Math.round((item.sellingPrice ?? item.price ?? 0) * (item.unitMultiplier ?? 1)) * (item.quantity ?? 0), 0);
      return { store: state.config, items: quote.items.map((item) => ({ sku: item.id ?? "", quantity: item.quantity ?? 0, availability: item.availability ?? "unknown", unitPriceCents: item.sellingPrice ?? item.price ?? null })),
        merchandiseCents, shippingCents: null, deliveryValidated: false,
        messages: ["Shipping is not included. An address and delivery selection are needed."] } satisfies QuoteView;
    }),
    cart: Effect.gen(function*() {
      const state = yield* repository.read;
      if (!state.remoteCartId) return yield* new ShoppingError({ code: "CART_NOT_SYNCED", message: "This profile has no remote cart. Use basket sync when the draft is ready." });
      return cartView(yield* run(state, Checkout.getCart({ orderFormId: state.remoteCartId, sc: state.config.salesChannel })), state);
    }),
    sync: repository.withState((original, save) => run(original, Effect.gen(function*() {
      const { syncedRevision: _previousSync, ...pending } = original;
      let state: ShopState = pending;
      const client = yield* VtexClient;
      const checkpoint = (cartId: string) => Effect.gen(function*() {
        const cookies = storeCookies(Redacted.value(yield* client.sessionCookies));
        state = { ...state, remoteCartId: cartId, cookies };
        yield* save(state);
      });
      if (!state.basket.length && !state.remoteCartId) return yield* new ShoppingError({ code: "EMPTY_BASKET", message: "Add a SKU before syncing a new cart." });
      yield* save(state);
      let cart = yield* (state.remoteCartId ? Checkout.getCart({ orderFormId: state.remoteCartId, sc: state.config.salesChannel }) : Checkout.getOrCreateCart({ forceNewCart: true, sc: state.config.salesChannel }));
      yield* checkpoint(cart.orderFormId);
      if (cart.salesChannel && cart.salesChannel !== state.config.salesChannel) return yield* new ShoppingError({ code: "CHANNEL_MISMATCH", message: "The remote cart belongs to a different sales channel; no items were changed." });
      const desired = new Map(state.basket.map((line) => [lineKey(line.option.sku, line.option.seller), line]));
      const managed = new Set(state.managedKeys);
      const visited = new Set<string>();
      const changes = cart.items.flatMap((item, index) => {
        const key = lineKey(item.id ?? "", item.seller ?? "");
        if (!desired.has(key) && !managed.has(key)) return [];
        const quantity = visited.has(key) ? 0 : desired.get(key)?.quantity ?? 0;
        visited.add(key);
        return quantity === item.quantity ? [] : [{ index, quantity }];
      });
      if (changes.length) {
        cart = yield* Checkout.updateItems({ orderFormId: cart.orderFormId, body: { orderItems: changes } });
        yield* checkpoint(cart.orderFormId);
      }
      const present = new Set(cart.items.map((item) => lineKey(item.id ?? "", item.seller ?? "")));
      const missing = state.basket.filter((line) => !present.has(lineKey(line.option.sku, line.option.seller)));
      if (missing.length) {
        cart = yield* Checkout.addItems({ orderFormId: cart.orderFormId, body: { orderItems: missing.map((line) => ({ id: line.option.sku, seller: line.option.seller, quantity: line.quantity })) } });
        yield* checkpoint(cart.orderFormId);
      }
      const actual = new Map<string, number>();
      for (const item of cart.items) {
        const key = lineKey(item.id ?? "", item.seller ?? "");
        actual.set(key, (actual.get(key) ?? 0) + (item.quantity ?? 0));
      }
      const exact = state.basket.every((line) => actual.get(lineKey(line.option.sku, line.option.seller)) === line.quantity) &&
        state.managedKeys.every((key) => desired.has(key) || !actual.get(key));
      state = { ...state, managedKeys: [...new Set([...state.managedKeys, ...desired.keys()])], ...(exact ? { syncedRevision: state.revision } : {}) };
      yield* save(state);
      const view = cartView(cart, state);
      return exact ? view : { ...view, messages: [...view.messages, "Some requested quantities were not accepted by the store. Inspect the cart before continuing."] };
    }))),
  };
});

export type ShoppingService = Effect.Success<typeof make>;
export class Shopping extends Context.Service<Shopping, ShoppingService>()("effect-vtex-sdk/Shopping") {}
export const layer = Layer.effect(Shopping, make);
