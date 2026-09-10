# get_usecase tool — spec

## Purpose
Fetch one `UseCase` by id (its full `scenario_slots` definitions and
`template_list`) — the read `generate_list`/`adjust_scenario` need before
they can do anything, and what the harness calls right after a user picks a
match from `search_usecases`' results.

## Contract
`getUseCase(id, deps?) -> UseCase | null`

Input:
```
id: string           // UseCase.id
deps?: {
  persistence: {
    getUseCase(id: string): Promise<UseCaseRow | null>
  }
}
```
Output: the `UseCaseRow` (per /docs/schemas/use-case.schema.json /
lib/types.ts), or `null` if no use case with that id exists (not an error —
mirrors `GET /api/usecases/[id]`'s "no rows" case at the data layer; the
caller, e.g. a route handler or the harness registry, decides how to surface
that, typically as a 404 or an `is_error` tool_result).

## Constraints
- Trivial DI wrapper, same pattern as every other `lib/tools/*.ts` file:
  persistence is injected via `deps.persistence`, never constructed inside
  this function.
- Deliberately has **no default live Supabase-backed implementation** baked
  in (unlike `memory_read`/`memory_write`, which do have one). Constructing
  a real request-scoped Supabase client requires Next.js request context
  (`cookies()`), which this generic lib function has no business assuming —
  same reasoning `basket_update.md` documents for `basketUpdate`. The caller
  (a route handler / the harness) must inject `deps.persistence` bound to
  its own client.
- `deps` has no default value; calling `getUseCase(id)` with no `deps`
  throws a clear, actionable error rather than attempting a network call or
  silently returning `null`.
- Never mutates anything — purely a read.

## Acceptance criteria
- Given an id that exists, returns that `UseCaseRow` unchanged (whatever
  `deps.persistence.getUseCase` returned).
- Given an id that doesn't exist, returns `null`, not an error.
- Calling with no `deps` throws immediately, without attempting any I/O.
