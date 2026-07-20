import { expect, test } from "bun:test";
import { flattenMcpResult, formatMcpApprovalPreview, isSupportedMcpSchema, sanitizeMcpName } from "../src/tools/mcp-manager";

test("sanitizes MCP names while preserving case", () => {
  expect(sanitizeMcpName("Roblox Studio!!")).toBe("Roblox_Studio");
  expect(() => sanitizeMcpName("---")).toThrow();
});

test("accepts ordinary nested schemas and rejects unsafe constructs", () => {
  expect(isSupportedMcpSchema({ type: "object", properties: { value: { type: "array", items: { type: "string", enum: ["a"] } } }, required: ["value"] })).toBeTrue();
  expect(isSupportedMcpSchema({ oneOf: [{ type: "string" }, { type: "number" }] })).toBeFalse();
  expect(isSupportedMcpSchema({ type: "array", items: [{ type: "string" }] })).toBeFalse();
});

test("flattens MCP results in order and bounds errors", () => {
  expect(flattenMcpResult({ content: [{ type: "text", text: "first" }, { type: "image" }, { type: "text", text: "last" }] })).toBe("first\n[MCP image content omitted]\nlast");
  expect(flattenMcpResult({ isError: true, content: [{ type: "text", text: "bad" }] })).toContain("MCP tool error: bad");
});

test("approval previews redact secrets without changing arguments", () => {
  const args = { apiKey: "hidden", nested: { password: "also hidden", access_token: "third secret", value: "shown" } };
  const preview = formatMcpApprovalPreview("Server", "tool", "mcp__Server__tool", args);
  expect(preview).not.toContain("hidden"); expect(preview).not.toContain("third secret"); expect(preview).toContain("[REDACTED]"); expect(args.apiKey).toBe("hidden");
});
