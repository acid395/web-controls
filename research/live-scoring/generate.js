/* generate.js - a benchmark built from the pages themselves.
 *
 * Forty-four hand-written prompts told us about forty-four prompts. What a
 * class of bug looks like only shows up at scale, and scale needs ground
 * truth that is not somebody's opinion - so the prompts are derived from
 * each page's own controls, and the right answer is known by construction.
 *
 * Five kinds, all objective:
 *   named    - "click <label>"           -> that control acted on
 *   typed    - two letters transposed    -> the same control
 *   value    - "select <option>"         -> that option chosen
 *   span     - a duration said in words  -> the control carrying it
 *   absent   - a label no page carries   -> nothing pressed, and said so
 *
 * Paraphrase cannot be generated - meaning is the thing being tested - so
 * those stay hand-written in score.js.
 */
const fs = require("fs");
const path = require("path");
const { loadPage, loadBackground } = require("../../extension/test/harness.js");

const PAGES = {
  usgs: "https://waterdata.usgs.gov/monitoring-location/01646500/",
  noaa: "https://water.noaa.gov/",
  drought: "https://www.drought.gov/",
  usgsstate: "https://waterdata.usgs.gov/nwis/rt",
  quakes: "https://earthquake.usgs.gov/earthquakes/map/",
  airnow: "https://www.airnow.gov/",
  weather: "https://www.weather.gov/",
  climate: "https://www.ncei.noaa.gov/access/monitoring/monthly-report/",
};
const DIR = path.join(__dirname, "pages");

const transpose = (w) => {
  const i = w.length > 4 ? 2 : 1;
  if (w.length < 4) return w;
  return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
};
const typo = (label) => {
  const parts = String(label).split(" ");
  const at = parts.findIndex((p) => p.length >= 5 && /^[a-zA-Z]+$/.test(p));
  if (at < 0) return null;
  parts[at] = transpose(parts[at]);
  return parts.join(" ");
};
const SPANS = [[7, "the past week"], [30, "a month"], [365, "a full year"]];

function casesFor(site, html, url, want = 8) {
  const page = loadPage(html, { url });
  if (!page) return [];
  const bg = loadBackground({ page });
  const all = bg.controlsForModel(page.GENERIC.inventory({ includeHidden: true }));
  const flat = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const labels = all.map((c) => flat(c.label));
  // Only controls whose name belongs to them alone. airnow carries both a
  // link and a radio called "Interactive Map", and waterdata a "Go to
  // Explore USGS Water Data" beside an "Explore USGS Water Data" - for those
  // there is no right answer to assert, so a benchmark that asserts one is
  // measuring its own confusion. Ambiguity is a real case and belongs to the
  // hand-written set, where the expectation can say what should happen.
  const usable = all.filter((c) => {
    const l = String(c.label || "").trim();
    if (!(l.length >= 4 && l.length <= 44) || c.disabled || c.opensPanel || c.hidden) return false;
    const f = flat(l);
    const sharesName = labels.filter((o) => o === f).length > 1;
    // Both directions. Dropping only the label that sits inside another
    // still left "Go to Explore USGS Water Data" asserting itself against a
    // page that also offers "Explore USGS Water Data" - and pressing the
    // shorter one is not wrong, it goes to the same place.
    const overlaps = labels.some((o) => o !== f && (o.includes(f) || f.includes(o)));
    return !sharesName && !overlaps;
  });
  const out = [];
  const switches = usable.filter((c) => /^(checkbox|radio)$/.test(String(c.type || "")));
  const links = usable.filter((c) => String(c.tag || c.kind) === "a");
  const lists = usable.filter((c) => (c.options || []).length > 2);
  const pick = (arr, n) => arr.filter((c, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);

  for (const c of pick(switches, want)) {
    out.push({ site, kind: "named", instruction: `click ${c.label}`, want: { on: c.label } });
    const t = typo(c.label);
    if (t && t !== c.label) {
      out.push({ site, kind: "typed", instruction: `click ${t}`, want: { on: c.label } });
    }
  }
  for (const c of pick(links, Math.min(want, 6))) {
    out.push({ site, kind: "named", instruction: `click ${c.label}`, want: { clicked: c.label } });
  }
  for (const c of pick(lists, 2)) {
    const opts = (c.options || []).filter((o) => String(o.value ?? "").trim()
      && String(o.text || "").trim().length >= 4);
    const o = opts[Math.min(2, opts.length - 1)];
    if (o) out.push({ site, kind: "value", instruction: `select ${o.text}`, want: { value: o.text } });
  }
  for (const [days, said] of SPANS) {
    const c = usable.find((x) => bg.daysInPhrase(x.label) === days
      && /^(checkbox|radio)$/.test(String(x.type || "")));
    if (c) out.push({ site, kind: "span", instruction: `click ${said}`, want: { on: c.label } });
  }
  out.push({ site, kind: "absent", instruction: "click the tidal predictions calibrator",
    want: { refuse: true } });
  return out;
}

function build() {
  const cases = [];
  for (const [site, url] of Object.entries(PAGES)) {
    const file = path.join(DIR, `${site}.html`);
    if (!fs.existsSync(file)) continue;
    cases.push(...casesFor(site, fs.readFileSync(file, "utf8"), url));
  }
  return cases;
}

module.exports = { build, PAGES, DIR };

if (require.main === module) {
  const cases = build();
  const by = {};
  for (const c of cases) by[c.kind] = (by[c.kind] || 0) + 1;
  console.log(`${cases.length} cases from ${Object.keys(PAGES).length} pages`);
  console.log(JSON.stringify(by, null, 1));
}
