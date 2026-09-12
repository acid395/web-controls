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
  const hasJsHandler = (el) => {
    if (el.hasAttribute("onclick")) return true;
    const p = reactProps(el);
    return !!(p && (p.onClick || p.onChange || p.onInput));
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
  // as it wastes a human's screen.
  const sigNorm = (s) => (s || "")
    .replace(/USGS-?\d+/g, "#ID")
    .replace(/\d{4}-\d{2}-\d{2}/g, "#DATE")
    .replace(/\d+/g, "#")
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
      if (!(TAGS.includes(tag) || (role && ROLES.includes(role)) || tabbable || hasJsHandler(el))) continue;
      if (seen.has(el) || !isVisible(el)) continue;
      seen.add(el);

      const lab = rawLabelOf(el);
      const rec = {
        kind: role || tag, tag, type: el.type || "", label: lab.slice(0, 80),
        name: el.name || "", id: el.id || "", value: (el.value ?? "").toString().slice(0, 60),
        checked: (el.type === "checkbox" || el.type === "radio") ? !!el.checked : undefined,
        selector: cssPath(el),
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
      if (instanceFoundFor || scanned++ > 30000 || depth > 3 || obj == null) return;
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

  const GENERIC = {
    inventory,
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
