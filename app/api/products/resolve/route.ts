import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MissingSearchApiKeyError, resolveProducts, type BudgetTier } from "@/lib/tools/resolve_products";

const VALID_BUDGET_TIERS = new Set<BudgetTier>(["low", "mid", "high"]);

/**
 * POST /api/products/resolve
 *
 * Thin wrapper around `resolveProducts` (/docs/tool-specs/resolve_products.md)
 * so a basket item can show real shoppable candidates without going through
 * the chat/harness loop. Same wiring lib/harness/tools.ts's `resolve_products`
 * registry entry does (including using its own module-level cache/search-
 * provider defaults, unmodified) -- duplicated here only because that
 * handler is presently reachable solely via the LLM tool-calling loop.
 *
 * Body: { item_name: string, quantity?: string, user_budget_tier?: "low"|"mid"|"high" }
 *
 * Requires auth: this is only ever called from the (auth-gated) basket
 * screen in this phase's UI, and gating it avoids an unauthenticated client
 * being able to burn this app's search-API quota for free. resolve_products
 * itself takes no user-scoped input, so this route doesn't otherwise touch
 * the caller's identity.
 *
 * No live search API key exists in this sandbox (no TAVILY_API_KEY) --
 * `resolveProducts` throws `MissingSearchApiKeyError` on any cache miss,
 * which this route turns into a graceful 503 + empty results rather than a
 * crash, so the basket UI can show "products unavailable right now" instead
 * of erroring.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { response } = await requireUser(supabase);
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
  const { item_name, quantity, user_budget_tier } = body as Record<string, unknown>;

  if (typeof item_name !== "string" || item_name.trim().length === 0) {
    return NextResponse.json({ error: "item_name is required and must be a non-empty string" }, { status: 400 });
  }
  if (quantity !== undefined && typeof quantity !== "string") {
    return NextResponse.json({ error: "quantity must be a string if provided" }, { status: 400 });
  }
  if (user_budget_tier !== undefined && !VALID_BUDGET_TIERS.has(user_budget_tier as BudgetTier)) {
    return NextResponse.json(
      { error: `user_budget_tier must be one of: ${[...VALID_BUDGET_TIERS].join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await resolveProducts({
      item_name,
      quantity: quantity as string | undefined,
      user_budget_tier: user_budget_tier as BudgetTier | undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MissingSearchApiKeyError) {
      return NextResponse.json(
        { results: [], reason: null, error: "search_provider_unavailable" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
