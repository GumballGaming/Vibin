import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadMcpConfig, mergeMcpConfigs, parseMcpImport, writeMcpConfigAtomic } from "../src/config/mcp-config";

test("imports MCP entries in object order and ignores names as saved identities", () => {
  const entries = parseMcpImport(JSON.stringify({ mcpServers: { first: { command: "a" }, second: { command: "b", args: ["x"] } } }));
  expect(entries.map((entry) => entry.sourceLabel)).toEqual(["first", "second"]);
  expect(entries.map((entry) => entry.config.command)).toEqual(["a", "b"]);
});

test("imports one raw server and rejects empty MCP collections", () => {
  expect(parseMcpImport('{"command":"node"}')).toHaveLength(1);
  expect(() => parseMcpImport('{"mcpServers":{}}')).toThrow("non-empty");
});

test("merges project servers over same-named global servers", () => {
  const merged = mergeMcpConfigs({ mcpServers: { Shared: { command: "global", args: [], autoApprove: false }, Global: { command: "g", args: [], autoApprove: false } } }, { mcpServers: { Shared: { command: "project", args: [], autoApprove: false } } });
  expect(merged.map((server) => [server.name, server.source, server.config.command])).toEqual([["Global", "global", "g"], ["Shared", "project", "project"]]);
  expect(merged[1]!.overridden).toBeTrue();
});

test("writes and reloads validated MCP configuration atomically", async () => {
  const folder = await mkdtemp(join(tmpdir(), "vibin-mcp-")); const path = join(folder, "nested", "mcp.json");
  await writeMcpConfigAtomic(path, { mcpServers: { Local: { command: "node", args: ["server.js"], autoApprove: false } } });
  expect((await loadMcpConfig(path)).mcpServers.Local?.args).toEqual(["server.js"]);
  expect(await readFile(path, "utf8")).toContain('"Local"');
});
