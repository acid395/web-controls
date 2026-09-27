/* actions.js - what this can actually be told to do, site by site.
 *
 * "List out the different actions of 4-5 sites" - and the only listing worth
 * having is one where every row was run. A catalogue of things a tool might
 * do is a wish; this presses each one against the real captured page and
 * records what happened, so a row that does not work says so next to the
 * ones that do.
 *
 * Every action is derived from the page's own controls, so the coverage is
 * the site's rather than ours - nothing here was chosen to flatter it. The
 * model declines throughout: this is the grounding layer alone, which is
 * what runs on any machine and what a small model gets for free before it
 * is asked anything. Where a row lands here, model size does not enter into
 * it.
 *
 *   node research/live-scoring/actions.js            > ACTIONS.md
 */
const fs = require("fs");
const path = require("path");
const { loadPage, loadBackground } = require("../../extension/test/harness.js");

const DIR = path.join(__dirname, "pages");
const SITES = {
  usgs: { url: "https://waterdata.usgs.gov/monitoring-location/01646500/",
    name: "waterdata.usgs.gov (a monitoring location)" },
  noaa: { url: "https://water.noaa.gov/", name: "water.noaa.gov (National Water Prediction Service)" },
  droughtmap: { url: "https://droughtmonitor.unl.edu/CurrentMap.aspx", name: "droughtmonitor.unl.edu" },
  weather: { url: "https://www.weather.gov/", name: "weather.gov" },
  airnow: { url: "https://www.airnow.gov/", name: "airnow.gov" },
  // Added when airnow.gov stopped resolving - and kept, because it is the
  // only page in this set that is a data page rather than a portal: four
  // tables, nine readouts, seventy-nine labelled numbers and five canvases.
  // Everything else here is navigation.
  drought: { url: "https://www.drought.gov/", name: "drought.gov" },
};

// Read off the capture files, never typed in: a date in a results table that
// somebody remembered rather than checked is the one number nobody can audit.
const SNAPSHOT_DATE = (() => {
  try {
    const f = path.join(DIR, "usgs.html");
    return fs.statSync(f).mtime.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  } catch (e) { return "unknown"; }
})();

const flat = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const transpose = (w) => (w.length < 4 ? w
  : w.slice(0, w.length > 4 ? 2 : 1) + w[(w.length > 4 ? 2 : 1) + 1]
    + w[w.length > 4 ? 2 : 1] + w.slice((w.length > 4 ? 2 : 1) + 2));
const typoOf = (label) => {
  const parts = String(label).split(" ");
  const at = parts.findIndex((p) => p.length >= 5 && /^[a-zA-Z]+$/.test(p));
  if (at < 0) return null;
  parts[at] = transpose(parts[at]);
  return parts.join(" ");
};

// Only controls whose name is their own. A label that another control also
// wears, or that sits inside another's, has no single right answer - and a
// listing that asserts one is recording its own confusion as a capability.
function usableControls(bg, page) {
  const all = bg.controlsForModel(page.GENERIC.inventory({ includeHidden: true }));
  const labels = all.map((c) => flat(c.label));
  return all.filter((c) => {
    const l = String(c.label || "").trim();
    if (!(l.length >= 4 && l.length <= 44) || c.disabled || c.opensPanel || c.hidden) return false;
    // A slider's grip and a map's attribution are on the page and are not
    // things anybody asks for by name. Listing them as actions measures the
    // enumerator's reach rather than the tool's.
    if (/^(handle|leaflet|skip to main content)$/i.test(l)) return false;
    const f = flat(l);
    if (labels.filter((o) => o === f).length > 1) return false;
    return !labels.some((o) => o !== f && (o.includes(f) || f.includes(o)));
  });
}

function kindOf(c) {
  const type = String(c.type || "").toLowerCase();
  if (type === "checkbox" || type === "radio") return "toggle";
  if ((c.options || []).length > 2) return "choose";
  if (String(c.kind || "").toLowerCase() === "textarea"
    || /^(text|search|email|number|date)$/.test(type)) return "type";
  return "press";
}

