/**
 * The runtime tool-calling harness loop.
 *
 * Drives a standard Claude tool-use conversation: send `messages` + the
 * fixed tool registry (lib/harness/tools.ts) to the Anthropic Messages API,
 * dispatch any `tool_use` blocks in the response to the matching registry
 * handler, feed the `tool_result`s back as the next user turn, and repeat
 * until the model responds with no more tool calls (a final text answer).
 *
 * Extensibility: this file never branches on a tool's name -- it only does
 * `TOOL_REGISTRY[block.name]` and calls `.handler(...)`. Registering a ninth
 * tool is entirely a `lib/harness/tools.ts` change; this loop does not need
 * to be touched.
 *
 * The Anthropic client is injected (`options.client`), not constructed here
 * -- there is no ANTHROPIC_API_KEY in this environment (see task brief), so
 * this file is exercised in tests via a mocked client implementing just the
 * `messages.create` surface this loop actually calls (see AnthropicClient
 * below), never a live API call.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { TOOL_REGISTRY, type HarnessDeps } from "./tools";

/**
 * The minimal surface of `@anthropic-ai/sdk`'s client this loop depends on.
 * Declared as a narrow interface (not `Anthropic` itself) specifically so
 * tests can inject a plain mock object (`{ messages: { create: vi.fn() } }`)
 * without constructing a real SDK client (which requires an API key at
 * construction in some SDK versions) -- the real `Anthropic` instance
 * satisfies this structurally, no adapter needed.
 */
export interface AnthropicClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface HarnessLoopOptions {
  client: AnthropicClient;
  /** Defaults to DEFAULT_MODEL below; override per-call (e.g. to pin a specific snapshot). */
  model?: string;
  maxTokens?: number;
  system?: string;
  /**
   * Safety cap on tool-use round-trips before the loop gives up rather than
   * looping forever against a misbehaving model. Not part of the Anthropic
   * API itself -- a harness-side guard.
   */
  maxIterations?: number;
}

export interface HarnessLoopResult {
  /** The full conversation, including every assistant/tool_result turn produced this call -- pass back in as `history` for the next user turn. */
  messages: Anthropic.MessageParam[];
  /** Concatenated text of the final assistant turn's text blocks. */
  finalText: string;
  /** How many request/response round-trips it took to reach a final answer. */
  iterations: number;
}

export const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_MAX_ITERATIONS = 8;

/**
 * Thrown when a `tool_use` block names a tool that isn't in `TOOL_REGISTRY`.
 * This is a harness/registry bug (the tool list we told the model about is
 * out of sync with what we can actually dispatch), not a recoverable
 * per-call input error -- so, unlike a registered tool's handler throwing
 * (which is reported back to the model as an `is_error` tool_result so it
 * can retry/adjust), this aborts the loop immediately rather than silently
 * degrading.
 */
export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`harness loop: no tool named "${name}" is registered in TOOL_REGISTRY`);
    this.name = "UnknownToolError";
  }
}

/** Thrown when the loop exceeds maxIterations without the model producing a final (non-tool-use) turn. */
export class HarnessLoopIterationLimitError extends Error {
  constructor(maxIterations: number) {
    super(`harness loop: exceeded maxIterations (${maxIterations}) without a final response`);
    this.name = "HarnessLoopIterationLimitError";
  }
}

function toolDefinitionsForRequest(): Anthropic.Tool[] {
  return Object.entries(TOOL_REGISTRY).map(([name, def]) => ({
    name,
    description: def.description,
    input_schema: def.input_schema,
  }));
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Runs one user turn through the tool-calling loop to completion (a final
 * text response, or an error). `history` is the prior conversation (may be
 * empty for a new session); the new user message is appended before the
 * first request.
 */
export async function runHarnessLoop(
  userMessage: string,
  history: Anthropic.MessageParam[],
  deps: HarnessDeps,
  options: HarnessLoopOptions,
): Promise<HarnessLoopResult> {
  const {
    client,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    system,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = options;

  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userMessage }];
  const tools = toolDefinitionsForRequest();

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system !== undefined ? { system } : {}),
      messages,
      tools,
    });

    // Cast: Anthropic.Message's `content` (ContentBlock[], the *response*
    // shape) is structurally a superset of what MessageParam's `content`
    // (ContentBlockParam[], the *request* shape) needs for every block type
    // this loop round-trips (text, tool_use) -- see file header, this is
    // the standard "feed the assistant turn straight back in" pattern.
    messages.push({ role: "assistant", content: response.content as unknown as Anthropic.ContentBlockParam[] });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      return { messages, finalText: extractText(response.content), iterations: iteration };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const toolDef = TOOL_REGISTRY[block.name];
      if (!toolDef) {
        // Fail loudly: an unregistered tool name means the registry and the
        // tool list we sent the model are out of sync -- a harness bug, not
        // something the model can recover from by retrying. Abort the whole
        // loop rather than feeding back a degraded response.
        throw new UnknownToolError(block.name);
      }

      try {
        const result = await toolDef.handler(block.input, { deps });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result ?? null),
        });
      } catch (err) {
        // A registered tool's own error (bad input, not-found, a thrown
        // domain error like UnknownSlotError/MemoryBoundaryError) IS
        // recoverable from the model's perspective -- report it back as an
        // is_error tool_result so the model can adjust its next call,
        // rather than aborting the whole conversation.
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: err instanceof Error ? err.message : String(err),
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new HarnessLoopIterationLimitError(maxIterations);
}
