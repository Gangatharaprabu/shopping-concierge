import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import categoryTaxonomy from "@/docs/schemas/category-taxonomy.json";

const VALID_CATEGORIES = new Set<string>(categoryTaxonomy.$defs.category.enum);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/usecases?category=&subcategory=&limit=&offset=
 *
 * Basic list/filter only -- NOT ranked search (that's feed-agent's job on
 * top of this later). use_cases has a public-read RLS policy, so this is
 * reachable unauthenticated; we still go through the request-scoped
 * (anon-key) client rather than the admin client so RLS stays the single
 * source of truth for what's readable.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const subcategory = url.searchParams.get("subcategory");

  if (category && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: `invalid category "${category}"`, valid_categories: [...VALID_CATEGORIES] },
      { status: 400 }
    );
  }

  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const limit = clampInt(limitParam, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(offsetParam, 0, 0, Number.MAX_SAFE_INTEGER);

  if (limit === null || offset === null) {
    return NextResponse.json({ error: "limit/offset must be non-negative integers" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("use_cases")
    .select("id, title, description, category, subcategory, tags, scenario_slots, template_list, created_at, updated_at")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (category) query = query.eq("category", category);
  if (subcategory) query = query.eq("subcategory", subcategory);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ use_cases: data, limit, offset });
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) return null;
  return Math.min(parsed, max);
}
