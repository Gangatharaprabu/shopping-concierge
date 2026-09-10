import { describe, expect, it } from "vitest";
import bbq from "../../db/seed/usecases/backyard-bbq-cookout.json";
import weekendTrip from "../../db/seed/usecases/weekend-trip-getaway.json";
import type { ListItem } from "../types";
import {
  computeQty,
  evaluatePresence,
  generateList,
  resolveScenarioSlots,
  type UseCaseForList,
} from "./generate_list";

const bbqUseCase = bbq as unknown as UseCaseForList;
const tripUseCase = weekendTrip as unknown as UseCaseForList;

function itemByName(items: ListItem[], name: string) {
  const found = items.find((i) => i.name === name);
  if (!found) throw new Error(`expected item "${name}" in ${JSON.stringify(items.map((i) => i.name))}`);
  return found;
}

describe("resolveScenarioSlots", () => {
  it("fills in every slot's default when none are provided", () => {
    const resolved = resolveScenarioSlots(bbqUseCase, {});
    expect(resolved).toEqual({
      time_of_day: "day",
      headcount: 8,
      setting: "outdoor",
      budget_tier: "mid",
      dietary: [],
    });
  });

  it("overrides only the provided slots, leaving the rest at default", () => {
    const resolved = resolveScenarioSlots(bbqUseCase, { headcount: 25 });
    expect(resolved.headcount).toBe(25);
    expect(resolved.time_of_day).toBe("day");
    expect(resolved.setting).toBe("outdoor");
  });
});

describe("generateList -- backyard-bbq-cookout (real seed fixture)", () => {
  it("at all-default slots, produces the documented base quantities and presence", () => {
    const items = generateList(bbqUseCase, {});

    expect(itemByName(items, "Grill tongs").qty).toBe(1);
    // 0.3 * 8 = 2.4, round "up" (Math.ceil) -> 3. Note this is a documented
    // divergence from qty.base (2.4, the hand-authored reference value) --
    // per this tool's brief, qty is always computed from scaling_rules when
    // present, qty.base is only a fallback for items with none.
    expect(itemByName(items, "Charcoal briquettes").qty).toBe(3);
    expect(itemByName(items, "Beef burger patties").qty).toBe(8); // 1 * 8
    expect(itemByName(items, "Folding tables").qty).toBe(1); // step tier: headcount 8 <= 8

    // dietary default [] -> vegan-only items absent
    expect(items.find((i) => i.name === "Veggie burger patties")).toBeUndefined();

    // time_of_day default "day" -> string lights (night-only) absent
    expect(items.find((i) => i.name === "Outdoor string lights")).toBeUndefined();

    // every generated item starts not-owned and traceable to its template item
    for (const item of items) {
      expect(item.owned).toBe(false);
      expect(item.source_item_id).toBeTruthy();
    }
  });

  it("presence_rules gated by a single tag_list slot: vegan dietary flips beef/veggie patties", () => {
    const items = generateList(bbqUseCase, { dietary: ["vegan"] });

    expect(items.find((i) => i.name === "Beef burger patties")).toBeUndefined();
    expect(itemByName(items, "Veggie burger patties").qty).toBe(8);
  });

  it("presence_rules gated by TWO slots at once (AND-combined): string lights only for outdoor + night", () => {
    expect(generateList(bbqUseCase, { time_of_day: "night", setting: "outdoor" }).find((i) => i.name === "Outdoor string lights")).toBeDefined();
    expect(generateList(bbqUseCase, { time_of_day: "night", setting: "indoor" }).find((i) => i.name === "Outdoor string lights")).toBeUndefined();
    expect(generateList(bbqUseCase, { time_of_day: "day", setting: "outdoor" }).find((i) => i.name === "Outdoor string lights")).toBeUndefined();
  });

  it("step scaling_rule produces the documented tier jumps for folding tables", () => {
    expect(itemByName(generateList(bbqUseCase, { headcount: 8 }), "Folding tables").qty).toBe(1);
    expect(itemByName(generateList(bbqUseCase, { headcount: 20 }), "Folding tables").qty).toBe(2);
    expect(itemByName(generateList(bbqUseCase, { headcount: 21 }), "Folding tables").qty).toBe(3);
  });

  it("linear scaling_rule with 'up' rounding + minimum applies for charcoal at higher headcount", () => {
    // 0.3 * 25 = 7.5 -> round up -> 8, floor(minimum 1) is a no-op here.
    expect(itemByName(generateList(bbqUseCase, { headcount: 25 }), "Charcoal briquettes").qty).toBe(8);
  });

  it("budget_tier has zero dependent items -- patching it changes nothing in the generated list", () => {
    const low = generateList(bbqUseCase, { budget_tier: "low" });
    const high = generateList(bbqUseCase, { budget_tier: "high" });
    expect(low.map((i) => ({ name: i.name, qty: i.qty }))).toEqual(high.map((i) => ({ name: i.name, qty: i.qty })));
  });
});

describe("generateList -- weekend-trip-getaway (real seed fixture, additive two-slot scaling)", () => {
  it("matches the schema README's worked 'base' math at default slots (headcount=2, duration=3 days)", () => {
    const items = generateList(tripUseCase, {});
    expect(itemByName(items, "Granola bars").qty).toBe(7); // 2*2 + 1*3
    expect(itemByName(items, "Toothbrush").qty).toBe(2); // 1 * 2
    expect(itemByName(items, "Phone charger").qty).toBe(1); // static
  });

  it("patching duration recomputes granola bars additively (2 bars/traveler + 1/day, not multiplicative)", () => {
    const items = generateList(tripUseCase, { duration: { unit: "days", count: 7 } });
    expect(itemByName(items, "Granola bars").qty).toBe(11); // 2*2 + 1*7
    expect(itemByName(items, "Toothbrush").qty).toBe(2); // unaffected by duration
  });
});

describe("evaluatePresence / computeQty -- direct unit coverage of the shared evaluator", () => {
  it("an item with no presence_rules is always present", () => {
    const grillTongs = bbqUseCase.template_list.find((i) => i.item_id === "grill_tongs")!;
    expect(evaluatePresence(grillTongs, resolveScenarioSlots(bbqUseCase, {}))).toBe(true);
  });

  it("an item with no scaling_rules always returns qty.base", () => {
    const grillTongs = bbqUseCase.template_list.find((i) => i.item_id === "grill_tongs")!;
    expect(computeQty(grillTongs, resolveScenarioSlots(bbqUseCase, { headcount: 99 }))).toBe(1);
  });
});
