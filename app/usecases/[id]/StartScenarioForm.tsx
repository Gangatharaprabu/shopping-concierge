"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ScenarioSlotEditor from "@/app/components/ScenarioSlotEditor";
import { resolveSlotValues, type ScenarioSlots, type ScenarioSlotValues, type SlotValue } from "@/app/components/scenario-slots";

export interface StartScenarioFormProps {
  useCaseId: string;
  scenarioSlots: ScenarioSlots;
}

type Status = "idle" | "starting" | "error";

/**
 * The use-case detail page's "Start" action. Initializes every slot to its
 * declared default, lets the user adjust them via <ScenarioSlotEditor>, and
 * on submit POSTs to the generate_list-backed /api/lists (scenario.items
 * omitted -- see that route's header for why that's the generate_list
 * path, not the raw-overwrite path), then navigates to the new list.
 */
export default function StartScenarioForm({ useCaseId, scenarioSlots }: StartScenarioFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<ScenarioSlotValues>(() => resolveSlotValues(scenarioSlots, {}));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-col gap-4">
      <ScenarioSlotEditor
        scenarioSlots={scenarioSlots}
        values={values}
        onChange={handleChange}
        disabled={status === "starting"}
      />
      <div>
        <button
          type="button"
          onClick={handleStart}
          disabled={status === "starting"}
          className="rounded bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "starting" ? "Starting..." : "Start shopping list"}
        </button>
      </div>
      {status === "error" && error && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Couldn&apos;t start your list: {error}
        </p>
      )}
    </div>
  );
}
