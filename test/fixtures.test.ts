import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as Schema from "effect/Schema";
import * as Exit from "effect/Exit";
import { Checkout, IntelligentSearch, IntelligentSearchLegacy, LegacySearch, Payments } from "../src/index.js";
import type { Operation } from "../src/Operation.js";

interface OpenApiOperation {
  responses: Record<string, { content?: Record<string, { example?: unknown; schema?: { example?: unknown } }> }>;
}
interface OpenApi { paths: Record<string, Record<string, OpenApiOperation>> }

const fixtures: Array<{ name: string; schema: Schema.Codec<unknown>; value: unknown }> = [];
for (const [name, module, file, prefix] of [
  ["LegacySearch", LegacySearch, "Search API", ""],
  ["IntelligentSearch", IntelligentSearch, "Intelligent Search API - v1", "/api/intelligent-search/v1"],
  ["IntelligentSearchLegacy", IntelligentSearchLegacy, "Intelligent Search API", "/api/io/_v/api/intelligent-search"],
  ["Checkout", Checkout, "Checkout API", ""],
  ["Payments", Payments, "Payments Gateway API", ""],
] as const) {
  const spec = JSON.parse(readFileSync(new URL(`../specs/VTEX - ${file}.json`, import.meta.url), "utf8")) as OpenApi;
  for (const op of Object.values(module)) {
    if (typeof op !== "function" || !("definition" in op)) continue;
    const { definition } = op as Operation<unknown, unknown>;
    if (definition.emptyResponse) continue;
    const route = definition.path.startsWith("/api/intelligent-search/v0/") ? definition.path.slice("/api/intelligent-search/v0".length) : definition.path.slice(prefix.length);
    const source = spec.paths[route]?.[definition.method.toLowerCase()];
    if (!source) throw new Error(`Missing source for ${definition.id}`);
    for (const [status, response] of Object.entries(source.responses)) {
      if (!status.startsWith("2")) continue;
      const content = response.content?.["application/json"];
      const value = content?.example ?? content?.schema?.example;
      if (value === undefined) continue;
      fixtures.push({ name: `${name}: ${definition.id} HTTP ${status}`, schema: definition.output, value });
    }
  }
}

it("has meaningful upstream response coverage", () => expect(fixtures.length).toBeGreaterThanOrEqual(55));

it.each(fixtures)("decodes upstream $name", ({ schema, value }) => {
  const result = Schema.decodeUnknownExit(schema)(value);
  if (Exit.isFailure(result)) throw new Error(String(result.cause).slice(0, 1300));
  expect(Exit.isSuccess(result)).toBe(true);
});
