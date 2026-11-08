import { expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { Checkout, IntelligentSearch } from "../src/index.js";

// Synthetic fixtures reproducing field shapes observed on a public storefront.
// No shopper identity, cookies or personalized price/availability data.
it("accepts fractional geocoordinates from a postal-code lookup", () => {
  expect(Schema.is(Checkout.getAddress.output)({
    postalCode: "01001000", city: "São Paulo", state: "SP", country: "BRA",
    street: "Praça da Sé", number: "", neighborhood: "Sé", complement: "", reference: "",
    geoCoordinates: [-46.630714416503906, -23.55284881591797],
  })).toBe(true);
});

it("accepts null tax percentages in Intelligent Search offers", () => {
  expect(Schema.is(IntelligentSearch.search.output)({
    products: [{ productId: "1", items: [{ itemId: "1", sellers: [{
      sellerId: "1", commertialOffer: { Price: 19.9, taxPercentage: null },
    }] }] }], recordsFiltered: 1,
  })).toBe(true);
});
