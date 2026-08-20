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
for (const file of files.filter((item) => item.endsWith(".wxml"))) {
  const source = fs.readFileSync(file, "utf8");
  if (/<button[^>]*open-type="chooseAvatar"[^>]*binderror=/.test(source)) {
    throw new Error(`${file}: binderror is not supported by button open-type=chooseAvatar`);
  }
}
const appConfig = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
if (Object.hasOwn(appConfig, "sitemapLocation")) {
  throw new Error("apps/miniapp/app.json: sitemapLocation is no longer supported by WeChat");
}
const testFiles = files.filter((item) => item.endsWith(".test.cjs"));
if (testFiles.length) {
  const result = spawnSync(process.execPath, ["--test", ...testFiles], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stdout || result.stderr || "Miniapp tests failed");
}
process.stdout.write(`Miniapp static check passed (${files.length} files).\n`);
