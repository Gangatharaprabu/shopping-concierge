import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ScenarioSlots } from "@/app/components/scenario-slots";
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
}

/**
 * Use-case detail + scenario slot editor. Public/browsable -- no auth
 * required to view (auth is only enforced when actually starting a list,
 * inside StartScenarioForm, per this phase's auth boundary).
 */
export default async function UseCaseDetailPage({ params }: PageProps) {
  const { id } = await params;

  let useCase: UseCaseDetail | null = null;
  let loadError: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("use_cases")
      .select("id, title, description, category, subcategory, tags, scenario_slots")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    useCase = data as UseCaseDetail | null;
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load this use case.";
  }

  if (loadError) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Couldn&apos;t reach the use-case catalogue right now ({loadError}).
      </div>
    );
  }

  if (!useCase) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          &larr; Back to browse
        </Link>
        <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
          {useCase.category} / {useCase.subcategory}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{useCase.title}</h1>
        {useCase.description && <p className="mt-2 text-zinc-600">{useCase.description}</p>}
        {useCase.tags.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1">
            {useCase.tags.map((t) => (
              <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                {t}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="rounded border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-medium">Set up your scenario</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Adjust the details below, then start your shopping list -- you can keep editing them after.
        </p>
        <div className="mt-4">
          <StartScenarioForm useCaseId={useCase.id} scenarioSlots={useCase.scenario_slots} />
        </div>
      </div>
    </div>
  );
}
