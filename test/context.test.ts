import { expect, test } from "bun:test";
import { expandFileMentions } from "../src/agent/context";

test("adds explicitly mentioned workspace files to a prompt", async () => {
  const prompt = await expandFileMentions("Review @package.json please", process.cwd());
  expect(prompt).toContain("Explicit file context: package.json");
  expect(prompt).toContain('"name": "vibin"');
});

test("adds a bounded directory tree for mentioned workspace folders", async () => {
  const prompt = await expandFileMentions("Review @src please", process.cwd());
  expect(prompt).toContain("Explicit directory context: src/");
  expect(prompt).toContain("f src/index.ts");
});

test("rejects file mentions outside the workspace", async () => {
  await expect(expandFileMentions("Read @../secret.txt", process.cwd())).rejects.toThrow("inside the project");
});
