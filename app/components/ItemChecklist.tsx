"use client";

import { useMemo, useState } from "react";
import type { ListItem } from "@/lib/types";
import { guessEmoji } from "@/app/design";

export interface ItemChecklistProps {
  items: ListItem[];
  /**
   * Called with the index (into the original, unfiltered `items` array) of
   * the item whose owned state was toggled. Omit entirely to render a
   * read-only checklist (no checkbox at all) -- used for the /usecases/[id]
   * pre-Start live preview, where there's no persisted ListItem.owned to
   * toggle yet (see StartScenarioForm.tsx).
   */
  onToggleOwned?: (index: number) => void;
  disabled?: boolean;
}

/**
 * Figma "Detail view" checklist: category filter chips across the top, then
 * items either grouped by category ("All" selected) or filtered to one
 * category. Shared by the pre-Start live preview (/usecases/[id],
 * read-only) and the persisted list workspace (/lists/[id], owned-toggle
 * enabled) -- see app/lists/[id]/ItemsList.tsx, which re-exports this
 * component to keep its existing import path/tests stable.
 *
 * --- Owned/visual-checkbox mapping (read this before touching the checkbox) ---
 * `ListItem.owned` keeps its exact existing meaning everywhere outside this
 * component: `owned: true` means "the user already has this, don't shop for
 * it" (CLAUDE.md's canonical model, unchanged). But the Figma visual
 * language reads a solid/checked circle as "this is actively on my list" --
 * the opposite sense. Rather than flipping the underlying data (which the
 * redesign brief explicitly forbids), this component only inverts what the
 * checkbox *looks like*: `visuallyChecked = !item.owned`. So:
 *   - `owned: false` (still need to shop for it)      -> renders CHECKED/solid/active
 *   - `owned: true`  (already have it, don't need it) -> renders UNCHECKED/grey/struck-through
 * Clicking always calls `onToggleOwned(index)`, which flips `item.owned`
 * exactly as before -- only the checkbox's visual state and aria-checked
 * value are computed from `!item.owned`, never the stored data.
 */
export default function ItemChecklist({ items, onToggleOwned, disabled }: ItemChecklistProps) {
  const [filterCategory, setFilterCategory] = useState("All");

  const entries = useMemo(
    () => items.map((item, index) => ({ item, index })),
    [items],
  );
  const categories = useMemo(
    () => Array.from(new Set(entries.map(({ item }) => item.category))),
    [entries],
  );

  if (items.length === 0) {
    return <p className="px-5 text-sm text-zinc-500">No items yet.</p>;
  }

  const shown = filterCategory === "All" ? entries : entries.filter(({ item }) => item.category === filterCategory);

  function renderRow({ item, index }: { item: ListItem; index: number }) {
    // See file header -- this is the one place `!item.owned` is computed for
    // display purposes; `item.owned` itself is never touched here.
    const visuallyChecked = !item.owned;
    return (
      <li key={`${item.source_item_id ?? "manual"}-${index}`} className="flex items-center gap-3 border-b border-zinc-50 py-3">
        {onToggleOwned ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={visuallyChecked}
            aria-label={item.name}
            disabled={disabled}
            onClick={() => onToggleOwned(index)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 active:scale-90"
            style={{
              borderColor: visuallyChecked ? "var(--color-ink)" : "#DDDDDD",
              background: visuallyChecked ? "var(--color-ink)" : "#FFFFFF",
            }}
          >
            {visuallyChecked && (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden="true">
                <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <span className="text-xl shrink-0">{guessEmoji(item.name)}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm leading-tight font-semibold ${!visuallyChecked ? "text-zinc-300 line-through" : "text-ink"}`}>
            {item.name}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {item.qty}
            {item.unit ? ` ${item.unit}` : ""}
          </p>
        </div>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5 overflow-x-auto px-5 pb-1">
        {["All", ...categories].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilterCategory(c)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              filterCategory === c ? "bg-ink text-white" : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="px-5">
        {filterCategory === "All" ? (
          categories.map((cat) => (
            <div key={cat}>
              <p className="pt-3 pb-1 text-[10px] font-black tracking-widest text-zinc-300 uppercase">{cat}</p>
              <ul>{entries.filter(({ item }) => item.category === cat).map(renderRow)}</ul>
            </div>
          ))
        ) : (
          <ul>{shown.map(renderRow)}</ul>
        )}
      </div>
    </div>
  );
}
