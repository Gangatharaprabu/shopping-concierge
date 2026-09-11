"use client";

import { useState, type FormEvent } from "react";
import type { ListShareRow, SharePermission } from "@/lib/types";

export interface SharePanelProps {
  listId: string;
  initialShares: ListShareRow[];
}

/**
 * Sharing UI for a ShoppingList, against the existing (unmodified)
 * /api/lists/[id]/shares routes. Sharing is by raw Supabase Auth user id in
 * the current API (no email lookup -- see /app/api/lists/[id]/shares/
 * route.ts's own doc comment, a deliberately deferred gap from Phase 3), so
 * this is a plain user-id text input, not an email-lookup feature the
 * backend doesn't support.
 */
export default function SharePanel({ listId, initialShares }: SharePanelProps) {
  const [shares, setShares] = useState<ListShareRow[]>(initialShares);
  const [userId, setUserId] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAddShare(e: FormEvent) {
    e.preventDefault();
    if (userId.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shared_with_user_id: userId.trim(), permission }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setShares((prev) => {
        const withoutExisting = prev.filter((s) => s.shared_with_user_id !== data.share.shared_with_user_id);
        return [...withoutExisting, data.share];
      });
      setUserId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(shareId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/shares/${shareId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-zinc-200 bg-white p-5">
      <h2 className="text-lg font-medium">Sharing</h2>

      {shares.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600">Not shared with anyone yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {shares.map((share) => (
            <li key={share.id} className="flex items-center justify-between rounded border border-zinc-100 px-3 py-2 text-sm">
              <span>
                {share.shared_with_user_id} &middot; <span className="text-zinc-500">{share.permission}</span>
              </span>
              <button
                type="button"
                onClick={() => handleRevoke(share.id)}
                disabled={busy}
                className="text-xs text-red-700 hover:underline disabled:opacity-50"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAddShare} className="mt-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="share-user-id" className="text-xs font-medium text-zinc-700">
            User id
          </label>
          <input
            id="share-user-id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Supabase Auth user id"
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="share-permission" className="text-xs font-medium text-zinc-700">
            Permission
          </label>
          <select
            id="share-permission"
            value={permission}
            onChange={(e) => setPermission(e.target.value as SharePermission)}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="view">view</option>
            <option value="edit">edit</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Share
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}
    </div>
  );
}
