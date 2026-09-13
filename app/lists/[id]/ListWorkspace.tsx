"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ScenarioSlotEditor from "@/app/components/ScenarioSlotEditor";
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

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-medium">Scenario</h2>
        {scenarioSlots ? (
          <div className="mt-3">
            <ScenarioSlotEditor
              scenarioSlots={scenarioSlots}
              values={slotValues}
              onChange={handleSlotChange}
              disabled={scenarioStatus === "saving"}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">Scenario editor unavailable (couldn&apos;t load its use case).</p>
        )}
        {scenarioStatus === "error" && scenarioError && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn&apos;t save that change: {scenarioError}
          </p>
        )}
      </div>

      <div className="rounded border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Items</h2>
          <button
            type="button"
            onClick={handleAddToBasket}
            disabled={basketStatus === "adding"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {basketStatus === "adding" ? "Adding to basket..." : "Add to basket"}
          </button>
        </div>
        {itemsStatus === "error" && itemsError && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn&apos;t save that change: {itemsError}
          </p>
        )}
        {basketStatus === "error" && basketError && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Couldn&apos;t add to basket: {basketError}
          </p>
        )}
        <div className="mt-3">
          <ItemsList items={items} onToggleOwned={handleToggleOwned} disabled={itemsStatus === "saving"} />
        </div>
      </div>
    </div>
  );
}
