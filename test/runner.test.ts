import { expect, test } from "bun:test";
import { join } from "node:path";
import { ToolRunner } from "../src/tools/runner";

test("lists files from the project root", async () => {
  const runner = new ToolRunner(process.cwd(), async () => false);

  await expect(runner.run("list_files", JSON.stringify({ path: "." }))).resolves.toContain("f package.json");
});

test("lists bounded workspace files and folders for @ suggestions", async () => {
  const runner = new ToolRunner(process.cwd(), async () => false);

  const entries = await runner.workspaceFiles();
  expect(entries).toContain("src/index.ts");
  expect(entries).toContain("src/");
});

test("skips an unreadable workspace during @ suggestion discovery", async () => {
  const runner = new ToolRunner(join(process.cwd(), "missing-workspace"), async () => false);

  await expect(runner.workspaceFiles()).resolves.toEqual([]);
});

test("always allow skips the next approval for the exact command", async () => {
  let confirmations = 0;
  const runner = new ToolRunner(process.cwd(), async () => false, async () => { confirmations += 1; return "always"; });

  await runner.run("run_command", JSON.stringify({ command: "Write-Output approved" }));
  await runner.run("run_command", JSON.stringify({ command: "Write-Output approved" }));

  expect(confirmations).toBe(1);
});

test("always allow can persist an exact command for future sessions", async () => {
  let saved = "";
  const allowed = new Set<string>();
  const runner = new ToolRunner(process.cwd(), async () => false, async () => "always", allowed, async (command) => { saved = command; });

  await runner.run("run_command", JSON.stringify({ command: "Write-Output persistent" }));

  expect(saved).toBe("Write-Output persistent");
  expect(allowed.has(saved)).toBe(true);
});

test("subagent tools cannot mutate the workspace or run commands", async () => {
  const runner = new ToolRunner(process.cwd(), async () => false);

  await expect(runner.runReadOnly("write_file", JSON.stringify({ path: "blocked.txt", content: "no" }))).rejects.toThrow("Subagents cannot use");
  await expect(runner.runReadOnly("run_command", JSON.stringify({ command: "Write-Output no" }))).rejects.toThrow("Subagents cannot use");
});
