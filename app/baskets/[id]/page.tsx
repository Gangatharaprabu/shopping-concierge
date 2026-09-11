import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BasketItem } from "@/lib/types";
import BasketItemRow from "./BasketItemRow";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Basket screen. Persists nothing on this page by itself beyond what
 * happens via child components, but viewing a basket is inherently
 * user-scoped (baskets RLS is owner-only, no sharing story -- see
 * /app/api/baskets/[id]/route.ts), so the whole page is auth-gated.
 *
 * The primary CTA is a stub ("Buy" / "Get this") per CLAUDE.md locked
 * decision #1 -- see BasketItemRow, which renders it as an inert,
 * network-free button. No payment/checkout UI is built here, not even a
 * fake one that looks functional.
 */
export default async function BasketPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/baskets/${id}`)}`);
  }

  let items: BasketItem[] | null = null;
  let loadError: string | null = null;

  try {
    const { data, error } = await supabase.from("baskets").select().eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      loadError = "not_found";
    } else {
      items = data.items as BasketItem[];
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "connection_error";
  }

  if (loadError === "not_found") {
    return (
      <div className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        This basket doesn&apos;t exist, or you don&apos;t have access to it.
      </div>
    );
  }
  if (loadError || !items) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Couldn&apos;t reach the server right now ({loadError}). This is expected without a live Supabase
        project configured.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Basket</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your basket</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Ordering isn&apos;t built yet -- &quot;Get this&quot; below is a placeholder.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-600">Your basket is empty.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item, index) => (
            <BasketItemRow key={`${item.source_item_id ?? "manual"}-${index}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
