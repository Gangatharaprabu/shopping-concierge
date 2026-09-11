import { describe, expect, it } from "vitest";
import bbq from "../../db/seed/usecases/backyard-bbq-cookout.json";
import weekendTrip from "../../db/seed/usecases/weekend-trip-getaway.json";
import type { ListItem } from "../types";
import { adjustScenario, UnknownSlotError } from "./adjust_scenario";
import { generateList, type UseCaseForList } from "./generate_list";

const bbqUseCase = bbq as unknown as UseCaseForList;
const tripUseCase = weekendTrip as unknown as UseCaseForList;

function itemBySourceId(items: ListItem[], sourceItemId: string) {
  const found = items.find((i) => i.source_item_id === sourceItemId);
  if (!found) throw new Error(`expected item with source_item_id "${sourceItemId}"`);
  return found;
}

describe("adjustScenario -- never regenerates the whole list (CLAUDE.md locked decision #2)", () => {
  it("case 1: an item that depends on the changed slot and STAYS present -- qty recomputed, owned preserved", () => {
    const baseItems = generateList(bbqUseCase, {});
    const withOwnedCharcoal = baseItems.map((item) =>
      item.source_item_id === "charcoal_briquettes" ? { ...item, owned: true } : item,
    );

    const result = adjustScenario(bbqUseCase, {}, withOwnedCharcoal, "headcount", 25);

    const charcoal = itemBySourceId(result.items, "charcoal_briquettes");
    expect(charcoal.qty).toBe(8); // 0.3 * 25 = 7.5 -> round up -> 8
    expect(charcoal.owned).toBe(true); // preserved, not silently reset to false
  });

  it("case 2: an item that depends on the changed slot and was ABSENT, now becomes present -- added as a new ListItem", () => {
    const baseItems = generateList(bbqUseCase, {}); // dietary: [] -> no veggie patties yet
    expect(baseItems.find((i) => i.source_item_id === "veggie_burger_patties")).toBeUndefined();

    const result = adjustScenario(bbqUseCase, {}, baseItems, "dietary", ["vegan"]);

    const veggie = itemBySourceId(result.items, "veggie_burger_patties");
    expect(veggie.qty).toBe(8); // 1 * headcount(8)
    expect(veggie.owned).toBe(false); // no prior user state to preserve -- it didn't exist yet
  });

  it("case 3: an item that depends on the changed slot and was PRESENT, now becomes absent -- removed", () => {
    const baseItems = generateList(bbqUseCase, {}); // dietary: [] -> beef patties present
    const withOwnedBeef = baseItems.map((item) =>
      item.source_item_id === "beef_burger_patties" ? { ...item, owned: true } : item,
    );
    expect(itemBySourceId(withOwnedBeef, "beef_burger_patties")).toBeDefined();

    const result = adjustScenario(bbqUseCase, {}, withOwnedBeef, "dietary", ["vegan"]);

    // Removed entirely -- even though it had been marked owned. Documented,
    // deliberate consequence of the item no longer being relevant (see
    // adjust_scenario.ts's doc comment) -- not the "discard edits" bug,
    // which is about *unrelated* items losing edits on a full regenerate.
    expect(result.items.find((i) => i.source_item_id === "beef_burger_patties")).toBeUndefined();
  });

  it("case 4: an item whose depends_on_slots does NOT include the changed slot is byte-for-byte untouched", () => {
    const baseItems = generateList(bbqUseCase, {});
    const tongsBefore = itemBySourceId(baseItems, "grill_tongs");

    const result = adjustScenario(bbqUseCase, {}, baseItems, "headcount", 50);

    const tongsAfter = itemBySourceId(result.items, "grill_tongs");
    expect(tongsAfter).toBe(tongsBefore); // same object reference, not just deep-equal
    expect(tongsAfter).toEqual(tongsBefore); // and, explicitly, deep-equal too
  });

  it("case 4b: an item depending on OTHER slots (not the changed one) is untouched even with multi-slot presence_rules", () => {
    // string_lights depends_on_slots: [time_of_day, setting]. Patching
    // headcount must not touch it at all, present or not.
    const baseItems = generateList(bbqUseCase, { time_of_day: "night", setting: "outdoor" });
    const lightsBefore = itemBySourceId(baseItems, "string_lights");

    const result = adjustScenario(bbqUseCase, { time_of_day: "night", setting: "outdoor" }, baseItems, "headcount", 40);

    expect(itemBySourceId(result.items, "string_lights")).toBe(lightsBefore);
  });

  it("case 5: a manually-added item (source_item_id: null) is never touched by adjust_scenario", () => {
    const baseItems = generateList(bbqUseCase, {});
    const manualItem: ListItem = {
      name: "Extra napkins",
      qty: 3,
      category: "misc",
      owned: false,
      source_item_id: null,
    };
    const itemsWithManual = [...baseItems, manualItem];

    // Patch headcount, which affects several template items, to make sure
    // the manual item survives regardless.
    const result = adjustScenario(bbqUseCase, {}, itemsWithManual, "headcount", 30);

    const manualAfter = result.items.find((i) => i.source_item_id == null);
    expect(manualAfter).toBe(manualItem); // same reference
    expect(manualAfter).toEqual(manualItem);
  });

  it("case 4/5 combined regression: patching one slot leaves EVERY unrelated/manual item deep-equal to its original, item-by-item", () => {
    const baseItems = generateList(bbqUseCase, { dietary: ["vegan"] }); // veggie patties present, beef absent
    const manualItem: ListItem = { name: "Extra napkins", qty: 3, category: "misc", owned: false, source_item_id: null };
    const original = [...baseItems, manualItem];

    // headcount only affects charcoal_briquettes, beef/veggie patties, folding_tables.
    const affectedIds = new Set(["charcoal_briquettes", "beef_burger_patties", "veggie_burger_patties", "folding_tables"]);

    const result = adjustScenario(bbqUseCase, { dietary: ["vegan"] }, original, "headcount", 12);

    for (const before of original) {
      if (before.source_item_id != null && affectedIds.has(before.source_item_id)) continue;
      const after = result.items.find((i) => i.source_item_id === before.source_item_id && i.name === before.name);
      expect(after).toEqual(before);
    }
  });
});

