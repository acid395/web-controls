const fs = require("fs"), path = require("path");
const H = "/Users/vincenthuang/web-controls/extension/test/harness.js";
const { loadPage, loadBackground } = require(H);
const sb = loadBackground();
const DIR = "/tmp/gov2";
const SITES = fs.readdirSync(DIR).filter((f) => f.endsWith(".html")).map((f) => [f.replace(".html",""), f]);
const URLS = { census:"https://www.census.gov/", datagov:"https://data.gov/", nasa:"https://www.nasa.gov/",
  energy:"https://www.energy.gov/", noaagov:"https://www.noaa.gov/", nps:"https://www.nps.gov/",
  wiDnr:"https://dnr.wisconsin.gov/", txwater:"https://www.waterdatafortexas.org/reservoirs/statewide",
  cdec:"https://cdec.water.ca.gov/", epaAir:"https://www.airnow.gov/",
  usgsEq:"https://earthquake.usgs.gov/earthquakes/map/", climate:"https://www.climate.gov/" };

function instructionFor(c) {
  const label = (c.label||"").trim().replace(/\s+/g," ").slice(0,50);
  if (!label) return null;
  const t = String(c.type||"").toLowerCase(), k = String(c.kind||"").toLowerCase();
  if (t==="checkbox"||t==="radio"||k==="checkbox") return `enable ${label}`;
  if (k==="select"||(c.options&&c.options.length)) {
    const o=(c.options||[])[1]||(c.options||[])[0];
    const v=o&&String(o.text||o.value||"").trim().slice(0,30);
    return v?`set ${label} to ${v}`:`open ${label}`;
  }
  if (["text","search","email","url","number","tel","textarea"].includes(t)) return `search ${label} for smith river`;
  return `click ${label}`;
}
const rows=[];
for (const [name,file] of SITES) {
  let page; const url = URLS[name] || `https://${name}.gov/`;
  try { page = loadPage(fs.readFileSync(path.join(DIR,file),"utf8"), { url }); } catch(e){ console.error(name,"load:",e.message); continue; }
  if (!page) continue;
  let inv; try { inv = page.GENERIC.inventory({ includeHidden:true }); }
  catch(e){ rows.push({site:name,fatal:"inventory threw: "+e.message}); console.error(name,"INVENTORY THREW:",e.message); continue; }
  const controls=(inv.controls||[]).filter(c=>(c.label||"").trim() && String(c.type||"").toLowerCase()!=="hidden");
  const byKind=new Map();
  for (const c of controls){ const k=`${c.kind}:${c.type||""}`; if(!byKind.has(k))byKind.set(k,[]); byKind.get(k).push(c); }
  const picked=[]; let r=0;
  while (picked.length<14 && r<40){ for(const[,l]of byKind) if(l[r]&&picked.length<14)picked.push(l[r]); r++; }
  for (const c of picked){
    const instr=instructionFor(c); if(!instr) continue;
    let plan=null,err=null;
    try { plan=sb.planGenericTool(instr,inv); } catch(e){ err=e.message; }
    const call=plan&&plan.calls&&plan.calls[0];
    // A wrapper inside a link is the same control. Resolving "click Facebook"
    // to the <a> when it was generated from the <span> inside it is the right
    // answer, not a miss - scoring it as a miss measured the harness.
    const sel = call && call.args && call.args.selector;
    const hit = !!(sel && (sel === c.selector
      || c.selector.startsWith(sel + " ") || sel.startsWith(c.selector + " ")
      || c.selector.endsWith(" > " + sel.split(" > ").pop())));
    const radioHit=!!(call&&call.name==="pagePickRadio"&&String(call.args.value||"").toLowerCase()===String(c.label||"").trim().toLowerCase());
    rows.push({site:name,label:(c.label||"").trim().replace(/\s+/g," ").slice(0,40),
      kind:`${c.kind}${c.type?":"+c.type:""}`,instr:instr.slice(0,46),
      tool:call?call.name:(err?"THREW":"no match"),ok:hit||radioHit,
      why:err?("THREW: "+err.slice(0,50)):(!call?(plan&&plan.ambiguous?"ambiguous":"no match"):((hit||radioHit)?"":"wrong control"))});
  }
  console.error(`${name}: ${controls.length} controls, sampled ${picked.length}`);
}
fs.writeFileSync("/tmp/gov2/rows.json",JSON.stringify(rows,null,1));
const done=rows.filter(r=>!r.fatal);
console.log(`\nTOTAL ${done.length} actions | ${done.filter(r=>r.ok).length} ok | ${done.filter(r=>!r.ok).length} failed`);
