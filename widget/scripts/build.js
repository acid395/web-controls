/* build.js - one file a site can load, assembled from the extension's own
 * sources rather than a copy of them.
 *
 *   node widget/scripts/build.js
 *
 * Writes widget/dist/:
 *   web-controls-widget.js    a classic script; mounts itself from its tag
 *   web-controls-widget.mjs   the same, as a module exporting mount()
 *   web-llm.js                the WebLLM build the extension ships, loaded
 *                             only when somebody presses "Load model"
 *
 * The agent is background.js byte for byte, inside a function that hands
 * it a stand-in `chrome`. Nothing is forked: a fix to the extension's agent
 * is a fix here on the next build, and the extension's 1700-odd tests are
 * tests of this agent too.
 */
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const EXT = path.join(REPO, "extension");
const SRC = path.join(__dirname, "..", "src");
const DIST = path.join(__dirname, "..", "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const section = (name, body) => `\n/* ---- ${name} ---- */\n${body}\n`;
// Each of the extension's files in a scope of its own. They talk to one
// another only through globalThis (WC_MODELS, WC_BUILD_STEP_PROMPT,
// window.GENERIC), and two of them declaring the same helper name at top
// level would otherwise be a SyntaxError that takes the whole widget down.
const isolated = (name, body) => section(name, `(function () {\n${body}\n})();`);

const background = read(EXT, "background.js");
// Loaded in order below instead; the shim's importScripts does nothing.
for (const lib of ["lib/models.js", "lib/step-prompt.js", "lib/env-vocab.js"]) {
  if (!background.includes(`importScripts("${lib}")`)) {
    throw new Error(`background.js no longer imports ${lib} - check what it needs now`);
  }
}

function body(scriptUrlExpr, loadersExpr) {
  return [
    `globalThis.WC_WIDGET_VERSION = ${JSON.stringify(pkg.version)};`,
    `const WC_SCRIPT_URL = ${scriptUrlExpr};`,
    `const WC_LOADERS = ${loadersExpr};`,
    // Taken before feed-capture wraps window.fetch, so the agent's own
    // requests to public APIs are never recorded as the page's data.
    "const WC_NATIVE_FETCH = window.fetch ? window.fetch.bind(window) : undefined;",
    isolated("extension/lib/models.js", read(EXT, "lib", "models.js")),
    isolated("extension/lib/step-prompt.js", read(EXT, "lib", "step-prompt.js")),
    isolated("extension/lib/env-vocab.js", read(EXT, "lib", "env-vocab.js")),
    isolated("extension/lib/gpu.js", read(EXT, "lib", "gpu.js")),
    section("extension/page/feed-capture.js",
      `function installFeedCapture() {\n${read(EXT, "page", "feed-capture.js")}\n}`),
    isolated("extension/page/generic-bundle.js", read(EXT, "page", "generic-bundle.js")),
    // The hand-written manifests background.js routes to on the sites it
    // knows. Loaded only on a matching page, and only when the agent first
    // reaches into it, so every other site pays nothing for them but bytes.
    section("extension/page/*-bundle.js (named manifests)",
      "const WC_NAMED_BUNDLES = {\n"
      + [["USGS", "usgs"], ["SITE", "site"], ["NOAA", "noaa"], ["FCP", "forecastpoints"]]
        .map(([g, file]) => `  ${g}: function () {\n${read(EXT, "page", `${file}-bundle.js`)}\n  },\n`).join("")
      + "};"),
    section("extension/background.js (as the agent)",
      "function bootAgent(chrome) {\n"
      + "  const importScripts = () => {};\n"
      + "  const fetch = WC_NATIVE_FETCH;\n"
      + background
      + "\n  return { routeFor };\n}"),
    section("widget/src/model-host.js", read(SRC, "model-host.js")),
    section("widget/src/chrome-shim.js", read(SRC, "chrome-shim.js")),
    section("widget/src/ui.js", read(SRC, "ui.js")),
    section("widget/src/widget.js", read(SRC, "widget.js")),
  ].join("\n");
}

const banner = `/*! web-controls widget ${pkg.version} - ask any page in plain English, answered by a model running on the visitor's own machine. */\n`;

// Classic script. Mounts from its own tag unless told not to.
const classic = `${banner}(function () {
if (window.WebControls) return;
const WC_CURRENT_SCRIPT = document.currentScript;
${body("(WC_CURRENT_SCRIPT && WC_CURRENT_SCRIPT.src) || location.href", "null")}
if (!WC_CURRENT_SCRIPT || WC_CURRENT_SCRIPT.dataset.captureFeeds !== "false") installFeedCapture();
window.WebControls = { mount, version: globalThis.WC_WIDGET_VERSION };
if (WC_CURRENT_SCRIPT && WC_CURRENT_SCRIPT.dataset.manual == null) {
  const go = () => mount(optionsFromScript(WC_CURRENT_SCRIPT));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
  else go();
}
})();
`;

// The two shapes a bundler follows, written out literally. Vite and webpack
// both copy a file named by import("./x") or new URL("./x", import.meta.url)
// into the app's build; anything computed, they cannot see.
const ESM_LOADERS = `{
  loadLib: () => import("./web-llm.js"),
  makeWorker: () => ({ worker: new Worker(new URL("./web-llm-worker.mjs", import.meta.url), { type: "module" }) }),
}`;

// Module. Never mounts itself: an app that imports it decides when.
//
// Importable on a server. Next.js, Nuxt and SvelteKit evaluate the modules
// they render with, and touching window at import time would crash the app
// on its first server render, before it ever reached a browser.
const esm = `${banner}const WebControls = typeof window === "undefined"
  ? {
    version: ${JSON.stringify(pkg.version)},
    mount() {
      throw new Error("web-controls-widget runs in the browser: call mount() from client-side code (useEffect, onMounted, or a \\"use client\\" component).");
    },
  }
  : (() => {
if (window.WebControls) return window.WebControls;
${body("import.meta.url", ESM_LOADERS)}
installFeedCapture();
return (window.WebControls = { mount, version: globalThis.WC_WIDGET_VERSION });
})();
export const mount = (options) => WebControls.mount(options);
export const version = WebControls.version;
export default WebControls;
`;

// The worker the module build names. It imports WebLLM by relative path, so
// a bundler that copies one copies the other.
const workerFile = `${banner}import { WebWorkerMLCEngineHandler } from "./web-llm.js";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (e) => handler.onmessage(e);
`;

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, "web-controls-widget.js"), classic);
fs.writeFileSync(path.join(DIST, "web-controls-widget.mjs"), esm);
fs.writeFileSync(path.join(DIST, "web-llm-worker.mjs"), workerFile);
fs.copyFileSync(path.join(EXT, "offscreen", "vendor", "web-llm.js"), path.join(DIST, "web-llm.js"));
fs.copyFileSync(path.join(SRC, "index.d.ts"), path.join(DIST, "web-controls-widget.d.ts"));

const kb = (f) => `${Math.round(fs.statSync(path.join(DIST, f)).size / 1024)} KB`;
console.log(`web-controls widget ${pkg.version}`);
for (const f of ["web-controls-widget.js", "web-controls-widget.mjs", "web-llm-worker.mjs", "web-llm.js", "web-controls-widget.d.ts"]) {
  console.log(`  dist/${f.padEnd(26)} ${kb(f)}`);
}
