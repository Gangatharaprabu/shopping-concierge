import { describe, expect, it } from "vitest";
import { extractPrice, retailerFromUrl, retailerKeyFromUrl } from "./price-extraction";

describe("extractPrice", () => {
  it("extracts a USD price from a $ symbol", () => {
    expect(extractPrice("Kingsford Charcoal Briquettes 5kg - $12.99 at checkout")).toEqual({
      price: 12.99,
      currency: "USD",
    });
  });

  it("extracts a price with thousands separators", () => {
    expect(extractPrice("Premium Grill Set - $1,249.00")).toEqual({
      price: 1249,
      currency: "USD",
    });
  });

  it("extracts a GBP price from the £ symbol", () => {
    expect(extractPrice("Weber Charcoal 5kg bag, £14.50, in stock")).toEqual({
      price: 14.5,
      currency: "GBP",
    });
  });

  it("extracts a EUR price from the € symbol", () => {
    expect(extractPrice("Sac de charbon 5kg - €9,00 disponible")).toBeTruthy();
  });

  it("prefers an explicit 3-letter currency code over a same-text symbol elsewhere", () => {
    expect(extractPrice("Price: USD 25.00 (was $30 - discount applied)")).toEqual({
      price: 25,
      currency: "USD",
    });
  });

  it("returns null for plain numbers with no currency signal", () => {
    expect(extractPrice("5kg bag, pack of 20, model 1234")).toBeNull();
  });

  it("returns null for a percentage-off snippet with no currency amount", () => {
    expect(extractPrice("50% off this week only, limited stock")).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(extractPrice("")).toBeNull();
  });

  it("returns null for an out-of-range absurd number even with a currency symbol", () => {
    expect(extractPrice("Serial number $999999999")).toBeNull();
  });
});

describe("retailerFromUrl / retailerKeyFromUrl", () => {
  it("resolves a known retailer to its display name", () => {
    expect(retailerFromUrl("https://www.amazon.com/dp/B000123")).toBe("Amazon");
    expect(retailerFromUrl("https://www.homedepot.com/p/item")).toBe("Home Depot");
  });

  it("falls back to a capitalized domain label for unknown retailers", () => {
    expect(retailerFromUrl("https://shop.somegrillstore.co.uk/product/1")).toBe("Somegrillstore");
  });

  it("returns null for an unparseable url", () => {
    expect(retailerFromUrl("not-a-url")).toBeNull();
    expect(retailerKeyFromUrl("not-a-url")).toBeNull();
  });

  it("keys www.amazon.com and amazon.com as the same retailer", () => {
    expect(retailerKeyFromUrl("https://www.amazon.com/dp/1")).toBe(
      retailerKeyFromUrl("https://amazon.com/dp/2"),
    );
  });
});
