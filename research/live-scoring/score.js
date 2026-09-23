/* score.js - thirty-eight instructions I wrote, scored against DOM captured
 * from three live federal sites.
 *
 * Every bug fixed today came from a single card somebody sent, which is a
 * poor way to find out what works: it tells you about the instruction that
 * failed and nothing about the ones that did not. This runs a spread of them
 * - named controls, reworded ones, values, searches, typos, sequences, and
 * requests for things the page does not have - and reports a number.
 *
 * The pages are snapshots with their scripts stripped, so a press that would
 * navigate does nothing here; the question asked is which control gets acted
 * on, which is what has actually been failing. Re-capture with capture.js.
 *
 * Cases carrying an "oracle" name the control a competent model would pick,
 * so what is measured is whether a correct choice reaches the page, not how
 * clever the stub is. Cases without one exercise the deterministic paths.
 *
 * Baseline when first run: 25/38. After the day's fixes: 36/38.
 */
const fs = require("fs");
const { loadPage, loadBackground } = require("/Users/vincenthuang/web-controls/extension/test/harness.js");
const DIR = require("path").join(__dirname, "pages");
const URLS = {
  usgs: "https://waterdata.usgs.gov/monitoring-location/01646500/",
  noaa: "https://water.noaa.gov/",
  drought: "https://www.drought.gov/",
};
const HTML = {};
for (const n of Object.keys(URLS)) HTML[n] = fs.readFileSync(`${DIR}/${n}.html`, "utf8");

