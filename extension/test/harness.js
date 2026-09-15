/* harness.js - loads background.js outside Chrome so its logic can be tested.
 *
 * background.js is a service worker: it calls importScripts at load and
 * chrome.* throughout. Rather than restructure it for testability, it runs
 * here in a vm context with those stubbed, which keeps the file under test
 * byte-identical to the one that ships.
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const EXT = path.join(__dirname, "..");

function loadBackground({ onFetch } = {}) {
  const requests = [];
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, URL,
    fetch: (url, opts) => {
      requests.push(String(url));
      if (onFetch) onFetch(String(url));
      return fetch(url, opts);
    },
    importScripts(rel) {
      vm.runInContext(fs.readFileSync(path.join(EXT, rel), "utf8"), sandbox, { filename: rel });
    },
    chrome: {
      runtime: {
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} },
        onMessage: { addListener() {} },
        getPlatformInfo(cb) { cb && cb({}); },
        sendMessage() {},
        getURL: (p) => `chrome-extension://test/${p}`,
        getContexts: async () => [],
      },
      tabs: { query: async () => [], sendMessage: async () => ({}) },
      permissions: { contains: async () => true },
      scripting: { executeScript: async () => {} },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      offscreen: { createDocument: async () => {} },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // env-vocab announces itself on load; keep test output readable.
  const quiet = console.log;
  console.log = () => {};
  try {
    vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), sandbox, { filename: "background.js" });
  } finally {
    console.log = quiet;
  }
  sandbox.__requests = requests;
  return sandbox;
}

// Runs the GENERIC page bundle against a DOM, the way it runs in a real page.
// Returns null when jsdom isn't installed, so DOM tests skip rather than fail.
function loadPage(html) {
  let JSDOM;
  try { ({ JSDOM } = require("jsdom")); } catch (e) { return null; }
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "dangerously" });
  const w = dom.window;
  // jsdom lays nothing out, so every element measures zero and the bundle's
  // isVisible() would reject all of them.
  w.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
  const script = w.document.createElement("script");
  script.textContent = fs.readFileSync(path.join(EXT, "page", "generic-bundle.js"), "utf8");
  const quiet = w.console.log;
  w.console.log = () => {};
  w.document.body.appendChild(script);
  w.console.log = quiet;
  return w;
}

module.exports = { loadBackground, loadPage, EXT };
