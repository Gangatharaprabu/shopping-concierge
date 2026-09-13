import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BasketItem } from "@/lib/types";
import BasketList from "./BasketList";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Basket screen -- redesigned as the Figma cart view's visual language
 * (item rows grouped by category, emoji, remove-from-basket affordance --
 * see BasketList.tsx). Single-basket only, per this task's locked decision
 * against multi-basket/cart aggregation -- there's no "group items across
 * multiple scenarios" feature here, just this one basket's items.
 *
 * Viewing a basket is inherently user-scoped (baskets RLS is owner-only, no
 * sharing story -- see /app/api/baskets/[id]/route.ts), but that user is
 * established silently by proxy.ts's anonymous-session logic before this
 * page ever runs -- no login wall here.
 *
 * The primary CTA is a stub ("Buy" / "Get this") per CLAUDE.md locked
 * decision #1 -- see BasketItemRow/BuyButton, which render it as an inert,
 * network-free button. No payment/checkout UI is built here, not even a
 * fake one that looks functional.
 */
export default async function BasketPage({ params }: PageProps) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

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
      <div className="m-5 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        This basket doesn&apos;t exist, or you don&apos;t have access to it.
      </div>
    );
  }
  if (loadError || !items) {
    return (
      <div className="m-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Couldn&apos;t reach the server right now ({loadError}). This is expected without a live Supabase
        project configured.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-zinc-100 px-5 pt-8 pb-4">
        <Link href="/" className="text-sm text-zinc-400">
          &larr; Back
        </Link>
        <div className="mt-3 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink text-lg text-white">🛒</div>
          <div>
            <h1 className="text-xl leading-tight font-black text-ink">Your basket</h1>
            <p className="text-xs text-zinc-400">
              {items.length} item{items.length === 1 ? "" : "s"} &middot; ordering isn&apos;t built yet
            </p>
          </div>
        </div>
      </div>

      <BasketList basketId={id} initialItems={items} />
    </div>
  );
}
