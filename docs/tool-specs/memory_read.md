# memory_read tool — spec

## Purpose
Read back a user's durable, cross-session `UserMemory` (household size,
dietary prefs, budget tier, brand prefs) so the harness can personalize a
matched use case / shopping list without asking the user to repeat
themselves every session.

## Contract
Input:  `userId: string`
Output: `UserMemory` — `{ user_id, household_size: number|null,
dietary_prefs: string[], budget_tier: "low"|"mid"|"high"|null,
brand_prefs: string[], updated_at: string|null }`

A user who has never had any durable preference written returns the
all-empty shape above (`updated_at: null`), not an error — no memory set is
a normal, expected state (mirrors `GET /api/memory`'s fallback).

## Constraints
- Read-only. Never writes, never infers/derives a value it wasn't given.
- Returns only the four durable `UserMemory` fields plus `user_id` /
  `updated_at` — never returns or merges in anything from a `Scenario` or
  `ShoppingList` (those are session/event-scoped, see CLAUDE.md locked
  decision #3 and `memory_write.md`'s boundary section).
- Relies on the caller-supplied `userId`; when the default Supabase-backed
  store is used, RLS (`user_memory_owner_select` in
  `/db/migrations/0005_user_memory.sql`) additionally scopes every query to
  the signed-in request user regardless of what `userId` is passed.

## Acceptance criteria
- Given a `userId` with an existing `user_memory` row, returns that row
  unchanged.
- Given a `userId` with no `user_memory` row, returns the all-empty default
  shape, not an error/exception.
- Never returns a field that isn't one of the five `UserMemory` keys.
