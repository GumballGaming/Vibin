import { readFile } from "node:fs/promises";
import { globalMcpPath, loadMcpConfig, mergeMcpConfigs, parseMcpImport, projectMcpPath, writeMcpConfigAtomic, type McpConfig } from "../config/mcp-config";
import { VibinError } from "../shared/errors";
import { TerminalUI } from "./ui";

const usage = "vibin mcp add [json-file] · vibin mcp list · vibin mcp remove";

export async function handleMcpCommand(args: string[], cwd: string, dataDir: string): Promise<boolean> {
  if (args[0] !== "mcp") return false;
  const ui = new TerminalUI(); const action = args[1];
  if (!action || !["add", "list", "remove"].includes(action)) throw new VibinError("MCP command not understood.", usage);
  const globalPath = globalMcpPath(dataDir); const projectPath = projectMcpPath(cwd);
  if (action === "list") {
    const merged = mergeMcpConfigs(await loadMcpConfig(globalPath), await loadMcpConfig(projectPath));
    ui.panel("MCP SERVERS", merged.length ? merged.map((entry) => `${entry.name}${entry.overridden ? " (project override)" : ""}\n  ${entry.source} · ${entry.config.command} · ${entry.config.autoApprove ? "tool calls trusted" : "approval required"}`).join("\n") : "No MCP servers configured.");
    return true;
  }
  if (action === "add") {
    const scope = await ui.choose("MCP SCOPE", [{ value: "global", label: "Global", detail: "Available in every Vibin project." }, { value: "project", label: "Project", detail: "Available only in this project after project trust." }]);
    const text = args[2] ? await readFile(args[2], "utf8").catch(() => { throw new VibinError(`Could not read MCP import file '${args[2]}'.`); }) : await ui.multiline("Paste MCP JSON");
    const entries = parseMcpImport(text); const path = scope === "global" ? globalPath : projectPath; const original = await loadMcpConfig(path); const updated: McpConfig = { mcpServers: { ...original.mcpServers } }; let completed = 0;
    for (const entry of entries) {
      const name = (await ui.ask(`Name for '${entry.sourceLabel}':`)).trim();
      if (!name) {
        if (completed && await ui.confirm(`Import the ${completed} completed server${completed === 1 ? "" : "s"}?`)) break;
        ui.info("MCP import cancelled."); return true;
      }
      if (updated.mcpServers[name] && !(await ui.confirm(`Replace existing MCP server '${name}'?`))) continue;
      updated.mcpServers[name] = entry.config; completed += 1;
    }
    if (completed) { await writeMcpConfigAtomic(path, updated); ui.info(`Saved ${completed} MCP server${completed === 1 ? "" : "s"}.`); }
    return true;
  }
  const globalConfig = await loadMcpConfig(globalPath); const projectConfig = await loadMcpConfig(projectPath);
  const choices = [...Object.keys(globalConfig.mcpServers).map((name) => ({ value: `global\0${name}`, label: name, detail: "Global server" })), ...Object.keys(projectConfig.mcpServers).map((name) => ({ value: `project\0${name}`, label: name, detail: "Project server" }))];
  if (!choices.length) { ui.info("No MCP servers configured."); return true; }
  const [scope, name] = (await ui.choose("REMOVE MCP SERVER", choices)).split("\0");
  if (!name || !(await ui.confirm(`Remove ${scope} MCP server '${name}'?`))) return true;
  const config = scope === "global" ? globalConfig : projectConfig; delete config.mcpServers[name];
  await writeMcpConfigAtomic(scope === "global" ? globalPath : projectPath, config); ui.info(`Removed MCP server '${name}'.`); return true;
}
