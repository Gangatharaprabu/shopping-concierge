import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScenarioSlotEditor from "./ScenarioSlotEditor";
import type { ScenarioSlots } from "./scenario-slots";

// Same scenario_slots shape as db/seed/usecases/backyard-bbq-cookout.json,
// trimmed to one slot per type so each control's patch payload is
// unambiguous to assert on.
const SCENARIO_SLOTS: ScenarioSlots = {
  time_of_day: { type: "enum", label: "Time of day", options: ["day", "night"], default: "day" },
  headcount: { type: "integer", label: "Guests", min: 2, max: 100, default: 8, unit: "guests" },
  dietary: {
    type: "tag_list",
    label: "Dietary needs",
    options: ["vegetarian", "vegan", "gluten_free", "nut_free"],
    default: [],
  },
  duration: { type: "duration", label: "Trip length", max_days: 14, default: { unit: "event", count: 1 } },
};

describe("ScenarioSlotEditor", () => {
  it("renders one control per declared slot, defaulted to each slot's default", () => {
    render(<ScenarioSlotEditor scenarioSlots={SCENARIO_SLOTS} values={{}} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Time of day")).toHaveValue("day");
    expect(screen.getByLabelText("Guests value")).toHaveValue(8);
    expect(screen.getByLabelText("vegan")).not.toBeChecked();
  });

  it("calls onChange with (slotId, newValue) when an enum slot is changed", async () => {
    const onChange = vi.fn();
    render(<ScenarioSlotEditor scenarioSlots={SCENARIO_SLOTS} values={{}} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Time of day"), "night");

    expect(onChange).toHaveBeenCalledWith("time_of_day", "night");
  });

  it("calls onChange with a number when an integer slot's number input changes", async () => {
    const onChange = vi.fn();
    render(<ScenarioSlotEditor scenarioSlots={SCENARIO_SLOTS} values={{}} onChange={onChange} />);

    const numberInput = screen.getByLabelText("Guests value");
    await userEvent.clear(numberInput);
    await userEvent.type(numberInput, "20");

    // Last call reflects the final typed digit; the important assertion is
    // the *type* of the payload (a number, not a string) and the slot id.
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(lastCall[0]).toBe("headcount");
    expect(typeof lastCall[1]).toBe("number");
  });

  it("calls onChange with the toggled tag added to the array for a tag_list slot", async () => {
    const onChange = vi.fn();
    render(<ScenarioSlotEditor scenarioSlots={SCENARIO_SLOTS} values={{ dietary: ["vegetarian"] }} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("vegan"));

    expect(onChange).toHaveBeenCalledWith("dietary", ["vegetarian", "vegan"]);
  });

  it("calls onChange with the tag removed from the array when un-checked", async () => {
    const onChange = vi.fn();
    render(<ScenarioSlotEditor scenarioSlots={SCENARIO_SLOTS} values={{ dietary: ["vegetarian", "vegan"] }} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("vegan"));

    expect(onChange).toHaveBeenCalledWith("dietary", ["vegetarian"]);
  });

  it("calls onChange with the full {unit,count} shape for a duration slot", async () => {
    const onChange = vi.fn();
    render(<ScenarioSlotEditor scenarioSlots={SCENARIO_SLOTS} values={{}} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText("Trip length unit"), "days");

    expect(onChange).toHaveBeenCalledWith("duration", { unit: "days", count: 2 });
  });
});