// The phrasings a person actually uses, spread across the ways they differ:
// the plain name, a misspelling of it, the same thing asked politely, and
// the page's own word for it where the vocabulary knows one.
function actionsFor(site, bg, page) {
  const controls = usableControls(bg, page);
  const out = [];
  const take = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);

  const switches = controls.filter((c) => kindOf(c) === "toggle");
  const links = controls.filter((c) => kindOf(c) === "press");
  const lists = controls.filter((c) => kindOf(c) === "choose");
  const boxes = controls.filter((c) => kindOf(c) === "type");

  for (const c of take(switches, 8)) {
    out.push({ site, kind: "toggle", say: `click ${c.label}`, on: c.label, want: { on: c.label } });
  }
  for (const c of take(links, 14)) {
    out.push({ site, kind: "press", say: `click ${c.label}`, on: c.label, want: { clicked: c.label } });
  }
  // A misspelling of a real control, which is how these get typed in practice.
  for (const c of take(links.concat(switches), 4)) {
    const t = typoOf(c.label);
    if (t && t !== c.label) {
      out.push({ site, kind: "misspelt", say: `click ${t}`, on: c.label,
        want: kindOf(c) === "toggle" ? { on: c.label } : { clicked: c.label } });
    }
  }
  // The same request, asked the way people ask.
  for (const c of take(links, 2)) {
    out.push({ site, kind: "polite", say: `could you please click ${c.label} for me`, on: c.label,
      want: { clicked: c.label } });
  }
  for (const c of take(lists, 2)) {
    const opts = (c.options || []).filter((o) => String(o.value ?? "").trim()
      && String(o.text || "").trim().length >= 4);
    const o = opts[Math.min(2, opts.length - 1)];
    if (o) out.push({ site, kind: "choose", say: `select ${o.text}`, on: `${c.label} -> ${o.text}`,
      want: { value: o.text } });
  }
  for (const c of take(boxes, 1)) {
    out.push({ site, kind: "search", say: "search potomac", on: c.label, want: { typed: "potomac" } });
  }
  // Asking rather than instructing. Correctness of prose cannot be asserted
  // here, so what is recorded is whether the page yielded anything to answer
  // from - which is the part that was broken.
  out.push({ site, kind: "read", say: "explain this data", on: "(the page's own values)", want: { read: true } });
  out.push({ site, kind: "read", say: "what does this page show", on: "(the page's own values)", want: { read: true } });
  // Something no page carries: the answer is to refuse, and to say so.
  out.push({ site, kind: "absent", say: "click the tidal predictions calibrator",
    on: "(nothing - should refuse)", want: { refuse: true } });
  return out;
}

