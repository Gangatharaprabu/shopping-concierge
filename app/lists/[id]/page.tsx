import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ScenarioSlots } from "@/app/components/scenario-slots";
import type { ListItem, ListShareRow } from "@/lib/types";
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
 * Shopping list / basket-building screen. Persists things for a specific
 * user (owned flags, scenario edits, shares, basket creation) so, per this
 * phase's auth boundary, the whole page is gated -- redirect to /login if
 * unauthenticated, rather than only gating individual actions.
 */
export default async function ListPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/lists/${id}`)}`);
  }

  let list: ListDetail | null = null;
  let useCaseTitle: string | null = null;
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
        .select("title, scenario_slots")
        .eq("id", data.scenario.use_case_id)
        .maybeSingle();
      if (useCaseError) throw new Error(useCaseError.message);
      if (useCaseRow) {
        useCaseTitle = useCaseRow.title;
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
      <div className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        This list doesn&apos;t exist, or you don&apos;t have access to it.
      </div>
    );
  }
  if (loadError || !list) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Couldn&apos;t reach the server right now ({loadError}). This is expected without a live Supabase
        project configured.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Shopping list</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{useCaseTitle ?? "Your list"}</h1>
      </div>

      <ListWorkspace
        listId={list.id}
        scenarioSlots={scenarioSlots}
        initialSlotValues={list.scenario.slots}
        initialItems={list.items}
      />

      <SharePanel listId={list.id} initialShares={shares} />
    </div>
  );
}
