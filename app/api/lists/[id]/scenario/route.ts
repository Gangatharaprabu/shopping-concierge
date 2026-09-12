import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { adjustScenario, UnknownSlotError } from "@/lib/tools/adjust_scenario";
import type { UseCaseForList } from "@/lib/tools/generate_list";
import type { ListItem, UseCaseRow } from "@/lib/types";

/**
 * PATCH /api/lists/[id]/scenario
 *
 * The adjust_scenario-backed counterpart to the raw, generic
 * `PATCH /api/lists/[id]` (which just overwrites whatever `scenario`/`items`
 * shape it's handed). Deliberately a separate route: adjust_scenario's
 * semantics ("patch one slot, recompute only affected items, never touch
 * anything else -- see CLAUDE.md locked decision #2 /
 * /docs/tool-specs/adjust_scenario.md) are genuinely different from a raw
 * overwrite, and conflating the two here would make it too easy for a caller
 * to accidentally regenerate/clobber a list by hitting the wrong endpoint.
 *
 * Body: { slot_id: string, new_value: string | number | string[] | { unit, count } }
 *
 * Flow: load the list (RLS decides visibility/ownership same as GET
 * /api/lists/[id]) -> load its UseCase -> call adjustScenario (pure
 * function, unchanged from lib/tools/adjust_scenario.ts) -> persist the
 * result's `slots`/`items` back onto the list -> return the updated list.
 * Same wiring lib/harness/tools.ts's `adjust_scenario` registry entry does,
 * duplicated here only because that handler is presently reachable solely
 * via the LLM tool-calling loop (POST /api/harness/message), which is the
 * wrong tool for a direct "drag the headcount slider" UI interaction.
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
  const { slot_id, new_value } = body as Record<string, unknown>;
  if (typeof slot_id !== "string" || slot_id.length === 0) {
    return NextResponse.json({ error: "slot_id is required and must be a string" }, { status: 400 });
  }
  if (new_value === undefined) {
    return NextResponse.json({ error: "new_value is required" }, { status: 400 });
  }

  // RLS (owner, or sharee with an 'edit' share) scopes visibility -- an id
  // that isn't visible to the caller simply comes back as no rows.
  const { data: listRow, error: listError } = await supabase
    .from("shopping_lists")
    .select()
    .eq("id", id)
    .maybeSingle();

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }
  if (!listRow) {
    return NextResponse.json({ error: "list not found" }, { status: 404 });
  }

  const useCaseId = (listRow.scenario as { use_case_id?: unknown })?.use_case_id;
  if (typeof useCaseId !== "string" || useCaseId.length === 0) {
    return NextResponse.json(
      { error: "list's scenario.use_case_id is missing/invalid -- cannot resolve its UseCase" },
      { status: 500 }
    );
  }

  const { data: useCaseRow, error: useCaseError } = await supabase
    .from("use_cases")
    .select("id, scenario_slots, template_list")
    .eq("id", useCaseId)
    .maybeSingle();

  if (useCaseError) {
    return NextResponse.json({ error: useCaseError.message }, { status: 500 });
  }
  if (!useCaseRow) {
    return NextResponse.json({ error: `no use case found for id "${useCaseId}"` }, { status: 500 });
  }

  const useCase = toUseCaseForList(useCaseRow as UseCaseRow);
  const currentScenarioSlots = ((listRow.scenario as { slots?: Record<string, unknown> })?.slots ?? {}) as Record<
    string,
    unknown
  >;
  const currentItems = (listRow.items ?? []) as ListItem[];

  let result;
  try {
    result = adjustScenario(useCase, currentScenarioSlots, currentItems, slot_id, new_value);
  } catch (err) {
    if (err instanceof UnknownSlotError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const { data: updated, error: updateError } = await supabase
    .from("shopping_lists")
    .update({
      scenario: { use_case_id: useCaseId, slots: result.slots },
      items: result.items,
    })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "list not found" }, { status: 404 });
  }

  return NextResponse.json({ list: updated });
}

/** Same row->pure-function-shape cast lib/harness/tools.ts uses for this tool. */
function toUseCaseForList(row: Pick<UseCaseRow, "id" | "scenario_slots" | "template_list">): UseCaseForList {
  return {
    id: row.id,
    scenario_slots: row.scenario_slots as unknown as UseCaseForList["scenario_slots"],
    template_list: row.template_list as unknown as UseCaseForList["template_list"],
  };
}