async function run(site, html, url, act) {
  const page = loadPage(html, { url });
  if (!page) return { ok: false, why: "no jsdom" };
  const pressed = [];
  for (const el of page.document.querySelectorAll("a, button")) {
    el.addEventListener("click", () => {
      // The name the control actually answers to, not the text inside it.
      // Half the controls on a map page are icon buttons: "Zoom out" is a
      // button whose textContent is a minus sign, and the Leaflet
      // attribution link's name is its title while its text reads
      // "Leaflet". Checking textContent recorded the right control being
      // pressed as a miss, which would have understated the layer being
      // measured rather than flattered it - wrong either way.
      const name = (el.getAttribute("aria-label") || el.getAttribute("title")
        || el.textContent || "").replace(/\s+/g, " ").trim();
      pressed.push(name);
      page.document.body.appendChild(page.document.createElement("hr"));
    });
  }
  const bg = loadBackground({ page });
  bg.__model = (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: false } : undefined);
  let r;
  try {
    r = await Promise.race([
      bg.__ask({ type: "smartAsk", instruction: act.say }),
      new Promise((res) => setTimeout(() => res({ ok: false, error: "timed out" }), 45000)),
    ]);
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }

  const w = act.want;
  if (w.refuse) return { ok: r.ok === false && !pressed.length, why: r.ok === false ? "refused" : "acted anyway" };
  if (w.read) {
    const read = await bg.invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
    const summary = read.ok ? bg.summariseForModel(read.result) : "";
    return { ok: summary.length > 60, why: `${summary.length} chars of page` };
  }
  if (w.on) {
    const inv = await bg.invokeOnActiveTab("inventory", [{ includeHidden: true }]).catch(() => ({ ok: false }));
    const now = ((inv.ok && inv.result && inv.result.controls) || [])
      .find((c) => flat(c.label) === flat(w.on));
    if (now && now.checked === true) return { ok: true, why: "set" };
    return { ok: pressed.some((p) => flat(p).includes(flat(w.on))), why: r.ok ? "ran" : String(r.error || "").slice(0, 40) };
  }
  if (w.clicked) {
    return { ok: pressed.some((p) => flat(p).includes(flat(w.clicked))),
      why: pressed.length ? `pressed ${pressed[0].slice(0, 28)}` : String(r.error || "nothing pressed").slice(0, 40) };
  }
  if (w.value) {
    const inv = await bg.invokeOnActiveTab("inventory", [{ includeHidden: true }]).catch(() => ({ ok: false }));
    const holder = ((inv.ok && inv.result && inv.result.controls) || [])
      .find((c) => (c.options || []).some((o) => flat(o.text || o.value) === flat(w.value) && o.selected));
    return { ok: !!holder, why: holder ? "chosen" : "not chosen" };
  }
  if (w.typed) {
    const inv = await bg.invokeOnActiveTab("inventory", [{ includeHidden: true }]).catch(() => ({ ok: false }));
    const box = ((inv.ok && inv.result && inv.result.controls) || [])
      .find((c) => String(c.value || "").toLowerCase().includes(w.typed));
    return { ok: !!box, why: box ? "typed in" : "not typed" };
  }
  return { ok: false, why: "no expectation" };
}

/* One site per process.
 *
 * Every case needs a page nothing has touched, and a fresh page means
 * re-parsing the site's HTML and re-evaluating background.js in a new vm
 * context - about thirty seconds each, which over a hundred and thirty
 * actions is an hour of waiting for a table. The sites do not depend on one
 * another, so they do not have to queue behind one another either: each
 * writes its own rows and a merge pass assembles the document.
 */
async function rowsForSite(site) {
  const meta = SITES[site];
  const file = path.join(DIR, `${site}.html`);
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, "utf8");
  const page = loadPage(html, { url: meta.url });
  const bg = loadBackground({ page });
  const route = (() => { try { return (bg.routeFor(meta.url) || {}).global || "GENERIC"; } catch (e) { return "GENERIC"; } })();
  const out = [];
  for (const act of actionsFor(site, bg, page)) {
    const res = await run(site, html, meta.url, act);
    out.push({ ...act, route, ok: res.ok, why: res.why });
    process.stderr.write(res.ok ? "." : "x");
  }
  return out;
}

