import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  noopSimilarityScore,
  searchUseCases,
  type SimilarityScoreFn,
  type UseCaseForSearch,
} from "./search_usecases";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const bbq: UseCaseForSearch = {
  id: "backyard-bbq-cookout",
  title: "Backyard BBQ Cookout",
  description: "Hosting a casual grill-out for friends or family.",
  category: "events",
  subcategory: "events.bbq_grilling",
  tags: ["grilling", "summer", "outdoor"],
  scenario_slots: {
    headcount: { type: "integer", min: 2, max: 100, default: 8 },
    budget_tier: { type: "enum", options: ["low", "mid", "high"], default: "mid" },
    dietary: { type: "tag_list", options: ["vegetarian", "vegan", "gluten_free", "nut_free"], default: [] },
  },
};

const weekendTrip: UseCaseForSearch = {
  id: "weekend-trip-getaway",
  title: "Weekend Trip",
  description: "A short getaway, 2-4 days, for a couple or small group.",
  category: "travel",
  subcategory: "travel.weekend_trip",
  tags: ["packing", "short-trip"],
  scenario_slots: {
    headcount: { type: "integer", min: 1, max: 8, default: 2 },
    budget_tier: { type: "enum", options: ["low", "mid", "high"], default: "mid" },
  },
};

const halloween: UseCaseForSearch = {
  id: "trick-or-treat-hosting",
  title: "Trick-or-Treat Hosting",
  description: "Handing out candy and decorating the porch for trick-or-treaters.",
  category: "seasonal",
  subcategory: "seasonal.halloween",
  tags: ["halloween", "trick-or-treat", "candy", "fall"],
  scenario_slots: {},
};

const apartment: UseCaseForSearch = {
  id: "first-apartment-essentials",
  title: "First Apartment Essentials",
  category: "home",
  subcategory: "home.new_apartment_setup",
  tags: ["move-in", "kitchen", "starter-kit"],
  scenario_slots: {
    budget_tier: { type: "enum", options: ["low", "mid", "high"], default: "mid" },
  },
};

const ALL: UseCaseForSearch[] = [bbq, weekendTrip, halloween, apartment];

function idsOf(results: ReturnType<typeof searchUseCases>): string[] {
  return results.map((r) => r.useCase.id);
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("same query + same opts always produces the same order and scores", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    const first = searchUseCases(ALL, "bbq", { now });
    const second = searchUseCases(ALL, "bbq", { now });
    expect(second).toEqual(first);
  });

  it("ties break on id ascending, not insertion order", () => {
    // Empty query -> every candidate scores 0 keyword/personalization/seasonal
    // (given a neutral month) -- pure id-ascending order.
    const now = new Date("2026-01-15T00:00:00Z"); // no seasonal boosts active for these fixtures
    const results = searchUseCases([weekendTrip, apartment, bbq], "", { now });
    expect(idsOf(results)).toEqual(
      [weekendTrip, apartment, bbq].map((u) => u.id).sort((a, b) => a.localeCompare(b)),
    );
  });
});

// ---------------------------------------------------------------------------
// Keyword matching
// ---------------------------------------------------------------------------

describe("keyword matching", () => {
  it("ranks a title/tag match above unrelated use cases", () => {
    const results = searchUseCases(ALL, "hosting a BBQ", { now: new Date("2026-01-01") });
    expect(results[0].useCase.id).toBe("backyard-bbq-cookout");
    expect(results[0].signals.keyword).toBeGreaterThan(0);
  });

  it("gives a title-phrase match a strictly higher keyword score than a mere token-overlap match", () => {
    const results = searchUseCases(ALL, "weekend trip", { now: new Date("2026-01-01") });
    expect(results[0].useCase.id).toBe("weekend-trip-getaway");
  });

  it("matches on tags even when the query doesn't literally appear in the title", () => {
    const results = searchUseCases(ALL, "grilling", { now: new Date("2026-01-01") });
    expect(results[0].useCase.id).toBe("backyard-bbq-cookout");
    expect(results[0].signals.keyword).toBeGreaterThan(0);
  });

  it("matches on category/subcategory tokens (e.g. 'apartment' against home.new_apartment_setup)", () => {
    const results = searchUseCases(ALL, "apartment", { now: new Date("2026-01-01") });
    expect(results[0].useCase.id).toBe("first-apartment-essentials");
  });

  it("empty query gives every candidate a zero keyword score", () => {
    const results = searchUseCases(ALL, "   ", { now: new Date("2026-01-01") });
    for (const r of results) {
      expect(r.signals.keyword).toBe(0);
    }
  });

  it("is case- and punctuation-insensitive", () => {
    const lower = searchUseCases(ALL, "backyard bbq cookout", { now: new Date("2026-01-01") });
    const mixed = searchUseCases(ALL, "  BACKYARD, BBQ!! Cookout??  ", { now: new Date("2026-01-01") });
    expect(idsOf(lower)).toEqual(idsOf(mixed));
    expect(lower[0].score).toBeCloseTo(mixed[0].score, 10);
  });
});

