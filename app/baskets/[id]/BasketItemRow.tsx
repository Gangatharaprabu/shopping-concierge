"use client";

import { useState } from "react";
import type { BasketItem } from "@/lib/types";
import type { ProductCandidate } from "@/lib/tools/resolve-products/types";
import { guessEmoji } from "@/app/design";
import BuyButton from "./BuyButton";

type ResolveStatus = "idle" | "loading" | "done" | "unavailable" | "error";

export interface BasketItemRowProps {
  item: BasketItem;
  /** Optional -- omit to render without a remove affordance (kept optional so this component still renders standalone). */
  onRemove?: () => void;
  removeDisabled?: boolean;
}

/**
 * One basket line, restyled per the Figma cart view's row language (emoji,
 * remove-from-basket affordance) -- see BasketList.tsx for where `onRemove`
 * is wired up. Also still renders: a "See products" action that calls
 * /api/products/resolve (the resolve_products-backed route) to show 2-3
 * shoppable candidates with price/retailer/link, and the stubbed Buy CTA
 * (BuyButton, untouched -- see its own file header re: CLAUDE.md locked
 * decision #1). Product resolution is per-item and on-demand (not fetched
 * eagerly for the whole basket) since it's a live web-search call per spec.
 */
export default function BasketItemRow({ item, onRemove, removeDisabled }: BasketItemRowProps) {
  const [status, setStatus] = useState<ResolveStatus>("idle");
  const [candidates, setCandidates] = useState<ProductCandidate[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSeeProducts() {
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/products/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_name: item.name, quantity: item.unit ? `${item.qty} ${item.unit}` : String(item.qty) }),
      });
      const data = await res.json();
      if (res.status === 503) {
        setStatus("unavailable");
        setMessage("Product search isn't available right now.");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setCandidates(data.results ?? []);
      setStatus("done");
      if ((data.results ?? []).length === 0) {
        setMessage(data.reason ? `No products found (${data.reason}).` : "No products found.");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }

  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-xl shrink-0">{guessEmoji(item.name)}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{item.name}</p>
            <p className="text-sm text-zinc-400">
              {item.qty}
              {item.unit ? ` ${item.unit}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleSeeProducts}
            disabled={status === "loading"}
            className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
          >
            {status === "loading" ? "Searching..." : "See products"}
          </button>
          <BuyButton itemName={item.name} />
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${item.name} from basket`}
              onClick={onRemove}
              disabled={removeDisabled}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500 active:scale-90 disabled:opacity-50"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {message && <p className="mt-3 text-sm text-zinc-600">{message}</p>}

      {candidates.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {candidates.map((c) => (
            <li key={c.url} className="rounded-xl border border-zinc-100 p-3 text-sm">
              <p className="font-medium">{c.product_name}</p>
              <p className="text-zinc-600">
                {c.currency} {c.price.toFixed(2)} &middot; {c.retailer}
              </p>
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-500 underline">
                View
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
