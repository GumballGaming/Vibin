import { VibinError } from "../shared/errors";
import type { ChatMessage, ChatStreamEvent, ToolCall, ToolDefinition } from "../shared/types";
import type { Provider, ProviderRequestOptions } from "./provider";

type AnthropicContent = Record<string, unknown>;
type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContent[] };

export function toAnthropicRequest(messages: ChatMessage[], tools: ToolDefinition[]): Record<string, unknown> {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n\n");
  const converted: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      const result: AnthropicContent = { type: "tool_result", tool_use_id: message.toolCallId ?? "", content: message.content ?? "" };
      const prior = converted.at(-1);
      if (prior?.role === "user" && Array.isArray(prior.content)) prior.content.push(result);
      else converted.push({ role: "user", content: [result] });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: AnthropicContent[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        let input: unknown = {};
        try { input = JSON.parse(call.arguments); } catch { /* the provider will receive an empty input for malformed history */ }
        content.push({ type: "tool_use", id: call.id, name: call.name, input });
      }
      converted.push({ role: "assistant", content });
      continue;
    }
    converted.push({ role: message.role === "assistant" ? "assistant" : "user", content: message.content ?? "" });
  }
  const request: Record<string, unknown> = { model: "", max_tokens: 8192, messages: converted, stream: true };
  if (system) request.system = system;
  if (tools.length) request.tools = tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }));
  return request;
}

export class AnthropicProvider implements Provider {
  constructor(private readonly options: { apiKey: string; baseUrl: string; model: string; maxTokens?: number }) {}

  async *stream(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal, _options: ProviderRequestOptions = {}): AsyncGenerator<ChatStreamEvent> {
    const request = toAnthropicRequest(messages, tools);
    request.model = this.options.model;
    request.max_tokens = this.options.maxTokens ?? 8192;
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST", signal, headers: { Accept: "text/event-stream", "Content-Type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify(request),
      });
    } catch (error) {
      if (signal?.aborted) throw new VibinError("Request cancelled.");
      throw new VibinError("Could not reach the Anthropic provider.", error instanceof Error ? error.message : undefined);
    }
    if (!response.ok || !response.body) throw new VibinError(`Anthropic provider request failed (${response.status}).`, (await response.text()).slice(0, 300));
    const decoder = new TextDecoder(); let buffer = ""; let eventName = ""; let finished = false; const toolsByIndex = new Map<number, ToolCall>();
    const process = (raw: string): ChatStreamEvent[] => {
      if (raw.startsWith("event: ")) { eventName = raw.slice(7).trim(); return []; }
      if (!raw.startsWith("data: ")) return [];
      let event: Record<string, any>;
      try { event = JSON.parse(raw.slice(6)); } catch { return []; }
      if (event.type === "error") throw new VibinError("Anthropic provider returned an error.", String(event.error?.message ?? "Unknown API error."));
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") toolsByIndex.set(event.index, { id: String(event.content_block.id ?? ""), name: String(event.content_block.name ?? ""), arguments: "" });
      if (event.type === "content_block_delta") {
        if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") return [{ type: "text", text: event.delta.text }];
        if (event.delta?.type === "input_json_delta" && typeof event.delta.partial_json === "string") { const prior = toolsByIndex.get(event.index); if (prior) prior.arguments += event.delta.partial_json; }
      }
      if (event.type === "content_block_stop") { const call = toolsByIndex.get(event.index); if (call?.id && call.name) return [{ type: "tool_call", call }]; }
      if (eventName === "message_stop" || event.type === "message_stop") { finished = true; return [{ type: "done" }]; }
      return [];
    };
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
      for (const line of lines) for (const output of process(line)) yield output;
    }
    if (buffer.trim()) for (const output of process(buffer)) yield output;
    if (!finished) yield { type: "done" };
  }
}
