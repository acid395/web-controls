const { loadPage, loadBackground } = require("/Users/vincenthuang/web-controls/extension/test/harness.js");
const P = `<!doctype html><html><head><title>NWPS</title></head><body>
  <label><input type="checkbox" name="fim"> Flood Inundation Mapping</label>
  <label><input type="checkbox" name="fi"> Flood Inundation</label>
  <label><input type="checkbox" name="on" checked> Precipitation Estimate</label>
  <label><input type="checkbox" name="dis" disabled> Archived Layer</label>
  <label for="ts">Time span</label>
  <select id="ts"><option>1 day</option><option>7 days</option><option>30 days</option></select>
  <label for="unit">Units</label><select id="unit"><option>feet</option><option>meters</option></select>
  <input id="q" type="search" placeholder="Search station">
  </body></html>`;
const CASES = [
  // exact vs superset label
  ["enable flood inundation",            (s) => s.fi === true && s.fim === false],
  ["enable flood inundation mapping",    (s) => s.fim === true && s.fi === false],
  // case and plural
  ["ENABLE FLOOD INUNDATION",            (s) => s.fi === true],
  ["set time span to 7 day",             (s) => s.ts === "7 days"],
  ["set time span to 30 days",           (s) => s.ts === "30 days"],
  ["set time span to 1 day",             (s) => s.ts === "1 day"],
  // already in the wanted state
  ["enable precipitation estimate",      (s) => s.on === true],
  ["turn off precipitation estimate",    (s) => s.on === false],
  // a disabled control must not be reported as switched
  ["enable archived layer",              (s) => s.dis === false],
  // typo
  ["enable flod inundaton",              (s) => s.fi === true],
  // units
  ["set units to meters",                (s) => s.unit === "meters"],
  // question phrased as a command
  ["can you enable flood inundation",    (s) => s.fi === true],
  // politeness and filler
  ["please turn on flood inundation for me", (s) => s.fi === true],
  // quoted exact
  ['enable "Flood Inundation"',          (s) => s.fi === true && s.fim === false],
];
(async () => {
  const bad = [];
  for (const [prompt, want] of CASES) {
    const page = loadPage(P, { url: "https://water.noaa.gov/" });
    const bg = loadBackground({ page });
    let r; try { r = await bg.__ask({ type: "smartAsk", instruction: prompt }); }
    catch (e) { bad.push([prompt, "THREW " + e.message, ""]); continue; }
    const g = (n) => { const el = page.document.querySelector(`[name="${n}"]`); return el ? el.checked : null; };
    const st = { fi: g("fi"), fim: g("fim"), on: g("on"), dis: g("dis"),
      ts: (page.document.getElementById("ts")||{}).value,
      unit: (page.document.getElementById("unit")||{}).value };
    if (!want(st)) bad.push([prompt, JSON.stringify(st), String(((r&&r.display)||{}).subtitle||"").slice(0,60)]);
  }
  console.log(`\n${CASES.length - bad.length}/${CASES.length} behaved as intended\n`);
  for (const [p, st, note] of bad) console.log(`  ${p.slice(0,44).padEnd(46)}\n      got ${st}\n      ${note}`);
})();
