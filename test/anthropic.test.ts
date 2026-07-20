import { expect, test } from "bun:test";
import { AnthropicProvider, toAnthropicRequest } from "../src/api/anthropic";
import type { ChatMessage, ToolDefinition } from "../src/shared/types";

const tool: ToolDefinition = { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } };

test("adapts Vibin messages and tools to Anthropic Messages format", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "rules" }, { role: "user", content: "inspect" },
    { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"x"}' }] },
    { role: "tool", content: "contents", toolCallId: "call_1" },
  ];
  expect(toAnthropicRequest(messages, [tool])).toEqual({
    model: "", max_tokens: 8192, stream: true, system: "rules",
    messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "contents" }] },
    ],
    tools: [{ name: "read_file", description: "Read a file", input_schema: tool.function.parameters }],
  });
});

test("streams Anthropic text and tool-use SSE events", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    expect(init?.headers).toMatchObject({ "x-api-key": "secret", "anthropic-version": "2023-06-01" });
    const body = [
      "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
      "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n",
      "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call_1\",\"name\":\"read_file\",\"input\":{}}}\n\n",
      "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\\\"x\\\"}\"}}\n\n",
      "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
      "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
    ].join("");
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  try {
    const events = [];
    for await (const event of new AnthropicProvider({ apiKey: "secret", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" }).stream([{ role: "user", content: "hi" }], [tool])) events.push(event);
    expect(events).toContainEqual({ type: "text", text: "Hello" });
    expect(events).toContainEqual({ type: "tool_call", call: { id: "call_1", name: "read_file", arguments: '{"path":"x"}' } });
  } finally { globalThis.fetch = originalFetch; }
});
