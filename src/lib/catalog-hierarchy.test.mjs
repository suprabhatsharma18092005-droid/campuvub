import { expect, test } from "bun:test";
import { chooseBrand, chooseCategory, chooseSubcategory, productMatchesSelection } from "./catalog-hierarchy.ts";

const chips = { category_id: "snacks", subcategory_id: "chips", brand_id: "lays" };
const legacy = { category_id: "snacks" }; // product saved before subcategories existed

test("no selection shows every product", () => {
  expect(productMatchesSelection(chips, {})).toBe(true);
  expect(productMatchesSelection(legacy, {})).toBe(true);
});

test("a category shows all its products, including ones without a subcategory", () => {
  expect(productMatchesSelection(chips, { category: "snacks" })).toBe(true);
  expect(productMatchesSelection(legacy, { category: "snacks" })).toBe(true);
  expect(productMatchesSelection(chips, { category: "drinks" })).toBe(false);
});

test("a subcategory narrows to its products only", () => {
  expect(productMatchesSelection(chips, { category: "snacks", subcategory: "chips" })).toBe(true);
  expect(productMatchesSelection(legacy, { category: "snacks", subcategory: "chips" })).toBe(false);
});

test("a brand narrows to that brand only", () => {
  expect(productMatchesSelection(chips, { category: "snacks", subcategory: "chips", brand: "lays" })).toBe(true);
  expect(productMatchesSelection(chips, { category: "snacks", subcategory: "chips", brand: "bingo" })).toBe(false);
});

test("changing a higher level clears the levels below it", () => {
  const full = { category: "snacks", subcategory: "chips", brand: "lays" };
  expect(chooseCategory(full, "drinks")).toEqual({ category: "drinks" });
  expect(chooseCategory(full, undefined)).toEqual({});
  expect(chooseSubcategory(full, "nachos")).toEqual({ category: "snacks", subcategory: "nachos" });
  expect(chooseBrand(full, undefined)).toEqual({ category: "snacks", subcategory: "chips", brand: undefined });
});