describe("adjustScenario -- additional correctness checks", () => {
  it("recomputes qty against the FULL updated slot map, not just the changed slot (two-slot presence_rules)", () => {
    // Start with default day/outdoor (string_lights absent). Patch setting
    // to outdoor (no-op change) -- still must stay absent since time_of_day
    // (unchanged, "day") is still failing its own rule.
    const baseItems = generateList(bbqUseCase, {});
    const result = adjustScenario(bbqUseCase, {}, baseItems, "setting", "outdoor");
    expect(result.items.find((i) => i.source_item_id === "string_lights")).toBeUndefined();

    // Now patch time_of_day to night while setting (from currentScenarioSlots) is outdoor -- should appear.
    const result2 = adjustScenario(bbqUseCase, { setting: "outdoor" }, baseItems, "time_of_day", "night");
    expect(itemBySourceId(result2.items, "string_lights")).toBeDefined();
  });

  it("returns a fully-resolved slots map with the patch applied and other slots defaulted", () => {
    const result = adjustScenario(bbqUseCase, {}, generateList(bbqUseCase, {}), "headcount", 40);
    expect(result.slots).toEqual({
      time_of_day: "day",
      headcount: 40,
      setting: "outdoor",
      budget_tier: "mid",
      dietary: [],
    });
  });

  it("throws UnknownSlotError for a slot_id the UseCase doesn't declare, and touches nothing", () => {
    const baseItems = generateList(bbqUseCase, {});
    expect(() => adjustScenario(bbqUseCase, {}, baseItems, "not_a_real_slot", "x")).toThrow(UnknownSlotError);
  });

  it("a slot with zero dependent items (budget_tier) patches the slot value but leaves every item byte-for-byte untouched", () => {
    const baseItems = generateList(bbqUseCase, {});
    const result = adjustScenario(bbqUseCase, {}, baseItems, "budget_tier", "high");

    expect(result.slots.budget_tier).toBe("high");
    expect(result.items).toEqual(baseItems);
    result.items.forEach((item, i) => expect(item).toBe(baseItems[i]));
  });

  it("handles an item scaled by TWO numeric slots (weekend-trip granola bars), recomputing only on the changed one", () => {
    const baseItems = generateList(tripUseCase, {}); // headcount 2, duration 3 days -> granola 7
    const phoneChargerBefore = itemBySourceId(baseItems, "phone_charger");

    const result = adjustScenario(tripUseCase, {}, baseItems, "duration", { unit: "days", count: 7 });

    expect(itemBySourceId(result.items, "granola_bars").qty).toBe(11); // 2*2 + 1*7
    expect(itemBySourceId(result.items, "toothbrush").qty).toBe(2); // unaffected -- doesn't depend on duration
    expect(itemBySourceId(result.items, "phone_charger")).toBe(phoneChargerBefore); // static, untouched
  });
});
