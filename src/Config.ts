import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import { ConfigurationError } from "./Errors.js";

export interface VtexOptions {
  /** An origin only, for example https://www.supermuffato.com.br. */
  readonly baseUrl: string;
  /** Used to derive https://{account}.vtexpayments.com.br for public payments. */
  readonly account?: string;
  readonly paymentsBaseUrl?: string;
  /** Optional browser Cookie header; seeded for the store's host only. */
  readonly cookie?: Redacted.Redacted<string>;
  readonly timeoutMs?: number;
  readonly maxReadRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

export interface VtexConfiguration {
  readonly baseUrl: string;
  readonly paymentsBaseUrl: string | undefined;
  readonly cookie: Redacted.Redacted<string> | undefined;
  readonly timeoutMs: number;
  readonly maxReadRetries: number;
  readonly retryDelayMs: number;
  readonly maxRetryDelayMs: number;
}

export class VtexConfig extends Context.Service<VtexConfig, VtexConfiguration>()("effect-vtex-sdk/VtexConfig") {}

const origin = (value: string): string => {
  const url = new URL(value);
  if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("Expected an HTTP(S) origin without credentials, path, query or fragment");
  }
  return url.origin;
};

export const configuration = (options: VtexOptions): Effect.Effect<VtexConfiguration, ConfigurationError> =>
  Effect.try({
    try: () => {
      if (options.account !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(options.account)) {
        throw new Error("Invalid VTEX account name");
      }
      const values = {
        timeoutMs: options.timeoutMs ?? 30_000,
        maxReadRetries: options.maxReadRetries ?? 2,
        retryDelayMs: options.retryDelayMs ?? 250,
        maxRetryDelayMs: options.maxRetryDelayMs ?? 10_000,
      };
      for (const [key, value] of Object.entries(values)) {
        if (!Number.isSafeInteger(value) || value < 0 || (key === "timeoutMs" && value === 0)) {
          throw new Error(`Invalid ${key}: expected a nonnegative safe integer (timeout must be positive)`);
        }
      }
      return {
        ...values,
        baseUrl: origin(options.baseUrl),
        paymentsBaseUrl: options.paymentsBaseUrl !== undefined ? origin(options.paymentsBaseUrl) :
          options.account !== undefined ? `https://${options.account}.vtexpayments.com.br` : undefined,
        cookie: options.cookie,
      };
    },
    catch: () => new ConfigurationError({ message: "Invalid VTEX configuration: use HTTP(S) origins, a valid account, and nonnegative integer retry settings." }),
  });

export const layer = (options: VtexOptions) => Layer.effect(VtexConfig, configuration(options));
