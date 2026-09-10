# memory_write tool — spec

## Purpose
The single write path to durable, cross-session `UserMemory` (household
size, dietary prefs, budget tier, brand prefs). This is the enforcement
point for CLAUDE.md's locked decision #3 (the memory boundary) — read that
decision, and the design note at the top of `/lib/tools/memory_write.ts`,
before calling or modifying this tool.

## Contract
Input:
```
{
  household_size?: number | null,
  dietary_prefs?: string[],
  budget_tier?: "low" | "mid" | "high" | null,
  brand_prefs?: string[],
  source: "user_confirmed",   // REQUIRED, no other value accepted
}
```
Output: the updated `UserMemory` record (same shape as `memory_read`'s
output).

Patch semantics: an unspecified durable field is left unchanged (not reset
to null/empty) — same as `PUT /api/memory`.

## Constraints — the memory boundary (CLAUDE.md locked decision #3)
- **Durable-only shape.** The input type has exactly five keys:
  `household_size`, `dietary_prefs`, `budget_tier`, `brand_prefs`, `source`.
  There is no field a caller can use to pass session/event-specific data
  (a `Scenario`'s `time_of_day`, `headcount`, `setting`, `dietary` slot, a
  `ListItem`, etc.) through — that data must stay on the
  `Scenario`/`ShoppingList` object and must NEVER be auto-promoted here.
- **Runtime-enforced, not just type-checked.** Because this tool is invoked
  from a harness dispatching a Claude tool_use call, the input arrives as
  parsed JSON at runtime with no compile-time guarantee. `memory_write`
  therefore rejects (throws `MemoryBoundaryError`) any call whose patch
  contains a key outside the five allowed ones, even if a caller bypassed
  TypeScript (e.g. via an `any` cast or object spread).
- **`source: "user_confirmed"` is required on every call.** This exists
  specifically to guard against a future harness change auto-writing
  Scenario-derived values into memory without deliberate user intent (e.g.
  blindly forwarding every `adjust_scenario` dietary patch into
  `dietary_prefs`). A caller must only set this when the model has
  recognized an explicit, standing statement from the user themselves (“I’m
  always vegan”, “we’re a household of 4”) — never as a side effect of a
  Scenario/ShoppingList mutation. See the cautionary example in
  `/lib/tools/memory_write.ts`'s top-of-file design note for a concrete
  realistic failure mode this guards against.
- Value validation mirrors `PUT /api/memory`: `household_size` is a
  positive integer or null; `dietary_prefs`/`brand_prefs` are string
  arrays; `budget_tier` is `"low"|"mid"|"high"` or null.

## Acceptance criteria
- Given a valid patch with `source: "user_confirmed"`, updates only the
  supplied durable fields and leaves unspecified fields unchanged.
- Given a patch containing any key other than the five allowed ones
  (e.g. attempting to pass `time_of_day` or `headcount`), throws
  `MemoryBoundaryError` and writes nothing.
- Given a patch missing `source` or with any `source` value other than
  `"user_confirmed"`, throws `MemoryBoundaryError` and writes nothing.
- Given an invalid durable value (e.g. `household_size: -1`,
  `budget_tier: "premium"`), throws `MemoryBoundaryError` and writes
  nothing.
