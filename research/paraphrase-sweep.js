const fs = require("fs");
const { loadPage, loadBackground } = require("/Users/vincenthuang/web-controls/extension/test/harness.js");
const sb = loadBackground();

// Fixed and domain-general. Written before looking at any site's labels, and
// not adjusted afterwards - the point is to measure what survives paraphrase,
// so tuning these to raise the number would defeat the exercise.
const SYNONYM = {
  precipitation: "rain", discharge: "flow", gage: "gauge", temperature: "temp",
  maximum: "max", minimum: "min", imagery: "satellite", inundation: "flooding",
  observations: "obs", forecasts: "forecast", equivalent: "eq", analysis: "data",
  hydrologic: "hydro", national: "us", information: "info", resources: "links",
  monitoring: "monitor", location: "site", statistics: "stats", download: "export",
};
const FILLER = ["layer", "mapping", "data", "information", "page", "tool", "service", "system"];

const VARIANTS = [
  ["verbatim", (l) => l],
  ["lowercased", (l) => l.toLowerCase()],
  ["filler dropped", (l) => l.split(/\s+/).filter((w) => !FILLER.includes(w.toLowerCase())).join(" ")],
  ["first two words", (l) => l.split(/\s+/).slice(0, 2).join(" ")],
  ["last two words", (l) => l.split(/\s+/).slice(-2).join(" ")],
  ["a synonym swapped", (l) => l.split(/\s+/)
      .map((w) => SYNONYM[w.toLowerCase().replace(/[^a-z]/g, "")] || w).join(" ")],
  ["politely", (l) => `can you please ${l.toLowerCase()} for me`],
];
const VERB = (c) => {
  const t = String(c.type || "").toLowerCase(), k = String(c.kind || "").toLowerCase();
  if (t === "checkbox" || t === "radio" || k === "checkbox") return "turn on";
  if (k === "select" || (c.options || []).length) return "set";
  if (["text","search","email","url","number","tel","textarea"].includes(t)) return null;
  return "click";
};
const SITES = [["usgs","/tmp/gov/usgs.html","https://waterdata.usgs.gov/nwis/rt"],
  ["drought","/tmp/gov/drought.html","https://www.drought.gov/"],
  ["epa","/tmp/gov/epa.html","https://mywaterway.epa.gov/"],
  ["weather","/tmp/gov/weather.html","https://www.weather.gov/"],
  ["fws","/tmp/new3/fws.html","https://www.fws.gov/"],
  ["usbr","/tmp/new3/usbr.html","https://www.usbr.gov/"]];

const tally = new Map(VARIANTS.map(([n]) => [n, [0, 0, 0]]));
const misses = [];
for (const [site, file, url] of SITES) {
  const page = loadPage(fs.readFileSync(file, "utf8"), { url });
  if (!page) continue;
  const inv = page.GENERIC.inventory({ includeHidden: true });
  const controls = (inv.controls || []).filter((c) => (c.label || "").trim()
    && String(c.type || "").toLowerCase() !== "hidden"
    && (c.label || "").trim().split(/\s+/).length >= 2);
  for (const c of controls.slice(0, 18)) {
    const verb = VERB(c); if (!verb) continue;
    for (const [name, make] of VARIANTS) {
      const phrase = make(c.label.trim());
      if (!phrase || !phrase.trim()) continue;
      // "click and Maps" is not a way anyone asks for anything - a fragment
      // starting on a conjunction or a symbol is the generator misfiring, not
      // a phrasing to be judged against.
      if (/^(and|or|the|of|to|&|-|\u2013)\b/i.test(phrase.trim())) continue;
      let hit = false, asked = false;
      try {
        const p = sb.planGenericTool(`${verb} ${phrase}`, inv);
        const sel = p && p.calls && p.calls[0] && p.calls[0].args.selector;
        const got = (inv.controls || []).find((x) => x.selector === sel);
        hit = !!(sel === c.selector
          || (got && String(got.label || "").trim().toLowerCase() === c.label.trim().toLowerCase())
          || (got && got.goesTo && got.goesTo === c.goesTo));
        if (!hit && p && p.ambiguous) {
          asked = p.ambiguous.some((a) => a.selector === c.selector
            || String(a.label || "").trim().toLowerCase() === c.label.trim().toLowerCase());
        }
      } catch (e) { hit = false; }
      const t = tally.get(name); t[1]++; if (hit) t[0]++; if (asked) t[2]++;
      else if (misses.length < 400 && !hit) misses.push({ site, name, phrase: `${verb} ${phrase}`, want: c.label.trim() });
    }
  }
}
console.log("\nphrasing                 resolved        + asked, wanted one offered");
let ok = 0, all = 0, ask = 0;
for (const [name, [o, t, a]] of tally) { ok += o; all += t; ask += a;
  console.log(`  ${name.padEnd(22)} ${String(o).padStart(3)}/${String(t).padStart(3)}  ${String(t ? Math.round(100*o/t) : 0).padStart(3)}%   ${String(o + a).padStart(3)}/${t}  ${t ? Math.round(100*(o+a)/t) : 0}%`); }
console.log(`  ${"TOTAL".padEnd(22)} ${ok}/${all}  ${Math.round(100*ok/all)}%   ${ok+ask}/${all}  ${Math.round(100*(ok+ask)/all)}%`);
fs.writeFileSync("/tmp/para/misses.json", JSON.stringify(misses, null, 1));
