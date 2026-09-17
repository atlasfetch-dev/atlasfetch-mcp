// Installs the PUBLISHED package with npx from an empty folder, then drives it
// with a real MCP client. Proves the tarball works for someone who has only
// the registry, not this checkout. Run: node scripts/registry-smoke.mjs <cwd>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cwd = process.argv[2];
const transport = new StdioClientTransport({
  command: process.platform === "win32" ? "npx.cmd" : "npx",
  args: ["-y", "atlasfetch-mcp@0.1.2"],
  cwd,
  stderr: "pipe",
});
const client = new Client({ name: "registry-smoke", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("tools from registry install:", tools.map((t) => t.name).join(", "));
const res = await client.callTool({ name: "lookup_location", arguments: { lat: -33.9249, lng: 18.4241 } });
console.log("isError:", res.isError ?? false);
console.log(res.content[0].text.split("\n")[0]);
await client.close();
