# check_inventory tool — spec

## Purpose
Partition a `ShoppingList`'s items into what the user still needs to shop
for vs. what they've already marked as owned, so a caller (concretely,
`basket_update`) can act on "the list minus what I already have" without
re-deriving that filter itself. There is no separate persistent "Inventory"
entity in this app's data model (see CLAUDE.md's canonical data models) --
"what I already have" is expressed entirely via `ListItem.owned`.

## Contract
Input:  `items: ListItem[]` (per /docs/schemas/use-case.schema.json's
`$defs.list_item` -- `{ name, qty, unit?, category, owned, source_item_id? }`)

Output: `{ needsSourcing: ListItem[], alreadyOwned: ListItem[] }`

- `needsSourcing` -- every item with `owned !== true`, in input order.
- `alreadyOwned` -- every item with `owned === true`, in input order.

## Constraints
- Pure function -- no I/O, no network, no DB access. Deterministic given the
  same input.
- Never mutates the input array or its items; returns new arrays referencing
  the same item objects.
- An item with `owned` missing/`undefined` is treated as **not owned**
  (included in `needsSourcing`) -- the safer default, since silently
  dropping an item from the basket due to a missing flag is a worse failure
  mode than including it.
- Every input item appears in exactly one of the two output arrays --
  `needsSourcing.length + alreadyOwned.length === items.length` always.

## Acceptance criteria
- Empty `items` -> `{ needsSourcing: [], alreadyOwned: [] }`.
- All items `owned: true` -> everything in `alreadyOwned`, `needsSourcing`
  empty.
- All items `owned: false` (or missing `owned`) -> everything in
  `needsSourcing`, `alreadyOwned` empty.
- Mixed list -> each item lands in the correct partition, both arrays
  preserve the original relative order of the input.
