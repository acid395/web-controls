const fs = require("fs"), path = require("path");
const { loadPage, loadBackground } = require("/Users/vincenthuang/web-controls/extension/test/harness.js");
const sb = loadBackground();

const SITES = [
  ["USGS NWIS",   "usgs.html",    "https://waterdata.usgs.gov/nwis/rt"],
  ["NWPS (NOAA)", "noaa.html",    "https://water.noaa.gov/"],
  ["Drought.gov", "drought.html", "https://www.drought.gov/"],
  ["EPA MyWaterway","epa.html",   "https://mywaterway.epa.gov/"],
  ["weather.gov", "weather.html", "https://www.weather.gov/"],
];

// The instruction a person would actually type for this control.
function instructionFor(c) {
  const label = (c.label || "").trim().replace(/\s+/g, " ").slice(0, 50);
  if (!label) return null;
  const type = String(c.type || "").toLowerCase(), kind = String(c.kind || "").toLowerCase();
  if (type === "checkbox" || type === "radio" || kind === "checkbox") return `enable ${label}`;
  if (kind === "select" || (c.options && c.options.length)) {
    const opt = (c.options || [])[1] || (c.options || [])[0];
    const v = opt && String(opt.text || opt.value || "").trim().slice(0, 30);
    return v ? `set ${label} to ${v}` : `open ${label}`;
  }
  if (["text","search","email","url","number","tel","textarea"].includes(type)) return `search ${label} for smith river`;
  return `click ${label}`;
}

const rows = [];
for (const [name, file, url] of SITES) {
  const html = fs.readFileSync(path.join("/tmp/gov", file), "utf8");
  let page;
  try { page = loadPage(html, { url }); } catch (e) { rows.push({ site:name, err:String(e.message) }); continue; }
  if (!page) { rows.push({ site:name, err:"jsdom failed" }); continue; }

  let inv;
  try { inv = page.GENERIC.inventory({ includeHidden: true }); }
  catch (e) { rows.push({ site:name, err:"inventory threw: "+e.message }); continue; }

  // A hidden input is not an action a person can take, so it is not a row in
  // an action matrix. Counting them as either successes or failures was
  // measuring the harness, not the extension.
  const controls = (inv.controls || []).filter((c) => (c.label||"").trim()
    && String(c.type||"").toLowerCase() !== "hidden");
  // Spread across kinds so the sample is not 25 nav links.
  const byKind = new Map();
  for (const c of controls) {
    const k = `${c.kind}:${c.type||""}`;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(c);
  }
  const picked = [];
  let round = 0;
  while (picked.length < 22 && round < 40) {
    for (const [, list] of byKind) if (list[round] && picked.length < 22) picked.push(list[round]);
    round++;
  }

  for (const c of picked) {
    const instr = instructionFor(c);
    if (!instr) continue;
    let plan = null, err = null;
    try { plan = sb.planGenericTool(instr, inv); } catch (e) { err = e.message; }
    const call = plan && plan.calls && plan.calls[0];
    const hit = !!(call && call.args && call.args.selector === c.selector);
    // A radio has no selector in its args; match on value instead.
    const radioHit = !!(call && call.name === "pagePickRadio" && !call.args.selector
      && String(call.args.value||"").toLowerCase() === String(c.label||"").trim().toLowerCase());
    rows.push({
      site: name, label: (c.label||"").trim().replace(/\s+/g," ").slice(0,44),
      kind: `${c.kind}${c.type?":"+c.type:""}`, instr: instr.slice(0, 48),
      tool: call ? call.name : (err ? "THREW" : "no match"),
      ok: hit || radioHit,
      why: err ? err.slice(0,40)
        : !call ? (plan && plan.ambiguous ? "ambiguous" : "no match")
        : (hit||radioHit) ? "" : "wrong control",
    });
  }
  console.error(`${name}: ${controls.length} controls, sampled ${picked.length}`);
}
fs.writeFileSync("/tmp/gov/matrix.json", JSON.stringify(rows, null, 1));
const done = rows.filter((r) => !r.err);
console.log(`\nTOTAL ${done.length} actions | ${done.filter(r=>r.ok).length} resolved | ${done.filter(r=>!r.ok).length} failed`);
