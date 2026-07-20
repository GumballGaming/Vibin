import { homedir } from "node:os";
import { join } from "node:path";

export function userVibinDir(): string {
  return join(process.env.USERPROFILE ?? homedir(), ".vibin");
}

export function userVibinBinDir(): string {
  return join(userVibinDir(), "bin");
}
