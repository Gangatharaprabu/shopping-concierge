import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemsList from "./ItemsList";
import type { ListItem } from "@/lib/types";

const ITEMS: ListItem[] = [
  { name: "Grill tongs", qty: 1, unit: "pair", category: "gear", owned: false, source_item_id: "grill_tongs" },
  { name: "Charcoal briquettes", qty: 2.4, unit: "kg", category: "fuel", owned: true, source_item_id: "charcoal_briquettes" },
];

describe("ItemsList", () => {
  it("renders each item's owned checkbox reflecting its current state", () => {
    render(<ItemsList items={ITEMS} onToggleOwned={vi.fn()} />);

    const tongsCheckbox = screen.getByLabelText("Grill tongs") as HTMLInputElement;
    const charcoalCheckbox = screen.getByLabelText("Charcoal briquettes") as HTMLInputElement;

    // Checkbox and label are separate elements linked by htmlFor/id -- get
    // the actual <input> via its role in the same list item.
    expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")[1]).toBeChecked();
    expect(tongsCheckbox).toBeInTheDocument();
    expect(charcoalCheckbox).toBeInTheDocument();
  });

  it("calls onToggleOwned with the toggled item's index, and only that index", async () => {
    const onToggleOwned = vi.fn();
    render(<ItemsList items={ITEMS} onToggleOwned={onToggleOwned} />);

    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);

    expect(onToggleOwned).toHaveBeenCalledTimes(1);
    expect(onToggleOwned).toHaveBeenCalledWith(0);
  });

  it("does not fire a toggle for a disabled list", async () => {
    const onToggleOwned = vi.fn();
    render(<ItemsList items={ITEMS} onToggleOwned={onToggleOwned} disabled />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeDisabled();
  });
});
