import type { ChatMessage, ChatStreamEvent, ToolDefinition } from "../shared/types";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type ProviderRequestOptions = { reasoningEffort?: ReasoningEffort };

export interface Provider {
  nativeReasoningEffort?(mode: string): ReasoningEffort | undefined;
  stream(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal, options?: ProviderRequestOptions): AsyncGenerator<ChatStreamEvent>;
}
