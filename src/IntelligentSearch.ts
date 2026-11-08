import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { RequestValidationError } from "./Errors.js";
import { search, type SearchInput } from "./generated/IntelligentSearch.js";
import type { PaginationOptions } from "./LegacySearch.js";
export * from "./generated/IntelligentSearch.js";

/** Page-based Intelligent Search, bounded even if the server never reports a total. */
export const stream = (input: Omit<SearchInput, "page" | "count">, options: PaginationOptions = {}) => {
  const count = options.pageSize ?? 24;
  const maxPages = options.maxPages ?? 100;
  if (!Number.isSafeInteger(count) || count < 1 || count > 50 || !Number.isSafeInteger(maxPages) || maxPages < 1) {
    return Stream.fail(new RequestValidationError({ operation: "IntelligentSearch.stream", message: "Use pageSize 1..50 and a positive integer maxPages.", details: Redacted.make(options) }));
  }
  return Stream.paginate(1, (page) => search({ ...input, page, count }).pipe(Effect.map((result) => {
    const products = result.products ?? [];
    const reportedSize = result.pagination?.perPage;
    const actualSize = reportedSize !== undefined && reportedSize > 0 ? reportedSize : count;
    const end = products.length === 0 || products.length < actualSize || page >= maxPages ||
      (result.recordsFiltered !== undefined && page * actualSize >= result.recordsFiltered);
    return [products, end ? Option.none() : Option.some(page + 1)] as const;
  })));
};
