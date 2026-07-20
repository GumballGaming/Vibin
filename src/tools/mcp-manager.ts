import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import type { ToolDefinition } from "../shared/types";
import type { EffectiveMcpServer } from "../config/mcp-config";

export const MCP_MAX_CONTENT_ITEM_TEXT = 16_000;
export const MCP_MAX_COMBINED_RESULT = 48_000;
export const MCP_MAX_ERROR_TEXT = 2_000;
export const MCP_MAX_SERVER_INSTRUCTIONS = 8_000;
export const MCP_MAX_COMBINED_INSTRUCTIONS = 24_000;
export const MCP_MAX_APPROVAL_PREVIEW = 4_000;
export const MCP_CONNECTION_TIMEOUT_MS = 10_000;
export const MCP_INITIALIZATION_CONCURRENCY = 4;
export const MCP_SHUTDOWN_TIMEOUT_MS = 5_000;

export type McpServerInstruction = { server: string; text: string };
export type McpWarning = { server: string; message: string };
export interface McpInitializationResult { tools: ToolDefinition[]; instructions: McpServerInstruction[]; warnings: McpWarning[] }
type Registration = { server: EffectiveMcpServer; originalName: string; registeredName: string; client: Client };
type Active = { client: Client; transport: StdioClientTransport };
type Approval = (preview: string) => Promise<boolean>;

const truncate = (text: string, max: number, marker: string): string => text.length <= max ? text : `${text.slice(0, Math.max(0, max - marker.length - 1))}\n${marker}`;
const withTimeout = async <T>(promise: Promise<T>, timeout: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); })]); }
  finally { if (timer) clearTimeout(timer); }
};

export function sanitizeMcpName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!sanitized) throw new Error("MCP name has no supported ASCII letters or digits.");
  return sanitized;
}

const unsupportedSchemaKeys = new Set(["$ref", "oneOf", "anyOf", "allOf", "not", "if", "then", "else", "patternProperties", "dependentSchemas", "unevaluatedProperties"]);
export function isSupportedMcpSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schema = value as Record<string, unknown>;
  if (Object.keys(schema).some((key) => unsupportedSchemaKeys.has(key))) return false;
  if (Array.isArray(schema.items)) return false;
  if (schema.items !== undefined && !isSupportedMcpSchema(schema.items)) return false;
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return false;
    if (!Object.values(schema.properties).every(isSupportedMcpSchema)) return false;
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object" && !isSupportedMcpSchema(schema.additionalProperties)) return false;
  return true;
}

export function flattenMcpResult(result: unknown): string {
  const raw = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const content = Array.isArray(raw.content) ? raw.content : [];
  const parts = content.map((item): string => {
    if (!item || typeof item !== "object") return "[Unsupported MCP content]";
    const value = item as Record<string, unknown>; const type = String(value.type ?? "unknown");
    if (type === "text") return truncate(String(value.text ?? ""), MCP_MAX_CONTENT_ITEM_TEXT, "[MCP content item truncated]");
    if (type === "structured" || type === "json") return truncate(JSON.stringify(value.data ?? value.value ?? value), MCP_MAX_CONTENT_ITEM_TEXT, "[MCP content item truncated]");
    if (type === "image") return "[MCP image content omitted]";
    if (type === "audio") return "[MCP audio content omitted]";
    if (type === "resource" || type === "resource_link") return "[MCP embedded resource omitted]";
    if (type === "blob" || type === "binary") return "[MCP binary content omitted]";
    return `[Unsupported MCP content: ${type}]`;
  });
  if (raw.structuredContent !== undefined) parts.push(truncate(JSON.stringify(raw.structuredContent), MCP_MAX_CONTENT_ITEM_TEXT, "[MCP content item truncated]"));
  const text = parts.join("\n");
  return truncate(raw.isError ? `MCP tool error: ${text}` : text, raw.isError ? MCP_MAX_ERROR_TEXT : MCP_MAX_COMBINED_RESULT, raw.isError ? "[MCP error truncated]" : "[MCP result truncated]");
}

const secretKeys = new Set(["token", "password", "passwd", "secret", "apikey", "api_key", "authorization", "cookie", "privatekey", "private_key"]);
export function formatMcpApprovalPreview(server: string, originalTool: string, registeredTool: string, args: unknown): string {
  const seen = new WeakSet<object>();
  const safe = (value: unknown, depth: number, key = ""): unknown => {
    const lowered = key.toLowerCase();
    if (secretKeys.has(lowered) || lowered.split(/[^a-z0-9]+/).some((segment) => secretKeys.has(segment))) return "[REDACTED]";
    if (typeof value === "string") return truncate(value, 500, "[truncated]");
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]"; if (depth >= 6) return "[Max depth]"; seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => safe(item, depth + 1));
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, safe(item, depth + 1, name)]));
  };
  return truncate(`Server: ${server}\nTool: ${originalTool}\nRegistered tool: ${registeredTool}\nArguments: ${JSON.stringify(safe(args, 0), null, 2)}`, MCP_MAX_APPROVAL_PREVIEW, "[MCP approval preview truncated]");
}

