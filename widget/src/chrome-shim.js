/* chrome-shim.js - the parts of the extension platform background.js reaches
 * for, answered from inside the page.
 *
 * background.js is the extension's whole agent: shortcuts, the step loop,
 * verification, the reading prompt. It talks to the outside world only
 * through chrome.* - messages to the page, to the panel's model, to storage,
 * to the tab. The test harness has always run it outside Chrome by stubbing
 * exactly that surface (extension/test/harness.js), and this is the same
 * idea with real answers behind it:
 *
 *   tabs.sendMessage(call)  -> window.GENERIC, in this same page
 *   runtime.sendMessage     -> the in-page model host ("panel"), or the
 *                              widget's UI (progress, which has no target)
 *   storage.local           -> localStorage, so the history outlives a page
 *                              load, which in a library is every navigation
 *   tabs.query / onUpdated  -> location, and history.pushState for apps
 *                              that route without reloading
 *
 * Everything else it touches at load - side panels, offscreen documents,
 * content-script registration - has no meaning here and is a no-op.
 *
 * The page the agent works on is this one unless `page` says otherwise:
 * the mini browser hands in a frame (frame-page.js), and the agent in the
 * page around it then outlives every page the frame shows.
 */
function createChromeShim({ modelHost, storageKey = "web-controls", onBroadcast, beforeCall, onWarm, pageGlobals, pageUrl, page } = {}) {
  const messageHandlers = [];
  page = page || inPage({ pageUrl });
  const pageHref = page.href;
  const updatedListeners = new Set();
  const changeListeners = new Set();
  const noop = () => {};
  const listenerSlot = () => ({ addListener: noop, removeListener: noop, hasListener: () => false });

  // A callback and a promise, both, as Chrome offers. background.js uses
  // both shapes.
  const either = (value, cb) => {
    if (typeof cb === "function") { Promise.resolve(value).then(cb); return undefined; }
    return Promise.resolve(value);
  };

  // --- storage ----------------------------------------------------------
  // One localStorage entry holding the lot. Blocked storage (a sandboxed
  // frame, a privacy mode) falls back to memory: the history is then only
  // as long as the page, which is no worse than having none.
  //
  // And once a write has failed, memory for good. A full quota (5 MB, shared
  // with the host app) refuses the write and leaves the old value readable,
  // so reading localStorage after that returned the history as it was before
  // the failure - every ask from then on vanished from it.
  let memory = {};
  let memoryOnly = false;
  const readAll = () => {
    if (memoryOnly) return memory;
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}") || {}; } catch (e) { return memory; }
  };
  const writeAll = (data) => {
    memory = data;
    if (memoryOnly) return;
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (e) { memoryOnly = true; }
  };
  const storageLocal = {
    get(key, cb) {
      const data = readAll();
      let out;
      if (key == null) out = { ...data };
      else if (typeof key === "string") out = key in data ? { [key]: data[key] } : {};
      else if (Array.isArray(key)) out = Object.fromEntries(key.filter((k) => k in data).map((k) => [k, data[k]]));
      else out = Object.fromEntries(Object.keys(key).map((k) => [k, k in data ? data[k] : key[k]]));
      return either(out, cb);
    },
    set(obj, cb) {
      const data = readAll();
      const changes = {};
      for (const [k, v] of Object.entries(obj || {})) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      writeAll(data);
      for (const fn of changeListeners) { try { fn(changes, "local"); } catch (e) { /* theirs */ } }
      return either(undefined, cb);
    },
    remove(key, cb) {
      const data = readAll();
      for (const k of (Array.isArray(key) ? key : [key])) delete data[k];
      writeAll(data);
      return either(undefined, cb);
    },
    clear(cb) { writeAll({}); return either(undefined, cb); },
  };

  // --- the tab, which is the page -----------------------------------------
  const thisTab = () => ({
    id: 1,
    windowId: 1,
    active: true,
    url: page.href(),
    title: page.title(),
    status: page.status(),
  });
  const tell = (status) => {
    const tab = { ...thisTab(), status };
    for (const fn of updatedListeners) {
      try { fn(tab.id, status === "loading" ? { status, url: tab.url } : { status }, tab); } catch (e) { /* theirs */ }
    }
  };
  const unwatch = page.watch(() => tell("loading"), () => tell("complete"));
  // Unmounted: the page's watchers and listeners go too, or every
  // mount/unmount left another in the chain.
  const dispose = () => {
    unwatch();
    if (page.dispose) page.dispose();
    updatedListeners.clear(); changeListeners.clear(); messageHandlers.length = 0;
  };

  // Calls on the page, answered by whichever of the named manifests owns
  // the function - only the ones the widget loaded itself. A window.SITE is
  // as likely the host's own - or an element with id="SITE", whose native
  // click() then answered the agent's click and pressed nothing.
  async function callPage(m) {
    if (!m || m.type !== "call") return {};
    if (beforeCall) { try { beforeCall(); } catch (e) { /* GENERIC still answers */ } }
    return page.call(m, pageGlobals ? pageGlobals() : ["GENERIC"]);
  }

  // --- the model, in the role of the extension's side panel ---------------
  async function answerAsPanel(m) {
    switch (m.type) {
      case "panelPing": return { ok: true, visible: true };
      case "panelStatus": return { ok: true, ...modelHost.status() };
      case "panelStep":
        try {
          const out = await modelHost.step(m.model, m.prompt, { timeoutMs: m.timeoutMs, schema: m.schema || null,
            logprobs: !!m.logprobs, maxTokens: m.maxTokens || null });
          return { ok: true, ...out, model: modelHost.status().model };
        } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
      case "panelBench":
        try {
          const began = Date.now();
          const out = await modelHost.step(m.model, "Reply with the single word: ready", { timeoutMs: 60000 });
          return { ok: true, ms: Date.now() - began, decodePerS: out.cost && out.cost.decodePerS, where: "the page" };
        } catch (e) { return { ok: false, error: String((e && e.message) || e), where: "the page" }; }
      case "panelEmbed":
        try { return { ok: true, vectors: await modelHost.embed(m.texts || []) }; }
        catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
      // The first request that needs the model starts it - through the
      // panel, so the progress bar shows it, where there is one.
      case "panelWarm":
        if (onWarm) { try { onWarm(m.model); } catch (e) { modelHost.load(m.model); } }
        else modelHost.load(m.model);
        return { ok: true };
      case "panelRelease":
        await modelHost.release();
        return { ok: true };
      case "panelInterrupt":
        if (modelHost.interrupt) modelHost.interrupt();
        return { ok: true };
      default:
        return undefined;
    }
  }

  const chrome = {
    runtime: {
      id: "web-controls-widget",
      lastError: undefined,
      onStartup: listenerSlot(),
      onInstalled: listenerSlot(),
      onMessage: {
        addListener(fn) { messageHandlers.push(fn); },
        removeListener(fn) { const i = messageHandlers.indexOf(fn); if (i >= 0) messageHandlers.splice(i, 1); },
        hasListener: (fn) => messageHandlers.includes(fn),
      },
      sendMessage(m, cb) {
        let reply;
        if (m && m.target === "panel") reply = answerAsPanel(m);
        // There is no hidden document here. Answering nothing is what the
        // extension sees when it has not been created, and every caller
        // already treats that as "not there".
        else if (m && m.target === "offscreen") reply = undefined;
        else {
          if (onBroadcast) { try { onBroadcast(m); } catch (e) { /* the UI's */ } }
          reply = undefined;
        }
        return either(reply, cb);
      },
      getURL: (p) => p,
      getManifest: () => ({ name: "web-controls widget", version: globalThis.WC_WIDGET_VERSION || "0" }),
      getContexts: async () => [],
      getPlatformInfo(cb) { return either({}, cb); },
    },
    action: { setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop },
    tabs: {
      query: (q, cb) => either([thisTab()], cb),
      get: (id, cb) => either(thisTab(), cb),
      sendMessage: (tabId, m, cb) => either(callPage(m), cb),
      onUpdated: {
        addListener: (fn) => updatedListeners.add(fn),
        removeListener: (fn) => updatedListeners.delete(fn),
        hasListener: (fn) => updatedListeners.has(fn),
      },
      onRemoved: listenerSlot(),
      onActivated: listenerSlot(),
    },
    windows: { onFocusChanged: listenerSlot() },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    // Installed by the site, so it is permitted on the site. There is no
    // other site it can reach.
    permissions: {
      contains: (q, cb) => either(true, cb),
      getAll: (cb) => either({ origins: [`${location.origin}/*`] }, cb),
      request: (q, cb) => either(true, cb),
      onAdded: listenerSlot(),
      onRemoved: listenerSlot(),
    },
    // The page bundles are already in this page; nothing to inject.
    scripting: {
      executeScript: async () => [],
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {},
    },
    storage: {
      local: storageLocal,
      onChanged: {
        addListener: (fn) => changeListeners.add(fn),
        removeListener: (fn) => changeListeners.delete(fn),
      },
    },
    offscreen: { createDocument: async () => {}, closeDocument: async () => {}, hasDocument: async () => false },
  };

  // Into background.js's handlers, as Chrome would deliver it, resolved with
  // whatever the handler sends back.
  function send(message) {
    return new Promise((resolve, reject) => {
      if (!messageHandlers.length) { reject(new Error("the agent did not start")); return; }
      let done = false;
      const sendResponse = (res) => { if (!done) { done = true; resolve(res); } };
      let pending = false;
      for (const fn of messageHandlers) {
        try {
          if (fn(message, { id: "web-controls-widget", url: location.href }, sendResponse) === true) pending = true;
        } catch (e) { reject(e); return; }
      }
      // Nobody kept the channel open and nobody answered: Chrome resolves
      // that with nothing, and so does this.
      if (!pending && !done) resolve(undefined);
    });
  }

  return { chrome, send, storage: storageLocal, dispose, pageHref };
}

