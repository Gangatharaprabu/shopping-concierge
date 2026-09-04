import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import type { SharePermission } from "@/lib/types";

const VALID_PERMISSIONS = new Set<SharePermission>(["view", "edit"]);

/**
 * GET /api/lists/[id]/shares
 *
 * Lists the shares on this list. RLS (list_shares_owner_select /
 * list_shares_sharee_select) scopes what comes back: the list's owner sees
 * every share on it; anyone else sees only the share row (if any) that
 * names them.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createSupabaseServerClient();
  const { response } = await requireUser(supabase);
  if (response) return response;

  const { data, error } = await supabase.from("list_shares").select().eq("list_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ shares: data });
}

/**
 * POST /api/lists/[id]/shares
 *
 * Creates (or updates the permission of, if one already exists -- upsert on
 * the (list_id, shared_with_user_id) unique constraint from
 * 0004_list_shares.sql) a share. Only the list's owner can do this (enforced
 * by list_shares_owner_insert/list_shares_owner_update RLS policies); a
 * non-owner caller gets 0 rows back (reported as 403 here since, unlike a
 * plain GET, the caller explicitly tried to mutate something they don't
 * own).
 *
 * Body: { shared_with_user_id: string (uuid), permission?: "view" | "edit" }
 *
 * Note: this takes a raw Supabase Auth user id, not an email -- resolving
 * an email to a user id needs the admin API (auth.admin.listUsers, which
 * requires the service-role key) and is intentionally left out of this
 * minimal CRUD layer; whichever agent builds the share UI will need to
 * either look up the id via its own means or this endpoint will need that
 * lookup added later.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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
  const { shared_with_user_id, permission } = body as Record<string, unknown>;

  if (typeof shared_with_user_id !== "string" || shared_with_user_id.length === 0) {
    return NextResponse.json({ error: "shared_with_user_id is required and must be a string" }, { status: 400 });
  }
  if (permission !== undefined && !VALID_PERMISSIONS.has(permission as SharePermission)) {
    return NextResponse.json({ error: `permission must be one of: ${[...VALID_PERMISSIONS].join(", ")}` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("list_shares")
    .upsert(
      {
        list_id: id,
        shared_with_user_id,
        permission: (permission as SharePermission) ?? "view",
      },
      { onConflict: "list_id,shared_with_user_id" }
    )
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    // RLS silently dropped the write (caller isn't this list's owner).
    return NextResponse.json({ error: "list not found or not owned by you" }, { status: 403 });
  }

  return NextResponse.json({ share: data }, { status: 201 });
}
