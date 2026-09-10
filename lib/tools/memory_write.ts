/**
 * memory_write tool
 *
 * Contract: /docs/tool-specs/memory_write.md (read that first -- this file
 * implements it, doesn't redefine it).
 *
 * ============================================================================
 * DESIGN NOTE -- this is the one place in the whole app where a write to
 * durable, cross-session UserMemory happens. CLAUDE.md's locked decision #3
 * is a hard constraint on this function specifically:
 *
 *   "Session/event-specific context (this event is at night, this event has
 *   20 guests) lives on the Scenario/ShoppingList object only and must
 *   never be auto-promoted to global memory."
 *
 * WHY THIS FUNCTION IS SAFE AGAINST THAT BOUNDARY VIOLATION
 * -----------------------------------------------------------------------
 * 1. Shape, not inference. `UserMemoryPatch` only has five possible keys:
 *    household_size, dietary_prefs, budget_tier, brand_prefs, and source.
 *    There is no field named "slots", no index signature, nothing a caller
 *    could use to pass a whole Scenario or ListItem through. A harness
 *    change that tried `memoryWrite(userId, scenario.slots)` would not
 *    type-check (Scenario.slots is `Record<string, unknown>`, not
 *    assignable to UserMemoryPatch) -- this is the *first* line of defense,
 *    per this phase's task description.
 *
 * 2. But the type system is NOT sufficient on its own, and this function
 *    does not pretend it is. In practice this tool will be invoked by a
 *    harness dispatching a tool_use call from the Claude API -- the
 *    "patch" argument arrives as arbitrary JSON parsed at runtime, with
 *    zero compile-time guarantee it matches UserMemoryPatch. So this
 *    function ALSO runtime-validates:
 *      - every key in the patch is one of the five allowed keys (rejects
 *        anything else outright, rather than silently dropping it -- a
 *        caller that's confused about the shape should get a loud error,
 *        not a silently-partial write);
 *      - `source` is literally "user_confirmed" (see decision below);
 *      - the four durable fields, when present, have the right shape
 *        (matches the validation already done in app/api/memory/route.ts's
 *        PUT handler, since both are guarding the same underlying columns).
 *
 * DECISION: memory_write REQUIRES `source: "user_confirmed"` on every call
 * -----------------------------------------------------------------------
 * The task asks us to decide whether memory_write should require an
 * explicit marker guarding against a future caller wiring it up to
 * auto-write scenario-derived values without deliberate user action.
 * Decision: yes -- `source: "user_confirmed"` is a REQUIRED, non-optional
 * field on UserMemoryPatch, and memory_write throws (MemoryBoundaryError)
 * if it's missing or has any other value.
 *
 * Why this is the simplest mechanism that still catches the realistic
 * failure mode (and not over-engineering for a ~100-user prototype):
 *   - It costs nothing at every legitimate call site: the harness only
 *     calls memory_write when the model has decided the user made an
 *     explicit, standing statement ("I'm vegan", "we're a household of 4",
 *     "always show me budget options") worth persisting globally --
 *     writing `source: "user_confirmed"` there is a one-token affirmation
 *     of intent that's already true.
 *   - It makes a careless auto-promotion path IMPOSSIBLE to write by
 *     accident. If some future code path forwards Scenario/ShoppingList
 *     data into memory_write "because the shape happened to line up" (see
 *     the cautionary example below), it would have to explicitly fabricate
 *     `source: "user_confirmed"` on a value that was never actually
 *     confirmed by the user -- which is a much harder mistake to make
 *     silently than just forgetting a flag would be. It forces the author
 *     of that call site to look at the literal string "user_confirmed" and
 *     ask "is that true?", which is exactly the review-time speed bump this
 *     boundary needs.
 *   - We deliberately did NOT build anything heavier (e.g. a separate
 *     confirmation-token workflow, a required human-in-the-loop UI
 *     approval step recorded server-side, an audit table). Those are
 *     real options if this app grows a stricter compliance need later, but
 *     for a prototype a required literal marker checked at the one call
 *     site that matters is proportionate. `MemoryWriteSource` is a union of
 *     exactly one string today; if a second legitimate source is ever
 *     needed (e.g. an explicit onboarding form), it must be added here
 *     deliberately as a code change, not supplied as a free-form string by
 *     a caller.
 *
 * CAUTIONARY EXAMPLE for harness-agent (a realistic way to get this wrong)
 * -----------------------------------------------------------------------
 * Imagine the harness handles `adjust_scenario` patching a UseCase's
 * `dietary` slot for a single dinner party (Scenario.slots.dietary =
 * "vegan", set because tonight's guest list includes vegans). A naive
 * "let's keep memory in sync" harness implementation might see the field
 * name `dietary` line up with UserMemory's `dietary_prefs` and reason "the
 * user just told us their dietary preference, let's remember it" --
 * auto-calling `memoryWrite(userId, { dietary_prefs: ["vegan"], source:
 * "user_confirmed" })` right after every adjust_scenario call that touches
 * the dietary slot. That would be a real, live instance of exactly the bug
 * CLAUDE.md warns about: one dinner's dietary constraint silently becomes
 * every future shopping list's default, with no user awareness it
 * happened. The `source: "user_confirmed"` marker doesn't stop a harness
 * from doing this -- it CAN'T, no type system can distinguish "the user
 * actually said 'I'm always vegan'" from "the model inferred this from one
 * Scenario slot" -- but it does mean whoever writes that auto-sync code
 * has to knowingly assert a false "user_confirmed" to make it compile/pass
 * validation, rather than the write happening as an unexamined side effect
 * of a scenario patch. The harness must only call memory_write from a code
 * path triggered by the model recognizing an explicit, standing statement
 * from the user themselves -- never as an automatic side effect of
 * adjust_scenario or any other Scenario/ShoppingList mutation.
 * ============================================================================
 */

