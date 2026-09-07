import { describe, it, expect } from "vitest";
import { normalizeTitle, jaccardSimilarity, titleTokens, findNearDuplicates } from "../lib/dedup.js";

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("Backyard BBQ Cookout!")).toBe("backyard bbq cookout");
  });
});

describe("jaccardSimilarity", () => {
  it("is 1 for identical token sets", () => {
    const a = titleTokens("Backyard BBQ Cookout");
    const b = titleTokens("Backyard BBQ Cookout");
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("is 0 for disjoint token sets", () => {
    const a = titleTokens("Backyard BBQ Cookout");
    const b = titleTokens("Ski Trip Packing List");
    expect(jaccardSimilarity(a, b)).toBe(0);
  });
});

describe("findNearDuplicates", () => {
  it("flags near-identical titles (stopword/punctuation variants)", () => {
    const flags = findNearDuplicates([
      { id: "a", title: "Backyard BBQ Cookout" },
      { id: "b", title: "The Backyard BBQ Cookout!" },
      { id: "c", title: "Weekend Trip Getaway" },
    ]);
    expect(flags.length).toBe(1);
    expect([flags[0].a.id, flags[0].b.id].sort()).toEqual(["a", "b"]);
  });

  it("does not flag genuinely distinct titles", () => {
    const flags = findNearDuplicates([
      { id: "a", title: "Backyard BBQ Cookout" },
      { id: "b", title: "First Apartment Essentials" },
      { id: "c", title: "Weekend Ski Trip" },
    ]);
    expect(flags.length).toBe(0);
  });

  it("respects a custom threshold", () => {
    const candidates = [
      { id: "a", title: "Kids Birthday Party at Home" },
      { id: "b", title: "Birthday Party for Adults at Home" },
    ];
    const strict = findNearDuplicates(candidates, 0.95);
    const loose = findNearDuplicates(candidates, 0.3);
    expect(strict.length).toBe(0);
    expect(loose.length).toBe(1);
  });
});
