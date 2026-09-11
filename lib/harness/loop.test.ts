import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { BasketPersistenceDeps } from "../tools/basket_update";
import {
  DEFAULT_MODEL,
  HarnessLoopIterationLimitError,
  UnknownToolError,
  runHarnessLoop,
  type AnthropicClient,
} from "./loop";
import type { HarnessDeps, UseCaseCatalogPersistence } from "./tools";

function unusedUseCases(): UseCaseCatalogPersistence {
  return {
    getUseCase: vi.fn().mockRejectedValue(new Error("getUseCase should not be called in this test")),
    listUseCases: vi.fn().mockRejectedValue(new Error("listUseCases should not be called in this test")),
  };
}

function unusedBasketPersistence(): BasketPersistenceDeps {
  return {
    getBasket: vi.fn().mockRejectedValue(new Error("getBasket should not be called in this test")),
    saveBasketItems: vi.fn().mockRejectedValue(new Error("saveBasketItems should not be called in this test")),
  };
}

function baseDeps(overrides: Partial<HarnessDeps> = {}): HarnessDeps {
  return {
    userId: "user-1",
    useCases: unusedUseCases(),
    basketPersistence: unusedBasketPersistence(),
    ...overrides,
  };
}

function textResponse(text: string): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    container: null,
    usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage,
  } as unknown as Anthropic.Message;
}

function toolUseResponse(id: string, name: string, input: unknown): Anthropic.Message {
  return {
    id: "msg_tool",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "tool_use", id, name, input, caller: { type: "direct" } }],
    stop_reason: "tool_use",
    stop_sequence: null,
    container: null,
    usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage,
  } as unknown as Anthropic.Message;
}

/**
 * The loop mutates and reuses the same `messages` array reference across
 * iterations (pushing the assistant turn, then the tool_result turn, before
 * the *next* `create` call). A plain `vi.fn()`'s `.mock.calls` would store
 * that same array *reference*, not a snapshot -- so inspecting it later
 * would show every recorded call's `messages` mutated to their *final*
 * state, not what was actually sent at call time. `calls` below instead
 * records a `structuredClone` of `params` at the moment of each `create`
 * invocation, giving every entry an honest point-in-time snapshot.
 */
function mockClient(...responses: Anthropic.Message[]) {
  let index = 0;
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(params));
    const response = responses[index];
    index++;
    if (!response) throw new Error("mockClient: ran out of queued responses");
    return response;
  });
  const client: AnthropicClient = { messages: { create } };
  return { client, create, calls };
}

