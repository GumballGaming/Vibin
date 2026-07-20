import { expect, test } from "bun:test";
import { parseCommand } from "../src/cli/commands";
import { formatAssistantHeader, formatAssistantText, formatColoredPanel, formatPanel, formatPromptFrame, formatToolStatus, promptNeedsFullRedraw } from "../src/cli/ui";
import { color } from "../src/cli/theme";
import { VIBIN_SYSTEM_PROMPT } from "../src/agent/system-prompt";
import { toolDefinitions } from "../src/tools/definitions";

test("parses supported commands", () => {
  expect(parseCommand("/model gpt-4.1")).toEqual({ type: "model", value: "gpt-4.1" });
  expect(parseCommand("/provider use openrouter")).toEqual({ type: "provider", value: "use openrouter" });
  expect(parseCommand("/plan inspect @src/index.ts")).toEqual({ type: "plan", value: "inspect @src/index.ts" });
  expect(parseCommand("/session resume auth-fix")).toEqual({ type: "session", value: "resume auth-fix" });
  expect(parseCommand("/thinking xhigh")).toEqual({ type: "thinking", value: "xhigh" });
  expect(parseCommand("/compact")).toEqual({ type: "compact" });
  expect(parseCommand("/exit")).toEqual({ type: "quit" });
  expect(parseCommand("hello")).toBeNull();
});

test("system prompt protects context and verification", () => {
  expect(VIBIN_SYSTEM_PROMPT).toContain("smallest reliable context");
  expect(VIBIN_SYSTEM_PROMPT).toContain("Never claim success without evidence");
});

test("keeps the assistant header left-aligned", () => {
  expect(formatAssistantHeader()).toBe("  ✦ Vibin:");
  expect(formatAssistantHeader("plan")).toBe("  ✦ Vibin:");
});

test("aligns later assistant lines beneath the first reply word", () => {
  expect(formatAssistantText("Hello\nagain", 11)).toBe("Hello\n           again");
});

test("redraws the prompt only while autocomplete is active", () => {
  expect(promptNeedsFullRedraw("hello", "hello world")).toBeFalse();
  expect(promptNeedsFullRedraw("", "/")).toBeTrue();
  expect(promptNeedsFullRedraw("read ", "read @")).toBeTrue();
  expect(promptNeedsFullRedraw("/", "")).toBeTrue();
});

test("keeps the submitted user prompt in the rendered frame", () => {
  expect(formatPromptFrame("work", "test-model", "C:/workspace", "show my prompt")).toContain("  ❯ show my prompt");
});

test("renders concise tool activity without exposing model reasoning", () => {
  expect(formatToolStatus("write_file", '{"path":"src/app.ts"}')).toBe("Writing src/app.ts…");
  expect(formatToolStatus("search_files", '{"query":"provider"}')).toBe("Searching files…");
});

test("offers the main agent a subagent tool", () => {
  expect(toolDefinitions.some((tool) => tool.function.name === "spawn_subagent")).toBe(true);
});

test("renders panels as complete rectangles sized for their content", () => {
  const lines = formatPanel("TITLE", "short\na longer line");
  expect(lines.every((line) => line.length === lines[0]!.length)).toBeTrue();
  expect(lines[0]).toMatch(/^  ┌─ TITLE /);
  expect(lines.at(-1)).toMatch(/┘$/);
  expect(lines.slice(1, -1).every((line) => line.endsWith(" │"))).toBeTrue();
});

test("keeps the right panel border indigo after styled body content", () => {
  const line = formatColoredPanel("TITLE", color.dim("detail"))[1]!;
  expect(line).toEndWith("\x1b[94m │\x1b[0m");
});
