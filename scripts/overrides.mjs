// Reviewed corrections to upstream schemas. See docs/schema-corrections.md.
const string = { type: "string" };
const number = { type: "number" };
const integer = { type: "integer" };
const object = (properties, required = []) => ({ type: "object", properties, required });
const array = (items) => ({ type: "array", items });
const nullable = (schema) => ({ ...schema, nullable: true });

export const publicPayment = object({
  paymentSystem: integer,
  installments: { ...integer, minimum: 1 },
  currencyCode: string,
  value: { ...integer, minimum: 0 },
  installmentsInterestRate: number,
  installmentsValue: { ...integer, minimum: 0 },
  referenceValue: { ...integer, minimum: 0 },
  fields: object({
    holderName: nullable(string), cardNumber: nullable(string), validationCode: nullable(string),
    dueDate: nullable(string), document: nullable(string), accountId: nullable(string),
    address: nullable(object({})), callbackUrl: nullable(string),
  }),
  transaction: object({ id: string, merchantName: string }, ["id", "merchantName"]),
}, ["paymentSystem", "installments", "currencyCode", "value", "referenceValue", "transaction"]);

export const placement = object({
  orderForm: { $ref: "#/components/schemas/orderForm", nullable: true },
  transactionData: object({
    merchantTransactions: array(object({
      id: string, transactionId: string, merchantName: string,
      payments: array(object({ paymentSystem: integer, value: integer, referenceValue: integer })),
    }, ["transactionId", "merchantName"])),
    receiverUri: string,
    gatewayCallbackTemplatePath: string,
  }, ["merchantTransactions"]),
  orders: array(object({ orderId: string, orderGroup: string, state: nullable(string), value: integer })),
}, ["transactionData", "orders"]);

export const checkoutNames = {
  CartSimulation: "simulate", CreateANewCart: "getOrCreateCart", GetCartInformationById: "getCart",
  RemoveAllItems: "removeAllItems", Removeallpersonaldata: "clearPersonalData", ItemsUpdate: "updateItems",
  Items: "addItems", ItemsHandle: "handleItems", PriceChange: "setManualPrice", SplitItem: "splitItem",
  IgnoreProfileData: "ignoreProfileData", GetClientProfileByEmail: "getClientProfile", AddClientProfile: "setClientProfile",
  AddShippingAddress: "setShippingData", AddClientPreferences: "setClientPreferences", AddMarketingData: "setMarketingData",
  AddPaymentData: "setPaymentData", AddMerchantContextData: "setMerchantContextData", SetMultipleCustomFieldValues: "setCustomData",
  SetSingleCustomFieldValue: "setCustomField", Removesinglecustomfieldvalue: "removeCustomField", ClearorderFormMessages: "clearMessages",
  GetCartInstallments: "getInstallments", AddCoupons: "addCoupons", ListPickupPpointsByLocation: "getPickupPoints",
  GetAddressByPostalCode: "getAddress", PlaceOrderFromExistingOrderForm: "placeOrderFromCart", PlaceOrder: "placeOrder",
  ProcessOrder: "processOrder", GetSellersByRegion: "getRegions",
};

export function correctComponents(spec, service) {
  function fixCoordinatesAndTax(node) {
    if (!node || typeof node !== "object") return;
    if (node.properties?.geoCoordinates?.type === "array") {
      node.properties.geoCoordinates.items = { type: "number" };
    }
    if (node.properties?.taxPercentage?.type === "number") {
      node.properties.taxPercentage.nullable = true;
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(fixCoordinatesAndTax);
      else fixCoordinatesAndTax(child);
    }
  }
  fixCoordinatesAndTax(spec);
  if (service === "Checkout") {
    const form = spec.components.schemas.orderForm;
    form.required = ["orderFormId", "items", "value"];
    form.properties.openTextField = nullable(object({ value: string }));
  }
  if (service === "LegacySearch") {
    // The fullest product response is inline, not the older `Example` component.
    const schema = structuredClone(spec.paths["/api/catalog_system/pub/products/search"].get.responses["200"].content["application/json"].schema.items);
    const sampleFields = ["Percentuals", "Percentual", "Total", "Teste de Api", "Ale", "Teste da Api2", "Alcool"];
    for (const field of sampleFields) delete schema.properties[field];
    schema.required = ["productId", "productName", "items"];
    schema.properties.brandImageUrl = nullable(string);
    schema.properties.productReference = nullable(string);
    schema.properties.productReferenceCode = { anyOf: [string, integer, { type: "null" }] };
    schema.properties.items.items.properties.images.items.properties.imageLabel = nullable(string);
    spec.components.schemas.Product = schema;
    // Remove sample-only requiredness deep inside SKU/offer response examples.
    function loosen(node) {
      if (!node || typeof node !== "object") return;
      if (node !== schema && node.type === "object") delete node.required;
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(loosen); else loosen(value);
      }
    }
    loosen(schema);
  }
}

export function correctOperation({ service, path, method, operation, input, output, parameters, spec }) {
  if (service === "LegacySearch") {
    if (path.includes("/products/") && !path.includes("/offers/")) output = array({ $ref: "#/components/schemas/Product" });
    for (const name of ["_from", "_to"]) if (input.properties[name]) input.properties[name] = { ...integer, minimum: 0, maximum: 2499 };
    if (input.properties.fq) input.properties.fq = { anyOf: [string, array(string)] };
    for (const parameter of parameters) {
      if (parameter.in === "path" && ["productId", "skuId", "categoryId"].includes(parameter.name)) {
        input.properties[parameter.name] = { anyOf: [string, { ...integer, minimum: 0 }] };
      }
    }
    if (path.includes("/products/")) {
      input.properties.sc = string;
      parameters.push({ name: "sc", in: "query" });
    }
  }
  if (service.startsWith("IntelligentSearch") && input.properties.facets) {
    input.properties.facets = string;
  }
  if (service === "Checkout") {
    const body = input.properties.body;
    if (body && (body.properties && Object.keys(body.properties).length > 0 || body.type === "array" || body.$ref)) {
      input.required.push("body");
    }
    if (path.endsWith("/items") && method === "post") {
      body.required = ["orderItems"];
      const item = body.properties.orderItems.items;
      item.required = ["id", "quantity", "seller"];
      item.properties.quantity.minimum = 1;
    }
    if (path.endsWith("/items/update")) {
      body.required = ["orderItems"];
      body.properties.orderItems.items.required = ["index", "quantity"];
      body.properties.orderItems.items.properties.quantity.minimum = 0;
      body.properties.orderItems.items.properties.index.minimum = 0;
    }
    if (operation.operationId === "CartSimulation") {
      body.required = ["items"];
      // Simulation is not an existing cart and does not have an orderFormId.
      if (output?.properties) output.required = ["items"];
    }
    if (["PlaceOrderFromExistingOrderForm", "PlaceOrder"].includes(operation.operationId)) output = placement;
    if (path.endsWith("/coupons")) body.required = ["text"];
    // `regionId` is optional for postal-code discovery despite the path parameter.
    if (operation.operationId === "GetSellersByRegion") {
      input.properties.regionId = string;
      input.required = input.required.filter((key) => key !== "regionId");
      parameters.find((p) => p.name === "regionId").optionalPath = true;
    }
  }
  if (service === "Payments") {
    input.required.push("body");
    input.properties.body = array(publicPayment);
    input.properties.body.minItems = 1;
  }
  input.required = [...new Set(input.required)];
  return { input, output };
}
