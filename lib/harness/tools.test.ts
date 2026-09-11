import { describe, expect, it, vi } from "vitest";
import bbq from "../../db/seed/usecases/backyard-bbq-cookout.json";
import { InMemoryProductCache } from "../tools/resolve-products/cache";
import type { SearchProvider, SearchResultItem } from "../tools/resolve-products/search-provider";
import type { MemoryStore } from "../tools/memory/store";
import type { BasketPersistenceDeps } from "../tools/basket_update";
import type { BasketItem, BasketRow, ListItem, UseCaseRow, UserMemoryRow } from "../types";
import { TOOL_REGISTRY, type HarnessDeps, type UseCaseCatalogPersistence } from "./tools";

const bbqRow = bbq as unknown as UseCaseRow;

function fakeUseCases(rows: UseCaseRow[] = [bbqRow]): UseCaseCatalogPersistence {
  return {
    async getUseCase(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listUseCases() {
      return rows;
    },
  };
}

function unusedBasketPersistence(): BasketPersistenceDeps {
  return {
    getBasket: vi.fn().mockRejectedValue(new Error("getBasket should not be called in this test")),
    saveBasketItems: vi.fn().mockRejectedValue(new Error("saveBasketItems should not be called in this test")),
  };
}

function fakeBasketPersistence(initial: BasketRow): BasketPersistenceDeps {
  let state: BasketRow | null = initial;
  return {
    async getBasket(id: string) {
      return state && state.id === id ? state : null;
    },
    async saveBasketItems(id: string, items: BasketItem[]) {
      if (!state || state.id !== id) throw new Error("basket not found");
      state = { ...state, items };
      return state;
    },
  };
}

function fakeMemoryStore(initial: UserMemoryRow | null = null): MemoryStore {
  let row = initial;
  return {
    async getUserMemory() {
      return row;
    },
    async upsertUserMemory(userId, patch) {
      row = {
        user_id: userId,
        household_size: patch.household_size ?? row?.household_size ?? null,
        dietary_prefs: patch.dietary_prefs ?? row?.dietary_prefs ?? [],
        budget_tier: patch.budget_tier ?? row?.budget_tier ?? null,
        brand_prefs: patch.brand_prefs ?? row?.brand_prefs ?? [],
        updated_at: "2026-01-01T00:00:00Z",
      };
      return row;
    },
  };
}

function baseDeps(overrides: Partial<HarnessDeps> = {}): HarnessDeps {
  return {
    userId: "user-1",
    useCases: fakeUseCases(),
    basketPersistence: unusedBasketPersistence(),
    ...overrides,
  };
}

describe("TOOL_REGISTRY -- registry shape", () => {
  it("has exactly the eight tools named in the task brief, each with a description, input_schema, and handler", () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual(
      [
        "adjust_scenario",
        "basket_update",
        "check_inventory",
        "generate_list",
        "get_usecase",
        "memory_read",
        "memory_write",
        "resolve_products",
        "search_usecases",
      ].sort(),
    );
    for (const def of Object.values(TOOL_REGISTRY)) {
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.input_schema.type).toBe("object");
      expect(typeof def.handler).toBe("function");
    }
  });
});

describe("get_usecase handler", () => {
  it("returns the use case for a known id", async () => {
    const result = (await TOOL_REGISTRY.get_usecase.handler(
      { use_case_id: "backyard-bbq-cookout" },
      { deps: baseDeps() },
    )) as { use_case: UseCaseRow };
    expect(result.use_case.id).toBe("backyard-bbq-cookout");
  });

  it("throws (surfaced as an is_error tool_result by the loop) for an unknown id", async () => {
    await expect(
      TOOL_REGISTRY.get_usecase.handler({ use_case_id: "no-such-id" }, { deps: baseDeps() }),
    ).rejects.toThrow(/no use case found/);
  });
});

describe("generate_list handler", () => {
  it("fetches the use case by id and generates items via the real generateList function", async () => {
    const result = (await TOOL_REGISTRY.generate_list.handler(
      { use_case_id: "backyard-bbq-cookout", scenario_slots: { headcount: 25 } },
      { deps: baseDeps() },
    )) as { items: ListItem[] };

    const charcoal = result.items.find((i) => i.source_item_id === "charcoal_briquettes");
    expect(charcoal?.qty).toBe(8); // 0.3 * 25 -> round up -> 8
  });
});

describe("adjust_scenario handler", () => {
  it("patches only the affected item, preserving owned on an unaffected-by-name-but-recomputed item", async () => {
    const genResult = (await TOOL_REGISTRY.generate_list.handler(
      { use_case_id: "backyard-bbq-cookout" },
      { deps: baseDeps() },
    )) as { items: ListItem[] };

    const itemsWithOwnedCharcoal = genResult.items.map((i) =>
      i.source_item_id === "charcoal_briquettes" ? { ...i, owned: true } : i,
    );

    const result = (await TOOL_REGISTRY.adjust_scenario.handler(
      {
        use_case_id: "backyard-bbq-cookout",
        current_scenario_slots: {},
        current_items: itemsWithOwnedCharcoal,
        slot_id: "headcount",
        new_value: 25,
      },
      { deps: baseDeps() },
    )) as { slots: Record<string, unknown>; items: ListItem[] };

    const charcoal = result.items.find((i) => i.source_item_id === "charcoal_briquettes");
    expect(charcoal?.qty).toBe(8);
    expect(charcoal?.owned).toBe(true);
    expect(result.slots.headcount).toBe(25);

    const tongs = result.items.find((i) => i.source_item_id === "grill_tongs");
    const originalTongs = genResult.items.find((i) => i.source_item_id === "grill_tongs");
    expect(tongs).toEqual(originalTongs); // untouched
  });
});

