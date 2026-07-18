import type { ToolDefinition } from "../shared/types";

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
export const toolDefinitions: ToolDefinition[] = [
  { type: "function", function: { name: "list_files", description: "List files in a project-relative directory.", parameters: object({ path: { type: "string" } }) } },
  { type: "function", function: { name: "read_file", description: "Read a UTF-8 project-relative file.", parameters: object({ path: { type: "string" } }, ["path"]) } },
  { type: "function", function: { name: "search_files", description: "Search text in project files.", parameters: object({ query: { type: "string" }, path: { type: "string" } }, ["query"]) } },
  { type: "function", function: { name: "write_file", description: "Create or replace a UTF-8 project-relative file. Requires user approval.", parameters: object({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]) } },
  { type: "function", function: { name: "run_command", description: "Run a project-local shell command. Requires user approval.", parameters: object({ command: { type: "string" } }, ["command"]) } },
  { type: "function", function: { name: "spawn_subagent", description: "Spawn a read-only specialist to investigate a focused subtask. The subagent can list, read, and search project files, then returns a concise report. It cannot edit files or run commands.", parameters: object({ task: { type: "string" }, name: { type: "string" } }, ["task"]) } },
];

export const subagentToolDefinitions = toolDefinitions.filter((tool) => ["list_files", "read_file", "search_files"].includes(tool.function.name));
