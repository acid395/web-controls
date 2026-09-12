/* ============================================================================
 * noaa-controls.js - paste into the DevTools console on
 *   https://water.noaa.gov/
 *
 *   window.WC    generic DOM primitives, identical to the WC block in
 *                web-controls.js, site-controls.js, and
 *                forecastpoints-controls.js. Keep them in sync.
 *   window.NOAA  tools for the water.noaa.gov national map page
 *
 * STATUS: partial. Confirmed live 2026-09-08 against the "View Layers" panel
 * and the River Gauge product picker. Settled, not just unconfirmed: typing
 * into #search-box produces no separate result-list element to click, in
 * four separate tries, the last two with a real value confirmed sitting in
 * the box (value: "Boise") and a generic-controls-grade inventory (Svelte
 * click-handler detection plus a cursor:pointer fallback) finding nothing
 * resembling a dropdown anywhere in the page. The likely explanation is a
 * closed shadow root, which a script cannot see into by design, not a
 * detection gap to keep patching. search() fills the box and presses Enter
 * as a best-effort "submit"; picking a specific result from it is not
 * something this approach can do on this page. Also unconfirmed: the second
 * nameless radio group (values "all"/"hydrologic"/"hide") whose panel hasn't
 * been opened yet. See README, "Tested on other sites."
 *
 * After pasting, try:
 *   NOAA.openLayers()
 *   NOAA.setBasemap('satellite')
 *   NOAA.toggleSection('River Gauge')
 *   NOAA.setGaugeProduct('ensemble')      // substring-matches the live label
 *   NOAA.setGaugeMode('forecast')
 *   NOAA.toggleFloodCategory('Minor Flood', true)
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
   * Layer 2: water.noaa.gov manifest
   *
   * DISCOVERED  read straight off the DOM, confirmed live 2026-09-08 via
   *             inventory-controls.js on https://water.noaa.gov/ (home map,
   *             default view, then again with "View Layers" open).
   * SUPPLIED    hand-typed domain knowledge. There's much less of it than in
   *             web-controls.js's USGS manifest, because this page's radios
   *             and checkboxes carry real, descriptive labels instead of
   *             opaque numeric codes, so pickRadio's built-in substring-label
   *             matching already handles most phrasing without a synonym
   *             table. SUPPLIED here is only for genuine abbreviations
   *             (HEFS, LRO) that don't literally appear in the label text.
   * ========================================================================== */

  const DISCOVERED = {
    searchBoxSelector: "#search-box",
    geolocateButtonText: "Geolocate",
    zoomInButtonText: "Zoom in",
    zoomOutButtonText: "Zoom out",
    homeButtonText: "Home",
    viewLayersButtonText: "View Layers",
    closePanelButtonText: "Close map panel",
    attributionToggleText: "Toggle attribution",
    mapCanvasSelector: "canvas.maplibregl-canvas", // not interactive, see NOAA.mapNote()

    // only <select> on the page once "View Layers" is open
    basemapSelectSelector: "select",
    basemapValues: ["topographic", "satellite", "dark", "light"],

    // toggle buttons for each collapsible section in the layers panel
    sections: {
      "river gauge": "#uk-accordion-1",
      hazards: "#uk-accordion-3",
      "precipitation estimate": "#uk-accordion-5",
      "national water model": "#uk-accordion-7",
      "flood inundation": "#uk-accordion-9",
      "national snow analysis": "#uk-accordion-10",
      "administrative boundaries": "#uk-accordion-12",
    },

    // "River Gauge" section, open by default: a 3-way product picker. These
    // <input type=radio> have no name attribute at all, confirmed by
    // dumping their outerHTML. pickRadio's nameless-radio fallback handles that.
    gaugeProductValues: ["obsFcst", "HEFS", "LRO"],
    gaugeModeButtonTexts: ["Observation", "Forecast"],
    floodCategoryLabels: [
      "Major Flood", "Moderate Flood", "Minor Flood", "Action", "No Flood",
      "Flood Category Not Defined", "Low Water Threshold", "Data Not Current", "Out of Service",
    ],
    limitByBoundaryLabel: "Limit by boundary",
    partnerFimLabel: "Only display Partner FIM Gauges",

    // a second nameless radio group exists somewhere on the page (values
    // "all"/"hydrologic"/"hide", each aria-labeled with its own value), but
    // its panel hasn't been opened or inventoried yet, so its purpose is unconfirmed.
    unconfirmedRadioValues: ["all", "hydrologic", "hide"],
  };

  // Abbreviations that don't appear verbatim in the live label text, so
  // pickRadio's own substring matching can't find them unaided.
  const SUPPLIED = {
    GAUGE_PRODUCT_ABBREV: {
      hefs: "HEFS",         // "Hydrologic Ensemble Forecasts", abbreviation not in the label text
      lro: "LRO",           // "Long Range Flood Outlook", abbreviation not in the label text
      "obs fcst": "obsFcst",
    },
  };

  const NOAA = {
    DISCOVERED, SUPPLIED, // see NOAA.DISCOVERED / NOAA.SUPPLIED

    mapNote() {
      return "Map markers are drawn on a MapLibre GL canvas. There is no per-station DOM element to find or click. Only the surrounding UI (search, layers panel, buttons) is scriptable. See README, 'Tested on other sites.'";
    },

    // Fills the box and presses Enter as a best-effort "submit." No separate
    // result list was ever observed live (see file header), so what this
    // actually does on the page is unconfirmed.
    search(query) {
      const box = fill(DISCOVERED.searchBoxSelector, query);
      box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
      return box;
    },
    geolocate() { return clickByText(DISCOVERED.geolocateButtonText); },
    zoomIn() { return clickByText(DISCOVERED.zoomInButtonText); },
    zoomOut() { return clickByText(DISCOVERED.zoomOutButtonText); },
    home() { return clickByText(DISCOVERED.homeButtonText); },

    openLayers() { return clickByText(DISCOVERED.viewLayersButtonText); },
    closeLayers() { return clickByText(DISCOVERED.closePanelButtonText); },
    listBasemaps() {
      const sel = deepQuery(DISCOVERED.basemapSelectSelector);
      return sel ? [...sel.options].map((o) => ({ value: o.value, text: o.text, selected: o.selected })) : [];
    },
    setBasemap(x) { return setSelect(DISCOVERED.basemapSelectSelector, norm(x)); },

    toggleSection(name) {
      const key = norm(name);
      const text = Object.keys(DISCOVERED.sections).find((k) => k === key || k.includes(key));
      if (!text) throw new Error(`toggleSection: "${name}" not one of [${Object.keys(DISCOVERED.sections).join(", ")}]`);
      return clickByText(text);
    },

    // p can be "obsFcst"/"HEFS"/"LRO" or free text. pickRadio label-matches
    // live, falling back to SUPPLIED for bare abbreviations.
    setGaugeProduct(p) {
      const code = SUPPLIED.GAUGE_PRODUCT_ABBREV[norm(p)] || p;
      return pickRadio("gauge-product", code);
    },
    setGaugeMode(x) {
      const want = norm(x);
      const text = DISCOVERED.gaugeModeButtonTexts.find((t) => norm(t) === want || norm(t).includes(want));
      if (!text) throw new Error(`setGaugeMode: "${x}" not one of [${DISCOVERED.gaugeModeButtonTexts.join(", ")}]`);
      return clickByText(text);
    },
    listFloodCategories() {
      return deepQueryAll('input[type=checkbox]')
        .filter((c) => DISCOVERED.floodCategoryLabels.some((l) => labelOf(c) === norm(l)))
        .map((c) => ({ label: rawLabelOf(c), checked: c.checked }));
    },
    toggleFloodCategory(label, on = true) {
      const want = norm(label);
      const cb = deepQueryAll('input[type=checkbox]').find((c) => labelOf(c) === want || labelOf(c).includes(want));
      if (!cb) throw new Error(`toggleFloodCategory: "${label}" not found. See NOAA.listFloodCategories()`);
      return setChecked(cb, on);
    },
    setLimitByBoundary(on = true) { return setChecked(deepQueryAll('input[type=checkbox]').find((c) => labelOf(c) === norm(DISCOVERED.limitByBoundaryLabel)), on); },
    setPartnerFimOnly(on = true) { return setChecked(deepQueryAll('input[type=checkbox]').find((c) => labelOf(c) === norm(DISCOVERED.partnerFimLabel)), on); },
  };

  window.WC = WC;
  window.NOAA = NOAA;
  console.log("%cLoaded  window.WC  +  window.NOAA  (water.noaa.gov, partial)", "color:green;font-weight:bold");
  console.log([
    "NOAA tools (partial, see file header for what's unconfirmed):",
    "  search('Boise')                    fills the search box (picking a result: unconfirmed)",
    "  geolocate() / zoomIn() / zoomOut() / home()",
    "  openLayers() / closeLayers()",
    "  listBasemaps() / setBasemap('satellite')",
    "  toggleSection('River Gauge' | 'Hazards' | ...)",
    "  setGaugeProduct('HEFS' | 'ensemble' | 'obsFcst' | 'LRO')",
    "  setGaugeMode('Observation' | 'Forecast')",
    "  listFloodCategories() / toggleFloodCategory('Minor Flood', true)",
    "  setLimitByBoundary(true) / setPartnerFimOnly(true)",
    "  NOAA.mapNote()   why individual map markers can't be clicked",
    "  NOAA.DISCOVERED / NOAA.SUPPLIED    what's read off the page vs typed in by hand",
  ].join("\n"));
})();
