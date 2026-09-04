import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";

/**
 * DELETE /api/lists/[id]/shares/[shareId]
 *
 * Revokes a share. RLS allows this for either the list's owner
 * (list_shares_owner_delete) or the sharee themselves removing their own
 * access (list_shares_sharee_delete, i.e. "leave a shared list"). Both
 * list_id and shareId are matched so a caller can't revoke a share by id
 * alone if it doesn't belong to the list in the URL.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; shareId: string }> }
) {
  const { id, shareId } = await context.params;

  const supabase = await createSupabaseServerClient();
  const { response } = await requireUser(supabase);
  if (response) return response;

  const { data, error } = await supabase
    .from("list_shares")
    .delete()
    .eq("id", shareId)
    .eq("list_id", id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "share not found" }, { status: 404 });
  }

  return NextResponse.json({ revoked: true });
}
