/* ============================================================================
 * forecastpoints-controls.js - paste into the DevTools console on
 *   https://www.weather.gov/forecastpoints?lat=...&lon=...  (any forecast
 *   point map URL on weather.gov)
 *
 *   window.WC    generic DOM primitives, identical to the WC block in
 *                web-controls.js, site-controls.js, and noaa-controls.js.
 *                Keep them in sync.
 *   window.FCP   tools for the forecast-points map page
 *
 * Confirmed live 2026-09-08 via inventory-controls.js. Plain server-rendered
 * HTML with jQuery and OpenLayers, no React or Svelte quirks, so this one
 * needed the least reverse-engineering of the four manifests in this repo.
 *
 * After pasting, try:
 *   FCP.listBasemaps()
 *   FCP.setBasemap('terrain')
 *   FCP.openLayers()
 *   FCP.zoomIn()
 *   FCP.setRingRadius(50)
 *   FCP.setRingColor('#ff0000')
 *   FCP.addRing()
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
   * Layer 2: weather.gov forecast-points manifest
   *
   * DISCOVERED  read straight off the DOM, confirmed live 2026-09-08 via
   *             inventory-controls.js.
   * SUPPLIED    hand-typed domain knowledge. There's essentially none needed
   *             here: every option, basemap names and button labels, is
   *             already plain, descriptive English in the DOM. Unlike USGS's
   *             numeric parameter codes, nothing on this page needs translating.
   * ========================================================================== */

  const DISCOVERED = {
    searchInputSelector: "#inputsearch", // type="text", not type="search"
    zoomInButtonText: "Zoom in",
    zoomOutButtonText: "Zoom out",
    attributionsButtonText: "Attributions",
    fullscreenButtonText: "Toggle full-screen",
    layersButtonText: "Layers",          // opens the layer switcher panel
    overviewButtonText: "O",             // OpenLayers overview-map toggle

    basemapSelectSelector: "#basemap-select",
    basemapValues: [
      "community", "dark-gray", "human-geography", "imagery", "light-gray",
      "navigation", "newspaper", "oceans", "outdoor", "streets", "terrain", "topographic",
    ],

    configurePlotOrderButtonText: "🛠 Configure Plot Order",
    configurePlotLookButtonText: "🛠 Configure Plot Look",

    rangeRingConfigLinkText: "Range Ring Configuration",
    ringRadiusSelector: "#quantity", // type=number, name="quantity", miles
    ringColorSelector: "#head",      // type=color, name="head"
    addRingButtonText: "Add Ring at Last Location",
    removeRingButtonText: "Remove Last Ring",
    clearRingsButtonText: "Clear Rings",

    legendToggleText: "Legend",

    mapLibrary: "OpenLayers", // confirmed by ol-zoom-in, ol-full-screen-false, and similar classes
  };

  const SUPPLIED = {}; // nothing needed yet, see note above

  const FCP = {
    DISCOVERED, SUPPLIED, // see FCP.DISCOVERED / FCP.SUPPLIED

    mapNote() {
      return "The map is OpenLayers-rendered (ol-* control classes). Individual forecast-point pins are drawn to a canvas/vector layer, not separate DOM elements. Same limitation as water.noaa.gov's MapLibre map. Only the surrounding chrome (search, zoom, basemap, rings) is scriptable. See README, 'Tested on other sites.'";
    },

    search(query) { return fill(DISCOVERED.searchInputSelector, query); }, // picking a result: unconfirmed
    zoomIn() { return clickByText(DISCOVERED.zoomInButtonText); },
    zoomOut() { return clickByText(DISCOVERED.zoomOutButtonText); },
    toggleFullscreen() { return clickByText(DISCOVERED.fullscreenButtonText); },
    toggleAttributions() { return clickByText(DISCOVERED.attributionsButtonText); },
    openLayers() { return clickByText(DISCOVERED.layersButtonText); },
    toggleOverview() { return clickByText(DISCOVERED.overviewButtonText); },

    listBasemaps() {
      const sel = deepQuery(DISCOVERED.basemapSelectSelector);
      return sel ? [...sel.options].map((o) => ({ value: o.value, text: o.text, selected: o.selected })) : [];
    },
    setBasemap(x) { return setSelect(DISCOVERED.basemapSelectSelector, norm(x)); },

    openPlotOrderConfig() { return clickByText(DISCOVERED.configurePlotOrderButtonText); },
    openPlotLookConfig() { return clickByText(DISCOVERED.configurePlotLookButtonText); },

    openRingConfig() { return clickByText(DISCOVERED.rangeRingConfigLinkText); },
    setRingRadius(miles) { this.openRingConfig(); return fill(DISCOVERED.ringRadiusSelector, String(miles)); },
    setRingColor(hex) { this.openRingConfig(); return fill(DISCOVERED.ringColorSelector, hex); }, // e.g. "#ff0000"
    addRing() { this.openRingConfig(); return clickByText(DISCOVERED.addRingButtonText); },
    removeLastRing() { this.openRingConfig(); return clickByText(DISCOVERED.removeRingButtonText); },
    clearRings() { this.openRingConfig(); return clickByText(DISCOVERED.clearRingsButtonText); },

    toggleLegend() { return clickByText(DISCOVERED.legendToggleText); },
  };

  window.WC = WC;
  window.FCP = FCP;
  console.log("%cLoaded  window.WC  +  window.FCP  (weather.gov/forecastpoints)", "color:green;font-weight:bold");
  console.log([
    "FCP tools:",
    "  search('Boise')                     fills the search box (picking a result: unconfirmed)",
    "  zoomIn() / zoomOut() / toggleFullscreen() / toggleAttributions() / toggleOverview()",
    "  openLayers()",
    "  listBasemaps() / setBasemap('terrain')",
    "  openPlotOrderConfig() / openPlotLookConfig()",
    "  openRingConfig() / setRingRadius(50) / setRingColor('#ff0000')",
    "  addRing() / removeLastRing() / clearRings()",
    "  toggleLegend()",
    "  FCP.mapNote()   why individual forecast-point pins can't be clicked",
    "  FCP.DISCOVERED / FCP.SUPPLIED    what's read off the page vs typed in by hand (SUPPLIED is empty here)",
  ].join("\n"));
})();
