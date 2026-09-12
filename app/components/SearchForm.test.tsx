import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

// Imported after the mock so the component picks up the mocked module.
const { default: SearchForm } = await import("./SearchForm");

describe("SearchForm", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("navigates to '/' with a 'q' param matching the typed query", async () => {
    render(<SearchForm />);

    await userEvent.type(screen.getByLabelText("Search use cases"), "hosting a BBQ");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url.startsWith("/?")).toBe(true);
    const params = new URLSearchParams(url.slice(2));
    expect(params.get("q")).toBe("hosting a BBQ");
    expect(params.has("category")).toBe(false);
  });

  it("includes both 'q' and 'category' when a category is selected", async () => {
    render(<SearchForm />);

    await userEvent.type(screen.getByLabelText("Search use cases"), "bbq");
    await userEvent.selectOptions(screen.getByLabelText("Category filter"), "events");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    const url = push.mock.calls[push.mock.calls.length - 1][0] as string;
    const params = new URLSearchParams(url.slice(2));
    expect(params.get("q")).toBe("bbq");
    expect(params.get("category")).toBe("events");
  });

  it("navigates to plain '/' (no query string) when the query is empty -- browse mode", async () => {
    render(<SearchForm />);

    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(push).toHaveBeenCalledWith("/");
  });
});
