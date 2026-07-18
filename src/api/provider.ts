import type { ChatMessage, ChatStreamEvent, ToolDefinition } from "../shared/types";

export interface Provider {
  stream(messages: ChatMessage[], tools: ToolDefinition[], signal?: AbortSignal): AsyncGenerator<ChatStreamEvent>;
}
