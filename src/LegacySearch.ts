import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { RequestValidationError } from "./Errors.js";
import { search, type SearchInput } from "./generated/LegacySearch.js";
export * from "./generated/LegacySearch.js";

export interface PaginationOptions {
  readonly pageSize?: number;
  readonly maxPages?: number;
}

/** Lazily fetches at most 2,500 results; early Stream termination stops requests. */
export const stream = (input: Omit<SearchInput, "_from" | "_to">, options: PaginationOptions = {}) => {
  const size = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 50;
  if (!Number.isSafeInteger(size) || size < 1 || size > 50 || !Number.isSafeInteger(maxPages) || maxPages < 1) {
    return Stream.fail(new RequestValidationError({ operation: "LegacySearch.stream", message: "Use pageSize 1..50 and a positive integer maxPages.", details: Redacted.make(options) }));
  }
  return Stream.paginate(0, (page) => {
    const from = page * size;
    const to = Math.min(from + size - 1, 2499);
    return search({ ...input, _from: from, _to: to }).pipe(Effect.map((products) => [
      products,
      products.length < to - from + 1 || to === 2499 || page + 1 >= maxPages ? Option.none() : Option.some(page + 1),
    ] as const));
  });
};
