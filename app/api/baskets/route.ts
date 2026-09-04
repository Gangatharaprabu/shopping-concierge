import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import type { BasketItem } from "@/lib/types";

/**
 * POST /api/baskets
 *
 * Basic persistence CRUD only, no payment/checkout logic (per CLAUDE.md
 * locked decision #1 -- commerce-agent builds inventory-subtraction logic
 * on top of this later). status is always created as "draft" -- the only
 * value the baskets.status CHECK constraint allows -- regardless of what
 * (if anything) the client sends for it.
 *
 * Body: { items?: BasketItem[] }
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  let body: unknown = {};
  const raw = await request.text();
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const { items } = body as Record<string, unknown>;
  if (items !== undefined && !Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array if provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("baskets")
    .insert({
      user_id: user.id,
      items: (items ?? []) as BasketItem[],
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ basket: data }, { status: 201 });
}
