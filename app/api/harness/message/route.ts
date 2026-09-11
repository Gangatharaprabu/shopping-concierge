import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/auth";
import type { AnthropicClient } from "@/lib/harness/loop";
import { runHarnessLoop } from "@/lib/harness/loop";
import type { HarnessDeps, UseCaseCatalogPersistence } from "@/lib/harness/tools";
import type { BasketPersistenceDeps } from "@/lib/tools/basket_update";
import { SupabaseMemoryStore } from "@/lib/tools/memory/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BasketItem, BasketRow, UseCaseRow } from "@/lib/types";

const USE_CASE_COLUMNS =
  "id, title, description, category, subcategory, tags, scenario_slots, template_list, embedding, created_at, updated_at";

/**
 * POST /api/harness/message
 *
 * Thin wrapper around lib/harness/loop.ts's `runHarnessLoop`: receives one
 * user message (+ optional prior conversation `history`), runs the
 * tool-calling loop against the fixed `TOOL_REGISTRY`
 * (lib/harness/tools.ts), and returns the result as JSON.
 *
 * Session/conversation state is kept as simple as the task allows: the
 * caller is responsible for round-tripping `history` (the `messages` array
 * this route returns) on the next call -- there is no server-side session
 * store here. A future frontend can persist `history` however it likes
 * (e.g. alongside a ShoppingList/Scenario record); that's out of scope for
 * this phase.
 *
 * All persistence wiring for the harness's tools (use_cases, baskets,
 * user_memory) is constructed *here*, bound to this request's RLS-scoped
 * Supabase client -- the loop and registry never touch Supabase directly
 * (see their file headers); this route is the one place that bridges them.
 *
 * No `ANTHROPIC_API_KEY` is configured in this environment (see this
 * phase's task brief) -- constructing `new Anthropic()` below does not
 * throw by itself (the SDK only resolves/validates credentials when a
 * request is actually made), so this route builds and type-checks fine; the
 * actual `client.messages.create` call inside `runHarnessLoop` will fail
 * with an auth error until a real key is set in the deployment environment.
 * That's expected/deferred, not a bug in this route.
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
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }

  const { message, history } = body as Record<string, unknown>;
  if (typeof message !== "string" || message.length === 0) {
    return NextResponse.json({ error: '"message" must be a non-empty string' }, { status: 400 });
  }
  if (history !== undefined && !Array.isArray(history)) {
    return NextResponse.json({ error: '"history" must be an array if provided' }, { status: 400 });
  }

  const useCases: UseCaseCatalogPersistence = {
    async getUseCase(id: string) {
      const { data, error } = await supabase.from("use_cases").select(USE_CASE_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`use_cases lookup failed: ${error.message}`);
      return (data as UseCaseRow | null) ?? null;
    },
    async listUseCases() {
      // At ~1000 use cases a full-table read is cheap enough for this
      // prototype -- see /docs/tool-specs/search_usecases.md's design note.
      const { data, error } = await supabase.from("use_cases").select(USE_CASE_COLUMNS);
      if (error) throw new Error(`use_cases list failed: ${error.message}`);
      return (data ?? []) as UseCaseRow[];
    },
  };

  const basketPersistence: BasketPersistenceDeps = {
    async getBasket(basketId: string) {
      const { data, error } = await supabase.from("baskets").select().eq("id", basketId).maybeSingle();
      if (error) throw new Error(`basket lookup failed: ${error.message}`);
      return (data as BasketRow | null) ?? null;
    },
    async saveBasketItems(basketId: string, items: BasketItem[]) {
      const { data, error } = await supabase.from("baskets").update({ items }).eq("id", basketId).select().single();
      if (error) throw new Error(`basket save failed: ${error.message}`);
      return data as BasketRow;
    },
  };

  const deps: HarnessDeps = {
    userId: user.id,
    useCases,
    basketPersistence,
    memory: { store: new SupabaseMemoryStore(supabase) },
  };

  // Real Anthropic client -- see file header re: no live API key in this
  // environment. Not injected as a route parameter (this is the one place
  // in the app allowed to construct it), but still satisfies the loop's
  // narrow `AnthropicClient` DI seam, same as every other tool's deps.
  const client: AnthropicClient = new Anthropic();

  try {
    const result = await runHarnessLoop(message, (history ?? []) as Anthropic.MessageParam[], deps, { client });
    return NextResponse.json({
      messages: result.messages,
      final_text: result.finalText,
      iterations: result.iterations,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
