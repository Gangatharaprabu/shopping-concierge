import Link from "next/link";
import categoryTaxonomy from "@/docs/schemas/category-taxonomy.json";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchUseCases, type UseCaseForSearch } from "@/lib/tools/search_usecases";
import SearchForm from "./components/SearchForm";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; subcategory?: string }>;
}

const VALID_CATEGORIES = new Set<string>(categoryTaxonomy.$defs.category.enum);

/**
 * Feed / search screen (replaces the default create-next-app scaffold).
 * Combines browse (empty query) and search into one screen, per this
 * phase's brief -- a search box that's empty by default is "browse mode",
 * not a separate route.
 *
 * Fetches directly via the server Supabase client + `searchUseCases`
 * (lib/tools/search_usecases.ts, imported unchanged) rather than
 * round-tripping through GET /api/usecases/search over HTTP -- the
 * Next.js-idiomatic way for a Server Component to read its own app's data,
 * and it avoids needing to reconstruct an absolute URL to fetch() the
 * sibling API route from server-rendering code. The API route stays the
 * public/external entry point to the same ranking logic; this page and that
 * route are both thin callers of the same underlying function, matching
 * this repo's "duplicate the wiring, not the logic" pattern.
 *
 * No Supabase project is reachable in this sandbox -- the query below fails
 * at the network layer, which is caught and rendered as a connection-error
 * state rather than crashing the page.
 */
export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q ?? "";
  const category = params.category && VALID_CATEGORIES.has(params.category) ? params.category : undefined;

  let results: { useCase: UseCaseForSearch; score: number }[] = [];
  let loadError: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    let dbQuery = supabase
      .from("use_cases")
      .select("id, title, description, category, subcategory, tags, scenario_slots")
      .order("id", { ascending: true });
    if (category) dbQuery = dbQuery.eq("category", category);

    const { data, error } = await dbQuery;
    if (error) throw new Error(error.message);

    const candidates = (data ?? []) as unknown as UseCaseForSearch[];
    results = searchUseCases(candidates, q, { limit: 40 }).map((r) => ({ useCase: r.useCase, score: r.score }));
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load use cases.";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Find your shopping list</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Describe what you&apos;re planning, or browse the full catalogue below.
        </p>
      </div>

      <SearchForm />

      {loadError ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Couldn&apos;t reach the use-case catalogue right now ({loadError}). This is expected in an
          environment with no live Supabase project configured -- try again once one is connected.
        </div>
      ) : results.length === 0 ? (
        <p className="text-sm text-zinc-600">No use cases matched. Try a different search or category.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {results.map(({ useCase }) => (
            <li key={useCase.id}>
              <Link
                href={`/usecases/${useCase.id}`}
                className="block rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400"
              >
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {useCase.category} / {useCase.subcategory}
                </p>
                <h2 className="mt-1 font-medium">{useCase.title}</h2>
                {useCase.description && <p className="mt-1 text-sm text-zinc-600">{useCase.description}</p>}
                {useCase.tags.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {useCase.tags.map((t) => (
                      <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                        {t}
                      </span>
                    ))}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
