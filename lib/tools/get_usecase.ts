/**
 * get_usecase tool
 *
 * Contract: /docs/tool-specs/get_usecase.md (read that first -- this file
 * implements it, doesn't redefine it).
 *
 * Trivial DI wrapper: fetch one UseCase by id. Deliberately has no default
 * live Supabase-backed implementation baked in -- same reasoning as
 * basket_update.ts: constructing a real request-scoped Supabase client
 * requires Next.js request context (cookies()), which this generic lib
 * function has no business assuming. The caller (a route handler / the
 * harness, which does have that context) injects `deps.persistence` bound to
 * its own client -- concretely, a thin wrapper around the same
 * `use_cases` table query already used by
 * /app/api/usecases/[id]/route.ts's GET handler.
 */

import type { UseCaseRow } from "../types";

export interface UseCasePersistence {
  /** Returns null if no use case with this id exists (not an error). */
  getUseCase(id: string): Promise<UseCaseRow | null>;
}

export interface GetUseCaseDeps {
  persistence: UseCasePersistence;
}

/**
 * Fetches one UseCase by id via `deps.persistence`. Returns null if it
 * doesn't exist (mirrors GET /api/usecases/[id]'s 404-as-null-data
 * behavior at the data layer -- the route/harness caller decides how to
 * surface that, e.g. as a 404 or a "not found" tool_result).
 *
 * `deps` is required in practice (there is no live default -- see file
 * header) but kept as a parameter with no default value so callers get an
 * explicit, actionable error rather than a silent no-op or an unwanted
 * network call this function shouldn't own.
 */
export async function getUseCase(id: string, deps?: GetUseCaseDeps): Promise<UseCaseRow | null> {
  if (!deps) {
    throw new Error(
      "getUseCase requires deps.persistence (getUseCase) -- no default Supabase-backed " +
        "implementation is wired at this layer; the caller (route handler/harness) must inject " +
        "one bound to its own request-scoped Supabase client.",
    );
  }
  return deps.persistence.getUseCase(id);
}
