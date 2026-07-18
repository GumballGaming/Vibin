import keytar from "keytar";

const SERVICE = "vibin-codex-oauth";
const ACCOUNT = "default";

export async function readCodexCredential(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function writeCodexCredential(value: string): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT, value);
}

export async function deleteCodexCredential(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}
