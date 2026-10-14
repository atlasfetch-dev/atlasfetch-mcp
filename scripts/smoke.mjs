// Smoke test: drives the built server over stdio with a real MCP client and
// calls the live API. Run: node scripts/smoke.mjs
//
// Set ATLASFETCH_API_KEY to test with a real account's key; without it the
// server falls back to the shared demo key, whose 2 requests a second and
// pooled quota belong to the website's visitors, not to tests.
//
// The SDK starts the server with a minimal environment (PATH and a few system
// variables), NOT this process's. So the key has to be forwarded explicitly:
// without that, setting ATLASFETCH_API_KEY here silently tested the demo key.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const forwarded = Object.fromEntries(
  ["ATLASFETCH_API_KEY", "ATLASFETCH_API_URL"].filter(name => process.env[name]).map(name => [name, process.env[name]]),
);
console.log(process.env.ATLASFETCH_API_KEY ? "key: ATLASFETCH_API_KEY (set)" : "key: none set; the server uses the demo key");
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/stdio.js"],
  env: { ...getDefaultEnvironment(), ...forwarded },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
for (const t of tools) {
  const required = t.inputSchema?.required ?? [];
  console.log(`  - ${t.name}: required [${required.join(", ")}] title="${t.title ?? ""}"`);
}

// The demo key allows 2 requests a second and this script is a burst of calls:
// without a pause the later ones come back 429 and prove nothing.
const pace = () => new Promise(resolve => setTimeout(resolve, 600));

async function call(name, args) {
  await pace();
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text ?? "").join("\n");
  console.log(`\n== ${name} ${JSON.stringify(args)} -> isError=${res.isError ?? false}`);
  console.log(text.slice(0, 700));
}

// London: should resolve GB / England / Westminster
await call("lookup_location", { lat: 51.5072, lng: -0.1276, encode: ["h3", "pluscode"] });
// Mid-Atlantic: every layer should be null, and that is a correct answer
await call("lookup_location", { lat: 0, lng: -30, base: ["country"] });
// Out of range: the schema should refuse before any request is billed
await call("lookup_location", { lat: 999, lng: 0 });
// A set that does not exist: skipped, reported in errors, still a success
await call("lookup_location", { lat: 51.5072, lng: -0.1276, sets: ["no_such_set"] });
// Streets (beta): opt-in layer. Adderley Street, Cape Town.
await call("lookup_location", { lat: -33.9221, lng: 18.4231, base: ["municipal", "street"] });
// London: a second street case, in another country.
await call("lookup_location", { lat: 51.5072, lng: -0.1276, base: ["country", "street"] });

// Directions: a short car route, and a truck: routed on Pro, refused (403, unbilled) below it.
await call("get_route", { locations: [{ lat: -33.9242, lng: 18.4210 }, { lat: -33.9068, lng: 18.4201 }] });
await call("get_route", { locations: [{ lat: -33.9242, lng: 18.4210 }, { lat: -33.9068, lng: 18.4201 }], mode: "truck" });

// Geocoding (ZA): an exact house, a street-level guess, and an uncovered country.
await call("geocode_address", { q: "25 Adderley Street, Cape Town" });
await call("geocode_address", { q: "9999 Long Street, Cape Town" });
await call("geocode_address", { q: "10 Downing Street, London", country: "GB" });
// A street corner (spec 1.6.0), and an erf, which has no point and goes to the customer.
await call("geocode_address", { q: "Cnr Main Rd and Belmont Rd, Rondebosch" });
await call("geocode_address", { q: "Erf 1234, Khayelitsha" });
// streetGeometry implies the street layer, so municipal alone still gets a street with a line.
await call("lookup_location", { lat: -26.2041, lng: 28.0473, base: ["municipal"], streetGeometry: "polyline6" });

await call("list_boundary_sets", {});
// update_boundary in a set that does not exist on any account: refused, nothing changed.
await call("update_boundary", { set: "smoke-no-such-set", name: "smoke-no-such-zone", geometry: { type: "Polygon", coordinates: [[[18.4, -33.93], [18.4, -33.9], [18.44, -33.9], [18.4, -33.93]]] } });
// Wrong shape on purpose: a Feature instead of a geometry
await call("add_boundary", { set: "demo", name: "x", geometry: { type: "Feature", properties: {}, geometry: {} } });

await client.close();
