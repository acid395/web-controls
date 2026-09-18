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

// Every test here has driven the planners directly, which leaves the message
// handler itself - the only thing the extension actually runs - untested. A
// throw in that handler fails every single ask at once and is invisible to
// all of them. loadBackground({ page }) wires the stub to a real jsdom page
// so a message can be sent in and an answer waited for, end to end.
function loadBackground({ onFetch, page } = {}) {
  const requests = [];
  let messageHandler = null;
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
        onMessage: { addListener(fn) { messageHandler = fn; } },
        getPlatformInfo(cb) { cb && cb({}); },
        sendMessage() {},
        getURL: (p) => `chrome-extension://test/${p}`,
        getContexts: async () => [],
      },
      tabs: {
        query: async () => (page ? [{ id: 1, url: page.location.href, active: true }] : []),
        get: async (id) => (page ? { id, url: page.location.href, active: true } : null),
        // The bridge, collapsed: the background asks for a function by name,
        // the page's manifest runs it.
        sendMessage: async (tabId, m) => {
          if (!page || !m || m.type !== "call") return {};
          const target = ["USGS", "SITE", "NOAA", "FCP", "GENERIC"]
            .map((n) => page[n]).find((t) => t && typeof t[m.fn] === "function");
          if (!target) return { ok: false, error: `${m.fn} is not a function on any manifest loaded here` };
          try { return { ok: true, result: await target[m.fn](...(m.args || [])) }; }
          catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
        },
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} },
        onActivated: { addListener() {} },
      },
      windows: { onFocusChanged: { addListener() {} } },
      sidePanel: { setPanelBehavior: async () => {} },
      permissions: {
        contains: async () => true,
        getAll: async () => ({ origins: [] }),
        onAdded: { addListener() {} },
        onRemoved: { addListener() {} },
      },
      scripting: {
        executeScript: async () => {},
        getRegisteredContentScripts: async () => [],
        registerContentScripts: async () => {},
        unregisterContentScripts: async () => {},
      },
      // A real in-memory store, not a no-op: ask history is persisted through
      // here, and stubbing it away would test nothing.
      storage: {
        local: {
          _data: {},
          async get(key) {
            if (key == null) return { ...this._data };
            if (typeof key === "string") return key in this._data ? { [key]: this._data[key] } : {};
            return Object.fromEntries(Object.keys(key).map((k) => [k, k in this._data ? this._data[k] : key[k]]));
          },
          async set(obj) { Object.assign(this._data, obj); },
        },
        onChanged: { addListener() {} },
      },
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
  // Send a message in exactly as Chrome would, and resolve with what the
  // handler sends back.
  sandbox.__ask = (message, { timeoutMs = 15000 } = {}) => new Promise((resolve, reject) => {
    if (!messageHandler) return reject(new Error("background.js registered no onMessage listener"));
    const timer = setTimeout(() => reject(new Error("the handler never responded")), timeoutMs);
    let done = false;
    const sendResponse = (res) => { if (done) return; done = true; clearTimeout(timer); resolve(res); };
    try {
      messageHandler(message, { id: "test" }, sendResponse);
    } catch (err) {
      clearTimeout(timer);
      reject(err); // a synchronous throw here fails every ask in the product
    }
  });
  return sandbox;
}

// Runs the GENERIC page bundle against a DOM, the way it runs in a real page.
// Returns null when jsdom isn't installed, so DOM tests skip rather than fail.
// A real page always has a real URL, and code under test resolves relative
// links against it; about:blank (jsdom's default) makes that throw.
function loadPage(html, { url = "https://waterdata.usgs.gov/state/Idaho/" } = {}) {
  let JSDOM;
  try { ({ JSDOM } = require("jsdom")); } catch (e) { return null; }
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "dangerously", url });
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

// offscreen.js is an ES module importing the WebLLM bundle, so it cannot be
// required directly. Its pure helpers are lifted out and evaluated alone.
function loadOffscreenHelper(name) {
  const src = fs.readFileSync(path.join(EXT, "offscreen", "offscreen.js"), "utf8");
  // Delimited by markers rather than by walking braces: the function being
  // extracted contains "{" and "}" as string literals, which defeats naive
  // brace counting - the same problem it exists to solve.
  const open = `/* @testable-start ${name} */`;
  const start = src.indexOf(open);
  const end = src.indexOf("/* @testable-end */", start);
  if (start === -1 || end === -1) throw new Error(`${name} is not marked testable in offscreen.js`);
  const sandbox = { JSON, console };
  vm.createContext(sandbox);
  vm.runInContext(`${src.slice(start + open.length, end)}\nthis.__fn = ${name};`, sandbox);
  return sandbox.__fn;
}

module.exports = { loadBackground, loadPage, loadOffscreenHelper, EXT };
