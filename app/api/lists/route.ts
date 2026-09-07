import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import type { ListItem, Scenario } from "@/lib/types";

/**
 * POST /api/lists
 *
 * Basic persistence CRUD only -- the harness's adjust_scenario patch
 * semantics (CLAUDE.md locked decision #2) are built on top of this by
 * harness-agent; this route just creates a row from whatever
 * scenario/items shape it's given.
 *
 * Body: { scenario: { use_case_id, slots }, items?: ListItem[] }
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const validation = validateCreateBody(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // user_id is always the authenticated caller, regardless of what (if
  // anything) the client sent -- never trust a client-supplied user_id.
  const { data, error } = await supabase
    .from("shopping_lists")
    .insert({
      user_id: user.id,
      scenario: validation.scenario,
      items: validation.items,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ list: data }, { status: 201 });
}

function validateCreateBody(
  body: unknown
): { ok: true; scenario: Scenario; items: ListItem[] } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be an object" };
  }
  const { scenario, items } = body as Record<string, unknown>;

  if (typeof scenario !== "object" || scenario === null) {
    return { ok: false, error: "scenario is required and must be an object" };
  }
  const { use_case_id, slots } = scenario as Record<string, unknown>;
  if (typeof use_case_id !== "string" || use_case_id.length === 0) {
    return { ok: false, error: "scenario.use_case_id is required and must be a string" };
  }
  if (typeof slots !== "object" || slots === null) {
    return { ok: false, error: "scenario.slots is required and must be an object" };
  }

  if (items !== undefined && !Array.isArray(items)) {
    return { ok: false, error: "items must be an array if provided" };
  }

  return {
    ok: true,
    scenario: scenario as Scenario,
    items: (items ?? []) as ListItem[],
  };
}
