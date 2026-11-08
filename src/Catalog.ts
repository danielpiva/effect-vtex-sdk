import * as Checkout from "./generated/Checkout.js";
import * as IntelligentSearch from "./generated/IntelligentSearch.js";
import * as IntelligentSearchLegacy from "./generated/IntelligentSearchLegacy.js";
import * as LegacySearch from "./generated/LegacySearch.js";
import * as Payments from "./generated/Payments.js";

const services = { Checkout, IntelligentSearch, IntelligentSearchLegacy, LegacySearch, Payments };

/** Inspect schemas and distinguish reads, cart updates, order placement and payments. */
export const operations = Object.values(services).flatMap((service) =>
  Object.values(service).flatMap((value) => typeof value === "function" && "definition" in value ? [value.definition] : []),
);
