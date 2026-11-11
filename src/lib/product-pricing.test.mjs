import { expect, test } from "bun:test";
import { getProductPriceDetails } from "./product-pricing.ts";

test("keeps the selling price of 9 and shows the higher original price of 15", () => {
  expect(getProductPriceDetails("9", "15")).toEqual({ offerPrice: 9, actualPrice: 15 });
});

test("does not show an original price equal to or below the selling price", () => {
  expect(getProductPriceDetails(9, 9).actualPrice).toBeNull();
  expect(getProductPriceDetails(9, 8).actualPrice).toBeNull();
});

test("handles omitted or invalid optional original prices", () => {
  for (const original of [undefined, null, "", "invalid"]) {
    expect(getProductPriceDetails(9, original)).toEqual({ offerPrice: 9, actualPrice: null });
  }
});