const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const sources = fs.readdirSync(path.join(root, "src")).filter((file) => file.endsWith(".js"));

function pngSize(file) {
  const buffer = fs.readFileSync(path.join(root, file));
  assert.strictEqual(buffer.toString("ascii", 1, 4), "PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test("manifest is a minimal Manifest V3 with localized name and description", () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(manifest.name, "__MSG_extName__");
  assert.strictEqual(manifest.description, "__MSG_extDescription__");
  assert.deepStrictEqual(manifest.permissions, ["storage", "unlimitedStorage"]);
  assert.strictEqual(manifest.host_permissions, undefined);
  for (const script of manifest.content_scripts) assert.deepStrictEqual(script.matches, ["https://www.wiki-masters.com/*"]);
});

test("every locale has a name and a short description within store limits", () => {
  for (const locale of fs.readdirSync(path.join(root, "_locales"))) {
    const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
    assert.ok(messages.extName.message.length <= 45, `${locale} name`);
    assert.ok(messages.extDescription.message.length <= 132, `${locale} description`);
  }
  assert.ok(fs.existsSync(path.join(root, "_locales", manifest.default_locale)));
});

test("icons exist at the declared sizes", () => {
  for (const [size, file] of Object.entries(manifest.icons)) assert.deepStrictEqual(pngSize(file), [Number(size), Number(size)], file);
});

test("every script and stylesheet listed in the manifest ships", () => {
  for (const script of manifest.content_scripts) {
    for (const file of [...script.js, ...(script.css ?? [])]) assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  const listed = new Set(manifest.content_scripts.flatMap((script) => script.js));
  for (const file of sources) assert.ok(listed.has(`src/${file}`), `src/${file} is not loaded by the manifest`);
});

test("no remote code, obfuscation, plain http or HTML injection in the shipped source", () => {
  const forbidden = [/\beval\(/, /new Function\(/, /document\.write/, /\binnerHTML\b/, /insertAdjacentHTML/, /\batob\(/, /fromCharCode/, /http:\/\//, /<script/i];
  for (const file of sources) {
    const source = read(`src/${file}`);
    for (const pattern of forbidden) assert.ok(!pattern.test(source), `${file} matches ${pattern}`);
  }
});

test("the only host the code talks to is the site itself", () => {
  for (const file of sources) {
    const urls = read(`src/${file}`).match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    for (const url of urls) assert.match(url, /^https:\/\/www\.wiki-masters\.com/, `${file}: ${url}`);
  }
});

test("the privacy policy and the license are in the repository", () => {
  assert.match(read("docs/privacy.html"), /Politique de confidentialité/);
  assert.match(read("LICENSE"), /MIT License/);
});
