import { VibinError } from "../shared/errors";
import type { ChatMessage, ChatStreamEvent, ToolCall, ToolDefinition } from "../shared/types";
import type { Provider, ProviderRequestOptions, ReasoningEffort } from "./provider";

type ChoiceDelta = { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };

export class OpenAICompatibleProvider implements Provider {
  constructor(private readonly options: { apiKey: string; baseUrl: string; model: string; appName?: string; supportsNativeReasoning?: boolean }) {}

  nativeReasoningEffort(mode: string): ReasoningEffort | undefined {
    if (!this.options.supportsNativeReasoning || !/^(gpt-5|o[134])(?:[.-]|$)/i.test(this.options.model)) return undefined;
    return (["low", "medium", "high", "xhigh"].includes(mode) ? mode : "xhigh") as ReasoningEffort;
  }

  async *stream(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal, options: ProviderRequestOptions = {}): AsyncGenerator<ChatStreamEvent> {
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey}`, ...(this.options.appName ? { "X-Title": this.options.appName } : {}) },
        body: JSON.stringify({ model: this.options.model, messages, tools, tool_choice: "auto", stream: true, ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}) }),
      });
    } catch (error) {
      if (signal?.aborted) throw new VibinError("Request cancelled.");
      throw new VibinError("Could not reach the AI provider.", error instanceof Error ? error.message : undefined);
    }
    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new VibinError(`Provider request failed (${response.status}).`, detail.slice(0, 300));
    }
    const decoder = new TextDecoder(); let buffer = "";
    const calls = new Map<number, ToolCall>();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const raw of lines) {
        if (!raw.startsWith("data: ")) continue;
        const payload = raw.slice(6).trim(); if (payload === "[DONE]") continue;
        try {
          const delta = (JSON.parse(payload).choices?.[0]?.delta ?? {}) as ChoiceDelta;
          if (delta.content) yield { type: "text", text: delta.content };
          for (const part of delta.tool_calls ?? []) {
            const prior = calls.get(part.index) ?? { id: "", name: "", arguments: "" };
            calls.set(part.index, { id: part.id ?? prior.id, name: part.function?.name ?? prior.name, arguments: prior.arguments + (part.function?.arguments ?? "") });
          }
        } catch { /* ignore incomplete/nonstandard SSE frames */ }
      }
    }
    for (const call of calls.values()) if (call.id && call.name) yield { type: "tool_call", call };
    yield { type: "done" };
  }
}
