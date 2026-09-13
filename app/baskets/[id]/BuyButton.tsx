"use client";

import { useState } from "react";

/**
 * The basket's primary CTA -- a STUB, per CLAUDE.md locked decision #1
 * ("Basket ends in a stubbed 'Buy'/'Get this' CTA with no real handoff. Do
 * not build payment or retailer-checkout integration.") and this phase's
 * explicit instruction not to build even a fake-but-functional-looking
 * checkout flow.
 *
 * On click, this does exactly one thing: flips a local "acknowledged"
 * message on screen. It never calls `fetch`, never navigates, never reads
 * or writes any order/payment-shaped state -- there is nothing here to wire
 * up to a real checkout later beyond replacing this component outright.
 */
export default function BuyButton({ itemName }: { itemName: string }) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`Get this: ${itemName}`}
        onClick={() => setAcknowledged(true)}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white"
      >
        Get this
      </button>
      {acknowledged && (
        <p role="status" className="text-xs text-zinc-500">
          Checkout isn&apos;t available yet.
        </p>
      )}
    </div>
  );
}
