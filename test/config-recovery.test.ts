import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, removeProfile, type VibinConfig } from "../src/config/config";

test("recovers from a saved profile with a blank model", async () => {
  const directory = join(process.cwd(), ".vibin-test-recovery");
  await mkdir(join(directory, ".vibin"), { recursive: true });
  await writeFile(join(directory, ".vibin", "config.json"), JSON.stringify({ activeProfile: "openai", profiles: { openai: { provider: "openai", apiKey: "key", model: "", baseUrl: "https://api.openai.com/v1" } } }));
  const config = await loadConfig(directory);
  expect(config.model).toBe("gpt-4.1-mini");
  await rm(directory, { recursive: true, force: true });
});

test("removing profiles keeps a valid active provider or returns to setup", () => {
  const profiles = {
    openai: { provider: "openai" as const, apiKey: "key-a", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1" },
    router: { provider: "openrouter" as const, apiKey: "key-b", model: "openai/gpt-4.1-mini", baseUrl: "https://openrouter.ai/api/v1" },
  };
  const config: VibinConfig = { ...profiles.openai, profiles, activeProfile: "openai", alwaysAllowedCommands: ["Write-Output approved"] };
  const switched = removeProfile(config, "openai");
  expect(switched.activeProfile).toBe("router");
  expect(switched.profiles).not.toHaveProperty("openai");
  const empty = removeProfile(switched, "router");
  expect(empty.profiles).toEqual({});
  expect(empty.apiKey).toBeUndefined();
  expect(empty.alwaysAllowedCommands).toEqual(["Write-Output approved"]);
});
