/* by-site.js - what the tool can do on each site, and how often it is right.
 *
 * Asked for twice and never produced: "list out the different actions of
 * 4-5 sites and how accurately we can perform those". The numbers existed -
 * the generated benchmark has been reporting one figure for everything -
 * but a single percentage across nine sites is not a result anybody can
 * use. A paper needs the per-site table and the kinds of action within it,
 * because that is where the claim is either supported or not.
 *
 * Every case here is derived from the page's own controls, so the coverage
 * is the site's rather than ours. The model declines throughout: this
 * measures the grounding layer, which is what runs on any machine.
 *
 *   node research/live-scoring/by-site.js
 */
const fs = require("fs");
const path = require("path");
const { loadPage, loadBackground } = require("../../extension/test/harness.js");
const { build, PAGES, DIR } = require("./generate.js");

const flat = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Which route each page takes, read from the extension rather than assumed.
function routeOf(bg, url) {
  try { return (bg.routeFor(url) || {}).global || "GENERIC"; } catch (e) { return "GENERIC"; }
}

(async () => {
  const cases = build();
  const html = {};
  for (const s of Object.keys(PAGES)) {
    const f = path.join(DIR, `${s}.html`);
    if (fs.existsSync(f)) html[s] = fs.readFileSync(f, "utf8");
  }
  const bySite = {};
  let route = {};

  for (const c of cases) {
    if (!html[c.site]) continue;
    const page = loadPage(html[c.site], { url: PAGES[c.site] });
    if (!page) continue;
    const clicks = [];
    const before = new Set(page.GENERIC.inventory({ includeHidden: true }).controls
      .filter((x) => x.checked === true).map((x) => x.selector));
    for (const el of page.document.querySelectorAll("a, button")) {
      el.addEventListener("click", () => clicks.push(flat(el.textContent)));
    }
    const bg = loadBackground({ page });
    if (!route[c.site]) route[c.site] = routeOf(bg, PAGES[c.site]);
    bg.__model = (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: true } : undefined);
    let r = null;
    try { r = await bg.__ask({ type: "smartAsk", instruction: c.instruction }); }
    catch (e) { r = { error: String(e.message || e) }; }

    const after = page.GENERIC.inventory({ includeHidden: true }).controls;
    const nowOn = after.filter((x) => x.checked === true && !before.has(x.selector))
      .map((x) => String(x.label || ""));
    const values = after.filter((x) => (x.options || []).length)
      .flatMap((x) => (x.options || []).filter((o) => o.selected).map((o) => String(o.text || "")));
    const refused = r.ok === false || /clearly does|could not place|nothing on this page/i
      .test(`${r.error || ""} ${(r.display || {}).title || ""}`);

    let ok = false;
    if (c.want.refuse) ok = refused && clicks.length === 0 && nowOn.length === 0;
    else if (c.want.on) ok = nowOn.some((l) => flat(l) === flat(c.want.on));
    else if (c.want.value) ok = values.some((v) => flat(v) === flat(c.want.value));
    else if (c.want.clicked) {
      ok = clicks.some((x) => flat(x).includes(flat(c.want.clicked)))
        || flat((r.display || {}).title || "").includes(flat(c.want.clicked));
    }
    bySite[c.site] = bySite[c.site] || {};
    bySite[c.site][c.kind] = bySite[c.site][c.kind] || { pass: 0, total: 0 };
    bySite[c.site][c.kind].total++;
    if (ok) bySite[c.site][c.kind].pass++;
  }

  const KINDS = ["named", "typed", "span", "value", "absent"];
  const HEAD = { named: "by name", typed: "misspelt", span: "a time span",
    value: "a value in a list", absent: "not there (refuse)" };

  console.log("\nWhat the tool can do on each site, with no model at all.");
  console.log("Cases are derived from each page's own controls.\n");
  console.log("site         route    " + KINDS.map((k) => HEAD[k].padEnd(18)).join("") + "all");
  console.log("-".repeat(78 + 24));
  let allPass = 0; let allTotal = 0;
  for (const site of Object.keys(bySite)) {
    const row = bySite[site];
    let p = 0; let t = 0;
    const cells = KINDS.map((k) => {
      const c = row[k];
      if (!c) return "-".padEnd(18);
      p += c.pass; t += c.total;
      return `${c.pass}/${c.total}`.padEnd(18);
    });
    allPass += p; allTotal += t;
    console.log(site.padEnd(13) + String(route[site] || "").padEnd(9) + cells.join("")
      + `${p}/${t} ${t ? Math.round((p / t) * 100) : 0}%`);
  }
  console.log("-".repeat(78 + 24));
  console.log("".padEnd(13) + "".padEnd(9) + "".padEnd(18 * KINDS.length)
    + `${allPass}/${allTotal} ${allTotal ? Math.round((allPass / allTotal) * 100) : 0}%`);
  console.log("\nGENERIC = no site-specific code in this repo.\n");
})();
