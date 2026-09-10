/* ============================================================================
 * site-controls.js - paste into the DevTools console on a USGS
 *   monitoring-location page, e.g.
 *   https://waterdata.usgs.gov/monitoring-location/USGS-13206000/
 *
 *   window.WC    generic DOM primitives, identical to the WC block in
 *                web-controls.js, noaa-controls.js, and
 *                forecastpoints-controls.js. Keep them in sync.
 *   window.SITE  tools for the monitoring-location page, split into
 *                DISCOVERED (read off the page) and SUPPLIED (typed by hand)
 *
 * After pasting, try:
 *   SITE.listGraphParameters()
 *   SITE.graphParameter('discharge')
 *   SITE.setTimeSpan('30 days')
 *   SITE.setScale('log')
 *   SITE.viewTabularData()
 *   SITE.revealDateRange()   // then run the mini-inventory it prints
 *   SITE.revealDownload()    // then run the mini-inventory it prints
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

  /* ---------- mini-inventory: dump controls that just appeared ---------- */
  const miniInventory = (note) => {
    const rows = deepQueryAll('input,select,textarea,button,[role=button],[role=combobox],[role=radio],[role=checkbox]')
      .filter((el) => el.offsetParent)
      .map((el) => ({
        tag: el.tagName.toLowerCase(), type: el.type || "", name: el.name || "", id: el.id || "",
        label: rawLabelOf(el).slice(0, 70), value: (el.value || "").slice(0, 40),
        options: el.tagName === "SELECT" ? [...el.options].map((o) => o.value + "=" + o.text.trim()) : undefined,
      }));
    console.log(`%c${note} - ${rows.length} visible controls`, "font-weight:bold;color:#06c");
    console.table(rows);
    try { copy(JSON.stringify(rows, null, 2)); console.log("copied to clipboard"); } catch (e) {}
    return rows;
  };

  /* ============================================================================
   * Layer 2: monitoring-location tool manifest
   *
   * DISCOVERED  group names, ids, and literal option values read off this
   *             page's DOM. Confirmed live, 2026-09-05. Re-derivable with
   *             inventory-controls.js, or SITE.revealDateRange() / revealDownload().
   * SUPPLIED    USGS parameter-code and ISO-8601-duration meanings, and the
   *             synonyms a person would type for them. Not visible in the DOM.
   * ========================================================================== */

  const DISCOVERED = {
    graphParamGroup: "continuous", // radio values look like "continuous-00060-0"
    timeSpanGroup: "time-span-short-cuts",
    timeSpanValues: ["P7D", "P30D", "P365D"],
    scaleGroup: "continuous-graph-scale-kind",
    scaleValues: ["linear", "log"],
    startDateSelector: "#continuous-data-start-date",
    endDateSelector: "#continuous-data-end-date",
    daysBeforeSelector: "#continuous-days-before",
    timeSpanPanelToggleText: "changetime span", // panel toggle (label has no space)
    timeSpanApplyText: "change time span",       // apply button inside the panel
    downloadOpenText: "downloaddata",            // opener button (label has no space)
    downloadSetGroup: "continuous-download-data-set",
    downloadPrimaryCheckboxId: "continuous-primary-data-download-checkbox",
    downloadLocationCheckboxId: "continuous-monitoring-location-data-download-checkbox",
    downloadMetadataCheckboxId: "continuous-time-series-data-download-checkbox",
    downloadButtonText: "download",
  };

  // USGS parameter codes and human synonyms for them. Not derivable from the
  // DOM: the radio's value is just "continuous-00060-0". "Discharge" is
  // USGS convention, taken from https://help.waterdata.usgs.gov/parameter_cd.
  const SUPPLIED = {
    GRAPH_PARAMS: {
      "00060": "00060", discharge: "00060", streamflow: "00060", flow: "00060",
      "00065": "00065", "gage height": "00065", stage: "00065",
      "00010": "00010", "water temperature": "00010", temperature: "00010", temp: "00010",
      "00095": "00095", "specific conductance": "00095", conductance: "00095",
      "00300": "00300", "dissolved oxygen": "00300", "do": "00300",
      "00400": "00400", ph: "00400",
      "63680": "63680", turbidity: "63680",
      "00045": "00045", precipitation: "00045", precip: "00045",
    },
    // ISO-8601 durations and the phrases a person types for them
    TIME_SPAN: {
      "7d": "P7D", "7 days": "P7D", "7": "P7D", week: "P7D",
      "30d": "P30D", "30 days": "P30D", "30": "P30D", month: "P30D",
      "1y": "P365D", "1yr": "P365D", "1 year": "P365D", "365": "P365D", year: "P365D",
    },
    DOWNLOAD_SETS: {
      data: "downloadPrimaryCheckboxId", primary: "downloadPrimaryCheckboxId",
      location: "downloadLocationCheckboxId", about: "downloadLocationCheckboxId",
      metadata: "downloadMetadataCheckboxId",
    },
  };

  const SITE = {
    DISCOVERED, SUPPLIED, // see SITE.DISCOVERED / SITE.SUPPLIED

    listGraphParameters() {
      return deepQueryAll(`input[name="${DISCOVERED.graphParamGroup}"]`).map((r) => ({ value: r.value, label: rawLabelOf(r), checked: r.checked }));
    },
    graphParameter(p) {
      const radios = deepQueryAll(`input[name="${DISCOVERED.graphParamGroup}"]`);
      if (!radios.length) throw new Error(`graphParameter: no "${DISCOVERED.graphParamGroup}" parameter radios on this page`);
      const want = norm(p);
      const code = SUPPLIED.GRAPH_PARAMS[want];
      const hit =
        (code && radios.find((r) => r.value.includes(code))) ||
        radios.find((r) => labelOf(r).includes(want));
      if (!hit) throw new Error(`graphParameter: "${p}" not available. See SITE.listGraphParameters()`);
      if (!hit.checked) realClick(hit);
      return hit.value;
    },
    setTimeSpan(x) {
      return pickRadio(DISCOVERED.timeSpanGroup, SUPPLIED.TIME_SPAN[norm(x)] || norm(x).toUpperCase());
    },
    setScale(x) {
      return pickRadio(DISCOVERED.scaleGroup, norm(x));
    },
    viewTabularData() { return clickByText("View tabular data"); },
    viewRelatedGraphs() { return clickByText("View related graphs"); },
    expandAllDataCollections() { return clickByText("Expand all data collections"); },

    // --- custom time span ---
    openTimeSpanPanel() {
      if (deepQuery(DISCOVERED.startDateSelector)) return "already open";
      clickExact(DISCOVERED.timeSpanPanelToggleText);
      return "opening";
    },
    applyTimeSpan() { return clickExact(DISCOVERED.timeSpanApplyText); },

    // start / end are strings the field accepts, e.g. "2024-01-15" or "01/15/2024"
    async setDateRange(start, end) {
      this.openTimeSpanPanel();
      const s = await waitFor(DISCOVERED.startDateSelector);
      const e = deepQuery(DISCOVERED.endDateSelector);
      fill(s, start);
      if (end && e) fill(e, end);
      this.applyTimeSpan();
      return { start, end };
    },
    async setDaysBefore(n) {
      this.openTimeSpanPanel();
      const el = await waitFor(DISCOVERED.daysBeforeSelector);
      fill(el, String(n));
      this.applyTimeSpan();
      return Number(n);
    },

    // --- download ---
    openDownloadDialog() {
      if (deepQuery(`#${DISCOVERED.downloadPrimaryCheckboxId}`)) return "already open";
      clickExact(DISCOVERED.downloadOpenText);
      return "opening";
    },
    listDownloadSets() {
      this.openDownloadDialog();
      return deepQueryAll(`input[name="${DISCOVERED.downloadSetGroup}"]`)
        .map((c) => ({ value: c.value, id: c.id, label: rawLabelOf(c), checked: c.checked }));
    },
    // sets: any of "data" (primary series), "location" (about this location), "metadata"
    async downloadData(sets = ["data"]) {
      this.openDownloadDialog();
      await waitFor(`#${DISCOVERED.downloadPrimaryCheckboxId}`);
      const wantedIds = new Set(sets.map((s) => DISCOVERED[SUPPLIED.DOWNLOAD_SETS[norm(s)]] || s));
      deepQueryAll(`input[name="${DISCOVERED.downloadSetGroup}"]`).forEach((cb) => setChecked(cb, wantedIds.has(cb.id)));
      const btn = deepQueryAll("button").find((b) => norm(b.textContent) === DISCOVERED.downloadButtonText);
      if (!btn) throw new Error("downloadData: 'Download' button not found");
      realClick(btn); // browser will start a file download
      return [...wantedIds];
    },

    // reveal-then-inspect (debug helpers)
    revealDateRange() {
      this.openTimeSpanPanel();
      setTimeout(() => miniInventory("Custom date range panel"), 700);
      return "mini-inventory prints in ~1s";
    },
    revealDownload() {
      this.openDownloadDialog();
      setTimeout(() => miniInventory("Download dialog"), 700);
      return "mini-inventory prints in ~1s";
    },
  };

  window.WC = WC;
  window.SITE = SITE;
  window.miniInventory = miniInventory;
  console.log("%cLoaded  window.WC  +  window.SITE  (monitoring-location page)", "color:green;font-weight:bold");
  console.log([
    "SITE tools:",
    "  listGraphParameters()",
    "  graphParameter('discharge' | 'gage height' | '00010' ...)",
    "  setTimeSpan('7 days' | '30 days' | '1 year')      quick presets",
    "  await setDateRange('2024-01-01', '2024-06-30')    custom start/end",
    "  await setDaysBefore(90)                           N days before today",
    "  setScale('linear' | 'log')",
    "  viewTabularData()  /  viewRelatedGraphs()  /  expandAllDataCollections()",
    "  listDownloadSets()",
    "  await downloadData(['data'])   // also 'location', 'metadata'. Starts a file download",
    "  SITE.DISCOVERED / SITE.SUPPLIED    what's read off the page vs typed in by hand",
  ].join("\n"));

  // full pick -> date -> download chain, for reference:
  //   SITE.graphParameter('discharge');
  //   await SITE.setDateRange('2024-01-01','2024-12-31');
  //   await SITE.downloadData(['data']);
})();
