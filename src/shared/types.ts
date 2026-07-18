export type ProviderName = "openai" | "openrouter" | "compatible" | "codex";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolCalls?: ToolCall[];
};

export type ToolCall = { id: string; name: string; arguments: string };
export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done" };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};