(async () => {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1];
  const only = arg("site");
  if (only) {
    const rows = await rowsForSite(only);
    process.stderr.write("\n");
    console.log(JSON.stringify(rows));
    return;
  }

  let rows = [];
  const merge = arg("merge");
  if (merge) {
    for (const f of merge.split(",")) rows.push(...JSON.parse(fs.readFileSync(f, "utf8")));
  } else {
    for (const site of Object.keys(SITES)) rows.push(...await rowsForSite(site));
    process.stderr.write("\n");
  }

  const bySite = {};
  for (const r of rows) {
    bySite[r.site] = bySite[r.site] || { n: 0, ok: 0, route: r.route, rows: [] };
    bySite[r.site].n++; if (r.ok) bySite[r.site].ok++;
    bySite[r.site].rows.push(r);
  }

  const lines = [];
  lines.push("# What it can be told to do, site by site");
  lines.push("");
  lines.push(`${rows.length} actions across ${Object.keys(bySite).length} sites, every one of them run.`);
  lines.push("");
  lines.push("Each action is derived from that page's own controls, so the coverage is the");
  lines.push("site's rather than ours.");
  lines.push("");
  lines.push("**This is one half of the measurement, and the lesser half.** The model is");
  lines.push("switched off for all of it, so what is reported here is the grounding layer");
  lines.push("alone - deterministic, and re-runnable by anyone with the repo. It is not the");
  lines.push("system: the thing that ships decides with a model loaded, and a component");
  lines.push("measured on its own does not stand in for that. The same 120 prompts are");
  lines.push("frozen in `extension/lib/bench-prompts.js` so they can be run live, in");
  lines.push("Chrome, with the model on - see `LIVE-BENCH.md`. Put the two columns beside");
  lines.push("each other; neither replaces the other.");
  lines.push("");
  lines.push("What this half does establish is a floor. A row that lands here lands with any");
  lines.push("model or none, so model size only decides the rows this layer cannot reach.");
  lines.push("");
  lines.push("## What this is not");
  lines.push("");
  lines.push("**Nothing here touched a live website.** Every row is replayed against a");
  lines.push("static HTML snapshot in jsdom - the files in `pages/`, captured by");
  lines.push("`capture.js` on the date below. The extension itself was not running in a");
  lines.push("browser: `background.js` is loaded into a Node vm with the `chrome.*` APIs");
  lines.push("stubbed. The https URLs in this file set the document's location so route");
  lines.push("matching resolves; they are not fetched.");
  lines.push("");
  lines.push("That gap is not cosmetic, and it has hidden real bugs. jsdom reports the");
  lines.push("same fake rectangle for every element, so anything judged on layout behaves");
  lines.push("differently here than in Chrome; the harness never answers a message sent to");
  lines.push("the side panel, so a test that looks like it exercises the panel is");
  lines.push("exercising the fallback; and a page that builds itself in JavaScript is");
  lines.push("captured only as far as the capture waited. This measures the logic against");
  lines.push("a snapshot. It is not evidence about any site today.");
  lines.push("");
  lines.push(`Snapshots captured: **${SNAPSHOT_DATE}**. Table generated: **${new Date().toISOString().slice(0, 10)}**.`);
  lines.push("");
  lines.push("| site | route | actions | land |");
  lines.push("|---|---|---|---|");
  for (const [site, s] of Object.entries(bySite)) {
    lines.push(`| ${SITES[site].name} | ${s.route} | ${s.n} | ${s.ok}/${s.n} (${Math.round(100 * s.ok / s.n)}%) |`);
  }
  const total = rows.length, landed = rows.filter((r) => r.ok).length;
  lines.push(`| **all five** | | **${total}** | **${landed}/${total} (${Math.round(100 * landed / total)}%)** |`);
  lines.push("");
  lines.push("`SITE` and `NOAA` are hand-written manifests. `GENERIC` means no code in this");
  lines.push("repo was written for that site at all - the controls are read out of the");
  lines.push("page's own DOM at run time rather than from anything written in advance.");
  lines.push("");

  const KINDS = {
    press: "Press a named control", toggle: "Turn something on", choose: "Choose a value from a list",
    type: "Type into a box", search: "Search the site", misspelt: "The same thing, misspelt",
    polite: "The same thing, asked politely", read: "Ask about the data", absent: "Ask for what is not there",
  };
  for (const [site, s] of Object.entries(bySite)) {
    lines.push(`## ${SITES[site].name}`);
    lines.push("");
    lines.push(`Route \`${s.route}\` - ${s.ok} of ${s.n} land with no model.`);
    lines.push("");
    lines.push("| what you type | what it acts on | kind | lands |");
    lines.push("|---|---|---|---|");
    for (const r of s.rows) {
      const say = String(r.say).replace(/\|/g, "\\|");
      const on = String(r.on).replace(/\|/g, "\\|");
      lines.push(`| \`${say}\` | ${on} | ${KINDS[r.kind] || r.kind} | ${r.ok ? "yes" : `no - ${r.why}`} |`);
    }
    lines.push("");
  }
  console.log(lines.join("\n"));
})();
