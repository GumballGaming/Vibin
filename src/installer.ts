import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DOWNLOAD_URL = "https://github.com/GumballGaming/Vibin/raw/main/dist/vibin.exe";

function addToUserPath(directory: string): void {
  const current = process.env.Path ?? "";
  const entries = current.split(";").filter(Boolean);
  if (entries.some((entry) => entry.toLowerCase() === directory.toLowerCase())) return;
  const userPath = process.env.USERPROFILE ? process.env.Path : undefined;
  void userPath;
  const command = Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('Path','User')`]);
  const stored = new TextDecoder().decode(command.stdout).trim();
  const storedEntries = stored ? stored.split(";").filter(Boolean) : [];
  if (!storedEntries.some((entry) => entry.toLowerCase() === directory.toLowerCase())) {
    const next = [...storedEntries, directory].join(";");
    Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", `[Environment]::SetEnvironmentVariable('Path', $env:VIBIN_INSTALL_PATH, 'User')`], { env: { ...process.env, VIBIN_INSTALL_PATH: next } });
  }
}

const installDir = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", "AppData", "Local"), "Vibin", "bin");
const target = join(installDir, "vibin.exe");
const response = await fetch(DOWNLOAD_URL, { headers: { "Cache-Control": "no-cache", "User-Agent": "VibinSetup/0.1.0" } });
if (!response.ok) throw new Error(`Could not download Vibin (${response.status}).`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.length < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new Error("The downloaded Vibin executable was invalid.");
await mkdir(installDir, { recursive: true });
await writeFile(target, bytes);
addToUserPath(installDir);
console.log(`Vibin installed to ${target}`);
Bun.spawn([target], { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
