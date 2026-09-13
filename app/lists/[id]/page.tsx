import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ScenarioSlots } from "@/app/components/scenario-slots";
import type { ListItem, ListShareRow } from "@/lib/types";
import { guessUseCaseEmoji } from "@/app/design";
import ListWorkspace from "./ListWorkspace";
import SharePanel from "./SharePanel";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ListDetail {
  id: string;
  scenario: { use_case_id: string; slots: Record<string, unknown> };
  items: ListItem[];
}

/**
 * Shopping list / basket-building screen -- redesigned as the Figma "Detail
 * view", now backed by real persisted data (see ListWorkspace.tsx for the
 * scenario editor + checklist + "Add to basket" logic, unchanged from
 * before this redesign beyond styling).
 *
 * Persists things for a specific user (owned flags, scenario edits, shares,
 * basket creation), but that user is established silently by proxy.ts's
 * anonymous-session logic before this page ever runs -- no login wall here.
 * If proxy.ts couldn't establish a session at all (no live Supabase project,
 * or anonymous sign-ins disabled on the project), the query below just
 * comes back empty under RLS and the existing "couldn't reach the server"
 * state handles it.
 */
export default async function ListPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  let list: ListDetail | null = null;
  let useCaseTitle: string | null = null;
  let useCaseCategory: string = "home";
  let scenarioSlots: ScenarioSlots | null = null;
  let shares: ListShareRow[] = [];
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase.from("shopping_lists").select().eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      loadError = "not_found";
    } else {
      list = data as ListDetail;

      const { data: useCaseRow, error: useCaseError } = await supabase
        .from("use_cases")
        .select("title, category, scenario_slots")
        .eq("id", data.scenario.use_case_id)
        .maybeSingle();
      if (useCaseError) throw new Error(useCaseError.message);
      if (useCaseRow) {
        useCaseTitle = useCaseRow.title;
        useCaseCategory = useCaseRow.category;
        scenarioSlots = useCaseRow.scenario_slots as ScenarioSlots;
      }

      const { data: shareRows, error: shareError } = await supabase
        .from("list_shares")
        .select()
        .eq("list_id", id);
      if (shareError) throw new Error(shareError.message);
      shares = (shareRows ?? []) as ListShareRow[];
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "connection_error";
  }

  if (loadError === "not_found") {
    return (
      <div className="m-5 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        This list doesn&apos;t exist, or you don&apos;t have access to it.
      </div>
    );
  }
  if (loadError || !list) {
    return (
      <div className="m-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Couldn&apos;t reach the server right now ({loadError}). This is expected without a live Supabase
        project configured.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-100 px-5 pt-8 pb-4">
        <Link href="/" className="text-sm text-zinc-400">
          &larr; Back
        </Link>
        <div className="mt-3 flex items-center gap-2.5">
          <span className="text-3xl">{guessUseCaseEmoji(useCaseTitle ?? "Your list", useCaseCategory)}</span>
          <div>
            <p className="text-xs text-zinc-400">Shopping list</p>
            <h1 className="text-xl leading-tight font-black text-ink">{useCaseTitle ?? "Your list"}</h1>
          </div>
        </div>
      </div>

      <ListWorkspace
        listId={list.id}
        scenarioSlots={scenarioSlots}
        initialSlotValues={list.scenario.slots}
        initialItems={list.items}
      />

      <div className="px-5 pb-6">
        <SharePanel listId={list.id} initialShares={shares} />
      </div>
    </div>
  );
}
