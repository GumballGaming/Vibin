#!/usr/bin/env bun
import { resolve } from "node:path";
import { startApp } from "./cli/app";
import { loadConfig } from "./config/config";
import { VibinError } from "./shared/errors";
import { checkForUpdate, handleUpdateCommand } from "./shared/updater";
import { userVibinDir } from "./shared/paths";
import { handleMcpCommand } from "./cli/mcp";
import { TerminalUI } from "./cli/ui";
import { HeadlessUI } from "./cli/headless";
import { listModels, listCodexModels } from "./api/models";
import { CodexAuth } from "./api/codex-auth";

export async function runVibin(): Promise<void> {
  const args = process.argv.slice(2);
  const headless = args.includes("--headless");
  if (await handleUpdateCommand(args)) return;
  if (args.includes("--smoke")) { console.log("Vibin smoke check passed: CLI modules load."); return; }
  if (args.includes("--models")) {
    const dataDir = userVibinDir();
    const cfg = await loadConfig(process.cwd(), dataDir);
    const out: { models: string[]; provider?: string; model?: string; thinking?: string; error?: string } = {
      models: [],
      provider: cfg.provider,
      model: cfg.model,
      thinking: cfg.thinking,
    };
    try {
      if (cfg.provider === "codex") {
        out.models = await listCodexModels(new CodexAuth());
      } else if (cfg.apiKey && cfg.baseUrl) {
        out.models = await listModels({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, provider: cfg.provider });
      } else {
        out.error = "No provider configured. Run /provider add in the terminal.";
      }
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    }
    process.stdout.write(JSON.stringify(out) + "\n");
    return;
  }
  const cwd = process.cwd();
  const dataDir = userVibinDir();
  if (await handleMcpCommand(args, cwd, dataDir)) return;
  if (!headless) void checkForUpdate(dataDir).catch(() => undefined);
  const ui = headless ? new HeadlessUI() : new TerminalUI();
  try { await startApp(cwd, await loadConfig(cwd, dataDir), args.filter((arg) => !arg.startsWith("-")).join(" ") || undefined, dataDir, ui); }
  catch (error) { const err = error instanceof VibinError ? error : new VibinError(error instanceof Error ? error.message : "Startup failed."); console.error(`Vibin: ${err.message}${err.hint ? `\n${err.hint}` : ""}`); process.exitCode = 1; }
}

if (import.meta.main) await runVibin();
