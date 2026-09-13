import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ScenarioSlots } from "@/app/components/scenario-slots";
import { guessUseCaseEmoji } from "@/app/design";
import StartScenarioForm from "./StartScenarioForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface UseCaseDetail {
  id: string;
  title: string;
  description: string | null;
  category: string;
  subcategory: string;
  tags: string[];
  scenario_slots: ScenarioSlots;
  template_list: unknown[];
}

/**
 * Use-case detail + scenario slot editor -- redesigned as the Figma "Detail
 * view". Public/browsable -- no auth required to view (auth is only
 * enforced when actually starting a list, inside StartScenarioForm, per
 * this phase's auth boundary).
 *
 * `template_list` is now selected alongside the existing columns (it wasn't
 * before) so StartScenarioForm can compute a live, client-side checklist
 * preview via `generateList` as the user adjusts scenario slots, before
 * ever persisting a ShoppingList.
 */
export default async function UseCaseDetailPage({ params }: PageProps) {
  const { id } = await params;

  let useCase: UseCaseDetail | null = null;
  let loadError: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("use_cases")
      .select("id, title, description, category, subcategory, tags, scenario_slots, template_list")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    useCase = data as UseCaseDetail | null;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load this use case.";
  }

  if (loadError) {
    return (
      <div className="m-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Couldn&apos;t reach the use-case catalogue right now ({loadError}).
      </div>
    );
  }

  if (!useCase) {
    notFound();
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-100 px-5 pt-8 pb-4">
        <Link href="/" className="text-sm text-zinc-400">
          &larr; Back
        </Link>
        <div className="mt-3 flex items-center gap-2.5">
          <span className="text-3xl">{guessUseCaseEmoji(useCase.title, useCase.category)}</span>
          <div>
            <h1 className="text-xl leading-tight font-black text-ink">{useCase.title}</h1>
            <p className="text-xs text-zinc-400">
              {useCase.category} / {useCase.subcategory}
            </p>
          </div>
        </div>
        {useCase.description && <p className="mt-2 text-sm text-zinc-600">{useCase.description}</p>}
        {useCase.tags.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1">
            {useCase.tags.map((t) => (
              <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                {t}
              </span>
            ))}
          </p>
        )}
      </div>

      <StartScenarioForm
        useCaseId={useCase.id}
        scenarioSlots={useCase.scenario_slots}
        templateList={useCase.template_list}
      />
    </div>
  );
}