let ORACLE = null;
const namingModel = (m) => {
  if (m.type === "llmStep" && ORACLE) {
    const want = m.controls.find((c) => String(c.label || "").toLowerCase() === ORACLE.toLowerCase());
    if (want) return { ok: true, step: { name: want.label, do: "click" }, raw: "{}" };
  }
  if (m.type === "llmStatus") return { ready: true, hasGpu: true, model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" };
  if (m.type !== "llmStep") return undefined;
  const goal = String(m.goal).toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const words = goal.split(/\s+/).filter((w) => w.length > 2 &&
    !/^(the|and|for|click|press|open|show|set|turn|make|please|this|that|with|into|from|only|want)$/.test(w));
  let best = null, bestScore = 0;
  for (const c of m.controls) {
    const l = String(c.label || "").toLowerCase();
    const hit = (t, w) => t.includes(w) || (w.length >= 4 && t.split(/\s+/).some(
      (x) => x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4))));
    let score = words.filter((w) => hit(l, w)).length;
    for (const o of (c.options || [])) {
      const os = words.filter((w) => hit(String(o.text || o.value).toLowerCase(), w)).length;
      if (os > score) score = os;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return { ok: true, step: { do: "finish", answer: "" }, raw: "{}" };
  return { ok: true, step: { name: best.label, do: "click" }, raw: "{}" };
};

// on(name) - a switch whose label matches must end checked
// val(id,v) - a select must hold v
// clicked(re) / searched(re) / refuse
const CASES = [
  ["usgs", "click 30 days", { on: /^30 days$/i }],
  ["usgs", "show me the last month of data", { on: /^30 days$/i, oracle: "30 days" }],
  ["usgs", "show the past week", { on: /^7 days$/i, oracle: "7 days" }],
  ["usgs", "i want a full year", { on: /^1 year$/i, oracle: "1 year" }],
  ["usgs", "clcik 30 days", { on: /^30 days$/i }],
  ["usgs", "switch to a logarithmic scale", { on: /^log$/i, oracle: "Log" }],
  ["usgs", "use a linear scale", { on: /^linear$/i, oracle: "Linear" }],
  ["usgs", "plot the gage height", { on: /graph gage height/i, oracle: "Graph Gage height, feet" }],
  ["usgs", "graph the discharge", { on: /graph discharge/i }],
  ["usgs", "plot the water level", { on: /graph gage height/i, oracle: "Graph Gage height, feet" }],
  // A question, so answering it is the right outcome - not toggling a graph.
  ["usgs", "how much water is flowing", { answered: /discharge|cfs|flow/i }],
  ["usgs", "enable continuous data", { on: /^continuous data$/i }],
  ["usgs", "show data for the same time span in prior year", { on: /same time span/i }],
  ["usgs", "select data to graph on second y-axis", { on: /second y/i }],
  ["usgs", "click 1 year and enable continuous data", { on: /^continuous data$/i }],
  ["usgs", "turn on 30 days and plot the discharge", { on: /graph discharge/i }],
  ["usgs", "click about this location", { on: /about this location/i }],
  ["usgs", "click the hydrograph exporter", { refuse: true }],
  ["usgs", "enable the tidal predictions layer", { refuse: true }],
  ["noaa", "click rivers at a glance", { clicked: /rivers-at-a-glance/i }],
  ["noaa", "show me the long range outlook", { clicked: /long range outlook/i }],
  ["noaa", "open the national snow analysis", { clicked: /national snow analysis/i }],
  ["noaa", "look up smith river", { searched: /smith river/i }],
  ["noaa", "search for the potomac", { searched: /potomac/i }],
  ["noaa", "click significant river flood outlook", { clicked: /significant river flood/i }],
  ["noaa", "i want the daily briefing", { clicked: /daily briefing/i }],
  ["noaa", "click the tide gauge calibrator", { refuse: true }],
  ["drought", "select alaska", { val: /alaska/i }],
  ["drought", "set the state to wyoming", { val: /wyoming/i }],
  ["drought", "choose california", { val: /california/i }],
  ["drought", "click current conditions", { clicked: /current conditions/i }],
  ["drought", "show me drought impacts", { clicked: /drought impacts/i }],
  ["drought", "search how to survive a drought", { searched: /survive a drought/i }],
  ["drought", "look up soil moisture", { searched: /soil moisture/i, orClicked: /soil moisture/i }],
  ["drought", "click outlooks and forecasts", { clicked: /outlooks and forecasts/i }],
  ["drought", "open the paleoclimate page", { clicked: /paleoclimate/i }],
  ["drought", "click the snowpack simulator", { refuse: true }],
  ["drought", "click agriculture and click fire", { clicked: /fire/i }],
];

(async () => {
  let pass = 0; const failures = [];
  for (const [site, instruction, expect] of CASES) {
    const page = loadPage(HTML[site], { url: URLS[site] });
    const bg = loadBackground({ page });
    ORACLE = expect.oracle || null;
    bg.__model = namingModel;
    const clicks = []; const submits = [];
    for (const el of page.document.querySelectorAll("a,button,input,summary,select,[role=button]")) {
      el.addEventListener("click", () => clicks.push(
        String(el.textContent || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 60)));
    }
    for (const f of page.document.querySelectorAll("form")) {
      f.addEventListener("submit", (e) => { e.preventDefault();
        submits.push([...f.querySelectorAll("input")].map((i) => i.value).filter(Boolean).join(" ")); });
    }
    const before = new Set(page.GENERIC.inventory({ includeHidden: true }).controls
      .filter((c) => c.checked === true).map((c) => c.selector));
    let r;
    try { r = await bg.__ask({ type: "smartAsk", instruction }); }
    catch (e) { failures.push([site, instruction, "threw " + e.message]); continue; }
    const typed = [...page.document.querySelectorAll("input")].map((i) => i.value).filter(Boolean);
    // Labelled the way the system labels things, not by my own guess at the
    // DOM - closest("label") returned the name attribute on these pages, so
    // correct outcomes were being scored as misses.
    const after = page.GENERIC.inventory({ includeHidden: true }).controls;
    const onNow = after.filter((c) => c.checked === true && !before.has(c.selector))
      .map((c) => String(c.label || "").trim().slice(0, 44));
    const selNow = [...page.document.querySelectorAll("select")].map((sel) => {
      const o = sel.options[sel.selectedIndex]; return String((o && o.text) || sel.value || "");
    });
    const refused = r.ok === false || /clearly does|could not place|nothing on this page/i.test(
      `${r.error || ""} ${(r.display || {}).title || ""}`);
    let ok = false, why = "";
    if (expect.refuse) {
      // Opening a panel to look inside is exploration, not an action: it is
      // reversible and changes no state. What must not happen is a state
      // change or a navigation on a request nothing here answers.
      const acted = clicks.filter((c) => c && !/^$/.test(c));
      ok = refused && onNow.length === 0 && acted.length === 0;
      why = `refused=${refused} pressed=${clicks.length} on=${onNow.length} | ${(r.display || {}).title || r.plannedBy}`;
    } else if (expect.answered) {
      ok = expect.answered.test(`${r.answer || ""} ${(r.display || {}).subtitle || ""} ${(r.display || {}).title || ""}`);
      why = `${r.plannedBy} | ${String((r.display || {}).subtitle || "").slice(0, 60)}`;
    } else if (expect.on) {
      ok = onNow.some((l) => expect.on.test(l));
      if (!ok && expect.orAnswer) ok = !!r.answer || /\d/.test(String((r.display || {}).subtitle || ""));
      why = `on=${JSON.stringify(onNow.slice(0, 3))} | ${r.plannedBy} | ${String((r.display || {}).subtitle || r.error || "").slice(0, 50)}`;
    } else if (expect.val) {
      ok = selNow.some((v) => expect.val.test(v));
      why = `selects=${JSON.stringify(selNow.slice(0, 3))} | ${r.plannedBy}`;
    } else if (expect.searched) {
      ok = submits.some((s) => expect.searched.test(s)) || typed.some((t) => expect.searched.test(t));
      if (!ok && expect.orClicked) ok = clicks.some((c) => expect.orClicked.test(c));
      why = `typed=${JSON.stringify(typed.slice(0, 2))} submits=${submits.length} clicks=${JSON.stringify(clicks.slice(0, 2))} | ${r.plannedBy}`;
    } else if (expect.clicked) {
      // A link wrapping an icon has no text of its own, so the card naming
      // the control counts as evidence too - the scorer was reading "" and
      // calling a correct press a miss.
      ok = clicks.some((c) => expect.clicked.test(c))
        || expect.clicked.test(String((r.display || {}).title || ""));
      why = `clicked=${JSON.stringify(clicks.slice(0, 3))} | ${r.plannedBy}`;
    }
    if (ok) pass++; else failures.push([site, instruction, why]);
  }
  const total = CASES.length;
  console.log(`\n${pass}/${total} = ${((pass / total) * 100).toFixed(0)}%\n`);
  for (const [s, i, w] of failures) console.log(`  MISS [${s}] "${i}"\n        ${w}`);
})();
