import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import { Shopping, BasketView, CartView, ProductOutput, QuoteView, SearchInput, SearchOutput, ShoppingError, ShoppingErrorSchema, PositiveInt } from "./Shopping.js";

function action<const Name extends string, I extends object, O>(
  name: Name, description: string, input: Schema.Codec<I>, output: Schema.Codec<O>,
  kind: "read" | "local" | "cart", handler: (input: I) => Effect.Effect<O, ShoppingError, Shopping>,
) {
  const callUnknown = (value: unknown) => Schema.decodeUnknownEffect(input, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError(() => new ShoppingError({ code: "INVALID_INPUT", message: `Input does not match ${name}'s schema.` })),
    Effect.flatMap(handler),
  );
  return {
    name, description, input, output, kind, call: handler, callUnknown,
    tool: Tool.make(name, { description, parameters: input, success: output, failure: ShoppingErrorSchema })
      .annotate(Tool.Readonly, kind === "read").annotate(Tool.Destructive, false)
      .annotate(Tool.Idempotent, name !== "shop_basket_add").annotate(Tool.OpenWorld, name !== "shop_status" && name !== "shop_basket_remove"),
  };
}

const Empty = Tool.EmptyParams;
export const Status = action("shop_status", "Read the profile, local basket and synchronization state. No remote cart is created.", Empty, BasketView, "read", () => Effect.flatMap(Shopping, (shop) => shop.basket));
export const Search = action("shop_search", "Search products on the configured sales channel. Prices are in cents and preparation labels include source evidence.", SearchInput, SearchOutput, "read", (input) => Effect.flatMap(Shopping, (shop) => shop.search(input)));
export const Product = action("shop_product", "Inspect a product, its SKU offers and preparation evidence from the store description.", Schema.Struct({ id: Schema.String }), ProductOutput, "read", ({ id }) => Effect.flatMap(Shopping, (shop) => shop.product(id)));
export const BasketAdd = action("shop_basket_add", "Add quantity to a SKU in the local draft. Does not modify a remote cart. Repeated calls increment the quantity.", Schema.Struct({ sku: Schema.String, quantity: Schema.optional(PositiveInt), seller: Schema.optional(Schema.String) }), BasketView, "local", ({ sku, quantity, seller }) => Effect.flatMap(Shopping, (shop) => shop.add(sku, quantity ?? 1, seller)));
export const BasketRemove = action("shop_basket_remove", "Remove a SKU from the local draft. Does not modify a remote cart.", Schema.Struct({ sku: Schema.String }), BasketView, "local", ({ sku }) => Effect.flatMap(Shopping, (shop) => shop.remove(sku)));
export const BasketQuote = action("shop_basket_quote", "Simulate the local basket against current VTEX prices and availability. No cart is created. Shipping remains unconfirmed.", Empty, QuoteView, "read", () => Effect.flatMap(Shopping, (shop) => shop.quote));
export const BasketSync = action("shop_basket_sync", "Explicitly reconcile the local draft into the CLI-owned remote cart. Changes cart items only; does not place orders or submit payments.", Empty, CartView, "cart", () => Effect.flatMap(Shopping, (shop) => shop.sync));
export const Cart = action("shop_cart", "Read the saved remote cart without creating one.", Empty, CartView, "read", () => Effect.flatMap(Shopping, (shop) => shop.cart));

export const actions = [Status, Search, Product, BasketAdd, BasketRemove, BasketQuote, BasketSync, Cart] as const;
export const toolkit = Toolkit.make(Status.tool, Search.tool, Product.tool, BasketAdd.tool, BasketRemove.tool, BasketQuote.tool, BasketSync.tool, Cart.tool);
export const handlers = toolkit.toLayer(Effect.gen(function*() {
  const shopping = yield* Shopping;
  const provide = <A>(effect: Effect.Effect<A, ShoppingError, Shopping>) => effect.pipe(Effect.provideService(Shopping, shopping));
  return {
    shop_status: (input: Parameters<typeof Status.call>[0]) => provide(Status.call(input)),
    shop_search: (input: Parameters<typeof Search.call>[0]) => provide(Search.call(input)),
    shop_product: (input: Parameters<typeof Product.call>[0]) => provide(Product.call(input)),
    shop_basket_add: (input: Parameters<typeof BasketAdd.call>[0]) => provide(BasketAdd.call(input)),
    shop_basket_remove: (input: Parameters<typeof BasketRemove.call>[0]) => provide(BasketRemove.call(input)),
    shop_basket_quote: (input: Parameters<typeof BasketQuote.call>[0]) => provide(BasketQuote.call(input)),
    shop_basket_sync: (input: Parameters<typeof BasketSync.call>[0]) => provide(BasketSync.call(input)),
    shop_cart: (input: Parameters<typeof Cart.call>[0]) => provide(Cart.call(input)),
  };
}));

export const execute = (name: string, input: unknown): Effect.Effect<unknown, ShoppingError, Shopping> => {
  const action = actions.find((action) => action.name === name);
  return action ? action.callUnknown(input) : Effect.fail(new ShoppingError({ code: "UNKNOWN_TOOL", message: `Unknown shopping tool: ${name}` }));
};
