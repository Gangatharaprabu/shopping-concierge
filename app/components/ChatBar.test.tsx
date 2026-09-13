import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FetchLike } from "./ChatBar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Imported after the mock so the component picks up the mocked module,
// same convention as SearchForm.test.tsx.
const { default: ChatBar } = await import("./ChatBar");

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("ChatBar", () => {
  let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;

  beforeEach(() => {
    fetchMock = vi.fn<FetchLike>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the persistent input bar and quick prompt chips", async () => {
    render(<ChatBar fetchImpl={fetchMock} />);

    expect(screen.getByLabelText("Chat message")).toBeInTheDocument();
    expect(screen.getByLabelText("Send message")).toBeInTheDocument();

    // Quick prompts only show once the panel is open.
    await userEvent.click(screen.getByLabelText("Toggle chat panel"));
    expect(screen.getByRole("button", { name: "Hosting a BBQ this weekend" })).toBeInTheDocument();
  });

  it("sends a message to POST /api/harness/message with an empty history on the first turn", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ messages: [{ role: "user", content: "hi" }], final_text: "Sure, tell me more!", iterations: 1 }),
    );

    render(<ChatBar fetchImpl={fetchMock} />);
    await userEvent.type(screen.getByLabelText("Chat message"), "hosting a bbq");
    await userEvent.click(screen.getByLabelText("Send message"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/harness/message");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ message: "hosting a bbq", history: [] });

    // User bubble appears immediately; assistant bubble appears once the
    // response resolves.
    expect(await screen.findByText("hosting a bbq")).toBeInTheDocument();
    expect(await screen.findByText("Sure, tell me more!")).toBeInTheDocument();
  });

  it("shows a typing indicator while the request is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<ChatBar fetchImpl={fetchMock} />);
    await userEvent.type(screen.getByLabelText("Chat message"), "hi");
    await userEvent.click(screen.getByLabelText("Send message"));

    expect(screen.getByLabelText("Concierge is typing")).toBeInTheDocument();

    resolveFetch(jsonResponse({ messages: [], final_text: "Hello!", iterations: 1 }));

    await waitFor(() => expect(screen.queryByLabelText("Concierge is typing")).not.toBeInTheDocument());
  });

  it("round-trips the returned `messages` array as `history` on the next send", async () => {
    const firstResponseMessages = [
      { role: "user", content: "hosting a bbq" },
      { role: "assistant", content: "Sure, tell me more!" },
    ];
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ messages: firstResponseMessages, final_text: "Sure, tell me more!", iterations: 1 }))
      .mockResolvedValueOnce(jsonResponse({ messages: [...firstResponseMessages, { role: "user", content: "20 guests" }], final_text: "Got it.", iterations: 1 }));

    render(<ChatBar fetchImpl={fetchMock} />);

    await userEvent.type(screen.getByLabelText("Chat message"), "hosting a bbq");
    await userEvent.click(screen.getByLabelText("Send message"));
    await screen.findByText("Sure, tell me more!");

    await userEvent.type(screen.getByLabelText("Chat message"), "20 guests");
    await userEvent.click(screen.getByLabelText("Send message"));
    await screen.findByText("Got it.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody).toEqual({ message: "20 guests", history: firstResponseMessages });
  });

  it("renders an error message when the route responds with a non-OK status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));

    render(<ChatBar fetchImpl={fetchMock} />);
    await userEvent.type(screen.getByLabelText("Chat message"), "hi");
    await userEvent.click(screen.getByLabelText("Send message"));

    expect(await screen.findByRole("alert")).toHaveTextContent("unauthorized");
  });

  it("renders an error message when fetch itself throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    render(<ChatBar fetchImpl={fetchMock} />);
    await userEvent.type(screen.getByLabelText("Chat message"), "hi");
    await userEvent.click(screen.getByLabelText("Send message"));

    expect(await screen.findByRole("alert")).toHaveTextContent("network down");
  });

  it("populates the input from a quick-prompt chip without sending automatically", async () => {
    render(<ChatBar fetchImpl={fetchMock} />);

    await userEvent.click(screen.getByLabelText("Toggle chat panel"));
    await userEvent.click(screen.getByRole("button", { name: "Beach trip for 4" }));

    expect(screen.getByLabelText("Chat message")).toHaveValue("Beach trip for 4");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
