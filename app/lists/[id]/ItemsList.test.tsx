import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemsList from "./ItemsList";
import type { ListItem } from "@/lib/types";

const ITEMS: ListItem[] = [
  { name: "Grill tongs", qty: 1, unit: "pair", category: "gear", owned: false, source_item_id: "grill_tongs" },
  { name: "Charcoal briquettes", qty: 2.4, unit: "kg", category: "fuel", owned: true, source_item_id: "charcoal_briquettes" },
];

/**
 * `ListItem.owned` semantics are unchanged (owned: true still means "I
 * already have this, don't shop for it") -- but per this redesign's Figma
 * visual language, the checkbox's *visual* checked state is the inverse of
 * `owned` (see ItemChecklist.tsx's file header): an item still needed
 * (`owned: false`) renders as the checked/active-looking circle, and an
 * item already owned (`owned: true`) renders as unchecked/struck-through.
 * These tests assert that inverted mapping explicitly so it doesn't silently
 * drift back to a literal `checked === owned` assumption.
 */
describe("ItemsList", () => {
  it("renders the checkbox's visual checked state as the inverse of `owned`", () => {
    render(<ItemsList items={ITEMS} onToggleOwned={vi.fn()} />);

    // Grill tongs: owned: false (still needed) -> visually checked.
    expect(screen.getByRole("checkbox", { name: "Grill tongs" })).toBeChecked();
    // Charcoal briquettes: owned: true (already have it) -> visually unchecked.
    expect(screen.getByRole("checkbox", { name: "Charcoal briquettes" })).not.toBeChecked();
  });

  it("calls onToggleOwned with the toggled item's index, and only that index", async () => {
    const onToggleOwned = vi.fn();
    render(<ItemsList items={ITEMS} onToggleOwned={onToggleOwned} />);

    await userEvent.click(screen.getByRole("checkbox", { name: "Grill tongs" }));

    expect(onToggleOwned).toHaveBeenCalledTimes(1);
    expect(onToggleOwned).toHaveBeenCalledWith(0);
  });

  it("does not fire a toggle for a disabled list", async () => {
    const onToggleOwned = vi.fn();
    render(<ItemsList items={ITEMS} onToggleOwned={onToggleOwned} disabled />);

    expect(screen.getByRole("checkbox", { name: "Grill tongs" })).toBeDisabled();
  });

  it("renders no checkboxes at all when onToggleOwned is omitted (read-only preview mode)", () => {
    render(<ItemsList items={ITEMS} />);

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("Grill tongs")).toBeInTheDocument();
  });

  it("filters items by category via the filter chips", async () => {
    render(<ItemsList items={ITEMS} onToggleOwned={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "fuel" }));

    expect(screen.queryByText("Grill tongs")).not.toBeInTheDocument();
    expect(screen.getByText("Charcoal briquettes")).toBeInTheDocument();
  });
});
