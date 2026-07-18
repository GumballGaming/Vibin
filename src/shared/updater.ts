import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const UPDATE_URL = "https://github.com/GumballGaming/Vibin/raw/main/dist/vibin.exe";
const STATE_FILE = "update-state.json";
const UPDATE_FILE = "vibin.exe.update";
const BACKUP_FILE = "vibin.exe.previous";

type UpdateState = { etag?: string; lastModified?: string };

function isCompiledWindowsExecutable(): boolean {
  return process.platform === "win32" && process.execPath.toLowerCase().endsWith(".exe") && basename(process.execPath).toLowerCase() === "vibin.exe";
}

async function readState(path: string): Promise<UpdateState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as UpdateState;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function applyUpdate(target: string, downloaded: string, parentPid: number): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      process.kill(parentPid, 0);
      await Bun.sleep(500);
    } catch {
      break;
    }
  }
  const backup = `${target}.previous`;
  try {
    if (existsSync(backup)) await unlink(backup);
    if (existsSync(target)) await rename(target, backup);
    await rename(downloaded, target);
    if (process.platform !== "win32") await chmod(target, 0o755);
    if (existsSync(backup)) await unlink(backup);
  } catch {
    try {
      if (!existsSync(target) && existsSync(backup)) await rename(backup, target);
    } catch { /* Keep the existing executable if restoration is also unavailable. */ }
  }
}

export async function handleUpdateCommand(args: string[]): Promise<boolean> {
  if (args[0] !== "--vibin-apply-update") return false;
  const target = args[1];
  const downloaded = args[2];
  const parentPid = Number(args[3]);
  if (!target || !downloaded || !Number.isInteger(parentPid)) return true;
  await applyUpdate(target, downloaded, parentPid);
  return true;
}

export async function checkForUpdate(cwd: string): Promise<void> {
  if (!isCompiledWindowsExecutable()) return;
  const directory = join(cwd, ".vibin");
  const statePath = join(directory, STATE_FILE);
  const state = await readState(statePath);
  const response = await fetch(UPDATE_URL, { method: "HEAD", headers: { "Cache-Control": "no-cache", "User-Agent": "Vibin-Updater" } });
  if (!response.ok) return;
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  const marker = etag ?? lastModified;
  if (!marker || marker === state.etag || marker === state.lastModified) return;
  await mkdir(directory, { recursive: true });
  const downloadPath = join(directory, UPDATE_FILE);
  const download = await fetch(UPDATE_URL, { headers: { "Cache-Control": "no-cache", "User-Agent": "Vibin-Updater" } });
  if (!download.ok) return;
  const bytes = new Uint8Array(await download.arrayBuffer());
  if (bytes.length < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return;
  await writeFile(downloadPath, bytes);
  await writeFile(statePath, `${JSON.stringify({ etag, lastModified }, null, 2)}\n`, "utf8");
  const child = Bun.spawn([process.execPath, "--vibin-apply-update", process.execPath, downloadPath, String(process.pid)], { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  child.unref();
}
