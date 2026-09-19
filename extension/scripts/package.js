/* package.js - build a distributable from source, or refuse to.
 *
 * The Desktop folder was assembled by hand, file by file, for a fortnight.
 * It drifted twice: once a stale README, once stale bundles. Both times the
 * person testing was running something nobody had built on purpose.
 *
 * This regenerates the bundles, checks every file the extension actually
 * loads is present, checks nothing is stale, and only then writes the zip.
 * A failure here is a refusal to ship, not a warning.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const EXT = path.join(__dirname, "..");
const ROOT = path.join(EXT, "..");
const OUT = path.join(ROOT, "dist");

const fail = (msg) => { console.error("package: " + msg); process.exit(1); };

// 1. Bundles are generated from the root manifests. If they are out of date,
//    the extension ships code nobody edited.
execFileSync(process.execPath, [path.join(__dirname, "build-bundles.js")], { stdio: "pipe" });
const dirty = execFileSync("git", ["status", "--porcelain", "extension/page", "extension/lib"], { cwd: ROOT })
  .toString().trim();
if (dirty) fail("bundles were out of date - they have been rebuilt, commit them and run again:\n" + dirty);

// 2. The manifest has to parse, and its version is what everything is named.
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const version = manifest.version;
if (!/^\d+\.\d+/.test(version)) fail(`manifest version looks wrong: ${version}`);

// The version is how anyone testing knows which build they have, so a
// version that did not move is worse than useless - it is a claim that
// nothing changed. Eight commits once shipped under one number because the
// edits that bumped it failed silently.
const stamp = path.join(EXT, "scripts", ".last-packaged");
const previous = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf8").trim() : null;
const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
const changed = execFileSync("git", ["log", "-1", "--format=%h", "--", "extension"], { cwd: ROOT }).toString().trim();
if (previous === version && changed !== head) {
  fail(`version ${version} was already packaged, but extension/ has changed since.\n`
    + "  Bump the version in extension/manifest.json - whoever is testing reads it to know what they have.");
}

// 3. Everything the extension loads, present. A missing file here is an
//    extension that installs and then does nothing.
const RUNTIME = [
  "manifest.json", "background.js", "content/bridge.js", "lib/env-vocab.js",
  "offscreen/offscreen.html", "offscreen/offscreen.js", "offscreen/vendor/web-llm.js",
  "popup/popup.html", "popup/popup.js", "README.md",
  ...fs.readdirSync(path.join(EXT, "page")).map((f) => "page/" + f),
];
const missing = RUNTIME.filter((f) => !fs.existsSync(path.join(EXT, f)));
if (missing.length) fail("missing files: " + missing.join(", "));

// Referenced-but-absent is the other half of the same check.
const bg = fs.readFileSync(path.join(EXT, "background.js"), "utf8");
const referenced = [
  ...new Set([...bg.matchAll(/"(page\/[a-z-]+\.js)"/g)].map((m) => m[1])),
  ...new Set([...bg.matchAll(/importScripts\("([^"]+)"\)/g)].map((m) => m[1])),
  manifest.background.service_worker,
  manifest.side_panel && manifest.side_panel.default_path,
].filter(Boolean);
const dangling = referenced.filter((f) => !fs.existsSync(path.join(EXT, f)));
if (dangling.length) fail("background.js references files that do not exist: " + dangling.join(", "));

// 4. Every route's host has to be granted, or its tools are decorative.
const routes = [...bg.matchAll(/test: \/\^https:\\\/\\\/([^/]+)/g)].map((m) => m[1].replace(/\\/g, ""));
const granted = (manifest.host_permissions || []).map((h) => h.replace(/^https:\/\//, "").replace(/\/\*$/, ""));
const ungranted = routes.filter((r) => !granted.some((g) => r.endsWith(g.replace(/^\*\./, "")) || g === "*"));
if (ungranted.length) console.warn("package: warning - routes without host permission: " + ungranted.join(", "));

// 5. Write it.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const stage = path.join(OUT, "web-controls-extension");
for (const rel of RUNTIME) {
  const to = path.join(stage, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(EXT, rel), to);
}
fs.copyFileSync(path.join(__dirname, "INSTALL.txt"), path.join(stage, "INSTALL.txt"));

const zip = path.join(OUT, `web-controls-${version}.zip`);
execFileSync("zip", ["-rqX", zip, "web-controls-extension", "-x", "*.DS_Store"], { cwd: OUT });

const size = (fs.statSync(zip).size / 1048576).toFixed(1);
fs.writeFileSync(stamp, version + "\n");
console.log(`packaged v${version} - ${RUNTIME.length + 1} files, ${size}MB`);
console.log(`  folder: ${stage}`);
console.log(`  zip:    ${zip}`);
