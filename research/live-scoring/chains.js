/* chains.js - how deep an instruction can go before it stops.
 *
 * The other two benchmarks ask one thing at a time. That is not what anyone
 * types: "select water temperature and then select huc08 subbasin and then
 * view the 7 day graph for the first location and then view the tabular
 * data" is one request with four links in it, and a tester's 8B completed it
 * where a 1.5B reached the third.
 *
 * So this measures depth, not accuracy - how many links of a chain are
 * carried out, and where it stops. Every clause names a control that is on
 * the page, word for word, so a clause that does not run is this failing to
 * act rather than the page failing to offer.
 *
 * Run twice on purpose. Page-only is what a machine that cannot hold a model
 * gets; with a planner is what it buys. The gap between the two columns is
 * the number worth reporting, because it says what the model is actually for
 * rather than how well it scores.
 *
 *   node research/live-scoring/chains.js
 */
const fs = require("fs");
const path = require("path");
const { loadPage, loadBackground } = require("../../extension/test/harness.js");

const DIR = path.join(__dirname, "pages");
const PAGES = {
  droughtmap: "https://droughtmonitor.unl.edu/CurrentMap.aspx",
  usgs: "https://waterdata.usgs.gov/monitoring-location/01646500/",
  noaa: "https://water.noaa.gov/",
};

// Each step names one control on that page, word for word. The chain is the
// only difficulty.
const CHAINS = [
  ["droughtmap", ["Maps", "Compare Two Weeks"]],
  ["droughtmap", ["Data", "Time Series"]],
  ["droughtmap", ["Maps", "Map Archive", "Data"]],
  ["droughtmap", ["Maps", "Map Types", "Data", "Time Series"]],
  ["droughtmap", ["Current", "Maps", "Map Areas", "Data", "Data Tables"]],
  ["usgs", ["Related links", "Water Year Summary"]],
  ["usgs", ["Related links", "Revisions", "Water Year Summary"]],
  ["usgs", ["WDFN Home", "WaterAlert", "Related links", "Revisions"]],
  ["noaa", ["Forecasts and Outlooks", "Key Messages"]],
  ["noaa", ["Shortcuts", "Rivers-at-a-Glance", "Long Range Outlook"]],
  ["noaa", ["Shortcuts", "Past Precipitation Estimates", "Forecasts and Outlooks", "Key Messages"]],
];

const flat = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The same stand-in the accuracy scorer uses: word overlap, no judgement.
// It is not a language model and is not meant to flatter one - it is there so
// the model-present column exercises the planning loop at all.
const standInModel = (m) => {
  if (m.type === "llmStatus") return { ready: true, hasGpu: true, model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" };
  if (m.type !== "llmStep") return undefined;
  const goal = flat(m.goal);
  const words = goal.split(" ").filter((w) => w.length > 2
    && !/^(the|and|then|click|press|open|show|select|set|turn)$/.test(w));
  let best = null; let bestScore = 0;
  for (const c of (m.controls || [])) {
    const l = flat(c.label);
    const score = words.filter((w) => l.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return { ok: true, step: { do: "finish", answer: "" } };
  return { ok: true, step: { name: best.label, do: "click" } };
};

(async () => {
  const html = {};
  for (const s of Object.keys(PAGES)) {
    const f = path.join(DIR, `${s}.html`);
    if (fs.existsSync(f)) html[s] = fs.readFileSync(f, "utf8");
  }

  const run = async (site, steps, withModel) => {
    const page = loadPage(html[site], { url: PAGES[site] });
    if (!page) return null;
    const pressed = [];
    for (const el of page.document.querySelectorAll("a, button")) {
      el.addEventListener("click", () => {
        pressed.push(flat(el.textContent));
        // A real press changes something; jsdom will not navigate, so this
        // stands in for the page having responded at all.
        page.document.body.appendChild(page.document.createElement("hr"));
      });
    }
    const bg = loadBackground({ page });
    bg.__model = withModel ? standInModel
      : (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: true } : undefined);
    const instruction = steps.map((s) => `click ${s}`).join(" and then ");
    const began = Date.now();
    let r = null;
    try { r = await bg.__ask({ type: "smartAsk", instruction }); } catch (e) { r = { error: String(e.message || e) }; }
    // In order: a chain that presses the third thing first has not done it.
    let reached = 0;
    let at = 0;
    for (const want of steps) {
      const found = pressed.indexOf(flat(want), at);
      if (found === -1) break;
      reached++; at = found + 1;
    }
    return { reached, of: steps.length, ms: Date.now() - began,
      plannedBy: (r && r.plannedBy) || "-", pressed: pressed.length };
  };

  const rows = [];
  for (const [site, steps] of CHAINS) {
    if (!html[site]) continue;
    const without = await run(site, steps, false);
    const withIt = await run(site, steps, true);
    rows.push({ site, steps, without, withIt });
  }

  const tally = (k) => {
    const done = rows.filter((r) => r[k] && r[k].reached === r[k].of).length;
    const links = rows.reduce((a, r) => a + ((r[k] && r[k].reached) || 0), 0);
    const total = rows.reduce((a, r) => a + r.steps.length, 0);
    const ms = rows.reduce((a, r) => a + ((r[k] && r[k].ms) || 0), 0);
    return { done, links, total, ms };
  };
  const a = tally("without"); const b = tally("withIt");

  console.log(`\n${rows.length} chains, ${a.total} links\n`);
  console.log("                     chains finished   links carried out   time");
  console.log(`  page only          ${String(a.done).padStart(2)}/${rows.length}`
    + `              ${String(a.links).padStart(3)}/${a.total}`
    + `             ${(a.ms / 1000).toFixed(1)}s`);
  console.log(`  with a planner     ${String(b.done).padStart(2)}/${rows.length}`
    + `              ${String(b.links).padStart(3)}/${b.total}`
    + `             ${(b.ms / 1000).toFixed(1)}s`);
  console.log("");
  for (const r of rows) {
    const mark = (x) => `${x.reached}/${x.of}`;
    const flagged = r.without.reached !== r.withIt.reached ? "  <-- the model's doing" : "";
    console.log(`  ${r.site.padEnd(11)} ${mark(r.without)} page  ${mark(r.withIt)} planner`
      + `   ${r.steps.join(" > ").slice(0, 52)}${flagged}`);
  }
  console.log("");
})();
