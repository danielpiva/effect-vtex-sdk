import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Command from "effect/cli/Command";
import * as Argument from "effect/cli/Argument";
import * as Flag from "effect/cli/Flag";
import * as GlobalFlag from "effect/cli/GlobalFlag";
import { Shopping, ShoppingError, layer as shoppingLayer } from "../Shopping.js";
import * as Tools from "../ShoppingTools.js";
import { server } from "../ShoppingMcp.js";
import { layer as repositoryLayer } from "../shopping/NodeRepository.js";
import { render } from "./Render.js";

const Json = GlobalFlag.Setting("json")({ flag: Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Emit structured JSON.")) });
const Profile = GlobalFlag.Setting("profile")({ flag: Flag.String("profile").pipe(Flag.withDefault("default"), Flag.withDescription("Private local profile name.")) });
const StateDir = GlobalFlag.Setting("state-dir")({ flag: Flag.String("state-dir").pipe(Flag.withDefault(process.env.VTEX_SHOP_HOME ?? join(homedir(), ".local", "state", "vtex-shop"))) });

const context = Effect.gen(function*() {
  const profile = yield* Profile;
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) return yield* new ShoppingError({ code: "INVALID_PROFILE", message: "Profile names may contain letters, numbers, underscores and hyphens." });
  return { json: yield* Json, services: shoppingLayer.pipe(Layer.provide(repositoryLayer(join(yield* StateDir, profile)))) };
});

const print = (name: string, input: unknown) => Effect.gen(function*() {
  const { json, services } = yield* context;
  const output = yield* Tools.execute(name, input).pipe(Effect.provide(services));
  yield* Console.log(json ? JSON.stringify(output) : render(output));
});

const initialize = Command.make("init", { url: Argument.String("url") }, ({ url }) => Effect.gen(function*() {
  const { json, services } = yield* context;
  const output = yield* Effect.flatMap(Shopping, (shop) => shop.initialize(url)).pipe(Effect.provide(services));
  yield* Console.log(json ? JSON.stringify(output) : render(output));
})).pipe(Command.withDescription("Save a storefront URL and sales channel in a private local profile."));

const search = Command.make("search", {
  query: Argument.String("query"), limit: Flag.Int("limit").pipe(Flag.withDefault(12)),
  sort: Flag.Literals("sort", ["price", "relevance"]).pipe(Flag.withDefault("price")),
  microwave: Flag.Boolean("microwave-only").pipe(Flag.withDefault(false)),
  maxPrice: Flag.Finite("max-price").pipe(Flag.withDescription("Maximum unit price in BRL, for example 15.50."), Flag.optional),
}, (input) => print("shop_search", { query: input.query, limit: input.limit, sort: input.sort, microwaveOnly: input.microwave, ...Option.match(input.maxPrice, { onNone: () => ({}), onSome: (price) => ({ maxPriceCents: Math.round(price * 100) }) }) })).pipe(Command.withDescription("Browse available offers, with preparation evidence and numeric price sorting."));

const product = Command.make("product", { id: Argument.String("product-id") }, ({ id }) => print("shop_product", { id }));
const status = Command.make("status", {}, () => print("shop_status", {}));
const basket = Command.make("basket", {}, () => print("shop_status", {})).pipe(Command.withSubcommands([
  Command.make("show", {}, () => print("shop_status", {})),
  Command.make("add", { sku: Argument.String("sku"), quantity: Flag.Int("quantity").pipe(Flag.withDefault(1)), seller: Flag.String("seller").pipe(Flag.optional) }, ({ sku, quantity, seller }) => print("shop_basket_add", { sku, quantity, ...Option.match(seller, { onNone: () => ({}), onSome: (seller) => ({ seller }) }) })),
  Command.make("remove", { sku: Argument.String("sku") }, ({ sku }) => print("shop_basket_remove", { sku })),
  Command.make("quote", {}, () => print("shop_basket_quote", {})),
  Command.make("sync", {}, () => print("shop_basket_sync", {})).pipe(Command.withDescription("Explicitly reconcile the draft into a separate store cart. Does not order or pay.")),
]));
const cart = Command.make("cart").pipe(Command.withSubcommands([Command.make("show", {}, () => print("shop_cart", {}))]));

const tools = Command.make("tools", {}, () => Effect.gen(function*() {
  const json = yield* Json;
  const list = Tools.actions.map((action) => ({ name: action.name, kind: action.kind, description: action.description, input: Schema.toJsonSchemaDocument(action.input) }));
  yield* Console.log(json ? JSON.stringify(list) : list.map((t) => `${t.name.padEnd(24)} ${t.kind.padEnd(6)} ${t.description}`).join("\n"));
}));

const call = Command.make("call", { tool: Argument.String("tool"), input: Argument.String("json") }, ({ tool, input }) => Effect.gen(function*() {
  const value = yield* Effect.try({ try: () => JSON.parse(input) as unknown, catch: () => new ShoppingError({ code: "INVALID_JSON", message: "The call argument must be valid JSON." }) });
  yield* print(tool, value);
}));

const batch = Command.make("batch", {}, () => Effect.gen(function*() {
  const { services } = yield* context;
  const invoke = yield* Effect.context<Shopping>().pipe(Effect.provide(services));
  yield* Effect.tryPromise({
    try: async () => {
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        let request: { tool: string; arguments?: unknown };
        try {
          const parsed: unknown = JSON.parse(line);
          if (typeof parsed !== "object" || parsed === null || !("tool" in parsed) || typeof parsed.tool !== "string") throw new Error();
          request = parsed as typeof request;
        }
        catch { process.stdout.write(JSON.stringify({ ok: false, error: { code: "INVALID_JSON", message: "Each input line must be valid JSON." } }) + "\n"); process.exitCode = 1; continue; }
        const outcome = await Effect.runPromise(Tools.execute(request.tool, request.arguments ?? {}).pipe(Effect.result, Effect.provide(invoke)));
        process.stdout.write(JSON.stringify(outcome._tag === "Success" ? { ok: true, result: outcome.success } : { ok: false, error: { code: outcome.failure.code, message: outcome.failure.message } }) + "\n");
        if (outcome._tag === "Failure") process.exitCode = 1;
      }
    },
    catch: () => new ShoppingError({ code: "BATCH_FAILED", message: "Could not process the input stream." }),
  });
})).pipe(Command.withDescription("Execute newline-delimited JSON tool calls, sequentially. Emits one JSON result per line."));

const mcp = Command.make("mcp", {}, () => Effect.gen(function*() {
  const { services } = yield* context;
  yield* Effect.never.pipe(Effect.provide(server.pipe(Layer.provide(services))));
})).pipe(Command.withDescription("Serve the shopping tools over MCP stdio."));

export const command = Command.make("vtex-shop").pipe(
  Command.withDescription("Inspectable VTEX shopping: browse → local basket → live quote → explicit cart sync."),
  Command.withSubcommands([initialize, status, search, product, basket, cart, tools, call, batch, mcp]),
  Command.withGlobalFlags([Json, Profile, StateDir]),
);

export const run = (args: ReadonlyArray<string>) => Command.runWith(command, { version: "0.2.0", renderErrors: false })(args);
