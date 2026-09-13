"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ScenarioSlotEditor from "@/app/components/ScenarioSlotEditor";
import CollapsibleSection from "@/app/components/CollapsibleSection";
import type { ScenarioSlots, ScenarioSlotValues, SlotValue } from "@/app/components/scenario-slots";
import type { ListItem } from "@/lib/types";
import ItemsList from "./ItemsList";

export interface ListWorkspaceProps {
  listId: string;
  scenarioSlots: ScenarioSlots | null;
  initialSlotValues: Record<string, unknown>;
  initialItems: ListItem[];
}

type SaveStatus = "idle" | "saving" | "error";
type BasketStatus = "idle" | "adding" | "error" | "done";

/**
 * Owns the two mutable, persisted pieces of a ShoppingList's UI: scenario
 * slot edits (PATCH /api/lists/[id]/scenario, the adjust_scenario-backed
 * route -- CLAUDE.md locked decision #2: patches affected items only, never
 * regenerates the list) and item `owned` toggles (PATCH /api/lists/[id],
 * the existing raw-overwrite route -- a legitimate use of it, since we're
 * only touching `owned` flags, not scaling/presence logic). Also hosts the
 * "Add to basket" CTA, which creates a basket (if needed) and syncs it via
 * the basket_update-backed /api/baskets/[id]/sync.
 *
 * Restyled for the Figma "Detail view" language (collapsible parameters,
 * pill CTA) -- none of the fetch/persistence logic above changed from
 * before this redesign.
 */
export default function ListWorkspace({
  listId,
  scenarioSlots,
  initialSlotValues,
  initialItems,
}: ListWorkspaceProps) {
  const router = useRouter();
  const [slotValues, setSlotValues] = useState<ScenarioSlotValues>(initialSlotValues as ScenarioSlotValues);
  const [items, setItems] = useState<ListItem[]>(initialItems);
  const [scenarioStatus, setScenarioStatus] = useState<SaveStatus>("idle");
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [itemsStatus, setItemsStatus] = useState<SaveStatus>("idle");
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [basketStatus, setBasketStatus] = useState<BasketStatus>("idle");
  const [basketError, setBasketError] = useState<string | null>(null);

  async function handleSlotChange(slotId: string, newValue: SlotValue) {
    setScenarioStatus("saving");
    setScenarioError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/scenario`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_id: slotId, new_value: newValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScenarioStatus("error");
        setScenarioError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setSlotValues(data.list.scenario.slots);
      setItems(data.list.items);
      setScenarioStatus("idle");
    } catch (err) {
      setScenarioStatus("error");
      setScenarioError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }

  async function handleToggleOwned(index: number) {
    const nextItems = items.map((item, i) => (i === index ? { ...item, owned: !item.owned } : item));
    setItems(nextItems);
    setItemsStatus("saving");
    setItemsError(null);
    try {
      const res = await fetch(`/api/lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: nextItems }),
      });
      const data = await res.json();
      if (!res.ok) {
        setItemsStatus("error");
        setItemsError(data.error ?? `Request failed (${res.status})`);
        setItems(items); // revert optimistic toggle
        return;
      }
      setItems(data.list.items);
      setItemsStatus("idle");
    } catch (err) {
      setItemsStatus("error");
      setItemsError(err instanceof Error ? err.message : "Could not reach the server.");
      setItems(items); // revert optimistic toggle
    }
  }

  async function handleAddToBasket() {
    setBasketStatus("adding");
    setBasketError(null);
    try {
      const createRes = await fetch("/api/baskets", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setBasketStatus("error");
        setBasketError(createData.error ?? `Request failed (${createRes.status})`);
        return;
      }
      const basketId = createData.basket.id;

      const syncRes = await fetch(`/api/baskets/${basketId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_items: items }),
      });
      const syncData = await syncRes.json();
      if (!syncRes.ok) {
        setBasketStatus("error");
        setBasketError(syncData.error ?? `Request failed (${syncRes.status})`);
        return;
      }

      setBasketStatus("done");
      router.push(`/baskets/${basketId}`);
    } catch (err) {
      setBasketStatus("error");
      setBasketError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }

  const remainingCount = items.filter((i) => !i.owned).length;

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-4">
        {scenarioSlots ? (
          <CollapsibleSection title="Customize parameters" icon="⚙️">
            <ScenarioSlotEditor
              scenarioSlots={scenarioSlots}
              values={slotValues}
              onChange={handleSlotChange}
              disabled={scenarioStatus === "saving"}
            />
          </CollapsibleSection>
        ) : (
          <p className="mb-3 text-sm text-zinc-500">Scenario editor unavailable (couldn&apos;t load its use case).</p>
        )}
        {scenarioStatus === "error" && scenarioError && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn&apos;t save that change: {scenarioError}
          </p>
        )}

        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-zinc-400">
            {remainingCount}/{items.length} still needed
          </p>
          <button
            type="button"
            onClick={handleAddToBasket}
            disabled={basketStatus === "adding"}
            className="rounded-full bg-accent px-4 py-2 text-sm font-black text-white active:scale-95 disabled:opacity-50"
          >
            {basketStatus === "adding" ? "Adding..." : "Add to basket"}
          </button>
        </div>

        {itemsStatus === "error" && itemsError && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn&apos;t save that change: {itemsError}
          </p>
        )}
        {basketStatus === "error" && basketError && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn&apos;t add to basket: {basketError}
          </p>
        )}
      </div>

      <ItemsList items={items} onToggleOwned={handleToggleOwned} disabled={itemsStatus === "saving"} />
    </div>
  );
}
