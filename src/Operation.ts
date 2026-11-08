import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { VtexClient } from "./VtexClient.js";
import type { VtexError } from "./Errors.js";

export interface Parameter {
  readonly name: string;
  readonly in: "path" | "query" | "header";
  readonly style?: string;
  readonly explode?: boolean;
  readonly greedy?: boolean;
  readonly optionalPath?: boolean;
}

export interface OperationDefinition<I, O> {
  readonly id: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly origin: "store" | "payments";
  readonly kind: "read" | "cart" | "order" | "payment";
  readonly parameters: ReadonlyArray<Parameter>;
  readonly body: boolean;
  readonly emptyResponse: boolean;
  readonly input: Schema.Codec<I>;
  readonly output: Schema.Codec<O>;
  readonly documentation: string;
}

/** A callable Effect with inspectable schemas and protocol metadata for adapters. */
export interface Operation<I, O> {
  (input: I): Effect.Effect<O, VtexError, VtexClient>;
  readonly definition: OperationDefinition<I, O>;
  readonly input: Schema.Codec<I>;
  readonly output: Schema.Codec<O>;
}

export const makeOperation = <I, O>(definition: OperationDefinition<I, O>): Operation<I, O> =>
  Object.assign(
    (input: I) => Effect.flatMap(VtexClient, (client) => client.execute(definition, input)),
    { definition, input: definition.input, output: definition.output },
  );