/* This page, as the agent's tab: the widget a site installs. */
function inPage({ pageUrl } = {}) {
  // The address the agent routes on. A page served through a proxy lives at
  // <proxy>/<host>/<path>; `pageUrl` names the site, and the path after its
  // host is the site's own, so routeFor and the site manifests see the
  // address the page really has.
  let proxiedHost = null;
  try { if (pageUrl) proxiedHost = new URL(pageUrl).host; } catch (e) { /* not an address */ }
  const href = () => {
    if (!proxiedHost) return location.href;
    const prefix = `/${proxiedHost}`;
    const p = location.pathname === prefix || location.pathname.startsWith(`${prefix}/`) ? location.pathname.slice(prefix.length) : location.pathname;
    return `https://${proxiedHost}${p || "/"}${location.search}${location.hash}`;
  };
  return {
    href,
    title: () => document.title,
    // Loading only while the document is still being parsed. Waiting for
    // readyState "complete" meant waiting for the load event, which one hung
    // image or tracker holds off forever - and nothing announced it when it
    // did come. So on such a page every ask sat out waitForPageLoad's full
    // ten seconds (twenty when waitForNavigation took "loading" for a
    // navigation), for a page whose controls had been there all along.
    status: () => (document.readyState === "loading" ? "loading" : "complete"),
    async call(m, names) {
      const owner = names.map((n) => window[n])
        .find((t) => t && typeof t.nodeType !== "number" && typeof t[m.fn] === "function");
      if (!owner) return { ok: false, error: `${m.fn} is not a function on any manifest loaded here` };
      try { return { ok: true, result: wcPostable(await owner[m.fn](...(m.args || []))) }; }
      catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
    // A client-side route change is the only navigation this page lives
    // through. A full one ends this script along with everything else.
    watch(onLoading, onComplete) {
      let lastUrl = location.href;
      const announce = () => { onLoading(); setTimeout(onComplete, 0); };
      const checkUrl = () => { if (location.href !== lastUrl) { lastUrl = location.href; announce(); } };
      const undo = [];
      for (const name of ["pushState", "replaceState"]) {
        const original = history[name];
        if (typeof original !== "function") continue;
        const wrapped = function (...args) {
          const out = original.apply(this, args);
          try { checkUrl(); } catch (e) { /* never break the app's router */ }
          return out;
        };
        history[name] = wrapped;
        undo.push(() => { if (history[name] === wrapped) history[name] = original; });
      }
      // Mounted from a module before the document finished parsing: a wait
      // that began then hears when it has.
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onComplete, { once: true });
      window.addEventListener("popstate", checkUrl);
      window.addEventListener("hashchange", checkUrl);
      return () => {
        undo.forEach((fn) => fn());
        window.removeEventListener("popstate", checkUrl);
        window.removeEventListener("hashchange", checkUrl);
      };
    },
  };
}
