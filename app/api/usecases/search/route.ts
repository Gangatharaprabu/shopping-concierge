import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import categoryTaxonomy from "@/docs/schemas/category-taxonomy.json";
import {
  searchUseCases,
  type BudgetTier,
  type SearchUseCasesMemory,
  type UseCaseForSearch,
} from "@/lib/tools/search_usecases";

const VALID_CATEGORIES = new Set<string>(categoryTaxonomy.$defs.category.enum);
const VALID_BUDGET_TIERS = new Set<BudgetTier>(["low", "mid", "high"]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/**
 * GET /api/usecases/search?q=&category=&subcategory=&limit=
 *   &household_size=&dietary_prefs=&budget_tier=
 *
 * Ranked search over use_cases -- thin wrapper around
 * lib/tools/search_usecases.ts, which holds all the actual scoring logic
 * (see /docs/tool-specs/search_usecases.md). This route's only jobs are:
 * fetch candidate rows from Supabase, translate query params into
 * SearchUseCasesOptions, call searchUseCases, shape the JSON response.
 *
 * A new, separate file from /app/api/usecases/route.ts (plain filter/list,
 * no ranking) and /app/api/usecases/[id]/route.ts -- neither of those is
 * touched here.
 *
 * `use_cases` has a public-read RLS policy (see /app/api/usecases/route.ts),
 * so this is reachable unauthenticated via the request-scoped anon client,
 * same as the sibling routes.
 *
 * Personalization inputs (household_size / dietary_prefs / budget_tier) are
 * accepted directly as query params here rather than fetched from
 * memory_read -- see /docs/tool-specs/search_usecases.md's "Open decisions"
 * section for why (memory-agent owns lib/tools/memory_read.ts and is
 * building it in a parallel worktree; this route stays decoupled from that
 * tool's contract until it lands, matching the CLAUDE.md-documented
 * memory/scenario boundary -- the caller, not this route, decides what
 * durable memory to pass in).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const category = url.searchParams.get("category");
  const subcategory = url.searchParams.get("subcategory");

  if (category && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: `invalid category "${category}"`, valid_categories: [...VALID_CATEGORIES] },
      { status: 400 }
    );
  }

  const limit = clampInt(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) {
    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  const memory = parseMemoryParams(url.searchParams);
  if (memory === "invalid_budget_tier") {
    return NextResponse.json(
      { error: "budget_tier must be one of low, mid, high", valid_budget_tiers: [...VALID_BUDGET_TIERS] },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  let dbQuery = supabase
    .from("use_cases")
    .select("id, title, description, category, subcategory, tags, scenario_slots")
    .order("id", { ascending: true });

  if (category) dbQuery = dbQuery.eq("category", category);
  if (subcategory) dbQuery = dbQuery.eq("subcategory", subcategory);

  const { data, error } = await dbQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const useCases = (data ?? []) as unknown as UseCaseForSearch[];
  const ranked = searchUseCases(useCases, query, { limit, memory });

  return NextResponse.json({
    results: ranked.map((r) => ({ use_case: r.useCase, score: r.score, signals: r.signals })),
    query,
    limit,
  });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) return null;
  return Math.min(parsed, max);
}

/** Returns null (no memory params supplied), a SearchUseCasesMemory, or the sentinel "invalid_budget_tier". */
function parseMemoryParams(searchParams: URLSearchParams): SearchUseCasesMemory | null | "invalid_budget_tier" {
  const householdSizeRaw = searchParams.get("household_size");
  const dietaryRaw = searchParams.get("dietary_prefs");
  const budgetTierRaw = searchParams.get("budget_tier");

  if (householdSizeRaw === null && dietaryRaw === null && budgetTierRaw === null) {
    return null;
  }

  let budget_tier: BudgetTier | null = null;
  if (budgetTierRaw !== null) {
    if (!VALID_BUDGET_TIERS.has(budgetTierRaw as BudgetTier)) return "invalid_budget_tier";
    budget_tier = budgetTierRaw as BudgetTier;
  }

  const household_size = householdSizeRaw !== null && Number.isFinite(Number(householdSizeRaw)) ? Number(householdSizeRaw) : null;
  const dietary_prefs = dietaryRaw
    ? dietaryRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    : [];

  return { household_size, dietary_prefs, budget_tier, brand_prefs: [] };
}
