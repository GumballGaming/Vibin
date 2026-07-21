import type { ThinkingMode } from "../shared/types";

export type { ThinkingMode } from "../shared/types";

export const THINKING_MODES: Array<{ value: ThinkingMode; label: string; detail: string }> = [
  { value: "low", label: "Low", detail: "Fast, direct answers with minimal deliberation." },
  { value: "medium", label: "Medium", detail: "Balanced reasoning for everyday coding work." },
  { value: "high", label: "High", detail: "Thorough reasoning and stronger verification." },
  { value: "xhigh", label: "XHigh", detail: "Extra-deep analysis for complex tasks." },
];

export const isThinkingMode = (value: string): value is ThinkingMode => THINKING_MODES.some((mode) => mode.value === value.toLowerCase());
export const thinkingInstruction = (mode: ThinkingMode): string => ({
  low: "Thinking mode: Low. Be direct and avoid unnecessary analysis.",
  medium: "Thinking mode: Medium. Balance careful reasoning with concise progress.",
  high: "Thinking mode: High. Analyze requirements, risks, and verification carefully before acting.",
  xhigh: "Thinking mode: XHigh. Perform extra-deep analysis, consider alternatives, and validate assumptions before acting.",
})[mode];
