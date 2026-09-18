/* ============================================================================
 * generic-controls.js - paste into the DevTools console on ANY page.
 *
 *   window.WC       generic DOM primitives, identical to the WC block in
 *                    every other file here. Keep them in sync.
 *   window.GENERIC  a manifest that needs no site-specific code at all: it
 *                    reads the live page and acts on it by selector, instead
 *                    of through named per-site functions like USGS.setParameter.
 *
 * This is the "no manifest yet" tier. web-controls.js / site-controls.js /
 * noaa-controls.js / forecastpoints-controls.js are all hand-written for one
 * specific page, which is what makes them reliable, and what makes them not
 * generalize. GENERIC trades some of that reliability for working on a page
 * nobody has looked at yet: instead of GENERIC.setParameter('discharge'), you
 * (or an LLM) call GENERIC.inventory() to see what's on the page, then
 * GENERIC.click(selector) / GENERIC.selectOption(selector, value) / etc.
 * against the exact selectors it just printed.
 *
 * After pasting, try:
 *   GENERIC.inventory()             // every control on the page, deduplicated
 *   GENERIC.mapInfo()               // is there a map, can it be driven
 *   GENERIC.click('#some-button')
 *   GENERIC.selectOption('#basemap-select', 'satellite')
 * ========================================================================== */
