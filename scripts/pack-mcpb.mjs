// Build atlasfetch-<version>.mcpb: a one-file bundle that Claude Desktop installs
// with a double-click, and the format Smithery needs for a local (stdio) server.
//
// A bundle ships its own node_modules, so it is packed from a staging copy with
// PRODUCTION dependencies only — packing the working tree would drag TypeScript
// and the mcpb CLI itself into every user's download.
//
// Run: npm run pack:mcpb
import { cpSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const STAGE = join("build", "mcpb");

function run(command, args, cwd = ".") {
  // A shell is needed so npm and npx resolve to their .cmd shims on Windows. The
  // command goes in as one string: passing an args array alongside shell:true
  // is deprecated (DEP0190), because the array is concatenated unescaped anyway.
  // Every argument here is a literal or a path this script built, never input.
  const line = [command, ...args.map(a => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
  const result = spawnSync(line, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\nFailed: ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

// Every place the version lives must agree, or the bundle, the npm package and
// the registry entry would describe different releases.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const serverJson = JSON.parse(readFileSync("server.json", "utf8"));
const versions = {
  "package.json": pkg.version,
  "manifest.json": manifest.version,
  "server.json": serverJson.version,
  "server.json packages[0]": serverJson.packages[0].version,
};
if (new Set(Object.values(versions)).size !== 1) {
  console.error("Versions disagree; refusing to pack:", versions);
  process.exit(1);
}
if (!existsSync(join("dist", "stdio.js"))) {
  console.error("dist/stdio.js is missing. Run npm run build first.");
  process.exit(1);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const file of ["manifest.json", "icon.png", "LICENSE", "README.md", "package.json", "package-lock.json"]) {
  cpSync(file, join(STAGE, file));
}
cpSync("dist", join(STAGE, "dist"), { recursive: true });

run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--silent"], STAGE);
run("npx", ["mcpb", "validate", join(STAGE, "manifest.json")]);

const output = `atlasfetch-${pkg.version}.mcpb`;
rmSync(output, { force: true });
run("npx", ["mcpb", "pack", STAGE, output]);
console.log(`\nBuilt ${output}`);
