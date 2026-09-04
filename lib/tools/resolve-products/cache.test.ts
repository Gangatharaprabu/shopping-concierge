import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CACHE_TTL_MS, InMemoryProductCache, normalizeItemName } from "./cache";
import type { ResolveProductsOutput } from "./types";

describe("normalizeItemName", () => {
  it("lowercases, trims, and collapses internal whitespace", () => {
    expect(normalizeItemName("  Charcoal   Briquettes  5kg ")).toBe("charcoal briquettes 5kg");
  });

  it("treats differently-cased/whitespaced input as the same key", () => {
    expect(normalizeItemName("Charcoal Briquettes 5kg")).toBe(
      normalizeItemName("charcoal   briquettes   5kg"),
    );
  });
});

describe("InMemoryProductCache", () => {
  const sample: ResolveProductsOutput = {
    results: [
      {
        product_name: "Test Product",
        price: 9.99,
        currency: "USD",
        retailer: "Amazon",
        url: "https://amazon.com/dp/1",
        matched_confidence: 0.8,
      },
    ],
    reason: null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for a key that was never set", async () => {
    const cache = new InMemoryProductCache();
    expect(await cache.get("nope")).toBeUndefined();
  });

  it("returns a cached value before it expires", async () => {
    const cache = new InMemoryProductCache();
    await cache.set("charcoal briquettes 5kg", sample);
    vi.advanceTimersByTime(DEFAULT_CACHE_TTL_MS - 1000);
    expect(await cache.get("charcoal briquettes 5kg")).toEqual(sample);
  });

  it("expires entries after the TTL", async () => {
    const cache = new InMemoryProductCache();
    await cache.set("charcoal briquettes 5kg", sample);
    vi.advanceTimersByTime(DEFAULT_CACHE_TTL_MS + 1);
    expect(await cache.get("charcoal briquettes 5kg")).toBeUndefined();
  });

  it("respects a custom TTL", async () => {
    const cache = new InMemoryProductCache(1000);
    await cache.set("k", sample);
    vi.advanceTimersByTime(1001);
    expect(await cache.get("k")).toBeUndefined();
  });
});
