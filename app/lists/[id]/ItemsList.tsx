"use client";

import type { ListItem } from "@/lib/types";

export interface ItemsListProps {
  items: ListItem[];
  /** Called with the index of the item whose "owned" checkbox was toggled. Purely presentational -- the caller owns persistence. */
  onToggleOwned: (index: number) => void;
  disabled?: boolean;
}

/**
 * Renders a ShoppingList's items[] (name/qty/unit/category) with an `owned`
 * checkbox per item. Deliberately dumb/controlled -- no fetch/persistence
 * here, just state-in/event-out -- so it's cheap to unit test and so
 * ListWorkspace (the actual PATCH-on-toggle caller) stays the one place
 * that owns the network call.
 */
export default function ItemsList({ items, onToggleOwned, disabled }: ItemsListProps) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-600">No items yet.</p>;
  }

  const byCategory = new Map<string, { item: ListItem; index: number }[]>();
  items.forEach((item, index) => {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push({ item, index });
    byCategory.set(item.category, bucket);
  });

  return (
    <div className="flex flex-col gap-4">
      {[...byCategory.entries()].map(([category, entries]) => (
        <div key={category}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{category}</h3>
          <ul className="mt-1 divide-y divide-zinc-100">
            {entries.map(({ item, index }) => (
              <li key={`${item.source_item_id ?? "manual"}-${index}`} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  id={`owned-${index}`}
                  checked={item.owned}
                  disabled={disabled}
                  onChange={() => onToggleOwned(index)}
                />
                <label htmlFor={`owned-${index}`} className={`flex-1 text-sm ${item.owned ? "text-zinc-400 line-through" : "text-zinc-900"}`}>
                  {item.name}
                </label>
                <span className="text-sm text-zinc-500">
                  {item.qty}
                  {item.unit ? ` ${item.unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
