import { describe, expect, it } from "vitest";
import type { ListItem } from "../types";
import { checkInventory } from "./check_inventory";

function item(overrides: Partial<ListItem>): ListItem {
  return {
    name: "Item",
    qty: 1,
    category: "misc",
    owned: false,
    source_item_id: null,
    ...overrides,
  };
}

describe("checkInventory", () => {
  it("returns empty partitions for an empty list", () => {
    expect(checkInventory([])).toEqual({ needsSourcing: [], alreadyOwned: [] });
  });

  it("puts every item in alreadyOwned when all are owned:true", () => {
    const items = [item({ name: "Tongs", owned: true }), item({ name: "Charcoal", owned: true })];

    const result = checkInventory(items);

    expect(result.alreadyOwned).toEqual(items);
    expect(result.needsSourcing).toEqual([]);
  });

  it("puts every item in needsSourcing when none are owned", () => {
    const items = [item({ name: "Tongs", owned: false }), item({ name: "Charcoal", owned: false })];

    const result = checkInventory(items);

    expect(result.needsSourcing).toEqual(items);
    expect(result.alreadyOwned).toEqual([]);
  });

  it("partitions a mixed list correctly, preserving relative order in each partition", () => {
    const tongs = item({ name: "Tongs", owned: true });
    const charcoal = item({ name: "Charcoal", owned: false });
    const cooler = item({ name: "Cooler", owned: true });
    const patties = item({ name: "Patties", owned: false });

    const result = checkInventory([tongs, charcoal, cooler, patties]);

    expect(result.alreadyOwned).toEqual([tongs, cooler]);
    expect(result.needsSourcing).toEqual([charcoal, patties]);
  });

  it("treats owned:undefined as not-owned (needs sourcing)", () => {
    // Manually-added ListItem that never went through a picker that defaults `owned`.
    const manuallyAdded = { name: "Extra napkins", qty: 1, category: "misc" } as ListItem;

    const result = checkInventory([manuallyAdded]);

    expect(result.needsSourcing).toEqual([manuallyAdded]);
    expect(result.alreadyOwned).toEqual([]);
  });

  it("every input item appears in exactly one output partition", () => {
    const items = [
      item({ name: "A", owned: true }),
      item({ name: "B", owned: false }),
      { name: "C", qty: 1, category: "misc" } as ListItem, // owned undefined
    ];

    const result = checkInventory(items);

    expect(result.needsSourcing.length + result.alreadyOwned.length).toBe(items.length);
  });

  it("does not mutate the input array or its items", () => {
    const items = [item({ name: "Tongs", owned: true }), item({ name: "Charcoal", owned: false })];
    const snapshot = JSON.parse(JSON.stringify(items));

    checkInventory(items);

    expect(items).toEqual(snapshot);
  });
});
