import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BuyButton from "./BuyButton";

/**
 * Per CLAUDE.md locked decision #1 and this phase's explicit instruction:
 * the basket screen's primary CTA is a stub with no real checkout flow.
 * These tests assert the negative space -- clicking it must never reach the
 * network, never navigate anywhere, and never render anything shaped like a
 * payment/checkout form.
 */
describe("BuyButton", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("BuyButton must never call fetch");
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders a 'Get this' button and no payment/checkout-shaped fields", () => {
    render(<BuyButton itemName="Charcoal briquettes" />);

    expect(screen.getByRole("button", { name: /get this/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/address/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("never calls fetch when clicked", async () => {
    render(<BuyButton itemName="Charcoal briquettes" />);

    await userEvent.click(screen.getByRole("button", { name: /get this/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("only shows an inert local acknowledgment message, no order confirmation data", async () => {
    render(<BuyButton itemName="Charcoal briquettes" />);

    await userEvent.click(screen.getByRole("button", { name: /get this/i }));

    expect(screen.getByRole("status")).toHaveTextContent("Checkout isn't available yet.");
  });
});
