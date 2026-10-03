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
  // An action followed by an explanation is judged on the action offline:
  // the explanation is the model's, and the model is off.
  if (w.read && !w.clicked) {
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

/* What a prompt asks for, in the runner's own terms.
 *
 * A prompt names its steps; the offline runner and the live panel judge a
 * row by `want`. The last step is the one that says the request was carried
 * through - except where the steps leave the page, and only the first can be
 * seen from here. A prompt with no steps is a reading.
 */
function wantOf(p) {
  const steps = p.steps || [];
  if (!steps.length) return { read: true };
  const seen = p.later ? steps[0] : steps[steps.length - 1];
  return p.explain ? { clicked: seen, read: true } : { clicked: seen };
}

async function rowsForSite(site) {
  const meta = SET[site];
  const file = path.join(DIR, `${site}.html`);
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, "utf8");
  const out = [];
  for (const p of meta.prompts) {
    const want = wantOf(p);
    const res = await runOne(meta.url, html, { ...p, want });
    out.push({ site, say: p.say, kind: p.kind, steps: p.steps || [], explain: !!p.explain,
      later: !!p.later, on: want.clicked || null, want, offline: !!res.ok, why: res.why });
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

  const head = `/* bench-prompts.js - the prompt set, frozen, so a live run and an offline
 * one are the same experiment.
 *
 * ${tot} prompts, ${Object.keys(bySite).length} sites, twenty each, hand-written against the controls
 * and data each page really carries. Two kinds of thing and their
 * combinations: an action that visibly changes the page, a question
 * answered from the page's data, an action followed by an explanation,
 * and several actions in order.
 *
 * \`steps\` are the controls a prompt should reach, in order; \`explain\`
 * means a prose answer is expected too; \`later\` means the steps after
 * the first happen on a page the first one opens.
 *
 * \`offline\` is what the grounding layer alone did with the prompt, model
 * off, against the captured page - ${needsModel} of ${tot} are false. jsdom applies
 * no stylesheet and cannot follow a link, so it is a floor, not a
 * forecast, and says nothing about steps on a second page. A reading
 * passes offline whenever the page has text to read, since explaining is
 * the model's job and the model is off.
 *
 * kinds: action | explain | action+explain | multistep
 *
 * Generated by research/live-scoring/build-bench-set.js from
 * research/live-scoring/submission-set.js, which is the file to edit.
 */
globalThis.WC_BENCH_PROMPTS = {`;

  const body = Object.entries(bySite).map(([site, rs]) => {
    const meta = SET[site];
    const ps = rs.map((r) => "   " + JSON.stringify({
      say: r.say, kind: r.kind, steps: r.steps, explain: r.explain || undefined,
      later: r.later || undefined, on: r.on, want: r.want, offline: r.offline,
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
