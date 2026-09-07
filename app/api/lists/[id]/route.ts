import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";

/**
 * GET /api/lists/[id]
 *
 * RLS (shopping_lists_owner_select / shopping_lists_shared_select) decides
 * whether the row is visible to the caller -- an id that exists but isn't
 * owned by or shared with the caller simply comes back as no rows, which we
 * report as 404 (RLS can't distinguish "doesn't exist" from "not yours",
 * and neither does this endpoint -- that's intentional, not a bug).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createSupabaseServerClient();
  const { response } = await requireUser(supabase);
  if (response) return response;

  const { data, error } = await supabase.from("shopping_lists").select().eq("id", id).maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "list not found" }, { status: 404 });
  }

  return NextResponse.json({ list: data });
}

/**
 * PATCH /api/lists/[id]
 *
 * Persists whatever partial shape it's given (scenario and/or items).
 * Slot-patch semantics (patch affected items only, never regenerate --
 * CLAUDE.md locked decision #2) are computed by harness-agent's
 * adjust_scenario BEFORE calling this endpoint; this route does not compute
 * or validate that logic itself, it just writes the resulting scenario/
 * items it's handed.
 *
 * Body: { scenario?: { use_case_id, slots }, items?: ListItem[] }
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

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
  const { scenario, items } = body as Record<string, unknown>;

  if (scenario === undefined && items === undefined) {
    return NextResponse.json({ error: "provide at least one of: scenario, items" }, { status: 400 });
  }
  if (scenario !== undefined && (typeof scenario !== "object" || scenario === null)) {
    return NextResponse.json({ error: "scenario must be an object if provided" }, { status: 400 });
  }
  if (items !== undefined && !Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array if provided" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (scenario !== undefined) patch.scenario = scenario;
  if (items !== undefined) patch.items = items;

  // RLS (owner update, or sharee update when their share's permission is
  // 'edit') determines whether this row is actually updatable by the
  // caller; a forbidden/nonexistent id updates 0 rows rather than erroring.
  const { data, error } = await supabase
    .from("shopping_lists")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "list not found" }, { status: 404 });
  }

  return NextResponse.json({ list: data });
}