import type { BudgetTier } from "@/lib/types";
import {
  SupabaseMemoryStore,
  type DurableMemoryFields,
  type MemoryStore,
  type UserMemory,
} from "./memory/store";

export type { MemoryStore, UserMemory } from "./memory/store";

const defaultStore = new SupabaseMemoryStore();

export interface MemoryWriteDeps {
  store?: MemoryStore;
}

/**
 * The only marker memory_write currently accepts. A future caller adding a
 * second legitimate source (e.g. an explicit onboarding-form submission)
 * should extend this union deliberately, not accept an arbitrary string --
 * see the design note above.
 */
export type MemoryWriteSource = "user_confirmed";

/**
 * Input shape for memoryWrite. Only the four durable UserMemory fields plus
 * the required `source` marker -- there is no field here a caller could use
 * to pass session/event-specific data (Scenario.slots, ListItem, etc.)
 * through, by construction. See the design note at the top of this file.
 */
export interface UserMemoryPatch extends DurableMemoryFields {
  source: MemoryWriteSource;
}

/** Thrown when a call violates the memory boundary (CLAUDE.md locked decision #3) or the required-source guard. */
export class MemoryBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryBoundaryError";
  }
}

const ALLOWED_KEYS = new Set(["household_size", "dietary_prefs", "budget_tier", "brand_prefs", "source"]);
const VALID_BUDGET_TIERS = new Set<BudgetTier>(["low", "mid", "high"]);

function assertNoForeignFields(patch: Record<string, unknown>): void {
  const unknownKeys = Object.keys(patch).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new MemoryBoundaryError(
      `memory_write received unexpected field(s): ${unknownKeys.join(", ")}. memory_write only ` +
        "ever persists the durable UserMemory fields (household_size, dietary_prefs, budget_tier, " +
        "brand_prefs) plus the required `source` marker -- session/event-specific fields (e.g. a " +
        "Scenario's time_of_day, headcount, dietary slot, or any other one-off value) must never " +
        "reach this function. If you meant to update a Scenario/ShoppingList, use adjust_scenario, " +
        "not memory_write. See CLAUDE.md locked decision #3."
    );
  }
}

function assertSourceConfirmed(patch: { source?: unknown }): void {
  if (patch.source !== "user_confirmed") {
    throw new MemoryBoundaryError(
      'memory_write requires source: "user_confirmed" on every call. This marks that the write ' +
        "reflects an explicit, standing preference the user actually stated (e.g. \"I'm always " +
        'vegan\"), not a one-off Scenario/session value being auto-promoted (e.g. "this dinner is ' +
        'vegan"). Never fabricate this marker on a value the user did not explicitly confirm as ' +
        "durable -- see the design note at the top of memory_write.ts."
    );
  }
}

function assertValidDurableValues(patch: DurableMemoryFields): void {
  const { household_size, dietary_prefs, budget_tier, brand_prefs } = patch;

  if (
    household_size !== undefined &&
    household_size !== null &&
    !(typeof household_size === "number" && Number.isInteger(household_size) && household_size > 0)
  ) {
    throw new MemoryBoundaryError("household_size must be a positive integer or null");
  }
  if (dietary_prefs !== undefined && !isStringArray(dietary_prefs)) {
    throw new MemoryBoundaryError("dietary_prefs must be an array of strings");
  }
  if (budget_tier !== undefined && budget_tier !== null && !VALID_BUDGET_TIERS.has(budget_tier)) {
    throw new MemoryBoundaryError(
      `budget_tier must be one of: ${[...VALID_BUDGET_TIERS].join(", ")}, or null`
    );
  }
  if (brand_prefs !== undefined && !isStringArray(brand_prefs)) {
    throw new MemoryBoundaryError("brand_prefs must be an array of strings");
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export async function memoryWrite(
  userId: string,
  patch: UserMemoryPatch,
  deps: MemoryWriteDeps = {}
): Promise<UserMemory> {
  // Runtime guards first -- these are the real enforcement for a caller
  // that reaches this function with arbitrary parsed-JSON tool-call input,
  // not just TypeScript-typed code (see design note above).
  assertNoForeignFields(patch as unknown as Record<string, unknown>);
  assertSourceConfirmed(patch);
  assertValidDurableValues(patch);

  const { source: _source, ...durablePatch } = patch;
  void _source; // consumed only for the guard above; never persisted (no such column)

  const store = deps.store ?? defaultStore;
  return store.upsertUserMemory(userId, durablePatch);
}
