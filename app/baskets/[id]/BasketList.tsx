"use client";

import { useState } from "react";
import type { BasketItem } from "@/lib/types";
import BasketItemRow from "./BasketItemRow";

export interface BasketListProps {
  basketId: string;
  initialItems: BasketItem[];
}

type RemoveStatus = "idle" | "removing" | "error";

/**
 * Owns the basket's item state + the "remove from basket" affordance this
 * redesign's Figma cart view calls for -- a small, contained new feature
 * (this basket had no remove action before), implemented against the
 * existing, unmodified PATCH /api/baskets/[id] route (which already accepts
 * a full replacement `items` array -- see that route's own doc comment).
 * Explicitly NOT /api/baskets/[id]/sync (untouched per this task's
 * non-goals) -- that route is for syncing a ShoppingList's items into the
 * basket wholesale, not for a one-off client-side removal.
 *
 * Groups items by category (falling back to "Other" for basket items with
 * no category, since BasketItem.category is optional) to match the Figma
 * cart view's grouped-by-category rows -- single-basket only, per this
 * task's locked decision against multi-basket/cart aggregation.
 */
export default function BasketList({ basketId, initialItems }: BasketListProps) {
  const [items, setItems] = useState<BasketItem[]>(initialItems);
  const [status, setStatus] = useState<RemoveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleRemove(index: number) {
    const previous = items;
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    setStatus("removing");
    setError(null);
    try {
      const res = await fetch(`/api/baskets/${basketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? `Request failed (${res.status})`);
        setItems(previous);
        return;
      }
      setItems(data.basket.items);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not reach the server.");
      setItems(previous);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
        <div className="text-5xl">🛒</div>
        <p className="text-lg font-black text-zinc-300">Your basket is empty</p>
      </div>
    );
  }

  const categories = Array.from(new Set(items.map((item) => item.category ?? "Other")));

  return (
    <div className="flex flex-col pb-4">
      {error && (
        <p className="mx-5 mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}
      {categories.map((cat) => (
        <div key={cat} className="px-5">
          <p className="pt-3 pb-1 text-[10px] font-black tracking-widest text-zinc-300 uppercase">{cat}</p>
          <ul className="flex flex-col gap-3 pb-2">
            {items.map((item, index) =>
              (item.category ?? "Other") === cat ? (
                <BasketItemRow
                  key={`${item.source_item_id ?? "manual"}-${index}`}
                  item={item}
                  onRemove={() => handleRemove(index)}
                  removeDisabled={status === "removing"}
                />
              ) : null,
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
