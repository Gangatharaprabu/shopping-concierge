import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET /api/usecases/[id]
 *
 * Public read (use_cases RLS allows anon SELECT) -- no auth required.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("use_cases")
    .select("id, title, description, category, subcategory, tags, scenario_slots, template_list, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "use case not found" }, { status: 404 });
  }

  return NextResponse.json({ use_case: data });
}
