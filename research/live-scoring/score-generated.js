/* Runs the generated benchmark and reports by kind, so a class of failure
 * shows as a class rather than as one more card. The model declines
 * throughout: what is measured here is whether a request that names
 * something on the page reaches it, which should never need a decision.
 */
const fs = require("fs");
const path = require("path");
const { loadPage, loadBackground } = require("../../extension/test/harness.js");
const { build, PAGES, DIR } = require("./generate.js");

const flat = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

(async () => {
  const cases = build();
  const html = {};
  for (const s of Object.keys(PAGES)) {
    const f = path.join(DIR, `${s}.html`);
    if (fs.existsSync(f)) html[s] = fs.readFileSync(f, "utf8");
  }
  const tally = {};
  const byRoute = {};
  const misses = [];
  for (const c of cases) {
    const page = loadPage(html[c.site], { url: PAGES[c.site] });
    if (!page) continue;
    const clicks = [];
    for (const el of page.document.querySelectorAll("a,button,input,summary,[role=option]")) {
      el.addEventListener("click", () => clicks.push(
        String(el.textContent || el.value || el.getAttribute("aria-label") || "").trim()));
    }
    const before = new Set(page.GENERIC.inventory({ includeHidden: true }).controls
      .filter((x) => x.checked === true).map((x) => x.selector));
    const bg = loadBackground({ page });
    bg.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmEmbed") return { ok: false };
      if (m.type === "llmStep") return { ok: true, step: { do: "finish", answer: "" }, raw: "{}" };
      return undefined;
    };
    let r;
    try { r = await bg.__ask({ type: "smartAsk", instruction: c.instruction }); }
    catch (e) { r = { error: "threw " + e.message }; }
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
    tally[c.kind] = tally[c.kind] || { pass: 0, total: 0 };
    tally[c.kind].total++;
    if (ok) tally[c.kind].pass++;
    // Which route carried it. Six of the eight pages have no site-specific
    // code at all, and a score that does not say so invites the reading that
    // this works because someone hand-wrote the sites it was measured on.
    const route = (typeof bg.routeFor === "function"
      ? (bg.routeFor(PAGES[c.site] || "") || {}).global : null) || "GENERIC";
    byRoute[route] = byRoute[route] || { pass: 0, total: 0 };
    byRoute[route].total++;
    if (ok) byRoute[route].pass++;
    else misses.push(`[${c.site}/${c.kind}] "${c.instruction}" -> ${r.plannedBy || "-"} `
      + `| on=${JSON.stringify(nowOn.slice(0, 2))} clicked=${JSON.stringify(clicks.slice(0, 2))}`);
  }
  let pass = 0; let total = 0;
  for (const k of Object.keys(tally)) { pass += tally[k].pass; total += tally[k].total; }
  console.log(`\n${pass}/${total} = ${((pass / total) * 100).toFixed(0)}%\n`);
  for (const [k, v] of Object.entries(tally)) {
    console.log(`  ${k.padEnd(8)} ${String(v.pass).padStart(3)}/${String(v.total).padEnd(3)} ${((v.pass / v.total) * 100).toFixed(0)}%`);
  }
  console.log("\n  by route");
  for (const [k, v] of Object.entries(byRoute)) {
    console.log(`  ${k.padEnd(8)} ${String(v.pass).padStart(3)}/${String(v.total).padEnd(3)} ${((v.pass / v.total) * 100).toFixed(0)}%`
      + (k === "GENERIC" ? "   no site-specific code" : "   hand-written manifest"));
  }
  console.log("");
  for (const m of misses.slice(0, 22)) console.log("  MISS " + m);
  if (misses.length > 22) console.log(`  ... and ${misses.length - 22} more`);
})();
