import { describe, it, expect } from "vitest";
import { validateUseCase } from "../lib/schema-validate.js";
import type { UseCase } from "../lib/types.js";

const validUseCase: UseCase = {
  id: "backyard-bbq-cookout",
  title: "Backyard BBQ Cookout",
  description: "Hosting a casual grill-out for friends or family.",
  category: "events",
  subcategory: "events.bbq_grilling",
  tags: ["grilling", "summer", "outdoor"],
  scenario_slots: {
    time_of_day: { type: "enum", label: "Time of day", options: ["day", "night"], default: "day" },
    headcount: { type: "integer", label: "Guests", min: 2, max: 100, default: 8, unit: "guests" },
    dietary: { type: "tag_list", label: "Dietary needs", options: ["vegan"], default: [] },
  },
  template_list: [
    { item_id: "grill_tongs", name: "Grill tongs", category: "gear", qty: { base: 1, unit: "pair" }, depends_on_slots: [] },
    {
      item_id: "charcoal",
      name: "Charcoal briquettes",
      category: "fuel",
      qty: { base: 2.4, unit: "kg" },
      depends_on_slots: ["headcount"],
      scaling_rules: [{ slot_id: "headcount", method: "linear", per_unit: 0.3, round: "up", minimum: 1 }],
    },
  ],
};

describe("validateUseCase", () => {
  it("accepts a well-formed UseCase matching the schema and lint rules", () => {
    const result = validateUseCase(validUseCase);
    expect(result.valid).toBe(true);
    expect(result.schemaErrors).toEqual([]);
    expect(result.lintErrors).toEqual([]);
  });

  it("rejects an id that doesn't match the slug pattern", () => {
    const result = validateUseCase({ ...validUseCase, id: "Not A Slug" });
    expect(result.valid).toBe(false);
    expect(result.schemaErrors.some((e) => e.includes("pattern"))).toBe(true);
  });

  it("rejects an unknown category enum value", () => {
    const result = validateUseCase({ ...validUseCase, category: "sports" });
    expect(result.valid).toBe(false);
  });

  it("lints: category must namespace-prefix subcategory", () => {
    const result = validateUseCase({ ...validUseCase, category: "travel" });
    expect(result.valid).toBe(false);
    expect(result.lintErrors.some((e) => e.includes("is not namespaced under category"))).toBe(true);
  });

  it("lints: presence_rules slot_id must be declared in depends_on_slots", () => {
    const bad: UseCase = {
      ...validUseCase,
      template_list: [
        {
          item_id: "veggie_patty",
          name: "Veggie patty",
          category: "food",
          qty: { base: 0, unit: "count" },
          depends_on_slots: [],
          presence_rules: [{ slot_id: "dietary", condition: "includes", value: "vegan" }],
        },
      ],
    };
    const result = validateUseCase(bad);
    expect(result.valid).toBe(false);
    expect(result.lintErrors.some((e) => e.includes("missing from depends_on_slots"))).toBe(true);
  });

  it("lints: scaling_rules slot_id must be declared in depends_on_slots", () => {
    const bad: UseCase = {
      ...validUseCase,
      template_list: [
        {
          item_id: "snacks",
          name: "Snacks",
          category: "food",
          qty: { base: 4, unit: "count" },
          depends_on_slots: [],
          scaling_rules: [{ slot_id: "headcount", method: "linear", per_unit: 1 }],
        },
      ],
    };
    const result = validateUseCase(bad);
    expect(result.valid).toBe(false);
    expect(result.lintErrors.some((e) => e.includes("missing from depends_on_slots"))).toBe(true);
  });

  it("lints: enum slot default must be one of its own options", () => {
    const bad: UseCase = {
      ...validUseCase,
      scenario_slots: {
        ...validUseCase.scenario_slots,
        time_of_day: { type: "enum", label: "Time of day", options: ["day", "night"], default: "dusk" },
      },
    };
    const result = validateUseCase(bad);
    expect(result.valid).toBe(false);
    expect(result.lintErrors.some((e) => e.includes('not one of options'))).toBe(true);
  });

  it("lints: integer slot default must be within min/max", () => {
    const bad: UseCase = {
      ...validUseCase,
      scenario_slots: {
        ...validUseCase.scenario_slots,
        headcount: { type: "integer", label: "Guests", min: 2, max: 10, default: 50, unit: "guests" },
      },
    };
    const result = validateUseCase(bad);
    expect(result.valid).toBe(false);
    expect(result.lintErrors.some((e) => e.includes("outside [min=2, max=10]"))).toBe(true);
  });

  it("lints: item_id must be unique within one UseCase's template_list", () => {
    const bad: UseCase = {
      ...validUseCase,
      template_list: [
        { item_id: "same", name: "A", category: "gear", qty: { base: 1, unit: "count" }, depends_on_slots: [] },
        { item_id: "same", name: "B", category: "gear", qty: { base: 1, unit: "count" }, depends_on_slots: [] },
      ],
    };
    const result = validateUseCase(bad);
    expect(result.valid).toBe(false);
    expect(result.lintErrors.some((e) => e.includes("must be unique"))).toBe(true);
  });

  it("lints: depends_on_slots must reference a slot declared in scenario_slots", () => {
    const bad: UseCase = {
      ...validUseCase,
      template_list: [
        {
          item_id: "cooler",
          name: "Cooler",
          category: "gear",
          qty: { base: 1, unit: "count" },
          depends_on_slots: ["setting"],
        },
      ],
    };
    const result = validateUseCase(bad);
    expect(result.valid).toBe(false);
    expect(result.lintErrors.some((e) => e.includes("not declared in scenario_slots"))).toBe(true);
  });
});
