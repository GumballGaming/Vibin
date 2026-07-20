import { expect, test } from "bun:test";
import { formatLaunchTrustPreview, serverFingerprint } from "../src/config/mcp-trust";
import type { EffectiveMcpServer } from "../src/config/mcp-config";

const server = (overrides: Partial<EffectiveMcpServer["config"]> = {}): EffectiveMcpServer => ({ name: "Roblox Studio", source: "project", overridden: false, config: { command: "cmd.exe", args: ["/c", "mcp.bat"], cwd: ".", env: { TOKEN: "hidden" }, autoApprove: false, ...overrides } });

test("server trust changes with launch fields but not auto approval", () => {
  const initial = serverFingerprint(server(), "project", "C:/work");
  expect(serverFingerprint(server({ args: ["/c", "other.bat"] }), "project", "C:/work")).not.toBe(initial);
  expect(serverFingerprint(server({ env: { TOKEN: "changed" } }), "project", "C:/work")).not.toBe(initial);
  expect(serverFingerprint(server({ autoApprove: true }), "project", "C:/work")).toBe(initial);
});

test("launch preview shows environment names without values", () => {
  const preview = formatLaunchTrustPreview(server(), "C:/work");
  expect(preview).toContain("TOKEN");
  expect(preview).not.toContain("hidden");
  expect(preview).toContain("cmd.exe");
});
