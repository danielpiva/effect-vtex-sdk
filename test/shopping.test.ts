import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as McpTest from "effect/ai/McpTest";
import * as McpProtocol from "effect/ai/McpProtocol";
import { Shopping, layer } from "../src/Shopping.js";
import { nodeRepository, layer as repositoryLayer } from "../src/shopping/NodeRepository.js";
import { preparation } from "../src/shopping/Preparation.js";
import { registrations } from "../src/ShoppingMcp.js";
import { json, serverTest, type RequestRecord } from "./helpers.js";

const fakeProduct = { productId: "42", productName: "Ready meal", description: "Pronto para aquecer. Leve ao micro-ondas por 4 minutos.",
  items: [{ itemId: "84", unitMultiplier: 1, measurementUnit: "un", sellers: [{ sellerId: "1", commertialOffer: { Price: 12.5, AvailableQuantity: 10 } }] }] };

interface Scenario { failAfterAdd?: boolean; clampQuantity?: boolean }
async function scenario(run: (context: {
  services: Layer.Layer<Shopping>; directory: string; requests: RequestRecord[]; config: Scenario;
  remote: { items: Array<{ id: string; seller: string; quantity: number; name: string; sellingPrice: number }> };
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "vtex-shop-test-"));
  const config: Scenario = {};
  const remote = { items: [] as Array<{ id: string; seller: string; quantity: number; name: string; sellingPrice: number }> };
  try {
    await serverTest((req, res) => {
      if (req.url.pathname.includes("/catalog_system/")) return json(res, [fakeProduct]);
      if (req.url.pathname.endsWith("/simulation")) return json(res, { items: [{ id: "84", quantity: 2, price: 1250, sellingPrice: 1250, availability: "available", unitMultiplier: 1 }] });
      if (req.url.pathname.endsWith("/items/update")) {
        const body = req.body as { orderItems: Array<{ index: number; quantity: number }> };
        for (const change of body.orderItems) if (remote.items[change.index]) remote.items[change.index]!.quantity = config.clampQuantity ? 1 : change.quantity;
        remote.items = remote.items.filter((i) => i.quantity > 0);
      } else if (req.url.pathname.endsWith("/items") && req.method === "POST") {
        const body = req.body as { orderItems: Array<{ id: string; seller: string; quantity: number }> };
        remote.items.push(...body.orderItems.map((item) => ({ ...item, name: "Ready meal", sellingPrice: 1250 })));
        if (config.failAfterAdd) { config.failAfterAdd = false; return json(res, { error: "ambiguous failure" }, 503); }
      }
      return json(res, { orderFormId: "owned-cart", salesChannel: "34", items: remote.items, value: remote.items.reduce((n, i) => n + i.quantity * i.sellingPrice, 0), messages: [] }, 200,
        { "set-cookie": "shop-session=private-test-value; Path=/; HttpOnly" });
    }, async ({ origin, requests }) => {
      const services = layer.pipe(Layer.provide(repositoryLayer(directory)));
      await Effect.runPromise(Effect.flatMap(Shopping, (shop) => shop.initialize(origin + "/?sc=34")).pipe(Effect.provide(services)));
      await run({ services, directory, requests, config, remote });
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("shopping workflow", () => {
  it("keeps additions local, persists integer prices and uses channel 34", async () => scenario(async ({ services, directory, requests }) => {
    const basket = await Effect.runPromise(Effect.flatMap(Shopping, (shop) => shop.add("84", 2)).pipe(Effect.provide(services)));
    expect(basket.estimatedMerchandiseCents).toBe(2500);
    expect(basket.synced).toBe(false);
    expect(requests.every((req) => req.method === "GET" && req.url.searchParams.get("sc") === "34")).toBe(true);
    const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    expect(state.basket[0].quantity).toBe(2);
    expect((await stat(join(directory, "state.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  }));

  it("searches current offers and retains preparation evidence", async () => scenario(async ({ services }) => {
    const result = await Effect.runPromise(Effect.flatMap(Shopping, (shop) => shop.search({ query: "meal", microwaveOnly: true })).pipe(Effect.provide(services)));
    expect(result.options[0]?.priceCents).toBe(1250);
    expect(result.options[0]?.preparation.status).toBe("microwave-ready");
    expect(result.options[0]?.preparation.evidence).toHaveLength(1);
  }));

  it("quotes the draft with the selected channel without creating a cart", async () => scenario(async ({ services, requests }) => {
    const quote = await Effect.runPromise(Effect.gen(function*() { const shop = yield* Shopping; yield* shop.add("84", 2); return yield* shop.quote; }).pipe(Effect.provide(services)));
    expect(quote.merchandiseCents).toBe(2500);
    expect(quote.deliveryValidated).toBe(false);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(requests.find((r) => r.method === "POST")?.url.searchParams.get("sc")).toBe("34");
    expect(requests.some((r) => /\/orderForm(?:\/|$)/.test(r.url.pathname))).toBe(false);
  }));

  it("creates one private cart, and a repeated sync does not duplicate quantities", async () => scenario(async ({ services, requests, remote, directory }) => {
    await Effect.runPromise(Effect.gen(function*() {
      const shop = yield* Shopping; yield* shop.add("84", 2); yield* shop.sync; yield* shop.sync;
    }).pipe(Effect.provide(services)));
    expect(remote.items).toHaveLength(1);
    expect(remote.items[0]?.quantity).toBe(2);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(requests.find((r) => r.url.searchParams.get("forceNewCart"))?.url.searchParams.get("sc")).toBe("34");
    const state = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    expect(state.remoteCartId).toBe("owned-cart");
    expect(state.cookies[0].value).toBe("private-test-value");
  }));

  it("updates quantities and removes managed lines without duplicating additions", async () => scenario(async ({ services, remote, requests }) => {
    await Effect.runPromise(Effect.gen(function*() {
      const shop = yield* Shopping; yield* shop.add("84", 1); yield* shop.sync; yield* shop.add("84", 2); yield* shop.sync;
      expect(remote.items[0]?.quantity).toBe(3);
      yield* shop.remove("84"); yield* shop.sync;
    }).pipe(Effect.provide(services)));
    expect(remote.items).toHaveLength(0);
    expect(requests.filter((r) => r.url.pathname.endsWith("/items/update"))).toHaveLength(2);
  }));

  it("preserves remote lines it does not manage", async () => scenario(async ({ services, remote }) => {
    remote.items.push({ id: "external", seller: "1", quantity: 1, name: "Added elsewhere", sellingPrice: 500 });
    await Effect.runPromise(Effect.gen(function*() { const shop = yield* Shopping; yield* shop.add("84", 1); yield* shop.sync; }).pipe(Effect.provide(services)));
    expect(remote.items.some((item) => item.id === "external")).toBe(true);
  }));

  it("recovers from an ambiguous add response by reading before retrying", async () => scenario(async ({ services, config, remote, requests }) => {
    config.failAfterAdd = true;
    await Effect.runPromise(Effect.gen(function*() {
      const shop = yield* Shopping; yield* shop.add("84", 1);
      const first = yield* shop.sync.pipe(Effect.result); expect(first._tag).toBe("Failure");
      yield* shop.sync;
    }).pipe(Effect.provide(services)));
    expect(remote.items).toHaveLength(1);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  }));

  it("does not claim synchronization when the store clamps requested quantity", async () => scenario(async ({ services, config }) => {
    const result = await Effect.runPromise(Effect.gen(function*() {
      const shop = yield* Shopping; yield* shop.add("84", 1); yield* shop.sync;
      config.clampQuantity = true;
      yield* shop.add("84", 1); const cart = yield* shop.sync;
      return { cart, basket: yield* shop.basket };
    }).pipe(Effect.provide(services)));
    expect(result.basket.synced).toBe(false);
    expect(result.cart.messages.some((m) => m.includes("not accepted"))).toBe(true);
  }));

  it("serializes separate repository instances using one profile", async () => scenario(async ({ directory }) => {
    const a = nodeRepository(directory); const b = nodeRepository(directory);
    await Effect.runPromise(Effect.all([a, b].map((repo) => repo.withState((state, save) => Effect.sleep(15).pipe(Effect.andThen(save({ ...state, revision: state.revision + 1 }))))), { concurrency: "unbounded" }));
    expect((await Effect.runPromise(a.read)).revision).toBe(2);
  }));

  it("releases the profile lock when an operation is interrupted", async () => scenario(async ({ directory }) => {
    const repo = nodeRepository(directory);
    await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(repo.withState(() => Effect.never));
      yield* Effect.sleep(20); yield* Fiber.interrupt(fiber);
      yield* repo.withState((state, save) => save({ ...state, revision: 1 }));
    }));
    expect((await Effect.runPromise(repo.read)).revision).toBe(1);
  }));

  it("preserves corrupt state instead of overwriting it during initialization", async () => scenario(async ({ directory }) => {
    const repo = nodeRepository(directory); const state = await Effect.runPromise(repo.read);
    await writeFile(join(directory, "state.json"), "not-json");
    const result = await Effect.runPromise(repo.initialize(state).pipe(Effect.result));
    expect(result._tag).toBe("Failure"); expect(await readFile(join(directory, "state.json"), "utf8")).toBe("not-json");
  }));

  it("serves typed MCP tools through the real protocol", async () => scenario(async ({ services }) => {
    const result = await Effect.runPromise(Effect.gen(function*() {
      const client = yield* McpTest.makeClient(registrations.pipe(Layer.provide(services)), { protocols: [McpProtocol.v2025_11_25] });
      const tools = yield* client.listTools();
      const status = yield* client.callTool({ name: "shop_status", arguments: {} });
      const added = yield* client.callTool({ name: "shop_basket_add", arguments: { sku: "84", quantity: 1 } });
      return { tools, status, added };
    }).pipe(Effect.scoped));
    expect(result.tools.tools).toHaveLength(8);
    expect(result.tools.tools.some((t) => /payment|place.*order/.test(t.name))).toBe(false);
    expect(result.status.isError).not.toBe(true); expect(result.added.isError).not.toBe(true);
    expect(JSON.stringify(result.status)).not.toContain("private-test-value");
  }));
});

it.each([
  ["Ready meal", "Aqueça no micro-ondas.", "microwave-ready"],
  ["Massa para Lasanha", "Monte e aqueça no micro-ondas.", "recipe-needed"],
  ["Lasanha Air Fryer", "Aqueça na air fryer", "other-equipment"],
  ["Frozen meal", "Produto congelado.", "unverified"],
  ["Meal", "Não usar micro-ondas.", "other-equipment"],
])("classifies preparation evidence for %s", (name, description, expected) => {
  expect(preparation(name!, description!).status).toBe(expected);
});
