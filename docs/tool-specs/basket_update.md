# basket_update tool — spec

## Purpose
The business-logic layer on top of the raw `PATCH /api/baskets/[id]`
persistence (/app/api/baskets/[id]/route.ts), which just writes whatever
`items` array it's given. `basket_update` is where `check_inventory`
actually gets used in the basket-building flow: the user marks some
`ShoppingList` items as already-owned, hits the basket "Buy"/"Get this" CTA,
and `basket_update` is what turns "the list minus what's owned" into the
basket's persisted `items[]`.

## Contract
Input:
```
basketUpdate(
  basketId: string,
  patch: {
    listItems?: ListItem[],   // a ShoppingList's items, as-is (owned included)
    items?: BasketItem[],     // pre-resolved basket items to add/set directly
    mode?: "replace" | "append",  // default "replace"
    status?: unknown,         // rejected if present and not "draft"
  },
  deps: { persistence: { getBasket, saveBasketItems } },
)
```
At least one of `patch.listItems` / `patch.items` must be provided.

Output:
```
{
  basket: BasketRow,
  addedFromList: ListItem[],   // listItems subset actually added (owned excluded)
  skippedOwned: ListItem[],    // listItems subset excluded because owned
}
```

Internally: `patch.listItems` is run through `check_inventory`
(/docs/tool-specs/check_inventory.md); only the `needsSourcing` subset is
mapped to `BasketItem`s and combined with `patch.items`. In `"replace"`
mode (default) this combined set becomes the basket's entire `items[]`. In
`"append"` mode it's merged onto the basket's existing persisted items,
keyed by `source_item_id` (falling back to a case-insensitive `name` match
for manually-added items with no `source_item_id`) so re-adding the same
item updates its quantity rather than duplicating the line.

Persistence is dependency-injected (`deps.persistence`) -- this tool never
talks to Supabase or any network directly. There is no default/live
implementation: constructing a real Supabase client requires Next.js
request context, which this tool has no business assuming. The caller
(route handler / harness) must inject `getBasket`/`saveBasketItems` bound to
its own request-scoped client.

## Constraints
- **Never grows order/checkout fields or logic.** Per CLAUDE.md's locked
  decision #1: "Ordering/checkout is OUT OF SCOPE for this phase. Basket
  ends in a stubbed 'Buy'/'Get this' CTA with no real handoff. Do not build
  payment or retailer-checkout integration." This tool touches only
  `Basket.items`; it must never read, write, or accept a payment method,
  order status, retailer-handoff token, or any similarly-shaped field, now
  or in a future revision of this spec.
- `status` is locked to `"draft"`: if `patch.status` is present and not
  `"draft"`, `basketUpdate` throws (`BasketStatusLockedError`) instead of
  silently ignoring or forwarding it -- defense-in-depth alongside the DB
  CHECK constraint and the PATCH route's own 400, per the same locked
  decision.
- Does not call `resolve_products` and does not do any product-sourcing --
  `patch.items` is assumed to already be in the right shape (a caller may
  have used `resolve_products`'s `ProductCandidate` output upstream, but
  that's the caller's responsibility, not this tool's).
- Does not mutate its inputs.
- `"append"` mode requires the basket to already exist (`getBasket` returns
  non-null); `"replace"` mode does not need to read the basket first.

## Acceptance criteria
- Given a `ShoppingList.items` with some items `owned: true`, the resulting
  basket contains only the `owned !== true` subset, mapped to `BasketItem`s.
- `patch.status` set to anything other than `undefined`/`"draft"` throws
  `BasketStatusLockedError` and never reaches `deps.persistence`.
- `"append"` mode on an existing basket with one item, given a new
  non-overlapping item, results in both items present; given an item that
  shares a `source_item_id` with an existing one, the existing line is
  updated in place (no duplicate).
- Omitting both `patch.listItems` and `patch.items` throws rather than
  silently writing an empty basket.
- Calling without `deps` throws a clear, actionable error rather than
  attempting a network call.
