export type ThinkingMode = "low" | "medium" | "high" | "xhigh" | "maxthinking" | "ultraagent";

export const THINKING_MODES: Array<{ value: ThinkingMode; label: string; detail: string }> = [
  { value: "low", label: "Low", detail: "Fast, direct answers with minimal deliberation." },
  { value: "medium", label: "Medium", detail: "Balanced reasoning for everyday coding work." },
  { value: "high", label: "High", detail: "Thorough reasoning and stronger verification." },
  { value: "xhigh", label: "XHigh", detail: "Extra-deep analysis for complex tasks." },
  { value: "maxthinking", label: "MaxThinking", detail: "Maximum-depth reasoning. Uses a lot of your quota/tokens." },
  { value: "ultraagent", label: "UltraAgent", detail: "Splits work into specialist sub-agents. Uses a lot of your quota/tokens." },
];

export const isThinkingMode = (value: string): value is ThinkingMode => THINKING_MODES.some((mode) => mode.value === value.toLowerCase());
export const thinkingInstruction = (mode: ThinkingMode): string => ({
  low: "Thinking mode: Low. Be direct and avoid unnecessary analysis.",
  medium: "Thinking mode: Medium. Balance careful reasoning with concise progress.",
  high: "Thinking mode: High. Analyze requirements, risks, and verification carefully before acting.",
  xhigh: "Thinking mode: XHigh. Perform extra-deep analysis, consider alternatives, and validate assumptions before acting.",
  maxthinking: "Thinking mode: MaxThinking. Use maximum-depth reasoning: decompose the task, consider edge cases and alternatives, and verify every important conclusion. This mode consumes a lot of quota/tokens.",
  ultraagent: "Thinking mode: UltraAgent. Specialist sub-agents will provide independent analysis before you act. Synthesize their findings carefully. This mode consumes a lot of quota/tokens.",
})[mode];
