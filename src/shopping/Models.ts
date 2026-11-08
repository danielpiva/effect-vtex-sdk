import * as Data from "effect/Data";
import * as S from "effect/Schema";

export class ShoppingError extends Data.TaggedError("ShoppingError")<{
  readonly code: string;
  readonly message: string;
}> {}
export const ShoppingErrorSchema = S.Struct({ _tag: S.Literal("ShoppingError"), code: S.String, message: S.String });
export const PositiveInt = S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1));
export const NonnegativeInt = S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(0));

export const Preparation = S.Struct({
  status: S.Literals(["microwave-ready", "recipe-needed", "other-equipment", "unverified"]),
  evidence: S.Array(S.String),
});
export type Preparation = typeof Preparation.Type;

export const ProductOption = S.Struct({
  productId: S.String, sku: S.String, seller: S.String, name: S.String,
  skuName: S.String, url: S.String, priceCents: NonnegativeInt,
  unitMultiplier: S.Number, measurementUnit: S.String, availableQuantity: S.Number,
  preparation: Preparation,
});
export type ProductOption = typeof ProductOption.Type;

export const BasketLine = S.Struct({ option: ProductOption, quantity: PositiveInt });
export type BasketLine = typeof BasketLine.Type;

export const ShopConfig = S.Struct({
  baseUrl: S.String, name: S.String, salesChannel: S.String, country: S.String,
  postalCode: S.optional(S.String),
});
export type ShopConfig = typeof ShopConfig.Type;

export const StoredCookie = S.Struct({
  name: S.String, value: S.String,
  options: S.optional(S.Struct({
    domain: S.optional(S.String), path: S.optional(S.String), expires: S.optional(S.String),
    secure: S.optional(S.Boolean), httpOnly: S.optional(S.Boolean), hostOnly: S.optional(S.Boolean),
    sameSite: S.optional(S.Literals(["strict", "lax", "none"])),
  })),
});
export type StoredCookie = typeof StoredCookie.Type;

export const ShopState = S.Struct({
  version: S.Literal(1), config: ShopConfig, basket: S.Array(BasketLine),
  revision: NonnegativeInt, cookies: S.Array(StoredCookie), managedKeys: S.Array(S.String),
  remoteCartId: S.optional(S.String), syncedRevision: S.optional(NonnegativeInt),
});
export type ShopState = typeof ShopState.Type;

export const SearchInput = S.Struct({
  query: S.String.check(S.isMinLength(1)),
  limit: S.optional(PositiveInt.check(S.isLessThanOrEqualTo(50))),
  sort: S.optional(S.Literals(["price", "relevance"])),
  microwaveOnly: S.optional(S.Boolean),
  maxPriceCents: S.optional(NonnegativeInt),
});
export type SearchInput = typeof SearchInput.Type;

export const SearchOutput = S.Struct({
  store: ShopConfig, query: S.String, options: S.Array(ProductOption),
  inspectedProducts: NonnegativeInt, note: S.String,
});
export type SearchOutput = typeof SearchOutput.Type;

export const ProductOutput = S.Struct({ productId: S.String, name: S.String, description: S.String, url: S.String, options: S.Array(ProductOption) });
export type ProductOutput = typeof ProductOutput.Type;

export const BasketView = S.Struct({
  store: ShopConfig, lines: S.Array(BasketLine), revision: NonnegativeInt,
  units: NonnegativeInt, estimatedMerchandiseCents: NonnegativeInt,
  shippingCents: S.Null, remoteCartId: S.optional(S.String), synced: S.Boolean,
});
export type BasketView = typeof BasketView.Type;

export const QuoteView = S.Struct({
  store: ShopConfig,
  items: S.Array(S.Struct({ sku: S.String, quantity: S.Number, availability: S.String, unitPriceCents: S.NullOr(S.Number) })),
  merchandiseCents: S.Number, shippingCents: S.NullOr(S.Number),
  messages: S.Array(S.String), deliveryValidated: S.Boolean,
});
export type QuoteView = typeof QuoteView.Type;

export const CartView = S.Struct({
  store: ShopConfig, id: S.String, url: S.String, valueCents: S.Number,
  items: S.Array(S.Struct({ sku: S.String, name: S.String, quantity: S.Number, seller: S.String, unitPriceCents: S.Number })),
  messages: S.Array(S.String),
});
export type CartView = typeof CartView.Type;

export const lineKey = (sku: string, seller: string) => `${sku}:${seller}`;
export const basketView = (state: ShopState): BasketView => ({
  store: state.config, lines: state.basket, revision: state.revision,
  units: state.basket.reduce((n, line) => n + line.quantity, 0),
  estimatedMerchandiseCents: state.basket.reduce((n, line) => n + Math.round(line.option.priceCents * line.option.unitMultiplier) * line.quantity, 0),
  shippingCents: null, ...(state.remoteCartId ? { remoteCartId: state.remoteCartId } : {}),
  synced: state.remoteCartId !== undefined && state.syncedRevision === state.revision,
});
