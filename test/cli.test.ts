import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const bin = resolve("dist/bin/vtex-shop.js");
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), "vtex-cli-test-")); directories.push(dir); return dir; };

function cli(args: string[], input = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject); child.on("close", (code) => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
}

it("shows a browsable command tree with useful help", async () => {
  const result = await cli(["--help"]);
  expect(result.code).toBe(0); expect(result.stdout).toContain("basket"); expect(result.stdout).toContain("mcp");
});

it("keeps JSON output clean and profile state persistent", async () => {
  const dir = await temp();
  const first = await cli(["init", "https://example.com/?sc=34", "--state-dir", dir, "--profile", "sample", "--json"]);
  expect(first.code).toBe(0); expect(JSON.parse(first.stdout).store.salesChannel).toBe("34");
  const second = await cli(["--state-dir", dir, "--profile", "sample", "status", "--json"]);
  expect(JSON.parse(second.stdout).store.baseUrl).toBe("https://example.com"); expect(second.stderr).toBe("");
});

it("uses nonzero exit status and stderr for failures", async () => {
  const dir = await temp();
  const result = await cli(["status", "--json", "--state-dir", dir]);
  expect(result.code).toBe(1); expect(result.stdout).toBe(""); expect(JSON.parse(result.stderr).error.code).toBe("NOT_INITIALIZED");
});

it("exposes eight machine-readable schemas without requiring initialization", async () => {
  const result = await cli(["tools", "--json"]);
  const tools = JSON.parse(result.stdout) as Array<{ name: string }>;
  expect(tools).toHaveLength(8); expect(tools.map((t) => t.name)).toContain("shop_basket_sync");
});

it("executes an NDJSON batch sequentially and reports each malformed input", async () => {
  const dir = await temp();
  await cli(["init", "https://example.com/?sc=34", "--state-dir", dir]);
  const result = await cli(["batch", "--state-dir", dir], '{"tool":"shop_status","arguments":{}}\nnull\n{"tool":"unknown"}\n');
  const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  expect(result.code).toBe(1); expect(lines).toHaveLength(3);
  expect(lines[0].ok).toBe(true); expect(lines[1].ok).toBe(false); expect(lines[2].error.code).toBe("UNKNOWN_TOOL");
  expect(result.stderr).toBe("");
});

it("serves MCP over real stdio without mixing terminal output into JSON-RPC", async () => {
  const dir = await temp();
  await cli(["init", "https://example.com/?sc=34", "--state-dir", dir]);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [bin, "mcp", "--state-dir", dir], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = ""; let complete = false;
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("MCP stdio timed out")); }, 8000);
    const send = (data: unknown) => child.stdin.write(JSON.stringify(data) + "\n");
    child.stdout.on("data", (data) => {
      buffer += data;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n"); const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1) {
            expect(message.result.protocolVersion).toBe("2025-11-25");
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          } else if (message.id === 2) {
            expect(message.result.tools).toHaveLength(8);
            send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "shop_status", arguments: {} } });
          } else if (message.id === 3) {
            expect(message.result.isError).not.toBe(true); complete = true; child.kill("SIGTERM");
          }
        } catch (error) { clearTimeout(timeout); child.kill("SIGKILL"); reject(error); }
      }
    });
    child.on("error", reject);
    child.on("close", () => { clearTimeout(timeout); complete ? resolve() : reject(new Error("MCP process closed before verification")); });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } } });
  });
}, 10000);
