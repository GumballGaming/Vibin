#!/usr/bin/env bun
import { resolve } from "node:path";
import { startApp } from "./cli/app";
import { loadConfig } from "./config/config";
import { VibinError } from "./shared/errors";
import { checkForUpdate, handleUpdateCommand } from "./shared/updater";

const args = process.argv.slice(2);
if (await handleUpdateCommand(args)) process.exit(0);
if (args.includes("--smoke")) { console.log("Vibin smoke check passed: CLI modules load."); process.exit(0); }
const cwd = process.cwd();
void checkForUpdate(cwd).catch(() => undefined);
try { await startApp(cwd, await loadConfig(cwd), args.filter((arg) => !arg.startsWith("-")).join(" ") || undefined); }
catch (error) { const err = error instanceof VibinError ? error : new VibinError(error instanceof Error ? error.message : "Startup failed."); console.error(`Vibin: ${err.message}${err.hint ? `\n${err.hint}` : ""}`); process.exitCode = 1; }
