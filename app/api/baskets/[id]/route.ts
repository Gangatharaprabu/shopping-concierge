import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";

/**
 * GET /api/baskets/[id]
 *
 * Owner-only (baskets RLS has no sharing story, unlike shopping_lists).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createSupabaseServerClient();
  const { response } = await requireUser(supabase);
  if (response) return response;

  const { data, error } = await supabase.from("baskets").select().eq("id", id).maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "basket not found" }, { status: 404 });
  }

  return NextResponse.json({ basket: data });
}

/**
 * PATCH /api/baskets/[id]
 *
 * Basic persistence CRUD only -- no payment/checkout logic, no
 * inventory-subtraction (commerce-agent builds that on top later). Only
 * `items` is patchable; `status` is rejected outright if the client tries
 * to change it away from "draft" (the DB CHECK constraint would reject it
 * too, but we surface a clear 400 here instead of a raw Postgres constraint
 * error), per CLAUDE.md locked decision #1.
 *
 * Body: { items: BasketItem[] }
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
  const { items, status } = body as Record<string, unknown>;

  if (status !== undefined && status !== "draft") {
    return NextResponse.json(
      { error: "status cannot be changed -- baskets only support 'draft' in this phase (no checkout yet)" },
      { status: 400 }
    );
  }
  if (items === undefined) {
    return NextResponse.json({ error: "items is required" }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("baskets")
    .update({ items })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "basket not found" }, { status: 404 });
  }

  return NextResponse.json({ basket: data });
}
