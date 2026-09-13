import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { generateList, type UseCaseForList } from "@/lib/tools/generate_list";
import type { ListItem, Scenario, UseCaseRow } from "@/lib/types";

/**
 * POST /api/lists
 *
 * Basic persistence CRUD, EXTENDED (Phase 9 / frontend-agent) with an
 * optional generate_list-backed creation path -- see /docs/tool-specs/
 * generate_list.md and the "resolve this gap" section of this phase's task
 * brief for why: generate_list is a pure function that only runs today
 * inside the LLM tool-calling loop (POST /api/harness/message), which is
 * wrong for a direct "click Start on a use case" UI interaction (slow,
 * costs money, non-deterministic, and there's no ANTHROPIC_API_KEY in this
 * sandbox to even exercise that path).
 *
 * Body: { scenario: { use_case_id, slots }, items?: ListItem[] }
 *   - `items` provided (even []): raw persistence, UNCHANGED from the
 *     original behavior -- whatever items array is given is written as-is.
 *   - `items` omitted: this route fetches the UseCase by
 *     `scenario.use_case_id` (public read, same table/columns
 *     /api/usecases/[id] uses) and calls `generateList` itself to produce
 *     the seed items, exactly mirroring what
 *     lib/harness/tools.ts's `generate_list` registry entry does -- same
 *     wiring, duplicated only because the harness's handler is presently
 *     only reachable via the LLM loop, not because the business logic
 *     (generateList itself, imported unchanged from lib/tools/generate_list.ts)
 *     is reimplemented here.
 *
 * The harness's adjust_scenario patch semantics (CLAUDE.md locked decision
 * #2) are a separate, later step -- see PATCH /api/lists/[id]/scenario, not
 * this route.
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

  let items: ListItem[];
  if (validation.items !== undefined) {
    items = validation.items;
  } else {
    const { data: useCaseRow, error: useCaseError } = await supabase
      .from("use_cases")
      .select("id, scenario_slots, template_list")
      .eq("id", validation.scenario.use_case_id)
      .maybeSingle();

    if (useCaseError) {
      return NextResponse.json({ error: useCaseError.message }, { status: 500 });
    }
    if (!useCaseRow) {
      return NextResponse.json(
        { error: `no use case found for id "${validation.scenario.use_case_id}"` },
        { status: 400 }
      );
    }

    items = generateList(toUseCaseForList(useCaseRow as UseCaseRow), validation.scenario.slots);
  }

  // user_id is always the authenticated caller, regardless of what (if
  // anything) the client sent -- never trust a client-supplied user_id.
  const { data, error } = await supabase
    .from("shopping_lists")
    .insert({
      user_id: user.id,
      scenario: validation.scenario,
      items,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ list: data }, { status: 201 });
}

/** Same row->pure-function-shape cast lib/harness/tools.ts uses for this tool. */
function toUseCaseForList(row: Pick<UseCaseRow, "id" | "scenario_slots" | "template_list">): UseCaseForList {
  return {
    id: row.id,
    scenario_slots: row.scenario_slots as unknown as UseCaseForList["scenario_slots"],
    template_list: row.template_list as unknown as UseCaseForList["template_list"],
  };
}

function validateCreateBody(
  body: unknown
): { ok: true; scenario: Scenario; items: ListItem[] | undefined } | { ok: false; error: string } {
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
    items: items as ListItem[] | undefined,
  };
}