export class McpManager {
  private active: Active[] = [];
  private registrations = new Map<string, Registration>();
  private closing?: Promise<void>;
  constructor(private readonly approve: Approval, private readonly cwd: string, private readonly connectionTimeout = MCP_CONNECTION_TIMEOUT_MS) {}

  async initialize(servers: EffectiveMcpServer[]): Promise<McpInitializationResult> {
    const result: McpInitializationResult = { tools: [], instructions: [], warnings: [] }; let cursor = 0;
    const worker = async (): Promise<void> => { while (cursor < servers.length) { const server = servers[cursor++]!; await this.initializeOne(server, result); } };
    await Promise.all(Array.from({ length: Math.min(MCP_INITIALIZATION_CONCURRENCY, servers.length) }, worker));
    let combined = 0;
    result.instructions = result.instructions.filter((item) => { combined += item.text.length; return combined <= MCP_MAX_COMBINED_INSTRUCTIONS; });
    return result;
  }

  private async initializeOne(server: EffectiveMcpServer, result: McpInitializationResult): Promise<void> {
    try { sanitizeMcpName(server.name); }
    catch { result.warnings.push({ server: server.name, message: "Skipped server: its name cannot be sanitized safely." }); return; }
    const transport = new StdioClientTransport({ command: server.config.command, args: server.config.args, ...(server.config.cwd ? { cwd: resolve(this.cwd, server.config.cwd) } : {}), ...(server.config.env ? { env: { ...process.env as Record<string, string>, ...server.config.env } } : {}), stderr: "ignore" });
    const client = new Client({ name: "vibin", version: "0.1.0" });
    try {
      await withTimeout(client.connect(transport), this.connectionTimeout, "connection timed out");
      this.active.push({ client, transport });
      const listed = await client.listTools();
      for (const tool of listed.tools) {
        let registeredName: string;
        try { registeredName = `mcp__${sanitizeMcpName(server.name)}__${sanitizeMcpName(tool.name)}`; }
        catch { result.warnings.push({ server: server.name, message: `Skipped tool '${tool.name}': its name cannot be sanitized safely.` }); continue; }
        if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) { result.warnings.push({ server: server.name, message: `Skipped tool '${tool.name}': invalid JSON Schema.` }); continue; }
        const collision = [...this.registrations.entries()].find(([name]) => name.toLowerCase() === registeredName.toLowerCase());
        if (collision) { const previous = collision[1]; result.warnings.push({ server: server.name, message: `Skipped '${server.name}/${tool.name}': conflicts with '${previous.server.name}/${previous.originalName}'.` }); continue; }
        this.registrations.set(registeredName, { server, originalName: tool.name, registeredName, client });
        result.tools.push({ type: "function", function: { name: registeredName, description: tool.description ?? `MCP tool from ${server.name}.`, parameters: tool.inputSchema as Record<string, unknown> } });
      }
      const instructions = client.getInstructions();
      if (typeof instructions === "string" && instructions.trim()) result.instructions.push({ server: server.name, text: truncate(instructions, MCP_MAX_SERVER_INSTRUCTIONS, "[MCP instructions truncated]") });
    } catch (error) {
      await transport.close().catch(() => undefined);
      result.warnings.push({ server: server.name, message: truncate(error instanceof Error ? error.message : "MCP initialization failed.", MCP_MAX_ERROR_TEXT, "[MCP error truncated]") });
    }
  }

  async call(registeredName: string, rawArguments: string): Promise<string> {
    const registration = this.registrations.get(registeredName); if (!registration) return `MCP tool unavailable: ${registeredName}`;
    let args: Record<string, unknown>; try { args = JSON.parse(rawArguments) as Record<string, unknown>; } catch { return "MCP tool arguments were invalid JSON."; }
    if (!registration.server.config.autoApprove && !(await this.approve(formatMcpApprovalPreview(registration.server.name, registration.originalName, registeredName, args)))) return "User declined the MCP tool call.";
    try { return flattenMcpResult(await registration.client.callTool({ name: registration.originalName, arguments: args })); }
    catch (error) { return truncate(`MCP tool error: ${error instanceof Error ? error.message : "unknown error"}`, MCP_MAX_ERROR_TEXT, "[MCP error truncated]"); }
  }

  closeAll(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const closing = Promise.allSettled(this.active.flatMap(({ client, transport }) => [client.close(), transport.close()]));
      let timedOut = false;
      try { await withTimeout(closing, MCP_SHUTDOWN_TIMEOUT_MS, "shutdown timed out"); } catch { timedOut = true; }
      if (timedOut) for (const { transport } of this.active) { const pid = transport.pid; if (pid) try { process.kill(pid); } catch { /* already exited */ } }
      this.active = []; this.registrations.clear();
    })();
    return this.closing;
  }
}
