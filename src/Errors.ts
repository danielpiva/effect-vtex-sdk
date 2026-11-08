import * as Data from "effect/Data";
import type * as Redacted from "effect/Redacted";

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string;
}> {}

export class RequestValidationError extends Data.TaggedError("RequestValidationError")<{
  readonly operation: string;
  readonly message: string;
  readonly details: Redacted.Redacted<unknown>;
}> {}

export class ResponseValidationError extends Data.TaggedError("ResponseValidationError")<{
  readonly operation: string;
  readonly message: string;
  readonly details: Redacted.Redacted<unknown>;
}> {}

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class RequestTimeoutError extends Data.TaggedError("RequestTimeoutError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface HttpFailure {
  readonly operation: string;
  readonly status: number;
  readonly message: string;
  readonly details: Redacted.Redacted<unknown>;
}

export class AuthenticationError extends Data.TaggedError("AuthenticationError")<HttpFailure> {}
export class NotFoundError extends Data.TaggedError("NotFoundError")<HttpFailure> {}
export class ConflictError extends Data.TaggedError("ConflictError")<HttpFailure> {}
export class RateLimitError extends Data.TaggedError("RateLimitError")<HttpFailure & {
  readonly retryAfterMs: number | undefined;
}> {}
export class ApiError extends Data.TaggedError("ApiError")<HttpFailure & {
  readonly retryAfterMs: number | undefined;
}> {}

export type VtexError = ConfigurationError | RequestValidationError | ResponseValidationError |
  TransportError | RequestTimeoutError | AuthenticationError | NotFoundError |
  ConflictError | RateLimitError | ApiError;
