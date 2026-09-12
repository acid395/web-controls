/* ============================================================================
 * web-controls.js - paste into the DevTools console on the live page.
 *
 * Layer 1  window.WC    generic DOM primitives, works on any site.
 *                        This block is identical to the WC block in
 *                        site-controls.js, noaa-controls.js, and
 *                        forecastpoints-controls.js. Keep them in sync.
 * Layer 2  window.USGS  tools for the USGS "state water conditions" page,
 *                        split into DISCOVERED (read off the page) and
 *                        SUPPLIED (typed in by hand, see that section below)
 *
 * Quick test after pasting:
 *   USGS.listParameters()
 *   USGS.setParameter('gage height')
 *   USGS.groupBy('huc8')
 *   USGS.sortBy('id-descending')
 *   USGS.toggleMap()
 *   await USGS.selectState('Montana')
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
   * Layer 2: USGS state-page tool manifest
   *
   * Split into two buckets, on purpose:
   *
   *  DISCOVERED  facts read straight off this page's DOM: group names, the
   *              literal option values, ids. You can re-find all of this any
   *              time by pasting inventory-controls.js on this page. None of
   *              it required knowing what the page means.
   *
   *  SUPPLIED    domain knowledge a script can't get from the DOM: USGS
   *              parameter-code meanings (00060 = discharge), ISO-8601
   *              duration codes (P120D = "120 days"), and the synonyms a
   *              person would type for each. If USGS renames a group or
   *              changes a value, only DISCOVERED goes stale. If a code's
   *              meaning were ever wrong, that would be SUPPLIED.
   * ========================================================================== */

  const DISCOVERED = {
    // input[name=...] for each radio/checkbox group on this page, and the
    // literal values seen on its <input>s. Confirmed live, 2026-09-05.
    parameterGroup: "map-quick-select-radios",
    parameterValues: ["00060", "00065", "72019", "00010", "all"],
    groupByGroup: "locationGroupButtons",
    groupByValues: ["county", "huc8", "huc6"],
    sortGroup: "location-sort-order",
    sortValues: ["name-ascending", "name-descending", "id-ascending", "id-descending"],
    recencyGroup: "filterByDate",
    recencyValues: ["P120D", "all"],
    dataTypeMatchGroup: "matching-parameter-codes-radio-group",
    dataTypeMatchValues: ["atLeastOne", "all"],
    dataTypeCheckboxGroup: "show-data-type-checkbox",
    dataTypeCodes: ["00060", "00065", "72019", "00010", "00300", "00400", "00095", "00045", "63680", "32315", "32321", "70969"],
    stateSearchSelector: "#state-territory-selection",
    filtersToggleText: "Customize filters", // renders as "Customizefilters" (two spans)
    mapToggleTextOn: "Hide map",
    mapToggleTextOff: "Show map",
  };

  // Human vocabulary mapped to the DISCOVERED values above. This is the part
  // a DOM reader genuinely cannot derive: nothing on the page says "00060
  // means discharge" or "P120D means 120 days." That's USGS/ISO-8601
  // convention, typed in here from https://help.waterdata.usgs.gov and
  // manual testing.
  const SUPPLIED = {
    PARAMS: {
      "00060": "00060", discharge: "00060", streamflow: "00060", flow: "00060",
      "00065": "00065", "gage height": "00065", "gauge height": "00065", stage: "00065",
      "72019": "72019", "depth to water level": "72019", "water level": "72019", groundwater: "72019",
      "00010": "00010", "water temperature": "00010", temperature: "00010", temp: "00010",
      all: "all", "any data": "all", any: "all",
    },
    GROUP_BY: {
      county: "county",
      huc8: "huc8", "huc-08": "huc8", "huc-08 subbasin": "huc8", "huc 08": "huc8",
      huc6: "huc6", "huc-06": "huc6", "huc-06 basin": "huc6", "huc 06": "huc6",
    },
    RECENCY: {
      p120d: "P120D", "120d": "P120D", "120 days": "P120D", "last 120 days": "P120D", recent: "P120D",
      all: "all", "all years": "all", "all possible years": "all", historical: "all",
    },
  };

  // The filter-panel controls only exist in the DOM while the panel is
  // open, and the panel renders asynchronously, so wait for it after
  // clicking the toggle.
  const ensureFilters = async () => {
    if (deepQueryAll(`input[name="${DISCOVERED.recencyGroup}"]`).length) return;
    try { clickByText(DISCOVERED.filtersToggleText); } catch (e) { /* button label varies */ }
    await waitFor(() => deepQueryAll(`input[name="${DISCOVERED.recencyGroup}"]`).length || null, { timeout: 4000 }).catch(() => {});
  };

  const checkedValue = (name) => {
    const r = deepQueryAll(`input[name="${name}"]`).find((el) => el.checked);
    return r ? r.value : null;
  };

  const USGS = {
    DISCOVERED, SUPPLIED, // see USGS.DISCOVERED / USGS.SUPPLIED

    listParameters() {
      return deepQueryAll(`input[name="${DISCOVERED.parameterGroup}"]`)
        .map((r) => ({ value: r.value, label: rawLabelOf(r), checked: r.checked }));
    },
    setParameter(p) {
      const code = SUPPLIED.PARAMS[norm(p)];
      if (!code) throw new Error(`setParameter: unknown "${p}". Known: ${[...new Set(Object.values(SUPPLIED.PARAMS))].join(", ")}`);
      return pickRadio(DISCOVERED.parameterGroup, code);
    },
    groupBy(x) {
      return pickRadio(DISCOVERED.groupByGroup, SUPPLIED.GROUP_BY[norm(x)] || norm(x));
    },
    sortBy(x) {
      // accepts: "id descending", "id-descending", "name ascending", ...
      return pickRadio(DISCOVERED.sortGroup, norm(x).replace(/[\s_]+/g, "-"));
    },
    mapVisible() {
      return !!deepQueryAll("button").find((b) => norm(b.textContent).includes(norm(DISCOVERED.mapToggleTextOn)));
    },
    toggleMap() {
      try { return clickByText(DISCOVERED.mapToggleTextOn); } catch (e) { return clickByText(DISCOVERED.mapToggleTextOff); }
    },
    setMap(visible) {
      if (this.mapVisible() !== !!visible) this.toggleMap();
      return this.mapVisible();
    },
    openFilters() { return clickByText(DISCOVERED.filtersToggleText); },

    // --- filter panel (auto-opens the panel; all async) ---
    async setRecency(x) {
      await ensureFilters();
      return pickRadio(DISCOVERED.recencyGroup, SUPPLIED.RECENCY[norm(x)] || norm(x));
    },
    async setDataTypeMatch(x) {
      await ensureFilters();
      return pickRadio(DISCOVERED.dataTypeMatchGroup, /all/.test(norm(x)) ? "all" : "atLeastOne");
    },
    async listDataTypes() {
      await ensureFilters();
      return deepQueryAll(`input[name="${DISCOVERED.dataTypeCheckboxGroup}"]`)
        .map((c) => ({ code: c.value, label: rawLabelOf(c), checked: c.checked }));
    },
    async toggleDataType(codeOrName, on = true) {
      await ensureFilters();
      const want = norm(codeOrName);
      const cb = deepQueryAll(`input[name="${DISCOVERED.dataTypeCheckboxGroup}"]`)
        .find((c) => c.value === codeOrName || labelOf(c).includes(want));
      if (!cb) throw new Error(`toggleDataType: "${codeOrName}" not found. See await USGS.listDataTypes()`);
      return setChecked(cb, on);
    },

    // snapshot of everything this page's tools control
    getState() {
      return {
        parameter: checkedValue(DISCOVERED.parameterGroup),
        groupBy: checkedValue(DISCOVERED.groupByGroup),
        sortBy: checkedValue(DISCOVERED.sortGroup),
        recency: checkedValue(DISCOVERED.recencyGroup),
        dataTypeMatch: checkedValue(DISCOVERED.dataTypeMatchGroup),
        dataTypes: deepQueryAll(`input[name="${DISCOVERED.dataTypeCheckboxGroup}"]`).filter((c) => c.checked).map((c) => c.value),
        mapVisible: this.mapVisible(),
      };
    },

    async selectState(name) {
      const box = deepQuery(DISCOVERED.stateSearchSelector);
      if (!box) throw new Error(`selectState: ${DISCOVERED.stateSearchSelector} not found`);
      realClick(box);
      box.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
      fill(box, name);
      const opt = await waitFor(() =>
        deepQueryAll('[role=option], [class*="option"], [id*="option"]')
          .find((o) => norm(o.textContent).includes(norm(name)) && o.offsetParent !== null)
      );
      realClick(opt); // react-select commits on mousedown, included in realClick
      return norm(opt.textContent);
    },
    selectCounty(name) {
      const want = norm(`select ${name}`.replace(/ county$/, ""));
      const el = deepQueryAll('[role=radio]').find((r) =>
        norm(r.getAttribute("aria-label")).startsWith(want)
      );
      if (!el) throw new Error(`selectCounty: "${name}" not found`);
      return realClick(el);
    },
    favoriteSite(id, on = true) {
      return setChecked(`#my-favorites-USGS-${id}-checkbox`, on);
    },
    openSite(id) { location.assign(`/monitoring-location/USGS-${id}/`); },
  };

  window.WC = WC;
  window.USGS = USGS;
  console.log("%cLoaded  window.WC  (generic primitives)  +  window.USGS  (this page)", "color:green;font-weight:bold");
  console.log([
    "USGS tools  (await the ones marked async):",
    "  getState()                         read current selections",
    "  setParameter('gage height')        map quick-select radios",
    "  groupBy('huc8' | 'huc6' | 'county')",
    "  sortBy('id descending')            name/id  ascending/descending",
    "  toggleMap()  /  setMap(true|false)  /  mapVisible()",
    "  await setRecency('120 days' | 'all')       async, opens the filter panel first",
    "  await setDataTypeMatch('any' | 'all')      async",
    "  await listDataTypes()  /  await toggleDataType('00060', true)   async",
    "  await selectState('Montana')",
    "  selectCounty('Ada')  /  favoriteSite('13206000', true)  /  openSite('13206000')",
    "  USGS.DISCOVERED / USGS.SUPPLIED    what's read off the page vs typed in by hand",
  ].join("\n"));
})();

/* ---------- bridge: lets the extension call USGS.* from outside this JS world ----------
 * This file runs in the page's own JS context (the "MAIN world"), so it can see window.USGS
 * above, but it has no access to chrome.* APIs. It talks out via postMessage; a content
 * script in the isolated world relays that to the extension background script.
 */
if (!window.__wcPageBridgeInstalled) {
  window.__wcPageBridgeInstalled = true;
  window.addEventListener("message", async (e) => {
    if (e.source !== window) return;
    if (!e.data || e.data.channel !== "web-controls-req") return;
    const { id, fn, args } = e.data;
    try {
      const target = window.USGS;
      if (!target || typeof target[fn] !== "function") throw new Error(`USGS.${fn} is not a function`);
      const result = await target[fn](...(args || []));
      window.postMessage({ channel: "web-controls-res", id, ok: true, result }, "*");
    } catch (err) {
      window.postMessage({ channel: "web-controls-res", id, ok: false, error: String((err && err.message) || err) }, "*");
    }
  });
}
