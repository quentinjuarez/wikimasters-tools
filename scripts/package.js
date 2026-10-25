const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const INCLUDED = ["manifest.json", "_locales", "icons", "src"];

const missing = INCLUDED.filter((entry) => !fs.existsSync(path.join(root, entry)));
if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);

const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const target = path.join(dist, `wikimasters-price-tools-${manifest.version}.zip`);
fs.rmSync(target, { force: true });
execFileSync("zip", ["-r", "-X", target, ...INCLUDED, "-x", "*.DS_Store"], { cwd: root, stdio: "inherit" });
console.log(target);
