"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** A narrow, easy-to-mock fetch signature -- deliberately not `typeof fetch` (whose overload set doesn't unify cleanly with `vi.fn()`'s inferred mock type in tests). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChatBarProps {
  /** Injectable only for tests -- production always uses the global fetch. */
  fetchImpl?: FetchLike;
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

type SendStatus = "idle" | "sending" | "error";

/**
 * Persistent bottom chat bar (mounted once in app/layout.tsx, present on
 * every page), wired to the real runtime harness at POST
 * /api/harness/message -- see that route's own doc comment for its
 * request/response shape, which this component mirrors exactly:
 *
 *   request:  { message: string, history?: Anthropic.MessageParam[] }
 *   response: { messages: Anthropic.MessageParam[], final_text: string, iterations: number }
 *             | { error: string }
 *
 * Session state is intentionally component-local (an in-memory `history`
 * array of whatever the route last returned as `messages`, round-tripped
 * verbatim on the next call) -- it resets on navigation/refresh, matching
 * that route's own stated design ("there is no server-side session store
 * here"). This is NOT the Figma reference's fake `generateResponse()` +
 * `ChatAction` dispatch -- this component never inspects tool-call content,
 * it only ever renders `final_text` as plain conversational text (see the
 * redesign task brief's explicit instruction not to fabricate a
 * navigation/action contract the harness doesn't really expose).
 */
export default function ChatBar({ fetchImpl }: ChatBarProps) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  // Whatever /api/harness/message last returned as `messages` -- passed back
  // as the next call's `history` verbatim. Typed loosely (not
  // Anthropic.MessageParam[]) on purpose: this component never reads inside
  // these objects, only stores and forwards them, so it has no real
  // dependency on the Anthropic SDK's types.
  const [history, setHistory] = useState<unknown[]>([]);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<SendStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // jsdom (this repo's component-test environment) doesn't implement
    // scrollIntoView -- guard it rather than relying on optional chaining
    // alone, which still throws once `endRef.current` itself exists.
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  // Lightweight, route-based context so the quick-prompt chips feel relevant
  // without this component needing to know anything structured about
  // whatever screen it's mounted alongside -- see file header re: no
  // tool-call parsing/navigation.
  const quickPrompts = useMemo(() => {
    if (pathname?.startsWith("/lists/")) {
      return ["What am I missing?", "Add 6 more guests", "Save this list"];
    }
    if (pathname?.startsWith("/baskets/")) {
      return ["What's in my basket?", "Find me a camping list"];
    }
    if (pathname?.startsWith("/usecases/")) {
      return ["Adjust for 12 people", "What else do I need?"];
    }
    return ["Hosting a BBQ this weekend", "Beach trip for 4", "Weekend camping trip"];
  }, [pathname]);

  const placeholder = pathname?.startsWith("/lists/")
    ? "Edit this list, add items..."
    : pathname?.startsWith("/baskets/")
      ? "Ask about your basket..."
      : "Describe what you're planning...";

  async function send(rawText: string) {
    const text = rawText.trim();
    if (!text || status === "sending") return;

    const doFetch = fetchImpl ?? fetch;
    setInput("");
    setIsOpen(true);
    setError(null);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    setStatus("sending");

    try {
      const res = await doFetch("/api/harness/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(typeof data?.error === "string" ? data.error : `Request failed (${res.status})`);
        return;
      }
      setHistory(Array.isArray(data.messages) ? data.messages : []);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", text: typeof data.final_text === "string" ? data.final_text : "" },
      ]);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function handleQuickPrompt(prompt: string) {
    setInput(prompt);
    inputRef.current?.focus();
  }

  return (
    <div className="relative shrink-0" style={{ zIndex: 60 }}>
      {isOpen && (
        <button
          type="button"
          aria-label="Close chat panel overlay"
          className="fixed inset-0 cursor-default"
          style={{ zIndex: 55, background: "transparent" }}
          onClick={() => setIsOpen(false)}
        />
      )}

      {isOpen && (
        <div className="slide-up absolute right-0 left-0 bottom-full pb-1.5" style={{ zIndex: 56 }}>
          <div className="mx-3 flex max-h-[55vh] flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-xl bg-ink text-[10px] text-white">
                  ✦
                </div>
                <span className="text-sm font-bold text-ink">Concierge</span>
              </div>
              <button
                type="button"
                aria-label="Close chat panel"
                onClick={() => setIsOpen(false)}
                className="px-1 text-xs text-zinc-400"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
              <div className="flex flex-wrap gap-1.5">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleQuickPrompt(p)}
                    className="rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-600"
                  >
                    {p}
                  </button>
                ))}
              </div>

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`fade-in flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-ink text-[10px] text-white">
                      ✦
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user" ? "rounded-[18px_18px_4px_18px] bg-ink text-white" : "rounded-[18px_18px_18px_4px] bg-zinc-100 text-ink"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {status === "sending" && (
                <div className="fade-in flex items-center gap-2" role="status" aria-label="Concierge is typing">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-ink text-[10px] text-white">
                    ✦
                  </div>
                  <div className="flex items-center gap-1 rounded-2xl bg-zinc-100 px-3 py-2.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="bounce-dot h-1.5 w-1.5 rounded-full bg-zinc-400"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {status === "error" && error && (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  Couldn&apos;t reach the concierge: {error}
                </p>
              )}

              <div ref={endRef} />
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mx-3 mt-1.5 mb-3" style={{ position: "relative", zIndex: 57 }}>
        <div
          className="flex items-center gap-2.5 rounded-2xl border-[1.5px] border-zinc-200 bg-white px-3.5 py-3"
          style={{ boxShadow: "0 2px 20px rgba(0,0,0,0.06)" }}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-ink text-[11px] text-white">
            ✦
          </div>
          <input
            ref={inputRef}
            type="text"
            aria-label="Chat message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm font-medium text-ink outline-none"
          />
          <button
            type="button"
            aria-label="Toggle chat panel"
            onClick={() => setIsOpen((v) => !v)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-xs text-zinc-500"
          >
            {isOpen ? "▼" : "▲"}
          </button>
          <button
            type="submit"
            aria-label="Send message"
            disabled={input.trim().length === 0 || status === "sending"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-ink text-sm text-white disabled:opacity-30"
          >
            ↑
          </button>
        </div>
      </form>
    </div>
  );
}
