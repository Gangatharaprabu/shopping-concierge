import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import type { BudgetTier } from "@/lib/types";

const VALID_BUDGET_TIERS = new Set<BudgetTier>(["low", "mid", "high"]);

/**
 * GET /api/memory
 *
 * Raw persistence read only -- enforcing the durable-vs-session boundary
 * (CLAUDE.md locked decision #3: session/event context never auto-promotes
 * here) is memory-agent's job on top of this endpoint, not this route's.
 *
 * Returns the caller's own user_memory row, or a default all-empty shape if
 * they don't have one yet (no memory set is a normal, expected state here,
 * not a 404 -- there's nothing to look up by id, memory is 1:1 with the
 * caller).
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  const { data, error } = await supabase.from("user_memory").select().eq("user_id", user.id).maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    memory: data ?? {
      user_id: user.id,
      household_size: null,
      dietary_prefs: [],
      budget_tier: null,
      brand_prefs: [],
      updated_at: null,
    },
  });
}

/**
 * PUT /api/memory
 *
 * Upserts the caller's own durable memory row. Raw persistence only -- the
 * boundary logic that decides what's *allowed* to be written here (as
 * opposed to living only on a Scenario/ShoppingList) is memory-agent's
 * responsibility on top of this endpoint; this route accepts and persists
 * whatever durable-shaped body it's given for the caller's own row.
 *
 * Body (all fields optional, unspecified fields are left unchanged):
 *   { household_size?: number | null, dietary_prefs?: string[],
 *     budget_tier?: "low" | "mid" | "high" | null, brand_prefs?: string[] }
 */
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const { household_size, dietary_prefs, budget_tier, brand_prefs } = body as Record<string, unknown>;

  if (
    household_size !== undefined &&
    household_size !== null &&
    !(typeof household_size === "number" && Number.isInteger(household_size) && household_size > 0)
  ) {
    return NextResponse.json({ error: "household_size must be a positive integer or null" }, { status: 400 });
  }
  if (dietary_prefs !== undefined && !isStringArray(dietary_prefs)) {
    return NextResponse.json({ error: "dietary_prefs must be an array of strings" }, { status: 400 });
  }
  if (budget_tier !== undefined && budget_tier !== null && !VALID_BUDGET_TIERS.has(budget_tier as BudgetTier)) {
    return NextResponse.json(
      { error: `budget_tier must be one of: ${[...VALID_BUDGET_TIERS].join(", ")}, or null` },
      { status: 400 }
    );
  }
  if (brand_prefs !== undefined && !isStringArray(brand_prefs)) {
    return NextResponse.json({ error: "brand_prefs must be an array of strings" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { user_id: user.id };
  if (household_size !== undefined) patch.household_size = household_size;
  if (dietary_prefs !== undefined) patch.dietary_prefs = dietary_prefs;
  if (budget_tier !== undefined) patch.budget_tier = budget_tier;
  if (brand_prefs !== undefined) patch.brand_prefs = brand_prefs;

  const { data, error } = await supabase
    .from("user_memory")
    .upsert(patch, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ memory: data });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
