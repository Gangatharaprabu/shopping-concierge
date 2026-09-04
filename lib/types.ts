/**
 * TypeScript mirror of CLAUDE.md's "Canonical data models" section and
 * /docs/schemas/use-case.schema.json. Hand-kept in sync with those sources
 * (same approach as scripts/usecase-pipeline/lib/types.ts, which mirrors the
 * same schema for the offline content pipeline -- that file and this one
 * intentionally don't share a module: the pipeline's types are scoped to
 * authoring/validating UseCase records offline, this one is the app-runtime
 * shape used by API routes/DB mapping code under /app/api and /lib).
 *
 * These types describe the *persisted row* shapes (what's stored in
 * Postgres/returned by the DB client), not JSON Schema validation -- no
 * schema-level validation happens here, only structural typing for
 * route-handler code.
 */

// ---- UseCase (see /docs/schemas/use-case.schema.json for the full,
// normative shape -- this is the subset relevant to persistence/API code) ----

export type Category = "events" | "travel" | "home" | "seasonal";

export interface UseCaseRow {
  id: string;
  title: string;
  description: string | null;
  category: Category;
  subcategory: string;
  tags: string[];
  scenario_slots: Record<string, unknown>;
  template_list: unknown[];
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

// ---- Scenario (CLAUDE.md: { use_case_id, slots{} }) ----

export interface Scenario {
  use_case_id: string;
  slots: Record<string, unknown>;
}

// ---- ListItem (CLAUDE.md: { name, qty, unit?, category, owned, source_item_id? }) ----

export interface ListItem {
  name: string;
  qty: number;
  unit?: string;
  category: string;
  owned: boolean;
  source_item_id?: string | null;
}

// ---- ShoppingList (CLAUDE.md: { id, user_id, scenario, items[], created_at, edited_at }) ----

export interface ShoppingListRow {
  id: string;
  user_id: string;
  scenario: Scenario;
  items: ListItem[];
  created_at: string;
  edited_at: string;
}

// ---- ListShare (new -- see CLAUDE.md's "Canonical data models" section,
// added alongside the db/migrations/0004_list_shares.sql migration) ----

export type SharePermission = "view" | "edit";

export interface ListShareRow {
  id: string;
  list_id: string;
  shared_with_user_id: string;
  permission: SharePermission;
  created_at: string;
}

// ---- UserMemory (durable) (CLAUDE.md: { user_id, household_size,
// dietary_prefs[], budget_tier, brand_prefs[] }) ----

export type BudgetTier = "low" | "mid" | "high";

export interface UserMemoryRow {
  user_id: string;
  household_size: number | null;
  dietary_prefs: string[];
  budget_tier: BudgetTier | null;
  brand_prefs: string[];
  updated_at: string;
}

// ---- Basket (CLAUDE.md: { id, user_id, items[], status: "draft" } -- no
// order/checkout fields yet, per locked decision #1) ----

export type BasketStatus = "draft";

export interface BasketItem {
  name: string;
  qty: number;
  unit?: string;
  category?: string;
  source_item_id?: string | null;
}

export interface BasketRow {
  id: string;
  user_id: string;
  items: BasketItem[];
  status: BasketStatus;
  created_at: string;
  updated_at: string;
}
