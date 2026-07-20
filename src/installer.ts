import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runVibin } from "./index";
import { userVibinBinDir } from "./shared/paths";

function addToUserPath(directory: string): void {
  const command = Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User')"]);
  const stored = new TextDecoder().decode(command.stdout).trim();
  const entries = stored ? stored.split(";").filter(Boolean) : [];
  if (entries.some((entry) => entry.toLowerCase() === directory.toLowerCase())) return;
  Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", "[Environment]::SetEnvironmentVariable('Path', $env:VIBIN_INSTALL_PATH, 'User')"], { env: { ...process.env, VIBIN_INSTALL_PATH: [...entries, directory].join(";") } });
}

const installDir = userVibinBinDir();
const target = join(installDir, "vibin.exe");

if (process.execPath.toLowerCase() === target.toLowerCase()) {
  await runVibin();
} else {
  if (!process.execPath.toLowerCase().endsWith(".exe")) throw new Error("Vibin Setup must be run as the compiled VibinSetup.exe installer.");
  await mkdir(installDir, { recursive: true });
  await copyFile(process.execPath, target);
  addToUserPath(installDir);
  console.log(`Vibin installed to ${target}`);
  Bun.spawn([target], { detached: true, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).unref();
}
