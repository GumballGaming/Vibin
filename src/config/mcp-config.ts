import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { VibinError } from "../shared/errors";

export type McpServerConfig = { command: string; args: string[]; env?: Record<string, string>; cwd?: string; autoApprove: boolean };
export type McpConfig = { mcpServers: Record<string, McpServerConfig> };
export type McpImportEntry = { sourceLabel: string; config: McpServerConfig };
export type EffectiveMcpServer = { name: string; source: "global" | "project"; overridden: boolean; config: McpServerConfig };

const empty = (): McpConfig => ({ mcpServers: {} });
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function parseMcpServer(value: unknown, label = "server"): McpServerConfig {
  if (!record(value)) throw new VibinError(`Invalid MCP ${label}: expected an object.`);
  if (typeof value.command !== "string" || !value.command.trim()) throw new VibinError(`Invalid MCP ${label}: 'command' must be a non-empty string.`);
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string"))) throw new VibinError(`Invalid MCP ${label}: 'args' must contain only strings.`);
  if (value.env !== undefined && (!record(value.env) || Object.values(value.env).some((item) => typeof item !== "string"))) throw new VibinError(`Invalid MCP ${label}: 'env' must contain only string values.`);
  if (value.cwd !== undefined && (typeof value.cwd !== "string" || !value.cwd.trim())) throw new VibinError(`Invalid MCP ${label}: 'cwd' must be a non-empty string.`);
  if (value.autoApprove !== undefined && typeof value.autoApprove !== "boolean") throw new VibinError(`Invalid MCP ${label}: 'autoApprove' must be a boolean.`);
  return {
    command: value.command,
    args: value.args ? [...value.args as string[]] : [],
    ...(value.env ? { env: { ...value.env as Record<string, string> } } : {}),
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    autoApprove: value.autoApprove === true,
  };
}

export function parseMcpImport(text: string): McpImportEntry[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new VibinError("Could not parse MCP JSON.", "Check the JSON and try again."); }
  if (!record(value)) throw new VibinError("Invalid MCP import: expected an object.");
  if (Object.hasOwn(value, "mcpServers")) {
    if (!record(value.mcpServers) || !Object.keys(value.mcpServers).length) throw new VibinError("Invalid MCP import: 'mcpServers' must be a non-empty object.");
    return Object.entries(value.mcpServers).map(([label, server]) => ({ sourceLabel: label, config: parseMcpServer(server, `'${label}'`) }));
  }
  return [{ sourceLabel: "imported server", config: parseMcpServer(value) }];
}

export function validateMcpConfig(value: McpConfig): McpConfig {
  if (!record(value) || !record(value.mcpServers)) throw new VibinError("Invalid MCP configuration.");
  return { mcpServers: Object.fromEntries(Object.entries(value.mcpServers).map(([name, server]) => {
    if (!name.trim()) throw new VibinError("Invalid MCP configuration: server names cannot be blank.");
    return [name, parseMcpServer(server, `'${name}'`)];
  })) };
}

export async function loadMcpConfig(path: string): Promise<McpConfig> {
  if (!existsSync(path)) return empty();
  try { return validateMcpConfig(JSON.parse(await readFile(path, "utf8")) as McpConfig); }
  catch (error) { if (error instanceof VibinError) throw error; throw new VibinError(`Could not parse MCP configuration at '${path}'.`); }
}

export async function writeMcpConfigAtomic(path: string, config: McpConfig): Promise<void> {
  const validated = validateMcpConfig(config); const folder = dirname(path);
  await mkdir(folder, { recursive: true });
  const temporary = join(folder, `.mcp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  try {
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

export function mergeMcpConfigs(globalConfig: McpConfig, projectConfig: McpConfig): EffectiveMcpServer[] {
  const result: EffectiveMcpServer[] = Object.entries(globalConfig.mcpServers).map(([name, config]) => ({ name, source: "global", overridden: Boolean(projectConfig.mcpServers[name]), config }));
  return [...result.filter((entry) => !entry.overridden), ...Object.entries(projectConfig.mcpServers).map(([name, config]) => ({ name, source: "project" as const, overridden: Boolean(globalConfig.mcpServers[name]), config }))];
}

export const globalMcpPath = (dataDir: string): string => join(dataDir, "mcp.json");
export const projectMcpPath = (cwd: string): string => join(cwd, ".vibin", "mcp.json");