describe("check_inventory handler", () => {
  it("partitions items via the real checkInventory function", async () => {
    const items: ListItem[] = [
      { name: "A", qty: 1, category: "x", owned: true, source_item_id: "a" },
      { name: "B", qty: 1, category: "x", owned: false, source_item_id: "b" },
    ];
    const result = (await TOOL_REGISTRY.check_inventory.handler({ items }, { deps: baseDeps() })) as {
      needsSourcing: ListItem[];
      alreadyOwned: ListItem[];
    };
    expect(result.needsSourcing.map((i) => i.name)).toEqual(["B"]);
    expect(result.alreadyOwned.map((i) => i.name)).toEqual(["A"]);
  });
});

describe("search_usecases handler", () => {
  it("ranks the catalogue fetched via deps.useCases.listUseCases, with no memory personalization when deps.memory is omitted", async () => {
    const result = (await TOOL_REGISTRY.search_usecases.handler(
      { query: "BBQ" },
      { deps: baseDeps() },
    )) as { results: Array<{ useCase: { id: string } }> };

    expect(result.results[0].useCase.id).toBe("backyard-bbq-cookout");
  });

  it("personalizes via memory_read when deps.memory.store is provided", async () => {
    const store = fakeMemoryStore({
      user_id: "user-1",
      household_size: null,
      dietary_prefs: ["vegan"],
      budget_tier: null,
      brand_prefs: [],
      updated_at: "2026-01-01T00:00:00Z",
    });

    const withMemory = (await TOOL_REGISTRY.search_usecases.handler(
      { query: "" },
      { deps: baseDeps({ memory: { store } }) },
    )) as { results: Array<{ score: number; useCase: { id: string } }> };
    const withoutMemory = (await TOOL_REGISTRY.search_usecases.handler(
      { query: "" },
      { deps: baseDeps() },
    )) as { results: Array<{ score: number; useCase: { id: string } }> };

    const withMemoryScore = withMemory.results.find((r) => r.useCase.id === "backyard-bbq-cookout")!.score;
    const withoutMemoryScore = withoutMemory.results.find((r) => r.useCase.id === "backyard-bbq-cookout")!.score;
    expect(withMemoryScore).toBeGreaterThan(withoutMemoryScore);
  });
});

describe("memory_read / memory_write handlers", () => {
  it("memory_write persists via deps.memory.store and memory_read reads it back", async () => {
    const store = fakeMemoryStore();
    const deps = baseDeps({ memory: { store } });

    await TOOL_REGISTRY.memory_write.handler(
      { dietary_prefs: ["vegan"], source: "user_confirmed" },
      { deps },
    );

    const result = (await TOOL_REGISTRY.memory_read.handler({}, { deps })) as UserMemoryRow;
    expect(result.dietary_prefs).toEqual(["vegan"]);
  });

  it("memory_write rejects a patch missing source without touching the store", async () => {
    const store = fakeMemoryStore();
    const upsertSpy = vi.spyOn(store, "upsertUserMemory");

    await expect(
      TOOL_REGISTRY.memory_write.handler({ dietary_prefs: ["vegan"] }, { deps: baseDeps({ memory: { store } }) }),
    ).rejects.toThrow(/user_confirmed/);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe("basket_update handler", () => {
  it("wires list_items through check_inventory (owned excluded) into the basket via deps.basketPersistence", async () => {
    const basketRow: BasketRow = {
      id: "basket-1",
      user_id: "user-1",
      items: [],
      status: "draft",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const persistence = fakeBasketPersistence(basketRow);

    const listItems: ListItem[] = [
      { name: "Charcoal", qty: 3, category: "fuel", owned: false, source_item_id: "charcoal_briquettes" },
      { name: "Grill tongs", qty: 1, category: "gear", owned: true, source_item_id: "grill_tongs" },
    ];

    const result = (await TOOL_REGISTRY.basket_update.handler(
      { basket_id: "basket-1", list_items: listItems },
      { deps: baseDeps({ basketPersistence: persistence }) },
    )) as { basket: BasketRow };

    expect(result.basket.items.map((i) => i.name)).toEqual(["Charcoal"]);
  });
});

describe("resolve_products handler", () => {
  it("wires through to resolveProducts with an injected fake cache/searchProvider (no network)", async () => {
    class FakeSearchProvider implements SearchProvider {
      async search(): Promise<SearchResultItem[]> {
        return [
          { title: "Charcoal 5kg", url: "https://www.walmart.com/ip/x", content: "$12.99", score: 0.9 },
          { title: "Charcoal 5kg Bag", url: "https://www.amazon.com/dp/y", content: "$14.49", score: 0.8 },
        ];
      }
    }
    const cache = new InMemoryProductCache();

    const result = (await TOOL_REGISTRY.resolve_products.handler(
      { item_name: "charcoal briquettes 5kg" },
      { deps: baseDeps({ resolveProducts: { cache, searchProvider: new FakeSearchProvider() } }) },
    )) as { results: unknown[]; reason: string | null };

    expect(result.reason).toBeNull();
    expect(result.results.length).toBeGreaterThanOrEqual(2);
  });
});