(() => {
  /* ---------- Layer 1: generic primitives ---------- */

  // querySelectorAll that also searches inside open shadow roots
  const deepQueryAll = (sel, root = document) => {
    const out = [];
    const visit = (node) => {
      node.querySelectorAll(sel).forEach((el) => out.push(el));
      node.querySelectorAll("*").forEach((el) => el.shadowRoot && visit(el.shadowRoot));
    };
    visit(root);
    return out;
  };
  const deepQuery = (sel, root) => deepQueryAll(sel, root)[0] || null;

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  // Reads the text that identifies a control, original case, whitespace
  // collapsed. Same order every file uses, including inventory-controls.js's
  // label() function: aria-label, then aria-labelledby, then a <label>
  // association, then a wrapping <label>, then placeholder/title/name, then
  // plain text content. Keep this order the same everywhere.
  const rawLabelOf = (el) => {
    if (!el) return "";
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const root = el.getRootNode();
      const txt = labelledBy
        .split(/\s+/)
        .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
        .filter(Boolean)
        .map((n) => n.textContent)
        .join(" ");
      if (clean(txt)) return clean(txt);
    }
    if (el.labels && el.labels[0]) return clean(el.labels[0].textContent);
    if (el.id) {
      const root = el.getRootNode();
      const forLabel = root.querySelector && root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) return clean(forLabel.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) return clean(wrap.textContent);
    return clean(el.placeholder || el.title || el.name || el.textContent || "");
  };
  // Matching form: lowercased and collapsed. Everything in this file that
  // compares labels (pickRadio, clickByText, ...) uses this, not rawLabelOf.
  const labelOf = (el) => norm(rawLabelOf(el));

  // React-safe value setter. Bypasses React's own tracking of the value.
  const setNativeValue = (el, value) => {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype :
      HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  };

  // Full pointer and mouse sequence, then a real click. React fires its own
  // onChange from that click's default action.
  const realClick = (elOrSel) => {
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`realClick: not found: ${elOrSel}`);
    el.scrollIntoView({ block: "center", inline: "center" });
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
    return el;
  };

  const fill = (elOrSel, text) => {
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`fill: not found: ${elOrSel}`);
    el.focus();
    setNativeValue(el, text);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: text.slice(-1) || "a" }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: text.slice(-1) || "a" }));
    return el;
  };

  const setSelect = (elOrSel, valueOrText) => {
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el || el.tagName !== "SELECT") throw new Error(`setSelect: not a <select>: ${elOrSel}`);
    const opt = [...el.options].find(
      (o) => o.value === valueOrText || norm(o.text) === norm(valueOrText)
    );
    if (!opt) throw new Error(`setSelect: no option "${valueOrText}" in [${[...el.options].map((o) => o.value)}]`);
    setNativeValue(el, opt.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.value;
  };

  const setChecked = (elOrSel, on = true) => {
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`setChecked: not found: ${elOrSel}`);
    if (!!el.checked !== !!on) realClick(el);
    return el.checked;
  };

  // Picks a radio inside a name-group by value, then exact label, then
  // partial label. Falls back to checking every radio with no name
  // attribute at all if the named group is empty. Some frameworks (seen on
  // water.noaa.gov) render an exclusive set of radios without a shared
  // name, and handle the exclusivity themselves in JS instead of relying on
  // the browser's native grouping. In that fallback groupName is unused,
  // since there's no real group to search within, so pass anything.
  const pickRadio = (groupName, valueOrLabel) => {
    let radios = deepQueryAll(`input[type=radio][name="${CSS.escape(groupName)}"]`);
    if (!radios.length) radios = deepQueryAll("input[type=radio]:not([name])");
    if (!radios.length) throw new Error(`pickRadio: no radio group "${groupName}"`);
    const want = norm(valueOrLabel);
    const hit =
      radios.find((r) => r.value === valueOrLabel) ||
      radios.find((r) => labelOf(r) === want) ||
      radios.find((r) => labelOf(r).includes(want));
    if (!hit) throw new Error(`pickRadio: "${valueOrLabel}" not in [${radios.map((r) => r.value)}]`);
    if (!hit.checked) realClick(hit);
    return hit.value;
  };

  // Clicks the first button, link, or role=button whose text or aria-label
  // matches. Strips all whitespace from both sides first, because some
  // sites split a label across several <span> tags with no space between
  // them, so it renders as e.g. "Customizefilters".
  const clickByText = (text, { tags = ["button", "a", "[role=button]", "summary"] } = {}) => {
    const squash = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
    const t = squash(text);
    const el = deepQueryAll(tags.join(",")).find((e) => {
      const l = squash(e.getAttribute("aria-label") || e.textContent);
      return l === t || l.includes(t);
    });
    if (!el) throw new Error(`clickByText: "${text}" not found`);
    return realClick(el);
  };

  // Exact match, whitespace collapsed to single spaces. Use this when two
  // controls differ only by a space that clickByText's whitespace-stripping
  // would erase, for example "changetime span" (a panel toggle) versus
  // "change time span" (the apply button inside that panel).
  const clickExact = (text, { tags = ["button", "a", "[role=button]", "summary"] } = {}) => {
    const t = norm(text);
    const el = deepQueryAll(tags.join(",")).find(
      (e) => norm(e.textContent) === t || norm(e.getAttribute("aria-label")) === t
    );
    if (!el) throw new Error(`clickExact: "${text}" not found`);
    return realClick(el);
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fnOrSel, { timeout = 8000, interval = 150 } = {}) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = typeof fnOrSel === "string" ? deepQuery(fnOrSel) : fnOrSel();
      if (v) return v;
      await wait(interval);
    }
    throw new Error(`waitFor: timed out after ${timeout}ms`);
  };

  const WC = {
    deepQuery, deepQueryAll, rawLabelOf, labelOf, norm,
    setNativeValue, realClick, fill, setSelect, setChecked, pickRadio, clickByText, clickExact,
    wait, waitFor,
  };

  /* ============================================================================
   * Layer 2: GENERIC - a manifest for a page nobody has mapped yet.
   *
   * inventory() is the same walk-and-dedupe logic as inventory-controls.js,
   * kept in sync with it, but returned as data instead of printed as a
   * table, and every row carries a selector so a caller (human or LLM) can
   * act on it immediately with the functions below.
   * ========================================================================== */

  function* walk(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n = tw.currentNode;
    while (n) { yield n; if (n.shadowRoot) yield* walk(n.shadowRoot); n = tw.nextNode(); }
  }

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  const reactProps = (el) => {
    const k = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return k ? el[k] : null;
  };
  // Misses Svelte (and some other frameworks): they compile a bound click
  // handler into a plain addEventListener call, which leaves neither an
  // onclick attribute nor a React-style prop marker on the element. Found
  // live on water.noaa.gov: a set of search-result rows were invisible to
  // both checks below. getEventListeners is a real fix for that specific
  // case, but it only exists in the DevTools console's own command-line API,
  // not in a page's own JS or a real extension's injected code, so it's used
  // when available and skipped otherwise rather than relied on.
  const hasJsHandler = (el) => {
    if (el.hasAttribute("onclick")) return true;
    const p = reactProps(el);
    if (p && (p.onClick || p.onChange || p.onInput)) return true;
    try {
      if (typeof getEventListeners === "function") {
        const ev = getEventListeners(el);
        if (ev && (ev.click || ev.pointerdown || ev.mousedown)) return true;
      }
    } catch (e) { /* not running in a console that provides it */ }
    return false;
  };
  // Weaker, framework-agnostic fallback that works everywhere, including a
  // real extension where getEventListeners isn't available at all: anything
  // styled to look clickable probably is, even if nothing above caught its
  // handler. Trades some false positives (decorative hover styles) for
  // catching handlers no attribute or prop inspection can see. Excludes SVG
  // graphics primitives: found live on water.noaa.gov that an icon's <svg>/
  // <path>/<line> inherit "pointer" from their already-captured clickable
  // parent button, so counting them too just duplicates that one real
  // control under three more entries instead of finding anything new.
  const GRAPHIC_TAGS = new Set(["svg", "path", "line", "circle", "rect", "polygon", "polyline", "g", "ellipse", "use"]);
  const looksClickable = (el) => {
    if (GRAPHIC_TAGS.has(el.tagName.toLowerCase())) return false;
    try { return getComputedStyle(el).cursor === "pointer"; } catch (e) { return false; }
  };

  const cssPath = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let s = cur.tagName.toLowerCase();
      if (cur.classList.length) s += "." + [...cur.classList].map((c) => CSS.escape(c)).join(".");
      const p = cur.parentNode;
      if (p && p.children) {
        const sib = [...p.children].filter((c) => c.tagName === cur.tagName);
        if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(cur) + 1})`;
      }
      parts.unshift(s);
      cur = p instanceof ShadowRoot ? p.host : p;
    }
    return parts.join(" > ");
  };

  // normalize dynamic bits so repeated rows share a signature, the same
  // dedup trick as inventory-controls.js: without it, a page with 40
  // repeated site-list rows produces 40 near-identical entries instead of
  // one pattern with a count, which wastes an LLM's context just as badly
  // as it wastes a human's screen. The final catch-all only strips runs of
  // 3+ digits (site ids, most numeric codes), not shorter ones: found live
  // on drought.gov that stripping every digit collapsed a 1-10 rating-scale
  // survey's radio buttons ("2".."9") into one signature, since they all
  // normalized to the same bare "#" with nothing else to tell them apart,
  // silently hiding 7 real, distinct options behind a single entry.
  const sigNorm = (s) => (s || "")
    .replace(/USGS-?\d+/g, "#ID")
    .replace(/\d{4}-\d{2}-\d{2}/g, "#DATE")
    .replace(/\d{3,}/g, "#")
    .trim();

  const TAGS = ["select", "input", "textarea", "button", "a", "summary", "details"];
  const ROLES = ["button", "link", "combobox", "listbox", "option", "tab", "checkbox",
    "radio", "switch", "menuitem", "menuitemcheckbox", "slider", "searchbox", "spinbutton"];

  function inventory() {
    const seen = new Set();
    const all = [];
    for (const el of walk(document.documentElement)) {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");
      const tabbable = el.getAttribute("tabindex") !== null && el.tabIndex >= 0;
      // Real signals (a native interactive tag, an ARIA role, a tab stop, or
      // an actual handler) vs. cursor:pointer alone. Found live on
      // water.noaa.gov: clicking a cursor:pointer-only <ul> did nothing,
      // because the real handler was on a child button inside it, not the
      // <ul> itself, so that fallback's catches get marked low confidence
      // rather than presented the same as a real button or role=button.
      const strong = TAGS.includes(tag) || (role && ROLES.includes(role)) || tabbable || hasJsHandler(el);
      const weak = !strong && looksClickable(el);
      if (!(strong || weak)) continue;
      if (seen.has(el) || !isVisible(el)) continue;
      seen.add(el);

      const lab = rawLabelOf(el);
      const rec = {
        kind: role || tag, tag, type: el.type || "", label: lab.slice(0, 80),
        name: el.name || "", id: el.id || "", value: (el.value ?? "").toString().slice(0, 60),
        checked: (el.type === "checkbox" || el.type === "radio") ? !!el.checked : undefined,
        selector: cssPath(el),
        confidence: weak ? "low" : "high",
      };
      if (tag === "select") rec.options = [...el.options].map((o) => ({ value: o.value, text: o.text.trim() }));
      rec._sig = [rec.kind, rec.type, sigNorm(lab), rec.name].join("|");
      all.push(rec);
    }

    const bySig = new Map();
    for (const r of all) {
      if (!bySig.has(r._sig)) bySig.set(r._sig, []);
      bySig.get(r._sig).push(r);
    }
    const groups = [...bySig.values()].map((rows) => {
      const r = rows[0];
      const { _sig, ...rest } = r;
      return { ...rest, count: rows.length };
    });

    return { url: location.href, controlCount: all.length, patternCount: groups.length, controls: groups };
  }

  // duck-typed map-instance hunt, same signatures as map-probe.js
  function mapInfo() {
    const domHints = {
      "Leaflet": ".leaflet-container",
      "Mapbox GL": ".mapboxgl-canvas",
      "MapLibre GL": ".maplibregl-canvas",
      "OpenLayers": ".ol-viewport",
      "Esri ArcGIS": "[class*='esri-']",
      "Google Maps": ".gm-style",
    };
    const libraries = Object.keys(domHints).filter((name) => deepQueryAll(domHints[name]).length > 0);
    const domMarkers = deepQueryAll(".leaflet-marker-icon, .leaflet-interactive").length;

    const instanceSigns = [
      { lib: "Leaflet", keys: ["getCenter", "getZoom", "eachLayer", "setView"] },
      { lib: "Mapbox/MapLibre GL", keys: ["getCenter", "getZoom", "queryRenderedFeatures", "getStyle"] },
      { lib: "OpenLayers", keys: ["getView", "getLayers", "forEachFeatureAtPixel", "renderSync"] },
      { lib: "Esri MapView/SceneView", keys: ["hitTest", "goTo", "toScreen", "toMap"] },
      { lib: "Google Maps", keys: ["getBounds", "panTo", "setZoom", "getDiv"] },
    ];
    const looksLike = (obj, keys) => {
      try { return obj && typeof obj === "object" && keys.every((k) => typeof obj[k] === "function"); }
      catch (e) { return false; }
    };
    let instanceFoundFor = null;
    let scanned = 0;
    const seen = new Set();
    const scan = (obj, depth) => {
      if (instanceFoundFor || scanned++ > 80000 || depth > 6 || obj == null) return;
      if (typeof obj !== "object" && typeof obj !== "function") return;
      if (seen.has(obj)) return;
      seen.add(obj);
      for (const sig of instanceSigns) {
        if (looksLike(obj, sig.keys)) { instanceFoundFor = sig.lib; return; }
      }
      if (obj instanceof Node || obj instanceof Window) return;
      let keys = [];
      try { keys = Object.getOwnPropertyNames(obj); } catch (e) { return; }
      for (const k of keys) {
        if (["self", "window", "top", "parent", "frames", "globalThis"].includes(k)) continue;
        let v;
        try { v = obj[k]; } catch (e) { continue; }
        scan(v, depth + 1);
      }
    };
    scan(window, 0);

    return { libraries, domMarkerCount: domMarkers, jsInstanceReachable: instanceFoundFor,
      driveable: domMarkers > 0 ? "dom" : instanceFoundFor ? "js-api" : libraries.length ? "no" : "no-map-found" };
  }

  /* ============================================================================
   * Feed capture - the data behind a chart that cannot be read.
   *
   * readPage() can read an SVG chart's labels, but a canvas chart is painted
   * pixels with nothing to extract, and the same is true of every canvas map
   * (see mapInfo). The data is not absent though - the page fetched it, drew
   * it, and threw the elements away. Intercepting fetch and XMLHttpRequest
   * catches it on the way in.
   *
   * The interceptor itself lives in page/feed-capture.js and runs at
   * document_start, because a chart requests its series during page load: an
   * interceptor installed when someone asks a question arrives too late to
   * see it. These two functions only read what it collected.
   *
   * Responses are cloned, capped, and only kept for data-looking URLs -
   * recording every image and analytics beacon would be noise, and holding
   * whole response bodies for a long-lived page would be a memory leak.
   * ========================================================================== */
  const FEED_URL_RE = /(\/api\/|\/rest\/|\/ogcapi\/|nwis|nwps|waterservices|waterdata|gridpoints|geoserver|\bwfs\b|\bwms\b|query\?|\.json(\?|$)|\.geojson(\?|$)|\.csv(\?|$)|observations|forecast|gauges?\/)/i;
  const FEED_LIMIT = 40;          // most recent N requests
  const FEED_BODY_CAP = 200000;   // characters kept per response

  // Everything captured so far. `parsed` is the decoded JSON where the body
  // was JSON, since that is the part worth reading.
  function capturedFeeds({ includeBodies = false } = {}) {
    const store = window.__wcFeedCapture;
    if (!store) {
      return { installed: false, count: 0, feeds: [],
        note: "feed capture is not installed on this page - enable the site and reload it" };
    }
    const feeds = store.feeds.map((f) => {
      let parsed = null;
      if (f.body && !f.truncated && /json/i.test(f.contentType || "")) {
        try { parsed = JSON.parse(f.body); } catch (e) { parsed = null; }
      }
      const out = { url: f.url, method: f.method, status: f.status, at: f.at, bytes: f.bytes, truncated: f.truncated };
      if (includeBodies) out.body = f.body;
      if (parsed) out.keys = Array.isArray(parsed) ? [`array[${parsed.length}]`] : Object.keys(parsed).slice(0, 12);
      return out;
    });
    return {
      installed: true, installedAt: store.installedAt, count: feeds.length, feeds,
      note: feeds.length ? undefined
        : "capture is installed but this page has requested nothing since - reload the page to catch the data it loads at startup",
    };
  }

  // One captured response in full, by URL substring - for actually reading
  // the series behind a chart rather than just listing what was fetched.
  function capturedFeed(match) {
    const store = window.__wcFeedCapture;
    if (!store) return { found: false, note: "feed capture is not installed on this page" };
    const needle = String(match || "").toLowerCase();
    const hit = [...store.feeds].reverse().find((f) => f.url.toLowerCase().includes(needle));
    if (!hit) return { found: false, note: `nothing captured whose URL contains "${match}"` };
    let parsed = null;
    try { parsed = JSON.parse(hit.body); } catch (e) { /* not JSON, body stands */ }
    return { found: true, url: hit.url, status: hit.status, at: hit.at, truncated: hit.truncated, parsed, body: parsed ? undefined : hit.body };
  }

  /* ============================================================================
   * readPage() - the data on the page, as opposed to inventory()'s controls.
   *
   * inventory() answers "what can I click here"; this answers "what does this
   * page say". Both read the live DOM at the moment they're called - nothing
   * is cached or precomputed.
   *
   * Four kinds of thing are worth extracting, in descending order of how
   * reliably they carry meaning:
   *   tables      - already structured, so they survive extraction intact
   *   pairs       - a label next to a value (dl/dt/dd, th+td, .label/.value)
   *   readouts    - a number with a unit sitting in its own element
   *   chartText   - SVG text and aria-labels, which is the only part of a
   *                 chart that exists as readable DOM
   *
   * A canvas chart yields nothing here, by construction: it is painted
   * pixels with no elements to read. That is a real limit, not an oversight
   * - see mapInfo() for the same problem with maps. The honest fix for those
   * is the data the page itself fetched, not the picture it drew.
   * ========================================================================== */

  // "12.4 ft", "-3.2 °C", "1,234 cfs", "45%"
  const NUMBER_UNIT = /(-?[\d,]+\.?\d*)\s*(°?[a-zA-Z%/]{1,12}\b)?/;

  const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

  function readTables(limit = 6) {
    const out = [];
    for (const table of deepQueryAll("table").slice(0, limit)) {
      if (!isVisible(table)) continue;
      const rows = [...table.rows].slice(0, 25);
      if (rows.length < 2) continue;
      const cells = (r) => [...r.cells].map((c) => textOf(c).slice(0, 60));

      // Requiring <th> was too strict: plenty of real tables mark up their
      // header row with <td>, and without column names a lookup has nothing
      // to match a day against - every day then reads the same cell, which
      // looks like a correct answer to the wrong question. So fall back to
      // shape: a first row that is mostly words, above rows that are mostly
      // numbers, is a header whatever tag it uses.
      const isNumeric = (t) => /^[^a-zA-Z]*-?[\d,.]+[^a-zA-Z]*$/.test(t) && /\d/.test(t);
      const firstRow = rows[0].cells.length ? cells(rows[0]) : [];
      const taggedHeader = [...rows[0].cells].some((c) => c.tagName === "TH");
      const bodyRows = rows.slice(1);
      const bodyHasNumbers = bodyRows.some((r) => cells(r).slice(1).some(isNumeric));
      const firstRowIsWords = firstRow.length > 1 && firstRow.slice(1).filter(Boolean).every((t) => !isNumeric(t));
      const header = firstRow.length && (taggedHeader || (firstRowIsWords && bodyHasNumbers))
        ? firstRow : null;
      out.push({
        caption: table.caption ? textOf(table.caption).slice(0, 80) : null,
        columns: header,
        rows: (header ? rows.slice(1) : rows).map(cells),
        totalRows: table.rows.length,
      });
    }
    return out;
  }

  function readPairs(limit = 40) {
    const pairs = [];
    // definition lists
    for (const dl of deepQueryAll("dl")) {
      const kids = [...dl.children];
      for (let i = 0; i < kids.length - 1; i++) {
        if (kids[i].tagName === "DT" && kids[i + 1].tagName === "DD") {
          pairs.push({ label: textOf(kids[i]).slice(0, 60), value: textOf(kids[i + 1]).slice(0, 60) });
        }
      }
    }
    // two-cell rows, the usual shape of a "current conditions" table
    for (const tr of deepQueryAll("tr")) {
      if (tr.cells && tr.cells.length === 2) {
        const label = textOf(tr.cells[0]), value = textOf(tr.cells[1]);
        if (label && value && label.length < 60) pairs.push({ label: label.slice(0, 60), value: value.slice(0, 60) });
      }
    }
    return pairs.slice(0, limit);
  }

  function readReadouts(limit = 40) {
    const out = [];
    const seen = new Set();
    for (const el of deepQueryAll("[class*=value], [class*=reading], [class*=stat], [class*=metric], [data-value], output")) {
      if (!isVisible(el)) continue;
      const text = textOf(el);
      if (!text || text.length > 40 || !/\d/.test(text)) continue;
      const key = text + "|" + (el.className || "");
      if (seen.has(key)) continue;
      seen.add(key);
      const m = text.match(NUMBER_UNIT);
      out.push({
        text,
        value: m ? Number(m[1].replace(/,/g, "")) : null,
        unit: m && m[2] ? m[2] : null,
        label: (el.getAttribute("aria-label") || rawLabelOf(el) || "").slice(0, 60) || null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // The readable part of a chart. SVG charts label their axes and often
  // their points; canvas charts have none of this, which is the difference
  // between a chart this can read and one it cannot.
  function readChartText(limit = 60) {
    const svgs = deepQueryAll("svg").filter(isVisible);
    const labelled = [];
    for (const svg of svgs.slice(0, 4)) {
      const texts = [...svg.querySelectorAll("text")].map(textOf).filter(Boolean);
      const aria = [...svg.querySelectorAll("[aria-label]")]
        .map((e) => e.getAttribute("aria-label")).filter((a) => a && /\d/.test(a));
      const titles = [...svg.querySelectorAll("title")].map(textOf).filter(Boolean);
      if (texts.length || aria.length || titles.length) {
        labelled.push({
          labels: texts.slice(0, limit),
          points: aria.slice(0, limit),
          titles: titles.slice(0, 12),
        });
      }
    }
    return {
      svgCharts: labelled,
      canvasCount: deepQueryAll("canvas").filter(isVisible).length,
    };
  }

  // Values written as one run of text - "High: 81°F", "Low 68 °F", "Humidity
   // 52%" - which is how a forecast page states most of what it shows. These
   // are invisible to readPairs(), which needs two elements, and to
   // readReadouts(), which needs a class or attribute to recognise. Without
   // them a page can display a number plainly and still look empty.
  function readLabelledNumbers(limit = 80) {
    const out = [];
    const seen = new Set();
    for (const el of deepQueryAll("p, span, div, li, dd, dt, td, th, strong, b, h3, h4, h5, h6")) {
      if (!isVisible(el)) continue;
      // Leaves only. A wrapper's textContent is its children concatenated,
      // which yields runs like "TodayHigh: 83 °F" alongside the "High: 83 °F"
      // it already contains - duplicated, and uglier to show.
      if (el.children.length > 1) continue;
      const text = textOf(el);
      if (!text || text.length > 70 || !/\d/.test(text)) continue;
      if (!/[a-zA-Z]/.test(text)) continue; // a bare number says nothing
      if (seen.has(text)) continue;
      seen.add(text);
      const m = text.match(/(-?[\d,]+\.?\d*)\s*(°\s?[CF]|°|%|[a-zA-Z/]{1,8})?/);
      out.push({
        text,
        value: m ? Number(m[1].replace(/,/g, "")) : null,
        unit: m && m[2] ? m[2].replace(/\s+/g, "") : null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /* ============================================================================
   * hoverSeries() - the data a chart only reveals on hover.
   *
   * A chart's numbers frequently exist nowhere in the DOM until a pointer
   * moves over it, at which point the library writes a tooltip. That is true
   * of canvas charts especially, where there is otherwise nothing to read at
   * all. Moving a synthetic pointer across the plot and collecting what
   * appears recovers the series.
   *
   * This is a genuine last resort, not a preferred path. It samples rather
   * than enumerates, so it can miss points between samples; it depends on the
   * library rendering a tooltip into the DOM at all (some draw it into the
   * canvas, where it stays unreadable); and it moves the pointer, which on a
   * map can pan or highlight. Feed capture is better whenever the underlying
   * request was seen, since that is the real series rather than a reading of
   * the picture.
   * ========================================================================== */
  const TOOLTIP_SELECTOR = [
    '[role=tooltip]', '.tooltip', '[class*="tooltip"]', '[class*="Tooltip"]',
    '[class*="popup"]', '[class*="Popup"]', '[class*="hover"]', '[id*="tooltip"]',
  ].join(",");

  const tooltipTexts = () => deepQueryAll(TOOLTIP_SELECTOR)
    .filter((el) => isVisible(el))
    .map((el) => textOf(el))
    .filter((t) => t && t.length < 300);

  async function hoverSeries({ selector, samples = 24, settle = 60 } = {}) {
    const target = selector
      ? deepQuery(selector)
      : deepQueryAll("canvas, svg").filter(isVisible).sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return (rb.width * rb.height) - (ra.width * ra.height);
        })[0];
    if (!target) return { found: false, note: "no chart or canvas on this page to hover over" };

    const box = target.getBoundingClientRect();
    if (!box.width || !box.height) return { found: false, note: "the chart has no size on screen" };

    const before = new Set(tooltipTexts());
    const seen = new Map(); // text -> the x fraction it first appeared at
    const y = box.top + box.height / 2;

    for (let i = 0; i < samples; i++) {
      const fraction = samples === 1 ? 0.5 : i / (samples - 1);
      const x = box.left + box.width * fraction;
      for (const type of ["pointermove", "mousemove"]) {
        // Both, because libraries listen for one or the other and there is
        // no reliable way to know which.
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, view: window,
        }));
      }
      await wait(settle);
      for (const text of tooltipTexts()) {
        if (before.has(text) || seen.has(text)) continue;
        seen.set(text, Math.round(fraction * 100) / 100);
      }
    }

    // Leave the pointer off the chart so the tooltip does not linger.
    target.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

    const points = [...seen.entries()].map(([text, at]) => ({ text, at }));
    return {
      found: points.length > 0,
      element: target.tagName.toLowerCase(),
      samples,
      points,
      note: points.length
        ? "read by hovering across the chart - sampled, so points between samples may be missing"
        : "hovering produced no tooltip. The chart may draw its tooltip into the canvas itself, where it cannot be read - try pageFeeds() for the data it fetched instead",
    };
  }

  /* ============================================================================
   * mapFeatures() - the data behind map markers.
   *
   * map-probe established the hard part years of testing keeps confirming: a
   * canvas map has no per-marker DOM, so markers cannot be found, clicked or
   * hovered by selector. Hovering pixels blindly is worse than useless on a
   * map, because a stray pointer pans it.
   *
   * What does sometimes exist is the library's own instance, reachable off
   * window, holding the features it drew. Asking it directly is exact where
   * hovering is guesswork. Leaflet and OpenLayers keep layers of features;
   * Mapbox and MapLibre can be queried for rendered features. When no
   * instance is reachable the honest answer is that the data is pixels, and
   * the request the page made (pageFeeds) is the only way to it.
   * ========================================================================== */
  function mapFeatures({ limit = 60 } = {}) {
    const info = mapInfo();
    const out = [];

    // DOM markers first: when they exist this is exact and cheap.
    const domMarkers = deepQueryAll('[class*="marker"], [class*="Marker"], .leaflet-marker-icon, [role="button"][aria-label]')
      .filter(isVisible)
      .map((el) => ({
        label: (el.getAttribute("aria-label") || el.getAttribute("title") || textOf(el) || "").slice(0, 120),
        selector: cssPath(el),
      }))
      .filter((m) => m.label);
    if (domMarkers.length) {
      return { source: "dom", libraries: info.libraries, count: domMarkers.length,
        features: domMarkers.slice(0, limit),
        note: "these markers are real elements, so they can also be clicked by selector" };
    }

    // Otherwise the library's own instance, if it is reachable.
    const seen = new Set();
    const collect = (obj, depth) => {
      if (!obj || depth > 5 || out.length >= limit || seen.has(obj)) return;
      if (typeof obj !== "object") return;
      seen.add(obj);

      // Leaflet: eachLayer walks everything added to the map.
      if (typeof obj.eachLayer === "function") {
        try {
          obj.eachLayer((layer) => {
            if (out.length >= limit) return;
            const latlng = typeof layer.getLatLng === "function" ? layer.getLatLng() : null;
            const popup = typeof layer.getPopup === "function" && layer.getPopup();
            const text = popup && typeof popup.getContent === "function" ? popup.getContent() : null;
            if (latlng || text) {
              out.push({
                lat: latlng ? latlng.lat : null, lon: latlng ? latlng.lng : null,
                label: typeof text === "string" ? text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : null,
                properties: layer.feature && layer.feature.properties ? layer.feature.properties : undefined,
              });
            }
          });
        } catch (e) { /* not a Leaflet map after all */ }
      }

      // OpenLayers: layers carry sources carrying features.
      if (typeof obj.getLayers === "function") {
        try {
          obj.getLayers().forEach((layer) => {
            const source = typeof layer.getSource === "function" ? layer.getSource() : null;
            if (source && typeof source.getFeatures === "function") {
              for (const f of source.getFeatures()) {
                if (out.length >= limit) break;
                const props = typeof f.getProperties === "function" ? f.getProperties() : {};
                delete props.geometry;
                out.push({ properties: props, label: (props.name || props.title || props.label || "") || null });
              }
            }
          });
        } catch (e) { /* not an OpenLayers map */ }
      }

      // Mapbox / MapLibre: ask for what is currently rendered.
      if (typeof obj.queryRenderedFeatures === "function") {
        try {
          for (const f of obj.queryRenderedFeatures()) {
            if (out.length >= limit) break;
            out.push({ properties: f.properties || {}, label: (f.properties && (f.properties.name || f.properties.title)) || null,
              lat: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : null,
              lon: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : null });
          }
        } catch (e) { /* not queryable right now */ }
      }
    };

    for (const key of Object.keys(window)) {
      if (out.length >= limit) break;
      let value;
      try { value = window[key]; } catch (e) { continue; } // some globals throw on access
      collect(value, 0);
    }

    if (out.length) {
      return { source: "js-instance", libraries: info.libraries, count: out.length, features: out.slice(0, limit),
        note: "read from the map library's own instance, which is exact - hovering pixels would not be" };
    }
    return {
      source: "none", libraries: info.libraries, count: 0, features: [],
      driveable: info.driveable,
      note: info.libraries.length
        ? "this map draws its features to a canvas and exposes no reachable instance, so there is nothing to read from the page - use pageFeeds() for the data it fetched"
        : "no map found on this page",
    };
  }

  /* ============================================================================
   * readUrl() - another page of the same site, without leaving this one.
   *
   * "I am on Idaho and I want Alaska" is a fair thing to ask, and navigating
   * there to answer it would lose the page in front of you. Fetching the
   * other page and running the same extraction over it answers without
   * moving.
   *
   * The limit is real and worth stating: this reads the HTML the server
   * sends. A page that renders its content in JavaScript - which many
   * dashboards do - arrives here nearly empty, and no amount of parsing
   * recovers what was never in the document. For those, the page's own data
   * request (pageFeeds) or the agency API is the way. Same-origin only, since
   * that is what the page is allowed to fetch.
   * ========================================================================== */
  async function readUrl(url) {
    let target;
    try { target = new URL(url, location.href); } catch (e) { throw new Error(`"${url}" is not a URL`); }
    if (target.origin !== location.origin) {
      throw new Error(`can only read pages on ${location.origin} from here - ${target.origin} is a different site`);
    }

    const res = await fetch(target.href, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${target.pathname} returned ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    // The same extraction as readPage, over a parsed document rather than the
    // live one. Visibility cannot be judged here - nothing is laid out - so
    // structure is used instead of geometry.
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    const tables = [...doc.querySelectorAll("table")].slice(0, 8).map((table) => {
      const rows = [...table.rows].slice(0, 30);
      const cells = (r) => [...r.cells].map((c) => text(c).slice(0, 60));
      const header = rows.length && [...rows[0].cells].some((c) => c.tagName === "TH") ? cells(rows[0]) : null;
      return {
        caption: table.caption ? text(table.caption).slice(0, 80) : null,
        columns: header,
        rows: (header ? rows.slice(1) : rows).map(cells),
        totalRows: table.rows.length,
      };
    }).filter((t) => t.rows.length);

    const pairs = [];
    for (const dl of doc.querySelectorAll("dl")) {
      const kids = [...dl.children];
      for (let i = 0; i < kids.length - 1; i++) {
        if (kids[i].tagName === "DT" && kids[i + 1].tagName === "DD") {
          pairs.push({ label: text(kids[i]).slice(0, 60), value: text(kids[i + 1]).slice(0, 60) });
        }
      }
    }
    for (const tr of doc.querySelectorAll("tr")) {
      if (tr.cells && tr.cells.length === 2) {
        const label = text(tr.cells[0]), value = text(tr.cells[1]);
        if (label && value && label.length < 60) pairs.push({ label: label.slice(0, 60), value: value.slice(0, 60) });
      }
    }

    const labelledNumbers = [];
    const seen = new Set();
    for (const el of doc.querySelectorAll("p, span, div, li, dd, dt, td, th, strong, b, h3, h4, h5, h6")) {
      if (el.children.length > 1) continue;
      const t = text(el);
      if (!t || t.length > 70 || !/\d/.test(t) || !/[a-zA-Z]/.test(t) || seen.has(t)) continue;
      seen.add(t);
      const m = t.match(/(-?[\d,]+\.?\d*)\s*(°\s?[CF]|°|%|[a-zA-Z/]{1,8})?/);
      labelledNumbers.push({ text: t, value: m ? Number(m[1].replace(/,/g, "")) : null, unit: m && m[2] ? m[2].replace(/\s+/g, "") : null });
      if (labelledNumbers.length >= 80) break;
    }

    const bodyText = text(doc.body || doc.documentElement).length;
    return {
      url: target.href,
      title: doc.title,
      headings: [...doc.querySelectorAll("h1, h2")].map(text).filter(Boolean).slice(0, 12),
      tables, pairs, labelledNumbers,
      readouts: [],
      chart: { svgCharts: [], canvasCount: doc.querySelectorAll("canvas").length },
      note: (!tables.length && !pairs.length && !labelledNumbers.length)
        ? (bodyText < 2000
          ? "this page arrived nearly empty, which means it builds its content in JavaScript - the server HTML has nothing to read"
          : "no tables, labelled pairs or numbers found in this page's HTML")
        : undefined,
    };
  }

  // Links on this page, so a caller can find the other page worth reading.
  function pageLinks({ limit = 120 } = {}) {
    const out = [];
    const seen = new Set();
    for (const a of deepQueryAll("a[href]")) {
      let href;
      try { href = new URL(a.getAttribute("href"), location.href); } catch (e) { continue; }
      if (href.origin !== location.origin) continue;
      if (seen.has(href.href)) continue;
      seen.add(href.href);
      const label = textOf(a).slice(0, 80) || a.getAttribute("aria-label") || a.getAttribute("title") || "";
      if (!label) continue;
      out.push({ label, url: href.href });
      if (out.length >= limit) break;
    }
    return { url: location.href, count: out.length, links: out };
  }

  /* ============================================================================
   * settle() and pageSignature() - telling a real change from a no-op.
   *
   * An action that silently did nothing looks exactly like one that worked:
   * both return without error. That is the same shape as every other bug this
   * project has produced - plausible, and wrong. Comparing a compact snapshot
   * of the page's control states before and after makes the difference
   * visible.
   *
   * Timing matters as much as the comparison. Most of these actions are
   * asynchronous - a click triggers a fetch, a re-render, an animation - so a
   * snapshot taken immediately afterwards catches the old state and reports a
   * working action as a no-op. settle() waits for the DOM to stop changing
   * first, with a ceiling so a page that mutates constantly (a live clock, a
   * ticker) cannot hang the caller.
   * ========================================================================== */
  function settle({ quiet = 220, timeout = 2500 } = {}) {
    return new Promise((resolve) => {
      let lastChange = Date.now();
      let mutations = 0;
      const observer = new MutationObserver((records) => {
        mutations += records.length;
        lastChange = Date.now();
      });
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true,
      });
      const started = Date.now();
      const tick = () => {
        const idleFor = Date.now() - lastChange;
        if (idleFor >= quiet || Date.now() - started >= timeout) {
          observer.disconnect();
          resolve({ mutations, waitedMs: Date.now() - started, timedOut: Date.now() - started >= timeout });
          return;
        }
        setTimeout(tick, 60);
      };
      setTimeout(tick, 60);
    });
  }

  // A compact record of what every control is currently set to. Deliberately
  // values only - positions and text move for reasons unrelated to the action
  // (lazy images, ads, a clock), and would report a change on every call.
  function pageSignature({ limit = 400 } = {}) {
    const state = {};
    let n = 0;
    for (const el of deepQueryAll("input, select, textarea, [role=radio], [role=checkbox], [aria-pressed], [aria-selected], [aria-expanded]")) {
      if (n >= limit) break;
      if (!isVisible(el)) continue;
      const key = cssPath(el);
      if (!key) continue;
      const tag = el.tagName.toLowerCase();
      let value;
      if (tag === "select") value = el.value;
      else if (el.type === "checkbox" || el.type === "radio") value = !!el.checked;
      else if (tag === "input" || tag === "textarea") value = String(el.value || "").slice(0, 80);
      else {
        value = el.getAttribute("aria-pressed") || el.getAttribute("aria-selected") || el.getAttribute("aria-expanded");
      }
      if (value === undefined || value === null) continue;
      // The label travels with the value. Without it a diff can only report
      // raw selectors - "div.map-app-container > div.uk-card..." - which says
      // nothing about what actually changed.
      state[key] = { value, label: rawLabelOf(el).slice(0, 60) || null, tag };
      n++;
    }
    return { url: location.href, title: document.title, controls: state, count: n };
  }

  // What actually changed between two snapshots, in terms a person can read.
  function signatureDiff(before, after) {
    const changes = [];
    const seen = new Set();
    const valueOf = (entry) => (entry && typeof entry === "object" ? entry.value : entry);
    const labelOfEntry = (entry) => (entry && typeof entry === "object" ? entry.label : null);

    for (const [key, entry] of Object.entries(after.controls || {})) {
      seen.add(key);
      const prior = (before.controls || {})[key];
      if (prior === undefined) {
        changes.push({ selector: key, label: labelOfEntry(entry), appeared: true, now: valueOf(entry) });
        continue;
      }
      if (String(valueOf(prior)) !== String(valueOf(entry))) {
        changes.push({ selector: key, label: labelOfEntry(entry) || labelOfEntry(prior), was: valueOf(prior), now: valueOf(entry) });
      }
    }
    for (const [key, entry] of Object.entries(before.controls || {})) {
      if (!seen.has(key)) changes.push({ selector: key, label: labelOfEntry(entry), disappeared: true, was: valueOf(entry) });
    }

    // A fragment change is the same document with a different view - most map
    // pages write their centre and zoom there. Reporting it as "page moved
    // to <long url>" is both ugly and wrong.
    const stripHash = (u) => String(u || "").split("#")[0];
    const hashOnly = before.url !== after.url && stripHash(before.url) === stripHash(after.url);

    return {
      changed: changes.length > 0 || before.url !== after.url,
      navigated: before.url !== after.url && !hashOnly ? { from: before.url, to: after.url } : undefined,
      viewChanged: hashOnly || undefined,
      changes: changes.slice(0, 20),
      changeCount: changes.length,
    };
  }

  /* ============================================================================
   * submit() - typing is not searching.
   *
   * fill() types and stops. Every hand-written manifest that wraps a search
   * box adds Enter itself (see NOAA.search), because typing alone leaves the
   * text sitting in the box and nothing else happening - and the value did
   * change, so a verification check calls it a success. A search that looks
   * performed and was not is the worst outcome available.
   *
   * Three routes, because sites differ: the Enter key, the form's own submit,
   * and an adjacent submit button. Enter first, since that is what a person
   * would press and what search widgets almost always listen for.
   * ========================================================================== */
  function submit(elOrSel) {
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`submit: not found: ${elOrSel}`);

    // A <select> that navigates on change has already done the work by the
    // time this runs - a state picker wired to location.href is exactly this
    // shape. Submitting as well either double-navigates or cancels the
    // navigation already in flight.
    // A dropdown is its own case. Some navigate on change and have already
    // done the work; some need the Go button beside them. None of them want
    // form.requestSubmit(), which on a page that wraps its controls in a form
    // for styling reloads everything and throws the page's state away. So a
    // select follows through only via an explicit button, or not at all.
    if (el.tagName === "SELECT") {
      const inline = String(el.getAttribute("onchange") || "") + String(el.getAttribute("onblur") || "");
      if (/location|navigate|\.submit\(|href/i.test(inline)) return { submitted: "change" };
      const near = el.form || el.closest("form") || el.parentElement || document;
      const go = near.querySelector('button[type=submit], input[type=submit], button[class*="go"], [aria-label*="Go"]')
        || [...near.querySelectorAll("button, input[type=button], a[role=button]")]
             .find((b) => /^(go|apply|view|submit|show)\b/i.test((b.textContent || b.value || "").trim()));
      if (go) { realClick(go); return { submitted: "button" }; }
      return { submitted: "change only - this dropdown has no go button" };
    }
    el.focus();

    const enter = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 };
    el.dispatchEvent(new KeyboardEvent("keydown", enter));
    el.dispatchEvent(new KeyboardEvent("keypress", enter));
    el.dispatchEvent(new KeyboardEvent("keyup", enter));

    // A form may ignore a synthetic Enter, so ask it directly.
    const form = el.form || el.closest("form");
    if (form) {
      try {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        return { submitted: "form" };
      } catch (e) { /* a framework may intercept; the button below is next */ }
    }

    // Otherwise a submit button beside it, which is how many search widgets
    // are actually built.
    const scope = form || el.parentElement || document;
    const button = scope.querySelector('button[type=submit], input[type=submit], button[class*="search"], [aria-label*="earch"][role=button]');
    if (button) { realClick(button); return { submitted: "button" }; }

    return { submitted: "enter" };
  }

  /* ============================================================================
   * The small operations everything else assumed were possible.
   *
   * waitFor already existed in the WC layer but was never exposed, so a
   * sequence's second step acted on whatever happened to exist when it ran -
   * settle() waits for the page to stop changing, which is not the same as
   * waiting for a particular thing to appear. readControl fills the other
   * obvious hole: nothing could read a single control's current value, so
   * "what is selected" worked on USGS (getState) and nowhere else.
   * ========================================================================== */

  // Waits for a selector to appear, which is what a sequence needs between a
  // click that opens a panel and an action inside it.
  async function waitForSelector(selector, { timeout = 5000 } = {}) {
    const started = Date.now();
    try {
      const el = await waitFor(selector, { timeout });
      return { found: true, selector, waitedMs: Date.now() - started, label: rawLabelOf(el).slice(0, 60) || null };
    } catch (e) {
      return { found: false, selector, waitedMs: Date.now() - started,
        note: `"${selector}" did not appear within ${timeout}ms - the action that should create it may not have run` };
    }
  }

  // One control's current state, in the same vocabulary inventory() uses.
  function readControl(selector) {
    const el = deepQuery(selector);
    if (!el) return { found: false, selector, note: `no element matches ${selector}` };
    const tag = el.tagName.toLowerCase();
    const out = {
      found: true, selector, tag,
      type: el.type || null,
      label: rawLabelOf(el).slice(0, 80) || null,
      disabled: !!el.disabled,
      visible: isVisible(el),
    };
    if (tag === "select") {
      out.value = el.value;
      out.selectedText = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text.trim() : null;
      out.options = [...el.options].slice(0, 30).map((o) => ({ value: o.value, text: o.text.trim(), selected: o.selected }));
    } else if (el.type === "checkbox" || el.type === "radio") {
      out.checked = !!el.checked;
      out.value = el.value;
    } else if (tag === "input" || tag === "textarea") {
      out.value = String(el.value || "").slice(0, 200);
    } else {
      out.text = textOf(el).slice(0, 200);
      for (const attr of ["aria-pressed", "aria-expanded", "aria-selected", "aria-checked"]) {
        const v = el.getAttribute(attr);
        if (v !== null) out[attr] = v;
      }
    }
    return out;
  }

  // Puts controls back the way they were, from the change list signatureDiff
  // produced. Only possible at all because verification records the previous
  // value - before that there was nothing to revert to.
  function restore(changes) {
    const results = [];
    for (const change of changes || []) {
      if (!change || !change.selector || change.was === undefined) continue;
      const el = deepQuery(change.selector);
      if (!el) { results.push({ selector: change.selector, ok: false, why: "no longer on the page" }); continue; }
      try {
        const tag = el.tagName.toLowerCase();
        if (tag === "select") setSelect(el, String(change.was));
        else if (el.type === "checkbox" || el.type === "radio") setChecked(el, change.was === true || change.was === "true");
        else if (tag === "input" || tag === "textarea") fill(el, String(change.was));
        else { results.push({ selector: change.selector, ok: false, why: "not a settable control" }); continue; }
        results.push({ selector: change.selector, ok: true, restoredTo: change.was });
      } catch (e) {
        results.push({ selector: change.selector, ok: false, why: String((e && e.message) || e) });
      }
    }
    return { restored: results.filter((r) => r.ok).length, attempted: results.length, results };
  }

  // Leaving the page is easy; coming back was not possible at all.
  function goBack() {
    const from = location.href;
    history.back();
    return { from, note: "asked the browser to go back - the page may take a moment" };
  }

  // realClick scrolls what it clicks into view, but nothing else did, so
  // reading a control below the fold was unreliable.
  function scrollToElement(selector) {
    const el = deepQuery(selector);
    if (!el) return { found: false, selector };
    el.scrollIntoView({ block: "center", inline: "center" });
    return { found: true, selector, label: rawLabelOf(el).slice(0, 60) || null };
  }

  function readPage() {
    const chart = readChartText();
    const tables = readTables();
    const pairs = readPairs();
    const readouts = readReadouts();
    // A bounded sample of the page's own text. Some pages state their subject
    // in prose rather than a heading - "0 miles N of Hermantown, MN" - and
    // without this there is no way to tell such a page is about that place.
    const bodyText = textOf(document.body || document.documentElement).slice(0, 4000);

    return {
      url: location.href,
      title: document.title,
      text: bodyText,
      headings: deepQueryAll("h1, h2").filter(isVisible).map(textOf).filter(Boolean).slice(0, 12),
      tables,
      pairs,
      readouts,
      labelledNumbers: readLabelledNumbers(),
      chart,
      // Said plainly, because "found nothing" and "the data is painted onto a
      // canvas and cannot be read from the DOM at all" are different answers.
      note: !tables.length && !pairs.length && !readouts.length && !chart.svgCharts.length && chart.canvasCount
        ? `no readable data in the DOM - this page draws to ${chart.canvasCount} canvas element(s), whose contents are pixels, not elements`
        : undefined,
    };
  }

  const GENERIC = {
    inventory,
    readPage,
    submit,
    waitForSelector,
    readControl,
    restore,
    goBack,
    scrollToElement,
    settle,
    pageSignature,
    signatureDiff,
    hoverSeries,
    mapFeatures,
    readUrl,
    pageLinks,
    capturedFeeds,
    capturedFeed,
    mapInfo,
    click: (selector) => realClick(selector),
    clickText: (text) => clickByText(text),
    fill: (selector, text) => fill(selector, text),
    selectOption: (selector, valueOrText) => setSelect(selector, valueOrText),
    check: (selector, on = true) => setChecked(selector, on),
    pickRadio: (nameOrAnything, valueOrLabel) => pickRadio(nameOrAnything, valueOrLabel),
  };

  window.WC = WC;
  window.GENERIC = GENERIC;
  console.log("%cLoaded  window.WC  +  window.GENERIC  (no manifest needed)", "color:green;font-weight:bold");
  console.log([
    "GENERIC tools:",
    "  inventory()                          every control on the page, deduplicated, with selectors",
    "  mapInfo()                             is there a map, and can it be driven",
    "  click(selector)  /  clickText('Download')",
    "  fill(selector, 'text')",
    "  selectOption(selector, 'value or visible text')",
    "  check(selector, true|false)",
    "  pickRadio(nameOrAnything, 'value or label')",
  ].join("\n"));
})();
