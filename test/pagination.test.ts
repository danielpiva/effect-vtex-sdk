import { expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { LegacySearch, IntelligentSearch, Vtex } from "../src/index.js";
import { serverTest, product, json } from "./helpers.js";

it("fetches legacy pages lazily and stops after an incomplete page", async () => {
  await serverTest((req, res, index) => {
    expect(req.url.searchParams.get("_from")).toBe(String(index * 2));
    expect(req.url.searchParams.get("_to")).toBe(String(index * 2 + 1));
    json(res, index === 0 ? [product, product] : [product]);
  }, async ({ origin, requests }) => {
    const data = await Effect.runPromise(LegacySearch.stream({ ft: "rice" }, { pageSize: 2 }).pipe(Stream.runCollect, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
    expect(data).toHaveLength(3);
    expect(requests).toHaveLength(2);
  });
});

it("does not request another page when a consumer terminates early", async () => {
  await serverTest((_, res) => json(res, [product, product]), async ({ origin, requests }) => {
    const data = await Effect.runPromise(LegacySearch.stream({}, { pageSize: 2 }).pipe(Stream.take(1), Stream.runCollect, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
    expect(data).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });
});

it("honors maxPages even when the server always returns a full page", async () => {
  await serverTest((_, res) => json(res, [product]), async ({ origin, requests }) => {
    await Effect.runPromise(LegacySearch.stream({}, { pageSize: 1, maxPages: 2 }).pipe(Stream.runCollect, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
    expect(requests).toHaveLength(2);
  });
});

it("paginates Intelligent Search using page/count and recordsFiltered", async () => {
  await serverTest((req, res, index) => {
    expect(req.url.searchParams.get("page")).toBe(String(index + 1));
    expect(req.url.searchParams.get("count")).toBe("1");
    json(res, { products: [{ productId: String(index), productName: "rice" }], recordsFiltered: 2 });
  }, async ({ origin, requests }) => {
    const data = await Effect.runPromise(IntelligentSearch.stream({ facets: "trade-policy/1" }, { pageSize: 1 }).pipe(Stream.runCollect, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
    expect(data).toHaveLength(2);
    expect(requests).toHaveLength(2);
  });
});

it("uses the server's page size when a storefront ignores the requested count", async () => {
  await serverTest((_, res, index) => {
    const products = Array.from({ length: index === 0 ? 3 : 1 }, (_, item) => ({ productId: String(item), productName: "Rice" }));
    json(res, { products, recordsFiltered: 4, pagination: { perPage: 3 } });
  }, async ({ origin, requests }) => {
    const data = await Effect.runPromise(IntelligentSearch.stream({ facets: "trade-policy/1" }, { pageSize: 1 }).pipe(Stream.runCollect, Effect.provide(Vtex.layerFetch({ baseUrl: origin }))));
    expect(data).toHaveLength(4);
    expect(requests).toHaveLength(2);
  });
});
