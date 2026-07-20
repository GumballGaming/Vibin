import { randomUUID } from "node:crypto";
import { VibinError } from "../shared/errors";
import type { ChatMessage, ChatStreamEvent, ToolCall, ToolDefinition } from "../shared/types";
import { CODEX_ENDPOINT, CodexAuth } from "./codex-auth";
import type { Provider, ProviderRequestOptions, ReasoningEffort } from "./provider";

export const CODEX_OAUTH_MODEL = "gpt-5.3-codex";
export const codexReasoningEffort = (mode: string): ReasoningEffort => (["low", "medium", "high", "xhigh"].includes(mode) ? mode : "xhigh") as ReasoningEffort;

type ResponsesInput = Array<Record<string, unknown>>;
type FunctionCallState = { id: string; name: string; arguments: string };

export function toResponsesInput(messages: ChatMessage[]): ResponsesInput {
  const input: ResponsesInput = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.toolCallId ?? "", output: message.content ?? "" });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      if (message.content) input.push({ role: "assistant", content: [{ type: "output_text", text: message.content }] });
      for (const call of message.toolCalls) input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments });
      continue;
    }
    input.push({ role: message.role === "system" ? "developer" : message.role, content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.content ?? "" }] });
  }
  return input;
}

export function toResponsesTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({ type: "function", name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters, strict: false }));
}

export function toCodexRequest(model: string, messages: ChatMessage[], tools: ToolDefinition[], options: ProviderRequestOptions = {}): Record<string, unknown> {
  return { model, input: toResponsesInput(messages), tools: toResponsesTools(tools), stream: true, store: false, ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}) };
}

export class CodexResponsesProvider implements Provider {
  constructor(private readonly options: { model: string; auth: CodexAuth; endpoint?: string }) {}

  nativeReasoningEffort(mode: string): ReasoningEffort { return codexReasoningEffort(mode); }

  async *stream(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal, options: ProviderRequestOptions = {}): AsyncGenerator<ChatStreamEvent> {
    const credential = await this.options.auth.accessToken();
    const response = await fetch(this.options.endpoint ?? CODEX_ENDPOINT, {
      method: "POST", signal,
      headers: {
        Accept: "text/event-stream", "Content-Type": "application/json", Authorization: `Bearer ${credential.access}`,
        ...(credential.accountId ? { "ChatGPT-Account-Id": credential.accountId } : {}),
        originator: "vibin", "User-Agent": "vibin/0.1.0", "session-id": randomUUID(),
      },
      body: JSON.stringify(toCodexRequest(this.options.model, messages, tools, options)),
    });
    if (!response.ok || !response.body) throw new VibinError(`Codex provider request failed (${response.status}).`, (await response.text()).slice(0, 300));
    const decoder = new TextDecoder(); let buffer = ""; const calls = new Map<string, FunctionCallState>();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const raw of lines) {
        if (!raw.startsWith("data: ")) continue;
        const payload = raw.slice(6).trim(); if (!payload || payload === "[DONE]") continue;
        let event: Record<string, any>;
        try { event = JSON.parse(payload) as Record<string, any>; } catch { continue; }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") yield { type: "text", text: event.delta };
        if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
          const item = event.item as Record<string, any> | undefined;
          if (item?.type === "function_call") {
            const id = String(item.call_id ?? item.id ?? event.output_index ?? randomUUID());
            const prior = calls.get(id) ?? { id, name: "", arguments: "" };
            calls.set(id, { id, name: typeof item.name === "string" ? item.name : prior.name, arguments: typeof item.arguments === "string" ? item.arguments : prior.arguments });
          }
        }
        if (event.type === "response.function_call_arguments.delta" && typeof event.delta === "string") {
          const id = String(event.item_id ?? event.output_index ?? ""); const prior = calls.get(id) ?? { id, name: "", arguments: "" };
          calls.set(id, { ...prior, arguments: prior.arguments + event.delta });
        }
        if (event.type === "response.function_call_arguments.done" && typeof event.arguments === "string") {
          const id = String(event.item_id ?? event.output_index ?? ""); const prior = calls.get(id) ?? { id, name: "", arguments: "" };
          calls.set(id, { ...prior, arguments: event.arguments });
        }
      }
    }
    for (const call of calls.values()) if (call.id && call.name) yield { type: "tool_call", call: call as ToolCall };
    yield { type: "done" };
  }
}
