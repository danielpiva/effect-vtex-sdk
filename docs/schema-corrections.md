# Reviewed schema corrections

Upstream: [vtex/openapi-schemas at 0475f5c](https://github.com/vtex/openapi-schemas/tree/0475f5c855b7f03a593b781461356c4feaa550f5). Corrections are implemented in `scripts/overrides.mjs`; the original snapshots are preserved.

| Area | Correction | Evidence / reason |
| --- | --- | --- |
| Legacy products | Share one product shape across search and cross-selling routes. Remove sample-only specification fields from required properties. | Several schemas require `Teste de Api`, `Percentuals`, and similar fields from an example catalog. Four cross-selling routes omit a schema even though their examples return products. |
| Legacy product references | `productReferenceCode` accepts string, integer, or null. Image labels can be null. | These variations occur in the upstream response examples. |
| Legacy IDs | Product, SKU and category path IDs accept strings or nonnegative integers. | Upstream routes inconsistently type identical identifiers. |
| Legacy pagination | `_from`/`_to` use nonnegative integer offsets; streams cap at 2,500 products. `fq` supports repeated values. | These parameters are serialized into strings on the wire. Multiple filters require repeated query keys. |
| Store context | Expose `sc` on legacy product routes. | Sales-channel selection belongs to storefront catalog context. |
| Order placement | Decode `{ orderForm, transactionData, orders }`; order state may be null. | The source response example disagrees with its `orderForm` schema reference. |
| Cart additions | Require SKU ID, seller and positive quantity; index is optional for new items. | The upstream required list conflates adding an item with updating an existing index. |
| Item updates | Require index and nonnegative quantity. | Quantity zero is removal. |
| Simulation | Require items; do not require an existing orderFormId in its response. | Simulation is a stateless quote operation. |
| Cart request bodies | Require meaningful body payloads even where OpenAPI omits `requestBody.required`. | Omitting the body cannot perform the documented operation. Empty-body operations retain an optional body. |
| Regions | Permit no region ID for postal-code region discovery. | The region endpoint supports address-based lookup. |
| Open text | Decode nullable `{ value }` objects. | Checkout models an open-text attachment as an object, despite the snapshot typing it as a string. |
| Payment fields | Card details remain optional for non-card methods; modeled monetary values use integer minor units. | Fields depend on the selected payment system. Transaction ID and merchant name remain required. |
| Intelligent Search | Keep v1 and legacy route spellings separate, with the legacy pickup endpoint under `/api/intelligent-search/v0`. | Per-route upstream server overrides are not interchangeable. |
| Geocoordinates | Use numbers, including fractions, for `geoCoordinates`. | The postal-code endpoint returned real longitude/latitude values while its schema declared integers. |
| Tax | `taxPercentage` may be null. | Observed in the public Muffato Intelligent Search response. |
| Checkout channel | Expose `sc` on cart creation and reads. | The shopper session must carry the explicitly selected storefront sales channel. |
| Cart messages | Accept both strings and `{ code, status, text }` messages. | Checkout warning payloads use structured messages even though the snapshot declares strings. |

Store-specific authentication, supported payment systems, custom fields and response variations should be added with focused fixtures. Avoid weakening every response to `unknown` to accommodate a single mismatch.
