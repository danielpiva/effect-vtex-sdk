import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Cookies from "effect/http/Cookies";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import type { OperationDefinition } from "./Operation.js";
import { VtexConfig, layer as configLayer, type VtexOptions } from "./Config.js";
import {
  ApiError, AuthenticationError, ConflictError, NotFoundError, RateLimitError,
  RequestTimeoutError, RequestValidationError, ResponseValidationError, TransportError, type VtexError,
} from "./Errors.js";
import { request } from "./internal/request.js";

export interface VtexClientService {
  readonly execute: <I, O>(definition: OperationDefinition<I, O>, input: I) => Effect.Effect<O, VtexError>;
  /** Cookies stay in memory unless the caller explicitly exports them. */
  readonly sessionCookies: Effect.Effect<Redacted.Redacted<ReadonlyArray<Cookies.Cookie>>>;
}

export class VtexClient extends Context.Service<VtexClient, VtexClientService>()("effect-vtex-sdk/VtexClient") {}

const retryAfter = (value: string | undefined, now: number): number | undefined => {
  if (value === undefined) return undefined;
  const milliseconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined;
};

export const layer = Layer.effect(VtexClient, Effect.gen(function*() {
  const config = yield* VtexConfig;
  const http = yield* HttpClient.HttpClient;
  const initial: Cookies.Cookie[] = config.initialCookies ? [...Redacted.value(config.initialCookies)] : [];
  if (config.cookie !== undefined) {
    const hostname = new URL(config.baseUrl).hostname;
    for (const [name, value] of Object.entries(Cookies.parseHeader(Redacted.value(config.cookie)))) {
      initial.push(Cookies.makeCookieUnsafe(name, value, { domain: hostname, hostOnly: true, path: "/", secure: config.baseUrl.startsWith("https:") }));
    }
  }
  const cookies = yield* Ref.make<ReadonlyArray<Cookies.Cookie>>(initial);
  const client = http.pipe(HttpClient.withCookiesRef(cookies));
  const writes = yield* Semaphore.make(1);

  const execute = <I, O>(definition: OperationDefinition<I, O>, input: I): Effect.Effect<O, VtexError> => {
    const once = Effect.gen(function*() {
      const validated = yield* Schema.decodeUnknownEffect(definition.input, { onExcessProperty: "error" })(input).pipe(
        Effect.mapError((error) => new RequestValidationError({ operation: definition.id, message: "Request does not match the operation schema.", details: Redacted.make(error) })),
      );
      const req = yield* request(definition, validated, config);
      const response = yield* client.execute(req).pipe(
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
        Effect.mapError(() => new TransportError({ operation: definition.id, message: "VTEX HTTP transport failed." })),
      );
      const text = yield* response.text.pipe(
        Effect.mapError(() => new TransportError({ operation: definition.id, message: "Could not read the VTEX response." })),
      );
      let data: unknown = undefined;
      if (text.length > 0) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (response.status < 200 || response.status >= 300) {
        const failure = { operation: definition.id, status: response.status, message: `VTEX returned HTTP ${response.status}.`, details: Redacted.make(data) };
        const now = yield* Effect.clockWith((clock) => Effect.succeed(clock.currentTimeMillisUnsafe()));
        const retryAfterMs = retryAfter(response.headers["retry-after"], now);
        if (response.status === 401 || response.status === 403) return yield* new AuthenticationError(failure);
        if (response.status === 404) return yield* new NotFoundError(failure);
        if (response.status === 409) return yield* new ConflictError(failure);
        if (response.status === 429) return yield* new RateLimitError({ ...failure, retryAfterMs });
        return yield* new ApiError({ ...failure, retryAfterMs });
      }
      return yield* Schema.decodeUnknownEffect(definition.output, { onExcessProperty: "ignore" })(definition.emptyResponse ? undefined : data).pipe(
        Effect.mapError((error) => new ResponseValidationError({ operation: definition.id, message: "Response does not match the operation schema.", details: Redacted.make(error) })),
      );
    }).pipe(Effect.timeoutOrElse({
      duration: config.timeoutMs,
      orElse: () => Effect.fail(new RequestTimeoutError({ operation: definition.id, message: "VTEX request timed out." })),
    }));

    const retry = (attempt: number): Effect.Effect<O, VtexError> => once.pipe(Effect.catch((error) => {
      const transient = error._tag === "RateLimitError" || error._tag === "TransportError" ||
        error._tag === "RequestTimeoutError" || (error._tag === "ApiError" && [408, 500, 502, 503, 504].includes(error.status));
      if (definition.kind !== "read" || !transient || attempt >= config.maxReadRetries) return Effect.fail(error);
      const hint = "retryAfterMs" in error ? error.retryAfterMs : undefined;
      if (hint !== undefined && hint > config.maxRetryDelayMs) return Effect.fail(error);
      const delay = hint ?? Math.min(config.retryDelayMs * 2 ** attempt, config.maxRetryDelayMs);
      return Effect.sleep(delay).pipe(Effect.flatMap(() => retry(attempt + 1)));
    }));

    const effect = definition.kind === "read" ? retry(0) : writes.withPermits(1)(once);
    return effect.pipe(Effect.withSpan(definition.id, {
      attributes: { "vtex.operation": definition.id, "vtex.kind": definition.kind, "http.request.method": definition.method },
    }));
  };
  return { execute, sessionCookies: Ref.get(cookies).pipe(Effect.map(Redacted.make)) };
}));

/** Uses the caller's Effect HttpClient, suitable for dependency injection and tests. */
export const layerWithConfig = (options: VtexOptions) => layer.pipe(Layer.provide(configLayer(options)));

/** Fetch transport for Node 22+, Bun, browsers and workers. */
export const layerFetch = (options: VtexOptions) => layerWithConfig(options).pipe(
  Layer.provide(FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual", credentials: "include" })))),
);
