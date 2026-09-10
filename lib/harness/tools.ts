/**
 * The runtime tool registry -- a fixed, extensible map of
 * tool name -> { description, input_schema, handler }, matching the
 * Anthropic Messages API's tool-use format. This is the "fixed tool
 * registry" harness-agent's brief calls for: `lib/harness/loop.ts` never
 * branches on a tool's name in its control flow, it only looks the name up
 * here and dispatches to whatever handler is registered. Adding a ninth tool
 * means adding one entry to `TOOL_REGISTRY` below -- no change to the loop.
 *
 * Every entry here is a thin wiring layer, not new business logic: each
 * handler's job is (1) parse/validate the tool_use `input` JSON, (2) do
 * whatever I/O is needed to gather the arguments the *actual* tool function
 * needs (e.g. generate_list/adjust_scenario need a full UseCase, but a
 * tool_use call only gives us a `use_case_id` -- so the handler fetches it),
 * and (3) call the real, already-implemented tool function
 * (lib/tools/*.ts) and return its result. No tool's actual behavior is
 * reimplemented here.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { adjustScenario } from "../tools/adjust_scenario";
import { basketUpdate, type BasketPersistenceDeps } from "../tools/basket_update";
import { checkInventory } from "../tools/check_inventory";
import { generateList, type UseCaseForList } from "../tools/generate_list";
import { getUseCase } from "../tools/get_usecase";
import type { MemoryStore } from "../tools/memory/store";
import { memoryRead } from "../tools/memory_read";
import { memoryWrite, type UserMemoryPatch } from "../tools/memory_write";
import { resolveProducts, type ResolveProductsDeps, type ResolveProductsInput } from "../tools/resolve_products";
import { searchUseCases, type SearchUseCasesMemory, type UseCaseForSearch } from "../tools/search_usecases";
import type { BasketItem, ListItem, UseCaseRow } from "../types";

// ---------------------------------------------------------------------------
// Dependencies every handler draws from. Bound once per request/session (see
// loop.ts) and threaded through as `ToolContext.deps` -- nothing in this
// file reaches for a live Supabase/Anthropic client itself, same DI
// philosophy as every lib/tools/*.ts file.
// ---------------------------------------------------------------------------

/** Raw use-case persistence -- the only DB-shaped dependency the registry needs for use-case-related tools. */
export interface UseCaseCatalogPersistence {
  /** Returns null if no use case with this id exists (not an error). */
  getUseCase(id: string): Promise<UseCaseRow | null>;
  /** The candidate catalogue search_usecases ranks. At ~1000 use cases this is a full-table read (see search_usecases.md). */
  listUseCases(): Promise<UseCaseRow[]>;
}

export interface HarnessDeps {
  /** The signed-in user this harness session is acting on behalf of -- used for memory_read/write and (optionally) search personalization. */
  userId: string;
  useCases: UseCaseCatalogPersistence;
  basketPersistence: BasketPersistenceDeps;
  /** Optional -- omit to run with no durable-memory personalization/writes wired (memory_read/memory_write will use their own live-Supabase default store, so tests should always inject a fake here). */
  memory?: { store?: MemoryStore };
  /** Optional -- resolve_products has its own module-level defaults (Tavily + in-memory cache) when omitted. */
  resolveProducts?: ResolveProductsDeps;
  /** Clock for search_usecases' seasonal scoring; defaults to `new Date()`. */
  now?: Date;
}

export interface ToolContext {
  deps: HarnessDeps;
}

export interface ToolDefinition {
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

export type ToolRegistry = Record<string, ToolDefinition>;

// ---------------------------------------------------------------------------
// Row -> pure-function-shape mapping helpers. UseCaseRow (lib/types.ts) is
// the persisted-row shape (scenario_slots/template_list typed as
// unknown/unknown[]); the pure functions in lib/tools/generate_list.ts and
// lib/tools/search_usecases.ts want narrower, structurally-typed views. Cast
// once, here, rather than in every handler.
// ---------------------------------------------------------------------------

function toUseCaseForList(row: UseCaseRow): UseCaseForList {
  return {
    id: row.id,
    scenario_slots: row.scenario_slots as unknown as UseCaseForList["scenario_slots"],
    template_list: row.template_list as unknown as UseCaseForList["template_list"],
  };
}

function toUseCaseForSearch(row: UseCaseRow): UseCaseForSearch {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    category: row.category,
    subcategory: row.subcategory,
    tags: row.tags,
    scenario_slots: row.scenario_slots as unknown as UseCaseForSearch["scenario_slots"],
  };
}

