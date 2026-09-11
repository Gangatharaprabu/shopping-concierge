"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

const CATEGORIES = [
  { id: "events", label: "Events" },
  { id: "travel", label: "Travel" },
  { id: "home", label: "Home" },
  { id: "seasonal", label: "Seasonal" },
];

/**
 * The feed/search screen's query box. An empty query is "browse mode" (see
 * /app/page.tsx and /docs/tool-specs/search_usecases.md) -- this form just
 * reflects state to/from the URL's `q`/`category` params (GET-navigation
 * style, no client-side fetch of its own) so the server component that
 * renders results stays the single source of truth for what's on screen,
 * and results are shareable/bookmarkable via URL.
 */
export default function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [category, setCategory] = useState(searchParams.get("category") ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim().length > 0) params.set("q", q.trim());
    if (category) params.set("category", category);
    router.push(params.toString().length > 0 ? `/?${params.toString()}` : "/");
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="What are you shopping for? e.g. 'hosting a BBQ'"
        aria-label="Search use cases"
        className="min-w-64 flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Category filter"
        className="rounded border border-zinc-300 px-2 py-2 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
        Search
      </button>
    </form>
  );
}
