import type { Product } from "../generated/LegacySearchModels.js";
import { plainText, preparation } from "./Preparation.js";
import type { ProductOption, ProductOutput, ShopConfig } from "./Models.js";

export function productView(product: Product, config: ShopConfig): ProductOutput {
  const description = plainText(typeof product.description === "string" ? product.description : "");
  const productUrl = typeof product.link === "string" ? product.link : config.baseUrl;
  const url = new URL(productUrl, config.baseUrl);
  url.searchParams.set("sc", config.salesChannel);
  const options: ProductOption[] = [];
  for (const sku of product.items) {
    for (const seller of sku.sellers ?? []) {
      const offer = seller.commertialOffer;
      if (!sku.itemId || !seller.sellerId || typeof offer?.Price !== "number" || !Number.isFinite(offer.Price) || offer.Price < 0) continue;
      options.push({
        productId: product.productId, sku: sku.itemId, seller: seller.sellerId,
        name: product.productName, skuName: sku.name ?? product.productName, url: url.toString(),
        priceCents: Math.round(offer.Price * 100), unitMultiplier: sku.unitMultiplier ?? 1,
        measurementUnit: sku.measurementUnit ?? "un", availableQuantity: offer.AvailableQuantity ?? 0,
        preparation: preparation(product.productName, description),
      });
    }
  }
  return { productId: product.productId, name: product.productName, description, url: url.toString(), options };
}
