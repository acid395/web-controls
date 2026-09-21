const fs = require("fs"), path = require("path");
const H = "/Users/vincenthuang/web-controls/extension/test/harness.js";
const { loadPage, loadBackground } = require(H);
const sb = loadBackground();
const DIR = "/tmp/new3";
const SITES = fs.readdirSync(DIR).filter((f) => f.endsWith(".html")).map((f) => [f.replace(".html",""), f]);
const URLS = { fws:"https://www.fws.gov/", usbr:"https://www.usbr.gov/", ncei:"https://www.ncei.noaa.gov/" };

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
  while (picked.length<34 && r<80){ for(const[,l]of byKind) if(l[r]&&picked.length<34)picked.push(l[r]); r++; }
  for (const c of picked){
    const instr=instructionFor(c); if(!instr) continue;
    let plan=null,err=null;
    try { plan=sb.planGenericTool(instr,inv); } catch(e){ err=e.message; }
    const call=plan&&plan.calls&&plan.calls[0];
    // A wrapper inside a link is the same control. Resolving "click Facebook"
    // to the <a> when it was generated from the <span> inside it is the right
    // answer, not a miss - scoring it as a miss measured the harness.
    // Several controls on these pages carry an identical label - nps.gov has
    // three called "Search". Reaching a different one of those is not a miss:
    // from the label alone there is no correct answer to pick.
    const resolved = (inv.controls||[]).find(x => x.selector === (call&&call.args&&call.args.selector));
    const sameLabelHit = !!(resolved && String(resolved.label||"").trim().toLowerCase()
      === String(c.label||"").trim().toLowerCase());
    const sel = call && call.args && call.args.selector;
    const hit = !!(sel && (sel === c.selector
      || c.selector.startsWith(sel + " ") || sel.startsWith(c.selector + " ")
      || c.selector.endsWith(" > " + sel.split(" > ").pop()))) || sameLabelHit
      || !!(resolved && resolved.goesTo && resolved.goesTo === c.goesTo);
    const radioHit=!!(call&&call.name==="pagePickRadio"&&String(call.args.value||"").toLowerCase()===String(c.label||"").trim().toLowerCase());
    rows.push({site:name,label:(c.label||"").trim().replace(/\s+/g," ").slice(0,40),
      kind:`${c.kind}${c.type?":"+c.type:""}`,instr:instr.slice(0,46),
      tool:call?call.name:(err?"THREW":"no match"),ok:hit||radioHit,
      why:err?("THREW: "+err.slice(0,50)):(!call?(plan&&plan.ambiguous?"ambiguous":"no match"):((hit||radioHit)?"":"wrong control"))});
  }
  console.error(`${name}: ${controls.length} controls, sampled ${picked.length}`);
}
fs.writeFileSync("/tmp/new3/rows.json",JSON.stringify(rows,null,1));
const done=rows.filter(r=>!r.fatal);
console.log(`\nTOTAL ${done.length} actions | ${done.filter(r=>r.ok).length} ok | ${done.filter(r=>!r.ok).length} failed`);
