/* build-bench-set.js - the hand-written set, run once with the model off,
 * written out as the frozen set the extension ships.
 *
 * The point of the offline pass here is not to score anything. It is to
 * record, per prompt, whether the grounding layer alone already answers it
 * - because that is the one number that says how much of the set actually
 * exercises the model. The set this replaces was 90% answerable without a
 * model and nothing in the file said so; a reader had to run it to find
 * out.
 *
 *   node research/live-scoring/build-bench-set.js --site=usgs > usgs.json
 *   node research/live-scoring/build-bench-set.js --merge=usgs.json,...
 *
 * One site per process: every prompt needs a page nothing has touched, and
 * a fresh page means re-parsing the HTML and re-evaluating background.js in
 * a new vm context. The sites do not depend on one another.
 */
const fs = require("fs");
const path = require("path");
const SET = require("./submission-set.js");
const DIR = path.join(__dirname, "pages");
const { loadPage, loadBackground } = require("../../extension/test/harness.js");

const flat = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* One prompt, one untouched page, the model switched off.
 *
 * Mirrors actions.js's runner deliberately: the two have to judge a row the
 * same way or the offline column here and the offline table there stop
 * being comparable.
 */
async function runOne(url, html, p) {
  const page = loadPage(html, { url });
  if (!page) return { ok: false, why: "no jsdom" };
  const pressed = [];
  for (const el of page.document.querySelectorAll("a, button")) {
    el.addEventListener("click", () => {
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
      bg.__ask({ type: "smartAsk", instruction: p.say }),
      new Promise((res) => setTimeout(() => res({ ok: false, error: "timed out" }), 45000)),
    ]);
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }

  const w = p.want || {};
  if (w.refuse) {
    return { ok: r.ok === false && !pressed.length,
      why: r.ok === false ? "refused" : "acted anyway" };
  }
  if (w.read) {
    const read = await bg.invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
    const summary = read.ok ? bg.summariseForModel(read.result) : "";
    return { ok: summary.length > 60, why: `${summary.length} chars of page` };
  }
  if (w.on) {
    const inv = await bg.invokeOnActiveTab("inventory", [{ includeHidden: true }])
      .catch(() => ({ ok: false }));
    const now = ((inv.ok && inv.result && inv.result.controls) || [])
      .find((c) => flat(c.label) === flat(w.on));
    if (now && now.checked === true) return { ok: true, why: "set" };
    return { ok: pressed.some((q) => flat(q).includes(flat(w.on))),
      why: r.ok ? "ran" : String(r.error || "").slice(0, 40) };
  }
  if (w.clicked) {
    const any = [].concat(w.clicked);
    return { ok: pressed.some((q) => any.some((c) => flat(q).includes(flat(c)))),
      why: pressed.length ? `pressed ${pressed[0].slice(0, 28)}`
        : String(r.error || "nothing pressed").slice(0, 40) };
  }
  return { ok: false, why: "no expectation" };
}

async function rowsForSite(site) {
  const meta = SET[site];
  const file = path.join(DIR, `${site}.html`);
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, "utf8");
  const out = [];
  for (const p of meta.prompts) {
    const res = await runOne(meta.url, html, p);
    out.push({ site, say: p.say, kind: p.kind, on: p.on, want: p.want,
      offline: !!res.ok, why: res.why });
    process.stderr.write(res.ok ? "." : "x");
  }
  return out;
}

/* The shipped file.
 *
 * Written rather than hand-maintained so the `offline` flag on every row is
 * a recorded result and not somebody's recollection of one.
 */
function emit(rows) {
  const bySite = {};
  for (const r of rows) (bySite[r.site] = bySite[r.site] || []).push(r);
  const tot = rows.length;
  const needsModel = rows.filter((r) => !r.offline).length;
  const chains = rows.filter((r) => r.kind === "chain").length;

  const head = `/* bench-prompts.js - the prompt set, frozen, so a live run and an offline
 * one are the same experiment.
 *
 * ${tot} prompts, ${Object.keys(bySite).length} sites, twenty each, hand-written against the control
 * list every page really carries. ${chains} of them are chains - two or three
 * steps in one sentence - where the two sets this replaces had three
 * between them across two hundred and twenty-three prompts.
 *
 * Nothing in here can be answered by matching a printed label. The set this
 * replaces was enumerated from each page's own controls, so most of it read
 * "click NDMC" or "click tag: Drought Index" - a footer logo asked for by
 * name, which is exactly what the name matcher exists to catch. On one site
 * three of twenty-four prompts reached the model.
 *
 * \`offline\` on each row is what the grounding layer alone did with this
 * exact prompt, the model switched off, against the captured page in
 * research/live-scoring/pages. ${needsModel} of ${tot} are false: that is the share of
 * the set that has no answer without a model, and it is the reason to
 * believe a live number measures the system rather than the matcher.
 *
 * Read the offline column with jsdom's limits in mind - it applies no
 * stylesheet and does no layout, so CSS-hidden menus are wide open there
 * and a browser is strictly harder. It is a floor, not a forecast.
 *
 * And it is weaker still on the reading rows. Offline, a reading prompt
 * passes when the page yields more than sixty characters to summarise - it
 * checks that there is something to read, not that anything explained it,
 * because explaining is the model's job and the model is off. All fifteen
 * read \`offline: true\` for that reason and none of them should be counted
 * as answered without a model. The live run is the only thing that says
 * whether those fifteen work.
 *
 * kinds: chain | paraphrase | vocabulary | world-knowledge | reading
 *        | refusal | judgment
 *
 * Generated by research/live-scoring/build-bench-set.js from
 * research/live-scoring/submission-set.js, which is the hand-written
 * source and the file to edit.
 */
globalThis.WC_BENCH_PROMPTS = {`;

  const body = Object.entries(bySite).map(([site, rs]) => {
    const meta = SET[site];
    const ps = rs.map((r) => "   " + JSON.stringify({
      say: r.say, kind: r.kind, on: r.on, want: r.want, offline: r.offline,
    })).join(",\n");
    return ` ${JSON.stringify(site)}: {\n`
      + `  "url": ${JSON.stringify(meta.url)},\n`
      + `  "note": ${JSON.stringify(meta.note)},\n`
      + `  "prompts": [\n${ps}\n  ]\n }`;
  }).join(",\n");

  return `${head}\n${body}\n};\n`;
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
  const merge = arg("merge");
  let rows = [];
  if (merge) {
    for (const f of merge.split(",")) rows.push(...JSON.parse(fs.readFileSync(f, "utf8")));
  } else {
    for (const site of Object.keys(SET)) rows.push(...await rowsForSite(site));
    process.stderr.write("\n");
  }
  // Source order, not merge order, so the shipped file is stable.
  const order = Object.keys(SET);
  rows.sort((a, b) => order.indexOf(a.site) - order.indexOf(b.site));
  const out = path.join(__dirname, "..", "..", "extension", "lib", "bench-prompts.js");
  fs.writeFileSync(out, emit(rows));
  const n = rows.length, need = rows.filter((r) => !r.offline).length;
  process.stderr.write(`wrote ${out}\n${n} prompts, ${need} need the model offline (${Math.round(need / n * 100)}%)\n`);
  for (const site of order) {
    const rs = rows.filter((r) => r.site === site);
    if (!rs.length) continue;
    process.stderr.write(`  ${site.padEnd(12)} ${rs.filter((r) => !r.offline).length}/${rs.length} need the model\n`);
  }
})();