describe("runHarnessLoop -- control flow", () => {
  it("terminates immediately on a final (no tool_use) response, with no tool dispatch", async () => {
    const { client, create } = mockClient(textResponse("Hello! How can I help?"));

    const result = await runHarnessLoop("hi", [], baseDeps(), { client });

    expect(result.finalText).toBe("Hello! How can I help?");
    expect(result.iterations).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("dispatches a tool_use block to the matching registry handler and feeds the tool_result back", async () => {
    const items = [{ name: "A", qty: 1, category: "x", owned: true, source_item_id: "a" }];
    const { client, create, calls } = mockClient(
      toolUseResponse("call_1", "check_inventory", { items }),
      textResponse("You already own item A."),
    );

    const result = await runHarnessLoop("what do I still need?", [], baseDeps(), { client });

    expect(result.finalText).toBe("You already own item A.");
    expect(create).toHaveBeenCalledTimes(2);

    // Second request's messages must include the tool_result for call_1.
    const toolResultMessage = calls[1].messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((c: { type: string }) => c.type === "tool_result"),
    );
    expect(toolResultMessage).toBeDefined();
    const toolResultBlock = (toolResultMessage!.content as Anthropic.ToolResultBlockParam[]).find(
      (c) => c.tool_use_id === "call_1",
    )!;
    expect(toolResultBlock.is_error).toBeUndefined();
    expect(JSON.parse(toolResultBlock.content as string)).toEqual({
      needsSourcing: [],
      alreadyOwned: items,
    });
  });

  it("handles multiple tool_use blocks in one response, dispatching each and returning one tool_result per call", async () => {
    const { client, calls } = mockClient(
      {
        ...toolUseResponse("call_1", "check_inventory", { items: [] }),
        content: [
          { type: "tool_use", id: "call_1", name: "check_inventory", input: { items: [] }, caller: { type: "direct" } },
          { type: "tool_use", id: "call_2", name: "check_inventory", input: { items: [] }, caller: { type: "direct" } },
        ],
      } as unknown as Anthropic.Message,
      textResponse("done"),
    );

    await runHarnessLoop("go", [], baseDeps(), { client });

    const toolResultMessage = calls[1].messages.at(-1)!;
    expect((toolResultMessage.content as Anthropic.ToolResultBlockParam[]).map((c) => c.tool_use_id)).toEqual([
      "call_1",
      "call_2",
    ]);
  });

  it("a registered tool handler's own error is fed back as an is_error tool_result and the loop continues (does not throw)", async () => {
    const { client, calls } = mockClient(
      // memory_write with no `source` -> throws MemoryBoundaryError inside the handler.
      toolUseResponse("call_1", "memory_write", { dietary_prefs: ["vegan"] }),
      textResponse("Got it, I won't remember that without confirmation."),
    );

    const result = await runHarnessLoop("remember I'm vegan", [], baseDeps(), { client });

    expect(result.finalText).toBe("Got it, I won't remember that without confirmation.");
    const toolResultMessage = calls[1].messages.at(-1)!;
    const toolResultBlock = (toolResultMessage.content as Anthropic.ToolResultBlockParam[])[0];
    expect(toolResultBlock.is_error).toBe(true);
    expect(toolResultBlock.content).toMatch(/user_confirmed/);
  });

  it("an unknown tool name fails loudly -- throws UnknownToolError and aborts the loop (no further API calls)", async () => {
    const { client, create } = mockClient(toolUseResponse("call_1", "not_a_real_tool", {}));

    await expect(runHarnessLoop("do something", [], baseDeps(), { client })).rejects.toThrow(UnknownToolError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("gives up with HarnessLoopIterationLimitError if the model never stops calling tools", async () => {
    const { client, create } = mockClient(
      toolUseResponse("call_1", "check_inventory", { items: [] }),
      toolUseResponse("call_2", "check_inventory", { items: [] }),
      toolUseResponse("call_3", "check_inventory", { items: [] }),
    );

    await expect(
      runHarnessLoop("loop forever", [], baseDeps(), { client, maxIterations: 2 }),
    ).rejects.toThrow(HarnessLoopIterationLimitError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("passes prior history through and appends the new user turn before the first request", async () => {
    const { client, calls } = mockClient(textResponse("continuing"));
    const history: Anthropic.MessageParam[] = [
      { role: "user", content: "first message" },
      { role: "assistant", content: "first reply" },
    ];

    await runHarnessLoop("second message", history, baseDeps(), { client });

    expect(calls[0].messages).toEqual([...history, { role: "user", content: "second message" }]);
  });

  it("sends every registered tool's name in the request's tools list", async () => {
    const { client, calls } = mockClient(textResponse("ok"));
    await runHarnessLoop("hi", [], baseDeps(), { client });

    const names = (calls[0].tools ?? []).map((t) => (t as Anthropic.Tool).name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search_usecases",
        "get_usecase",
        "adjust_scenario",
        "generate_list",
        "check_inventory",
        "resolve_products",
        "memory_read",
        "memory_write",
        "basket_update",
      ]),
    );
  });
});

describe("runHarnessLoop -- extensibility smoke test", () => {
  it("a tool registered only for this test is dispatched correctly without any loop change", async () => {
    // Prove the "adding a 9th tool means one registry entry, not a loop
    // change" claim: register a throwaway tool directly on TOOL_REGISTRY
    // (mutating the shared module map, restored after the test) and confirm
    // the loop dispatches to it with zero changes to loop.ts.
    const { TOOL_REGISTRY } = await import("./tools");
    TOOL_REGISTRY.__test_echo__ = {
      description: "test-only echo tool",
      input_schema: { type: "object", properties: { value: { type: "string" } } },
      handler: async (input) => ({ echoed: input }),
    };

    try {
      const { client, calls } = mockClient(
        toolUseResponse("call_1", "__test_echo__", { value: "hi" }),
        textResponse("echoed"),
      );

      const result = await runHarnessLoop("echo hi", [], baseDeps(), { client });
      expect(result.finalText).toBe("echoed");

      const toolResultMessage = calls[1].messages.at(-1)!;
      const toolResultBlock = (toolResultMessage.content as Anthropic.ToolResultBlockParam[])[0];
      expect(JSON.parse(toolResultBlock.content as string)).toEqual({ echoed: { value: "hi" } });
    } finally {
      delete TOOL_REGISTRY.__test_echo__;
    }
  });
});
