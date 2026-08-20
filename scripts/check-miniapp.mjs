import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve("apps/miniapp");
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else files.push(target);
  }
}
walk(root);

for (const file of files.filter((item) => item.endsWith(".json"))) JSON.parse(fs.readFileSync(file, "utf8"));
for (const file of files.filter((item) => item.endsWith(".js") || item.endsWith(".cjs"))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
}
const testFiles = files.filter((item) => item.endsWith(".test.cjs"));
if (testFiles.length) {
  const result = spawnSync(process.execPath, ["--test", ...testFiles], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stdout || result.stderr || "Miniapp tests failed");
}
process.stdout.write(`Miniapp static check passed (${files.length} files).\n`);
