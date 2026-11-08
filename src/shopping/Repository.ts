import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { ShopState, ShoppingError } from "./Models.js";

export interface RepositoryService {
  readonly read: Effect.Effect<ShopState, ShoppingError>;
  readonly initialize: (state: ShopState) => Effect.Effect<ShopState, ShoppingError>;
  readonly withState: <A, R>(
    use: (state: ShopState, save: (state: ShopState) => Effect.Effect<void, ShoppingError>) => Effect.Effect<A, ShoppingError, R>,
  ) => Effect.Effect<A, ShoppingError, R>;
}
export class ShoppingRepository extends Context.Service<ShoppingRepository, RepositoryService>()("effect-vtex-sdk/ShoppingRepository") {}
