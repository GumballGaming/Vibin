export type Command = { type: "help" | "status" | "clear" | "compact" | "quit" | "history" | "context" | "config" } | { type: "model" | "provider" | "files" | "read" | "search" | "plan" | "session" | "thinking"; value: string } | { type: "unknown" };
export function parseCommand(input: string): Command | null {
  if (!input.startsWith("/")) return null;
  const [name, ...rest] = input.slice(1).trim().split(/\s+/); const value = rest.join(" ");
  if (["help", "status", "clear", "compact", "quit", "exit", "history", "context", "config"].includes(name ?? "")) return { type: name === "exit" ? "quit" : name as "help" | "status" | "clear" | "compact" | "quit" | "history" | "context" | "config" };
  if (["model", "provider", "files", "read", "search", "plan", "session", "thinking"].includes(name ?? "")) return { type: name as "model" | "provider" | "files" | "read" | "search" | "plan" | "session" | "thinking", value };
  return { type: "unknown" };
}
