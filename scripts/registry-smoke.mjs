// Installs the PUBLISHED package with npx into an empty temporary folder, then
// drives it with a real MCP client. Proves the release works for someone who
// has only the npm registry, not this checkout.
//
// Run: node scripts/registry-smoke.mjs [version] [--require-key]   (version defaults to package.json)
//
// Without ATLASFETCH_API_KEY it tests the public demo key: what a user who
// supplies no key gets. That is what the release's verify step means to test.
// Any other check of production uses the AtlasIQ key and --require-key, so a
// failed key read stops the run instead of quietly testing the demo key.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.argv.includes("--require-key") && !process.env.ATLASFETCH_API_KEY) {
  console.error("registry-smoke: --require-key, but ATLASFETCH_API_KEY is empty. Not running on the demo key.");
  process.exit(2);
}
console.log(process.env.ATLASFETCH_API_KEY ? "key: ATLASFETCH_API_KEY (set)" : "key: none set; testing the public demo key");

const version = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const cwd = mkdtempSync(join(tmpdir(), "atlasfetch-smoke-"));

const transport = new StdioClientTransport({
  command: process.platform === "win32" ? "npx.cmd" : "npx",
  args: ["-y", `atlasfetch-mcp@${version}`],
  cwd,
  stderr: "pipe",
  // Forward a real key when one is set, as scripts/smoke.mjs does; the SDK
  // would otherwise start the server without it and test the demo key.
  env: {
    ...getDefaultEnvironment(),
    ...(process.env.ATLASFETCH_API_KEY ? { ATLASFETCH_API_KEY: process.env.ATLASFETCH_API_KEY } : {}),
  },
});
const client = new Client({ name: "registry-smoke", version: "0.0.0" });

try {
  await client.connect(transport);
  const served = client.getServerVersion()?.version;
  const { tools } = await client.listTools();
  console.log(`atlasfetch-mcp@${version} from npm reports version ${served}`);
  console.log("tools:", tools.map(t => t.name).join(", "));
  const res = await client.callTool({ name: "lookup_location", arguments: { lat: -33.9249, lng: 18.4241 } });
  console.log("lookup isError:", res.isError ?? false);
  console.log(res.content[0].text.split("\n")[0]);
  if (served !== version || res.isError) process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  rmSync(cwd, { recursive: true, force: true });
}
