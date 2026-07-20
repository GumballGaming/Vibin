import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EffectiveMcpServer } from "./mcp-config";

export type McpTrustStore = { projects: string[]; servers: Record<string, string> };
const empty = (): McpTrustStore => ({ projects: [], servers: {} });

export async function canonicalProjectPath(cwd: string): Promise<string> {
  const path = await realpath(cwd).catch(() => resolve(cwd));
  return process.platform === "win32" ? path.toLowerCase() : path;
}

export async function loadMcpTrust(path: string): Promise<McpTrustStore> {
  if (!existsSync(path)) return empty();
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return {
      projects: Array.isArray(raw.projects) ? raw.projects.filter((item): item is string => typeof item === "string") : [],
      servers: raw.servers && typeof raw.servers === "object" && !Array.isArray(raw.servers) ? Object.fromEntries(Object.entries(raw.servers).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
    };
  } catch { return empty(); }
}

export async function writeMcpTrustAtomic(path: string, trust: McpTrustStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(`${JSON.stringify(trust, null, 2)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

export function serverTrustKey(server: EffectiveMcpServer, projectIdentity: string): string {
  return `${server.source}:${server.source === "project" ? projectIdentity : "global"}:${server.name}`;
}

export function serverFingerprint(server: EffectiveMcpServer, projectIdentity: string, appCwd: string): string {
  const env = Object.entries(server.config.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const payload = { source: server.source, project: server.source === "project" ? projectIdentity : null, name: server.name, command: server.config.command, args: server.config.args, cwd: resolve(appCwd, server.config.cwd ?? appCwd), env };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function formatLaunchTrustPreview(server: EffectiveMcpServer, appCwd: string, maxLength = 4_000): string {
  const text = [`Server: ${server.name}`, `Scope: ${server.source}`, `Command: ${server.config.command}`, `Args: ${JSON.stringify(server.config.args)}`, `Working directory: ${resolve(appCwd, server.config.cwd ?? appCwd)}`, `Environment names: ${Object.keys(server.config.env ?? {}).join(", ") || "none"}`].join("\n");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 24)}\n[MCP preview truncated]`;
}
