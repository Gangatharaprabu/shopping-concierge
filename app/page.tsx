import Link from "next/link";
import categoryTaxonomy from "@/docs/schemas/category-taxonomy.json";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchUseCases, type UseCaseForSearch } from "@/lib/tools/search_usecases";
import { generateList, type UseCaseForList } from "@/lib/tools/generate_list";
import type { ListItem } from "@/lib/types";
import { guessEmoji, guessUseCaseEmoji, pal } from "./design";
import SearchForm from "./components/SearchForm";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; subcategory?: string }>;
}

const VALID_CATEGORIES = new Set<string>(categoryTaxonomy.$defs.category.enum);
const CATEGORY_CHIPS = [
  { id: "events", label: "Events" },
  { id: "travel", label: "Travel" },
  { id: "home", label: "Home" },
  { id: "seasonal", label: "Seasonal" },
];

/** How many of a use case's default-scenario items to show in the feed's carousel preview. */
const PREVIEW_ITEM_LIMIT = 10;

interface FeedResult {
  useCase: UseCaseForSearch;
  itemCount: number;
  previewItems: ListItem[];
}

/**
 * Home feed / search screen -- redesigned per this phase's Figma-derived
 * brief as a per-use-case row (title/emoji/description) with a horizontally
 * scrolling preview carousel of its default-scenario items.
 *
 * Carousel interactivity decision: this carousel is READ-ONLY/preview-only,
 * not a per-card "add to cart" affordance. CLAUDE.md locked decision #2 in
 * this task's brief rules out multi-basket/cart aggregation ("keep today's
 * flow: one 'Add to basket' action creates/syncs one basket"); a per-card
 * add-to-cart *from the feed* would need to create/sync a basket per
 * scenario on the fly (there's no ShoppingList yet at feed time -- these are
 * template-default items, not a persisted list a user owns), which is
 * exactly the "group items across multiple scenarios" scope this task
 * explicitly says to skip. So "Add to basket" stays a detail/list-page-only
 * action (see /usecases/[id] and /lists/[id]), and this carousel is purely
 * a taste of what's in each use case -- tapping anywhere on a row opens its
 * detail page, where the real (interactive, ownable) checklist lives.
 *
 * Fetches directly via the server Supabase client + `searchUseCases`
 * (lib/tools/search_usecases.ts, imported unchanged) rather than
 * round-tripping through GET /api/usecases/search over HTTP -- see that
 * route's own doc comment for why ("duplicate the wiring, not the logic").
 * This page now also selects `template_list` and computes each result's
 * preview items via the existing, unmodified `generateList`
 * (lib/tools/generate_list.ts), the same computation
 * /api/usecases/search's route now does for its own callers.
 *
 * No Supabase project is reachable in this sandbox -- the query below fails
 * at the network layer, which is caught and rendered as a connection-error
 * state rather than crashing the page.
 */
export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q ?? "";
  const category = params.category && VALID_CATEGORIES.has(params.category) ? params.category : undefined;

  let results: FeedResult[] = [];
  let loadError: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    let dbQuery = supabase
      .from("use_cases")
      .select("id, title, description, category, subcategory, tags, scenario_slots, template_list")
      .order("id", { ascending: true });
    if (category) dbQuery = dbQuery.eq("category", category);

    const { data, error } = await dbQuery;
    if (error) throw new Error(error.message);

    type RowWithTemplate = UseCaseForSearch & { template_list: unknown[] };
    const candidates = (data ?? []) as unknown as RowWithTemplate[];
    const ranked = searchUseCases(candidates, q, { limit: 40 });

    results = ranked.map((r) => {
      const row = r.useCase as RowWithTemplate;
      const items = generateList({
        id: row.id,
        scenario_slots: row.scenario_slots,
        template_list: row.template_list,
      } as unknown as UseCaseForList);
      return { useCase: row, itemCount: items.length, previewItems: items.slice(0, PREVIEW_ITEM_LIMIT) };
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load use cases.";
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 pt-8 pb-4">
        <div>
          <h1 className="text-2xl leading-none font-black text-ink">Concierge</h1>
          <p className="mt-0.5 text-xs text-zinc-400">AI-curated shopping lists</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-5 py-4">
        <SearchForm />
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_CHIPS.map((c) => {
            const isActive = category === c.id;
            const href = isActive
              ? `/${q ? `?q=${encodeURIComponent(q)}` : ""}`
              : `/?${new URLSearchParams({ ...(q ? { q } : {}), category: c.id }).toString()}`;
            return (
              <Link
                key={c.id}
                href={href}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  isActive ? "bg-ink text-white" : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      </div>

      {loadError ? (
        <div className="mx-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Couldn&apos;t reach the use-case catalogue right now ({loadError}). This is expected in an
          environment with no live Supabase project configured -- try again once one is connected.
        </div>
      ) : results.length === 0 ? (
        <p className="px-5 text-sm text-zinc-600">No use cases matched. Try a different search or category.</p>
      ) : (
        <div className="flex flex-col">
          {results.map(({ useCase, itemCount, previewItems }, rowIndex) => (
            <div key={useCase.id} className={`border-b border-zinc-100 ${rowIndex % 2 === 1 ? "bg-zinc-50" : "bg-white"}`}>
              <Link href={`/usecases/${useCase.id}`} className="block px-5 pt-5 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-2xl leading-none">{guessUseCaseEmoji(useCase.title, useCase.category)}</span>
                  <h2 className="text-lg leading-tight font-black text-ink">{useCase.title}</h2>
                </div>
                {useCase.description && <p className="mt-0.5 ml-9 text-xs text-zinc-400">{useCase.description}</p>}
                <div className="mt-1.5 ml-9 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                    {itemCount} items
                  </span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                    {useCase.category} / {useCase.subcategory}
                  </span>
                </div>
              </Link>

              {/* Preview-only carousel -- see file header re: why this isn't interactive. */}
              <div className="flex gap-2.5 overflow-x-auto px-5 pt-1 pb-5">
                {previewItems.map((item, i) => {
                  const p = pal(i);
                  return (
                    <div
                      key={`${item.source_item_id ?? item.name}-${i}`}
                      className="flex min-h-[110px] w-[108px] shrink-0 flex-col gap-1.5 rounded-2xl p-3"
                      style={{ background: p.bg, border: `1.5px solid ${p.border}` }}
                    >
                      <span className="text-[28px] leading-none">{guessEmoji(item.name)}</span>
                      <div className="flex-1">
                        <p className="text-xs leading-snug font-semibold" style={{ color: p.text }}>
                          {item.name}
                        </p>
                        <p className="mt-0.5 text-[10px]" style={{ color: p.sub }}>
                          {item.qty}
                          {item.unit ? ` ${item.unit}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <Link
                  href={`/usecases/${useCase.id}`}
                  className="flex min-h-[110px] w-[76px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-zinc-200 bg-zinc-100"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white">→</div>
                  <span className="text-center text-[10px] font-semibold text-zinc-500">See all</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
