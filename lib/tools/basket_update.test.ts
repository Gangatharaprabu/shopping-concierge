import { describe, expect, it, vi } from "vitest";
import type { BasketItem, BasketRow, ListItem } from "../types";
import { BasketStatusLockedError, basketUpdate, type BasketPersistenceDeps } from "./basket_update";

function listItem(overrides: Partial<ListItem>): ListItem {
  return {
    name: "Item",
    qty: 1,
    category: "misc",
    owned: false,
    source_item_id: null,
    ...overrides,
  };
}

function basketRow(overrides: Partial<BasketRow> = {}): BasketRow {
  return {
    id: "basket-1",
    user_id: "user-1",
    items: [],
    status: "draft",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** In-memory fake standing in for the real Supabase-backed persistence. */
function fakePersistence(initial: BasketRow): BasketPersistenceDeps {
  let state: BasketRow | null = initial;
  return {
    async getBasket(basketId: string) {
      return state && state.id === basketId ? state : null;
    },
    async saveBasketItems(basketId: string, items: BasketItem[]) {
      if (!state || state.id !== basketId) {
        throw new Error("basket not found");
      }
      state = { ...state, items };
      return state;
    },
  };
}

describe("basketUpdate", () => {
  describe("status lock", () => {
    it("throws BasketStatusLockedError when patch.status is set to something other than 'draft', without touching persistence", async () => {
      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn(),
        saveBasketItems: vi.fn(),
      };

      await expect(
        basketUpdate("basket-1", { items: [], status: "ordered" }, { persistence }),
      ).rejects.toThrow(BasketStatusLockedError);

      expect(persistence.getBasket).not.toHaveBeenCalled();
      expect(persistence.saveBasketItems).not.toHaveBeenCalled();
    });

    it("allows patch.status === 'draft' (no-op value) through", async () => {
      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn(),
        saveBasketItems: vi.fn().mockResolvedValue(basketRow()),
      };

      await expect(
        basketUpdate("basket-1", { items: [], status: "draft" }, { persistence }),
      ).resolves.toBeDefined();
    });
  });

  describe("input validation", () => {
    it("throws if neither listItems nor items is provided", async () => {
      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn(),
        saveBasketItems: vi.fn(),
      };

      await expect(basketUpdate("basket-1", {}, { persistence })).rejects.toThrow(
        /listItems.*items|items.*listItems/,
      );
    });

    it("throws a clear error when deps is omitted", async () => {
      await expect(basketUpdate("basket-1", { items: [] })).rejects.toThrow(/deps\.persistence/);
    });
  });

  describe("mark-owned -> basket CTA flow (the combined check_inventory + basket_update path)", () => {
    it("adds only the needs-sourcing subset of a ShoppingList's items to the basket", async () => {
      const tongs = listItem({ name: "Grill tongs", owned: true, source_item_id: "grill_tongs" });
      const charcoal = listItem({ name: "Charcoal", owned: false, source_item_id: "charcoal" });
      const cooler = listItem({ name: "Cooler", owned: true, source_item_id: "cooler" });
      const patties = listItem({ name: "Patties", qty: 8, owned: false, source_item_id: "patties" });

      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn(),
        saveBasketItems: vi.fn(async (basketId: string, items: BasketItem[]) =>
          basketRow({ id: basketId, items }),
        ),
      };

      const result = await basketUpdate(
        "basket-1",
        { listItems: [tongs, charcoal, cooler, patties] },
        { persistence },
      );

      expect(persistence.saveBasketItems).toHaveBeenCalledTimes(1);
      const [, savedItems] = (persistence.saveBasketItems as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(savedItems.map((i: BasketItem) => i.name)).toEqual(["Charcoal", "Patties"]);

      expect(result.addedFromList.map((i) => i.name)).toEqual(["Charcoal", "Patties"]);
      expect(result.skippedOwned.map((i) => i.name)).toEqual(["Grill tongs", "Cooler"]);
      expect(result.basket.items.map((i) => i.name)).toEqual(["Charcoal", "Patties"]);
    });

    it("re-running with more items marked owned shrinks the basket (replace mode is the default)", async () => {
      const charcoal = listItem({ name: "Charcoal", owned: false, source_item_id: "charcoal" });
      const patties = listItem({ name: "Patties", owned: false, source_item_id: "patties" });

      let saved: BasketItem[] = [];
      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn(),
        saveBasketItems: vi.fn(async (basketId: string, items: BasketItem[]) => {
          saved = items;
          return basketRow({ id: basketId, items });
        }),
      };

      await basketUpdate("basket-1", { listItems: [charcoal, patties] }, { persistence });
      expect(saved.map((i) => i.name)).toEqual(["Charcoal", "Patties"]);

      // User now also marks patties as owned and re-hits the CTA.
      await basketUpdate(
        "basket-1",
        { listItems: [charcoal, { ...patties, owned: true }] },
        { persistence },
      );
      expect(saved.map((i) => i.name)).toEqual(["Charcoal"]);
    });

    it("treats owned:undefined list items as needing sourcing", async () => {
      const manuallyAdded = { name: "Extra napkins", qty: 1, category: "misc" } as ListItem;

      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn(),
        saveBasketItems: vi.fn(async (basketId: string, items: BasketItem[]) =>
          basketRow({ id: basketId, items }),
        ),
      };

      const result = await basketUpdate("basket-1", { listItems: [manuallyAdded] }, { persistence });

      expect(result.addedFromList).toEqual([manuallyAdded]);
      expect(result.basket.items).toHaveLength(1);
    });

    it("combines needs-sourcing listItems with explicitly-passed pre-resolved items", async () => {
      const charcoal = listItem({ name: "Charcoal", owned: false, source_item_id: "charcoal" });
      const preResolved: BasketItem = { name: "Propane tank", qty: 1, unit: "count", source_item_id: null };

      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn(),
        saveBasketItems: vi.fn(async (basketId: string, items: BasketItem[]) =>
          basketRow({ id: basketId, items }),
        ),
      };

      const result = await basketUpdate(
        "basket-1",
        { listItems: [charcoal], items: [preResolved] },
        { persistence },
      );

      expect(result.basket.items.map((i) => i.name)).toEqual(["Charcoal", "Propane tank"]);
    });
  });

  describe("mode: append", () => {
    it("merges new items onto the basket's existing items", async () => {
      const existing = basketRow({
        items: [{ name: "Existing item", qty: 1, source_item_id: "existing" }],
      });
      const fake = fakePersistence(existing);

      const newItem: BasketItem = { name: "New item", qty: 1, source_item_id: "newid" };

      const result = await basketUpdate(
        existing.id,
        { items: [newItem], mode: "append" },
        { persistence: fake },
      );

      expect(result.basket.items.map((i) => i.name).sort()).toEqual(["Existing item", "New item"]);
    });

    it("updates an existing line in place (by source_item_id) instead of duplicating it", async () => {
      const existing = basketRow({
        items: [{ name: "Charcoal", qty: 1, unit: "kg", source_item_id: "charcoal" }],
      });
      const fake = fakePersistence(existing);

      const updated: BasketItem = { name: "Charcoal", qty: 3, unit: "kg", source_item_id: "charcoal" };

      const result = await basketUpdate(existing.id, { items: [updated], mode: "append" }, { persistence: fake });

      expect(result.basket.items).toHaveLength(1);
      expect(result.basket.items[0].qty).toBe(3);
    });

    it("throws if the basket does not exist yet", async () => {
      const persistence: BasketPersistenceDeps = {
        getBasket: vi.fn().mockResolvedValue(null),
        saveBasketItems: vi.fn(),
      };

      await expect(
        basketUpdate("missing-basket", { items: [{ name: "X", qty: 1 }], mode: "append" }, { persistence }),
      ).rejects.toThrow(/basket not found/);
      expect(persistence.saveBasketItems).not.toHaveBeenCalled();
    });
  });
});
