import { expect, test } from "bun:test";
import { CODEX_OAUTH_MODEL, codexReasoningEffort, toCodexRequest, toResponsesInput, toResponsesTools } from "../src/api/codex-responses";
import type { ChatMessage, ToolDefinition } from "../src/shared/types";

test("adapts Vibin messages and tool results to Responses input", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "inspect" },
    { role: "assistant", content: null, toolCalls: [{ id: "call_1", name: "read_file", arguments: '{"path":"x"}' }] },
    { role: "tool", content: "contents", toolCallId: "call_1" },
  ];
  expect(toResponsesInput(messages)).toEqual([
    { role: "developer", content: [{ type: "input_text", text: "rules" }] },
    { role: "user", content: [{ type: "input_text", text: "inspect" }] },
    { type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"x"}' },
    { type: "function_call_output", call_id: "call_1", output: "contents" },
  ]);
});

test("adapts Vibin function definitions to Responses tools", () => {
  const tool: ToolDefinition = { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object" } } };
  expect(toResponsesTools([tool])).toEqual([{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object" }, strict: false }]);
});

test("uses the only supported ChatGPT/Codex OAuth model", () => {
  expect(CODEX_OAUTH_MODEL).toBe("gpt-5.3-codex");
});

test("maps Vibin thinking levels to supported Codex reasoning effort", () => {
  expect(codexReasoningEffort("low")).toBe("low");
  expect(codexReasoningEffort("xhigh")).toBe("xhigh");
});

test("sends native reasoning effort to Codex", () => {
  expect(toCodexRequest(CODEX_OAUTH_MODEL, [], [], { reasoningEffort: "xhigh" })).toMatchObject({ reasoning: { effort: "xhigh" } });
});