async function requireUseCase(deps: HarnessDeps, useCaseId: unknown): Promise<UseCaseForList> {
  if (typeof useCaseId !== "string" || useCaseId.length === 0) {
    throw new Error('tool input error: "use_case_id" must be a non-empty string');
  }
  const row = await deps.useCases.getUseCase(useCaseId);
  if (!row) {
    throw new Error(`no use case found for id "${useCaseId}"`);
  }
  return toUseCaseForList(row);
}

function asRecord(input: unknown, toolName: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${toolName}: tool input must be a JSON object`);
  }
  return input as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared JSON-schema fragments (Anthropic tool-use input_schema format).
// ---------------------------------------------------------------------------

const LIST_ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    qty: { type: "number" },
    unit: { type: "string" },
    category: { type: "string" },
    owned: { type: "boolean" },
    source_item_id: { type: ["string", "null"] },
  },
  required: ["name", "qty", "category", "owned"],
} as const;

const BASKET_ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    qty: { type: "number" },
    unit: { type: "string" },
    category: { type: "string" },
    source_item_id: { type: ["string", "null"] },
  },
  required: ["name", "qty"],
} as const;

// ---------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------

export const TOOL_REGISTRY: ToolRegistry = {
  search_usecases: {
    description:
      "Rank the UseCase catalogue for a free-text query (e.g. 'hosting a BBQ'), optionally scoped to a " +
      "category/subcategory, biased by the caller's durable memory when available. Use this to find " +
      "candidate use cases matching what the user described.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text describing what the user wants; \"\" for browse mode." },
        category: { type: "string", description: "Optional hard filter, e.g. 'events'." },
        subcategory: { type: "string", description: "Optional hard filter, e.g. 'events.bbq_grilling'." },
        limit: { type: "integer", description: "Max results to return." },
      },
      required: ["query"],
    },
    handler: async (rawInput, { deps }) => {
      const input = asRecord(rawInput, "search_usecases");
      const query = typeof input.query === "string" ? input.query : "";
      const rows = await deps.useCases.listUseCases();
      const candidates = rows.map(toUseCaseForSearch);

      let memory: SearchUseCasesMemory | null = null;
      if (deps.memory?.store) {
        const durable = await memoryRead(deps.userId, { store: deps.memory.store });
        memory = {
          household_size: durable.household_size,
          dietary_prefs: durable.dietary_prefs,
          budget_tier: durable.budget_tier,
          brand_prefs: durable.brand_prefs,
        };
      }

      const results = searchUseCases(candidates, query, {
        category: typeof input.category === "string" ? input.category : undefined,
        subcategory: typeof input.subcategory === "string" ? input.subcategory : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
        memory,
        now: deps.now,
      });

      return { results };
    },
  },

  get_usecase: {
    description: "Fetch one UseCase by id -- its full scenario_slots definitions and template_list.",
    input_schema: {
      type: "object",
      properties: {
        use_case_id: { type: "string" },
      },
      required: ["use_case_id"],
    },
    handler: async (rawInput, { deps }) => {
      const input = asRecord(rawInput, "get_usecase");
      const useCase = await getUseCase(input.use_case_id as string, { persistence: deps.useCases });
      if (!useCase) {
        throw new Error(`no use case found for id "${String(input.use_case_id)}"`);
      }
      return { use_case: useCase };
    },
  },

  generate_list: {
    description:
      "Generate a fresh ShoppingList.items[] for a UseCase at a given (possibly partial) set of scenario " +
      "slot values -- missing slots fall back to their declared default. Use this ONCE, when a user first " +
      "starts a Scenario from a UseCase. For any later edit to an already-generated list, use " +
      "adjust_scenario instead -- never call generate_list again on an existing list, that would discard " +
      "the user's edits (owned flags, manually-added items).",
    input_schema: {
      type: "object",
      properties: {
        use_case_id: { type: "string" },
        scenario_slots: {
          type: "object",
          description: "Partial slot_id -> value map; unset slots use the UseCase's declared default.",
        },
      },
      required: ["use_case_id"],
    },
    handler: async (rawInput, { deps }) => {
      const input = asRecord(rawInput, "generate_list");
      const useCase = await requireUseCase(deps, input.use_case_id);
      const scenarioSlots = (input.scenario_slots as Record<string, unknown> | undefined) ?? {};
      const items: ListItem[] = generateList(useCase, scenarioSlots);
      return { items };
    },
  },

  adjust_scenario: {
    description:
      "PATCH one scenario slot on an already-generated ShoppingList and recompute only the items whose " +
      "depends_on_slots includes that slot -- per CLAUDE.md's locked decision #2, this NEVER regenerates " +
      "the whole list, so every unaffected item (including manually-added items) is left untouched. Use " +
      "this for every edit after the initial generate_list call (headcount changes, dietary changes, " +
      "day/night, etc.).",
    input_schema: {
      type: "object",
      properties: {
        use_case_id: { type: "string" },
        current_scenario_slots: {
          type: "object",
          description: "The Scenario's current slots{} before this patch (partial; unset slots use their default).",
        },
        current_items: {
          type: "array",
          items: LIST_ITEM_SCHEMA,
          description: "The ShoppingList's current items[], as persisted (including owned flags and manually-added items).",
        },
        slot_id: { type: "string", description: "The single slot being changed." },
        new_value: { description: "The slot's new value (string for enum, number for integer, string[] for tag_list, {unit,count} for duration)." },
      },
      required: ["use_case_id", "current_items", "slot_id", "new_value"],
    },
    handler: async (rawInput, { deps }) => {
      const input = asRecord(rawInput, "adjust_scenario");
      const useCase = await requireUseCase(deps, input.use_case_id);
      const currentScenarioSlots = (input.current_scenario_slots as Record<string, unknown> | undefined) ?? {};
      const currentItems = (input.current_items ?? []) as ListItem[];
      if (typeof input.slot_id !== "string") {
        throw new Error('adjust_scenario: "slot_id" must be a string');
      }
      const result = adjustScenario(useCase, currentScenarioSlots, currentItems, input.slot_id, input.new_value);
      return result;
    },
  },

  check_inventory: {
    description: "Partition a ShoppingList's items[] into what still needs sourcing vs. what's already owned.",
    input_schema: {
      type: "object",
      properties: {
        items: { type: "array", items: LIST_ITEM_SCHEMA },
      },
      required: ["items"],
    },
    handler: async (rawInput) => {
      const input = asRecord(rawInput, "check_inventory");
      return checkInventory((input.items ?? []) as ListItem[]);
    },
  },

  resolve_products: {
    description: "Turn one shopping-list item name into 2-3 real, purchasable product options via web search.",
    input_schema: {
      type: "object",
      properties: {
        item_name: { type: "string" },
        quantity: { type: "string" },
        user_budget_tier: { type: "string", enum: ["low", "mid", "high"] },
      },
      required: ["item_name"],
    },
    handler: async (rawInput, { deps }) => {
      const input = asRecord(rawInput, "resolve_products");
      return resolveProducts(input as unknown as ResolveProductsInput, deps.resolveProducts ?? {});
    },
  },

  memory_read: {
    description: "Read the caller's durable, cross-session UserMemory (household size, dietary prefs, budget tier, brand prefs).",
    input_schema: { type: "object", properties: {} },
    handler: async (_rawInput, { deps }) => {
      return memoryRead(deps.userId, { store: deps.memory?.store });
    },
  },

  memory_write: {
    description:
      "Write to the caller's durable, cross-session UserMemory. ONLY call this when the user has made an " +
      "explicit, standing statement about themselves (\"I'm always vegan\", \"we're a household of 4\") -- " +
      "never as a side effect of a Scenario/ShoppingList edit (adjust_scenario). Requires source: " +
      '"user_confirmed".',
    input_schema: {
      type: "object",
      properties: {
        household_size: { type: ["integer", "null"] },
        dietary_prefs: { type: "array", items: { type: "string" } },
        budget_tier: { type: ["string", "null"], enum: ["low", "mid", "high", null] },
        brand_prefs: { type: "array", items: { type: "string" } },
        source: { type: "string", enum: ["user_confirmed"] },
      },
      required: ["source"],
    },
    handler: async (rawInput, { deps }) => {
      const input = asRecord(rawInput, "memory_write");
      return memoryWrite(deps.userId, input as unknown as UserMemoryPatch, { store: deps.memory?.store });
    },
  },

  basket_update: {
    description:
      "Apply a patch to a Basket's items[] -- pass a ShoppingList's list_items (owned items are " +
      "automatically excluded) and/or pre-resolved items, in 'replace' (default) or 'append' mode. Never " +
      "accepts or changes anything checkout/order-related; baskets only ever have status 'draft'.",
    input_schema: {
      type: "object",
      properties: {
        basket_id: { type: "string" },
        list_items: { type: "array", items: LIST_ITEM_SCHEMA },
        items: { type: "array", items: BASKET_ITEM_SCHEMA },
        mode: { type: "string", enum: ["replace", "append"] },
      },
      required: ["basket_id"],
    },
    handler: async (rawInput, { deps }) => {
      const input = asRecord(rawInput, "basket_update");
      if (typeof input.basket_id !== "string") {
        throw new Error('basket_update: "basket_id" must be a string');
      }
      return basketUpdate(
        input.basket_id,
        {
          listItems: input.list_items as ListItem[] | undefined,
          items: input.items as BasketItem[] | undefined,
          mode: input.mode as "replace" | "append" | undefined,
        },
        { persistence: deps.basketPersistence },
      );
    },
  },
};
