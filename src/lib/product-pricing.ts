/** Keep the selling price unchanged; show an original price only when higher. */
export function getProductPriceDetails(
  price: number | string,
  actualPrice?: number | string | null,
): { offerPrice: number; actualPrice: number | null } {
  const offerPrice = Number(price);
  const original = actualPrice == null ? NaN : Number(actualPrice);
  return {
    offerPrice,
    actualPrice: Number.isFinite(original) && original > offerPrice ? original : null,
  };
}