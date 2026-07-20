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

export async function runVibin(): Promise<void> {
  const args = process.argv.slice(2);
  const headless = args.includes("--headless");
  if (await handleUpdateCommand(args)) return;
  if (args.includes("--smoke")) { console.log("Vibin smoke check passed: CLI modules load."); return; }
  const cwd = process.cwd();
  const dataDir = userVibinDir();
  if (await handleMcpCommand(args, cwd, dataDir)) return;
  if (!headless) void checkForUpdate(dataDir).catch(() => undefined);
  const ui = headless ? new HeadlessUI() : new TerminalUI();
  try { await startApp(cwd, await loadConfig(cwd, dataDir), args.filter((arg) => !arg.startsWith("-")).join(" ") || undefined, dataDir, ui); }
  catch (error) { const err = error instanceof VibinError ? error : new VibinError(error instanceof Error ? error.message : "Startup failed."); console.error(`Vibin: ${err.message}${err.hint ? `\n${err.hint}` : ""}`); process.exitCode = 1; }
}

if (import.meta.main) await runVibin();
