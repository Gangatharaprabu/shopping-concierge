"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import ScenarioSlotEditor from "@/app/components/ScenarioSlotEditor";
import CollapsibleSection from "@/app/components/CollapsibleSection";
import ItemChecklist from "@/app/components/ItemChecklist";
import { resolveSlotValues, type ScenarioSlots, type ScenarioSlotValues, type SlotValue } from "@/app/components/scenario-slots";
import { generateList, type UseCaseForList } from "@/lib/tools/generate_list";

export interface StartScenarioFormProps {
  useCaseId: string;
  scenarioSlots: ScenarioSlots;
  templateList: unknown[];
}

type Status = "idle" | "starting" | "error";

/**
 * The use-case detail page's scenario editor + "Start" action, redesigned as
 * the Figma "Detail view": a collapsible "Customize parameters" section
 * (wrapping the existing, unmodified `ScenarioSlotEditor`) above a live
 * checklist that recomputes client-side via the existing, unmodified
 * `generateList` (lib/tools/generate_list.ts) every time a slot value
 * changes -- no network round-trip needed before the list is actually
 * started, per this phase's brief.
 *
 * The checklist here is read-only (`ItemChecklist` with no `onToggleOwned`):
 * there is no persisted ShoppingList/ListItem.owned to toggle yet at this
 * point, only a preview of what `generateList` would produce. "Start
 * shopping list" still persists via the existing generate_list-backed
 * POST /api/lists flow, unchanged from before this redesign.
 */
export default function StartScenarioForm({ useCaseId, scenarioSlots, templateList }: StartScenarioFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<ScenarioSlotValues>(() => resolveSlotValues(scenarioSlots, {}));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const previewItems = useMemo(() => {
    const useCase = { id: useCaseId, scenario_slots: scenarioSlots, template_list: templateList } as unknown as UseCaseForList;
    return generateList(useCase, values);
  }, [useCaseId, scenarioSlots, templateList, values]);

  function handleChange(slotId: string, newValue: SlotValue) {
    setValues((prev) => ({ ...prev, [slotId]: newValue }));
  }

  async function handleStart() {
    setStatus("starting");
    setError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: { use_case_id: useCaseId, slots: values } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      router.push(`/lists/${data.list.id}`);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-4">
        <CollapsibleSection title="Customize parameters" icon="⚙️">
          <ScenarioSlotEditor
            scenarioSlots={scenarioSlots}
            values={values}
            onChange={handleChange}
            disabled={status === "starting"}
          />
        </CollapsibleSection>

        <button
          type="button"
          onClick={handleStart}
          disabled={status === "starting"}
          className="mb-4 w-full rounded-full bg-accent px-5 py-3 text-sm font-black text-white active:scale-[0.98] disabled:opacity-50"
        >
          {status === "starting" ? "Starting..." : `Start shopping list · ${previewItems.length} items`}
        </button>

        {status === "error" && error && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn&apos;t start your list: {error}
          </p>
        )}
      </div>

      <ItemChecklist items={previewItems} />
    </div>
  );
}