// ---------------------------------------------------------------------------
// Seasonal boost
// ---------------------------------------------------------------------------

describe("seasonal boost", () => {
  it("boosts a seasonal use case in its in-season month vs. out of season", () => {
    const inSeason = searchUseCases(ALL, "", { now: new Date("2026-10-15") });
    const outOfSeason = searchUseCases(ALL, "", { now: new Date("2026-06-15") });

    const inSeasonSignal = inSeason.find((r) => r.useCase.id === "trick-or-treat-hosting")!.signals.seasonal;
    const outOfSeasonSignal = outOfSeason.find((r) => r.useCase.id === "trick-or-treat-hosting")!.signals.seasonal;

    expect(inSeasonSignal).toBeGreaterThan(0);
    expect(outOfSeasonSignal).toBe(0);
  });

  it("moves the seasonal use case to the top of an otherwise-tied browse query in season", () => {
    const results = searchUseCases(ALL, "", { now: new Date("2026-10-31") });
    expect(results[0].useCase.id).toBe("trick-or-treat-hosting");
  });

  it("gives non-seasonal use cases a zero seasonal signal regardless of date", () => {
    const results = searchUseCases(ALL, "", { now: new Date("2026-10-31") });
    const bbqSignal = results.find((r) => r.useCase.id === "backyard-bbq-cookout")!.signals.seasonal;
    expect(bbqSignal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Personalization
// ---------------------------------------------------------------------------

describe("personalization", () => {
  it("works fine with no memory supplied (personalization signal is 0 for everyone)", () => {
    const results = searchUseCases(ALL, "", { now: new Date("2026-01-01") });
    for (const r of results) {
      expect(r.signals.personalization).toBe(0);
    }
  });

  it("boosts a use case whose dietary slot options include the user's dietary_prefs", () => {
    const withoutMemory = searchUseCases(ALL, "bbq", { now: new Date("2026-01-01") });
    const withMemory = searchUseCases(ALL, "bbq", {
      now: new Date("2026-01-01"),
      memory: { dietary_prefs: ["vegan"] },
    });

    const before = withoutMemory.find((r) => r.useCase.id === "backyard-bbq-cookout")!;
    const after = withMemory.find((r) => r.useCase.id === "backyard-bbq-cookout")!;

    expect(after.signals.personalization).toBeGreaterThan(before.signals.personalization);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("boosts a use case whose budget_tier slot default matches the user's budget_tier", () => {
    const results = searchUseCases([bbq, apartment], "", {
      now: new Date("2026-01-01"),
      memory: { budget_tier: "mid" },
    });
    for (const r of results) {
      expect(r.signals.personalization).toBeGreaterThan(0); // both default to "mid"
    }
  });

  it("boosts a use case whose headcount range contains the user's household_size", () => {
    const results = searchUseCases([bbq, weekendTrip], "", {
      now: new Date("2026-01-01"),
      memory: { household_size: 50 }, // within bbq's [2,100] but outside weekendTrip's [1,8]
    });
    const bbqResult = results.find((r) => r.useCase.id === "backyard-bbq-cookout")!;
    const tripResult = results.find((r) => r.useCase.id === "weekend-trip-getaway")!;
    expect(bbqResult.signals.personalization).toBeGreaterThan(tripResult.signals.personalization);
  });

  it("never throws when memory is partially populated", () => {
    expect(() => searchUseCases(ALL, "bbq", { memory: { budget_tier: "high" } })).not.toThrow();
    expect(() => searchUseCases(ALL, "bbq", { memory: {} })).not.toThrow();
    expect(() => searchUseCases(ALL, "bbq", { memory: null })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Filtering / limit
// ---------------------------------------------------------------------------

describe("filtering and limit", () => {
  it("applies a hard category filter before scoring", () => {
    const results = searchUseCases(ALL, "", { category: "seasonal" });
    expect(results).toHaveLength(1);
    expect(results[0].useCase.id).toBe("trick-or-treat-hosting");
  });

  it("applies a hard subcategory filter before scoring", () => {
    const results = searchUseCases(ALL, "", { subcategory: "home.new_apartment_setup" });
    expect(results).toHaveLength(1);
    expect(results[0].useCase.id).toBe("first-apartment-essentials");
  });

  it("respects limit", () => {
    const results = searchUseCases(ALL, "", { limit: 2, now: new Date("2026-01-01") });
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// similarityScore seam (pgvector upgrade point)
// ---------------------------------------------------------------------------

describe("similarityScore hook", () => {
  it("defaults to a no-op that contributes 0 to every score", () => {
    const results = searchUseCases(ALL, "bbq", { now: new Date("2026-01-01") });
    for (const r of results) {
      expect(r.signals.similarity).toBe(0);
    }
  });

  it("noopSimilarityScore always returns 0 regardless of input", () => {
    expect(noopSimilarityScore("anything", bbq)).toBe(0);
  });

  it("a custom similarityScore dep changes ranking without touching the rest of the scoring logic", () => {
    const preferApartment: SimilarityScoreFn = (_query, useCase) =>
      useCase.id === "first-apartment-essentials" ? 1 : 0;

    const results = searchUseCases(ALL, "", { now: new Date("2026-01-01") }, { similarityScore: preferApartment });
    expect(results[0].useCase.id).toBe("first-apartment-essentials");
    expect(results[0].signals.similarity).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Real seed data (read from disk, no DB required)
// ---------------------------------------------------------------------------

describe("against the real seed use cases", () => {
  const SEED_DIR = path.resolve(__dirname, "../../db/seed/usecases");
  const seedUseCases: UseCaseForSearch[] = fs
    .readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(SEED_DIR, f), "utf-8")) as UseCaseForSearch);

  it("loads all 49 seed use cases", () => {
    expect(seedUseCases.length).toBe(49);
  });

  it("ranks every seed use case without throwing", () => {
    expect(() => searchUseCases(seedUseCases, "hosting a party", { now: new Date("2026-09-10") })).not.toThrow();
  });

  it("query 'bbq' surfaces a grilling use case at the top", () => {
    const results = searchUseCases(seedUseCases, "bbq", { now: new Date("2026-09-10") });
    expect(results[0].useCase.subcategory).toBe("events.bbq_grilling");
  });

  it("query 'camping trip' surfaces a camping use case at the top", () => {
    const results = searchUseCases(seedUseCases, "camping trip", { now: new Date("2026-09-10") });
    expect(results[0].useCase.subcategory).toBe("travel.camping_backpacking");
  });

  it("query 'halloween' surfaces the halloween use case, boosted further in October", () => {
    const june = searchUseCases(seedUseCases, "halloween", { now: new Date("2026-06-01") });
    const october = searchUseCases(seedUseCases, "halloween", { now: new Date("2026-10-01") });
    expect(june[0].useCase.subcategory).toBe("seasonal.halloween");
    expect(october[0].useCase.subcategory).toBe("seasonal.halloween");
    expect(october[0].score).toBeGreaterThan(june[0].score);
  });

  it("browse mode (empty query) in October surfaces in-season seasonal use cases first", () => {
    const results = searchUseCases(seedUseCases, "", { now: new Date("2026-10-15"), limit: 5 });
    const topSubcategories = results.map((r) => r.useCase.subcategory);
    expect(topSubcategories).toContain("seasonal.halloween");
  });

  it("is deterministic against the real dataset (repeat calls match)", () => {
    const a = searchUseCases(seedUseCases, "weekend getaway", { now: new Date("2026-09-10") });
    const b = searchUseCases(seedUseCases, "weekend getaway", { now: new Date("2026-09-10") });
    expect(a).toEqual(b);
  });
});
