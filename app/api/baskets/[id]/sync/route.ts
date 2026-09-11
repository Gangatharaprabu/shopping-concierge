import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { basketUpdate, BasketStatusLockedError, type BasketPersistenceDeps } from "@/lib/tools/basket_update";
import type { BasketItem, BasketRow, ListItem } from "@/lib/types";

/**
 * POST /api/baskets/[id]/sync
 *
 * The basket_update-backed counterpart to the raw `PATCH /api/baskets/[id]`
 * (which just overwrites `items` with whatever array it's given). This is
 * the route the "Add to basket" CTA on the list screen actually calls: pass
 * the ShoppingList's current `items[]` (owned flags included, unfiltered)
 * and this route runs `basketUpdate` -- which itself runs `check_inventory`
 * -- to exclude anything the user already owns before persisting, per
 * /docs/tool-specs/basket_update.md.
 *
 * Body: { list_items?: ListItem[], items?: BasketItem[], mode?: "replace" | "append" }
 * (at least one of list_items/items required -- see basket_update.md)
 *
 * Same wiring lib/harness/tools.ts's `basket_update` registry entry does,
 * duplicated here only because that handler is presently reachable solely
 * via the LLM tool-calling loop.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createSupabaseServerClient();
  const { response } = await requireUser(supabase);
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
  const { list_items, items, mode } = body as Record<string, unknown>;

  if (list_items !== undefined && !Array.isArray(list_items)) {
    return NextResponse.json({ error: "list_items must be an array if provided" }, { status: 400 });
  }
  if (items !== undefined && !Array.isArray(items)) {
    return NextResponse.json({ error: "items must be an array if provided" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "replace" && mode !== "append") {
    return NextResponse.json({ error: 'mode must be "replace" or "append" if provided' }, { status: 400 });
  }
  if (list_items === undefined && items === undefined) {
    return NextResponse.json({ error: "provide at least one of: list_items, items" }, { status: 400 });
  }

  const persistence: BasketPersistenceDeps = {
    async getBasket(basketId: string) {
      const { data, error } = await supabase.from("baskets").select().eq("id", basketId).maybeSingle();
      if (error) throw new Error(`basket lookup failed: ${error.message}`);
      return (data as BasketRow | null) ?? null;
    },
    async saveBasketItems(basketId: string, newItems: BasketItem[]) {
      const { data, error } = await supabase
        .from("baskets")
        .update({ items: newItems })
        .eq("id", basketId)
        .select()
        .single();
      if (error) throw new Error(`basket save failed: ${error.message}`);
      return data as BasketRow;
    },
  };

  try {
    const result = await basketUpdate(
      id,
      {
        listItems: list_items as ListItem[] | undefined,
        items: items as BasketItem[] | undefined,
        mode: mode as "replace" | "append" | undefined,
      },
      { persistence }
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BasketStatusLockedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error && /basket not found/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
