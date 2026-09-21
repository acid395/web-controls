const { loadPage, loadBackground } = require("/Users/vincenthuang/web-controls/extension/test/harness.js");
const NWPS = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-navbar-nav"><li><a href="/fim">Flood Inundation Mapping</a></li></ul>
  <ul class="uk-accordion">
    <li class="uk-open"><button class="uk-accordion-title">Flood Inundation</button>
      <div class="uk-accordion-content">
        <label><input type="checkbox" name="inund"> INUNDATION</label>
        <label><input type="checkbox" name="cov" checked> INUNDATION COVERAGE</label></div></li>
    <li><button class="uk-accordion-title">National Snow Analysis</button>
      <div class="uk-accordion-content" style="display:none">
        <label><input type="checkbox" name="sd"> Snow Depth</label></div></li>
  </ul>
  <label for="bm">Basemap</label>
  <select id="bm"><option>Topographic</option><option>Satellite</option><option>Streets</option></select>
  <input id="q" type="search" placeholder="Search location">
  <button id="dl">Download CSV</button><p id="log"></p>
  <script>document.getElementById("dl").addEventListener("click",()=>{document.getElementById("log").textContent="dl";});<\/script>
  </body></html>`;
// prompt -> what the page should look like afterwards
const CASES = [
  ["enable flood inundation",        (s) => s.inund === true && s.cov === true],
  ["select inundation",              (s) => s.inund === true],
  ["turn on snow depth",             (s) => s.sd === true && s.inund === false],
  ["turn off inundation coverage",   (s) => s.cov === false && s.inund === false],
  ["uncheck inundation coverage",    (s) => s.cov === false],
  ["hide inundation coverage",       (s) => s.cov === false],
  ["set basemap to satellite",       (s) => s.bm === "Satellite"],
  ["set the basemap to streets",     (s) => s.bm === "Streets"],
  ["change basemap to topographic",  (s) => s.bm === "Topographic"],
  ["search for smith river",         (s) => /smith river/i.test(s.q)],
  ['search for "eel river"',         (s) => /eel river/i.test(s.q)],
  ["click download csv",             (s) => s.log === "dl"],
  ["enable flood inundation and then set basemap to satellite",
                                     (s) => s.inund === true && s.bm === "Satellite"],
  ["turn on snow depth and turn off inundation coverage",
                                     (s) => s.sd === true && s.cov === false],
];
(async () => {
  const bad = [];
  for (const [prompt, want] of CASES) {
    const page = loadPage(NWPS, { url: "https://water.noaa.gov/" });
    const bg = loadBackground({ page });
    let r; try { r = await bg.__ask({ type: "smartAsk", instruction: prompt }); }
    catch (e) { bad.push([prompt, "THREW " + e.message, ""]); continue; }
    const g = (n) => { const el = page.document.querySelector(`[name="${n}"]`); return el ? el.checked : null; };
    const st = { inund: g("inund"), cov: g("cov"), sd: g("sd"),
      bm: (page.document.getElementById("bm") || {}).value,
      q: (page.document.getElementById("q") || {}).value || "",
      log: (page.document.getElementById("log") || {}).textContent || "" };
    const ok = want(st);
    if (!ok) bad.push([prompt, JSON.stringify(st), `${r && r.ok} | ${((r && r.display) || {}).subtitle || ""}`.slice(0, 66)]);
  }
  console.log(`\n${CASES.length - bad.length}/${CASES.length} behaved as intended\n`);
  for (const [p, st, note] of bad) console.log(`  ${p.slice(0,46).padEnd(48)}\n      got ${st}\n      ${note}`);
})();
