#!/usr/bin/env node
/* build-bundles.js - regenerates extension/page/*-bundle.js from the
 * hand-written manifest scripts one directory up.
 *
 * A bundle is the manifest script verbatim, plus a fixed postMessage-listener
 * "bridge" appended at the end that lets the extension call it from outside
 * the page's own JS world (see extension/README.md's diagram). Before this
 * script existed, that bridge was hand-appended per bundle - fine for one
 * file (USGS), risky for five, since missing either of the two window.<X>
 * substitutions silently produces a bundle that talks to the wrong global.
 *
 * Run manually whenever a source manifest changes:
 *   node extension/scripts/build-bundles.js
 * Not wired into any install/build step - this is still a POC.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PAGE_DIR = path.join(__dirname, "..", "page");
const LIB_DIR = path.join(__dirname, "..", "lib");

const BUNDLES = [
  { source: "web-controls.js", out: "usgs-bundle.js", global: "USGS" },
  { source: "site-controls.js", out: "site-bundle.js", global: "SITE" },
  { source: "noaa-controls.js", out: "noaa-bundle.js", global: "NOAA" },
  { source: "forecastpoints-controls.js", out: "forecastpoints-bundle.js", global: "FCP" },
  { source: "generic-controls.js", out: "generic-bundle.js", global: "GENERIC" },
];

// Not a page bundle - env-vocab.js is loaded directly into background.js's
// service-worker scope (via importScripts), which has no `window`. Same
// copy-in requirement as the page bundles above (an extension can only load
// files packaged inside its own directory), but no bridge is appended - it's
// a plain data/knowledge table, not something the extension calls functions
// on through the page-bridge mechanism.
const LIB_FILES = [
  // Only the real assignment needs to change - "window.ENV_VOCAB" also
  // appears earlier in a plain comment, which .replace()'s first-match-only
  // behavior would hit instead if targeted loosely.
  { source: "env-vocab.js", out: "env-vocab.js", transform: (s) => s.replace("window.ENV_VOCAB = ENV_VOCAB;", "globalThis.ENV_VOCAB = ENV_VOCAB;") },
];

// One bridge, used by every bundle. It resolves a call against whichever
// manifest globals are actually present rather than a single hardcoded one,
// so a page can carry both its named manifest and GENERIC at once - that's
// what lets a USGS or NOAA page use inventory()/click() for controls its
// hand-written manifest never covered. The install guard means only the
// first bridge on a page survives, so all of them must be interchangeable.
function bridgeTemplate(global) {
  return `
/* ---------- bridge: lets the extension call this page's manifest functions ----------
 * This file runs in the page's own JS context (the "MAIN world"), so it can see
 * window.${global} above, but it has no access to chrome.* APIs. It talks out via
 * postMessage; a content script in the isolated world relays that to the extension
 * background script. Function lookup walks every manifest global present, so
 * injecting a named manifest and GENERIC together works.
 */
// Replace, do not skip. A boolean guard meant a tab that was already open
// kept the bridge from whichever build first touched it: reloading the
// extension replaced window.GENERIC but left the old listener in place, so
// any fix to the bridge itself silently did not apply until the page was
// reloaded too. That is invisible from the outside and looks exactly like a
// fix that did not work.
if (window.__wcPageBridge) {
  window.removeEventListener("message", window.__wcPageBridge);
}
{
  window.__wcPageBridgeInstalled = true;

  // postMessage structured-clones its payload, and a DOM node cannot be
  // cloned. click() returns the element it clicked, so a click that worked
  // perfectly came back as "HTMLAnchorElement object could not be cloned" -
  // an action reported as a failure after it had already happened, which is
  // the one error people retry until they break something.
  //
  // Guarded here rather than at each call site so nothing a manifest returns,
  // now or later, can fail on the way home.
  const describeNode = (n) => ({
    element: String(n.tagName || "node").toLowerCase(),
    text: String(n.textContent || "").trim().slice(0, 80) || undefined,
    id: n.id || undefined,
    href: n.href || undefined,
  });
  const postable = (v) => {
    if (v == null || typeof v !== "object") return v;
    if (typeof Node !== "undefined" && v instanceof Node) return describeNode(v);
    try {
      if (typeof structuredClone === "function") structuredClone(v);
      return v;
    } catch (e) {
      if (Array.isArray(v)) return v.map(postable);
      const out = {};
      for (const k of Object.keys(v)) { try { out[k] = postable(v[k]); } catch (e2) { out[k] = String(v[k]); } }
      return out;
    }
  };
  window.__wcPageBridge = async (e) => {
    if (e.source !== window) return;
    if (!e.data || e.data.channel !== "web-controls-req") return;
    const { id, fn, args } = e.data;
    try {
      // Named manifests first: a hand-written, verified implementation beats
      // GENERIC's selector-driven fallback whenever both expose the same name.
      const names = ["USGS", "SITE", "NOAA", "FCP", "GENERIC"];
      const owner = names
        .map((n) => window[n])
        .find((t) => t && typeof t[fn] === "function");
      if (!owner) throw new Error(\`\${fn} is not a function on any manifest loaded here (tried \${names.join(", ")})\`);
      const result = await owner[fn](...(args || []));
      window.postMessage({ channel: "web-controls-res", id, ok: true, result: postable(result) }, "*");
    } catch (err) {
      window.postMessage({ channel: "web-controls-res", id, ok: false, error: String((err && err.message) || err) }, "*");
    }
  };
  window.addEventListener("message", window.__wcPageBridge);
}
`;
}

for (const { source, out, global } of BUNDLES) {
  const sourcePath = path.join(ROOT, source);
  const outPath = path.join(PAGE_DIR, out);
  const body = fs.readFileSync(sourcePath, "utf8");
  fs.writeFileSync(outPath, body + bridgeTemplate(global));
  console.log(`wrote ${out} (from ${source}, global window.${global})`);
}

fs.mkdirSync(LIB_DIR, { recursive: true });
for (const { source, out, transform } of LIB_FILES) {
  const sourcePath = path.join(ROOT, source);
  const outPath = path.join(LIB_DIR, out);
  const body = fs.readFileSync(sourcePath, "utf8");
  fs.writeFileSync(outPath, transform ? transform(body) : body);
  console.log(`wrote lib/${out} (from ${source})`);
}
