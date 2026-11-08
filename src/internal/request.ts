import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { OperationDefinition } from "../Operation.js";
import type { VtexConfiguration } from "../Config.js";
import { ConfigurationError, RequestValidationError } from "../Errors.js";

export const request = <I, O>(definition: OperationDefinition<I, O>, input: I, config: VtexConfiguration) =>
  Effect.gen(function*() {
    const baseUrl = definition.origin === "payments" ? config.paymentsBaseUrl : config.baseUrl;
    if (!baseUrl) return yield* new ConfigurationError({ message: "Public payments require account or paymentsBaseUrl in the VTEX configuration." });
    return yield* Effect.try({
      try: () => {
        const fields = input as Record<string, unknown>;
        let path = definition.path;
        const query = new URLSearchParams();
        const headers: Record<string, string> = { accept: "application/json" };
        for (const parameter of definition.parameters) {
          const value = fields[parameter.name];
          if (parameter.in === "path") {
            if (parameter.optionalPath && (value === undefined || value === "")) {
              path = path.replace(`/{${parameter.name}}`, "");
              continue;
            }
            if (value === undefined || value === null) throw new Error("Missing path parameter");
            const segments = parameter.greedy ? String(value).replace(/^\/+|\/+$/g, "").split("/") : [String(value)];
            if (segments.some((segment) => segment === "." || segment === "..")) throw new Error("Invalid path segment");
            if (!parameter.greedy && segments[0] === "") throw new Error("Empty path segment");
            path = path.replace(`{${parameter.name}}`, segments.map(encodeURIComponent).join("/"));
          } else if (value !== undefined && value !== null) {
            if (parameter.in === "header") {
              headers[parameter.name] = String(value);
            } else if (Array.isArray(value)) {
              if (parameter.explode === false) {
                const separator = parameter.style === "spaceDelimited" ? " " : parameter.style === "pipeDelimited" ? "|" : ",";
                query.append(parameter.name, value.map(String).join(separator));
              } else {
                for (const item of value) query.append(parameter.name, String(item));
              }
            } else if (typeof value === "object") {
              throw new Error("Unsupported query object");
            } else {
              query.append(parameter.name, String(value));
            }
          }
        }
        if (path.includes("{") || !path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid request path");
        const url = new URL(path, baseUrl);
        url.search = query.toString();
        let req = HttpClientRequest.make(definition.method)(url.toString(), { headers });
        if (definition.body) req = HttpClientRequest.bodyJsonUnsafe(req, fields.body === undefined ? {} : fields.body);
        return req;
      },
      catch: (error) => new RequestValidationError({
        operation: definition.id,
        message: "Cannot encode VTEX request parameters or JSON body.",
        details: Redacted.make(error),
      }),
    });
  });
