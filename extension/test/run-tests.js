#!/usr/bin/env node
/* run-tests.js - the regression suite.
 *
 *   node extension/test/run-tests.js          logic only, no network
 *   node extension/test/run-tests.js --live   also calls the real agency APIs
 *
 * Nearly every case here exists because it once produced a confidently wrong
 * answer rather than an error: a statewide average over incompatible datums,
 * Snake Creek returned for the Snake River, Kansas City resolving to Kansas,
 * a 2012 reading served as current, Friday answered with today's weather.
 * Those are invisible to type checking and to "does it crash" testing, which
 * is why they are pinned here by name.
 */
const { loadBackground, loadPage, loadOffscreenHelper } = require("./harness");

let passed = 0, failed = 0, skipped = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else { failed++; failures.push({ label, actual, expected }); }
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}
function ensure(label, condition, detail) {
  if (condition) passed++;
  else { failed++; failures.push({ label, actual: detail, expected: "truthy" }); }
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}`);
}
function skip(label, why) { skipped++; console.log(`  skip ${label} (${why})`); }
function section(name) { console.log(`\n${name}`); }

const sb = loadBackground();
const plan = (text, route = { global: "GENERIC" }) => sb.planDataTool(text, route);
const toolOf = (text, route) => { const p = plan(text, route); return (p && p.name) || undefined; };

section("place and measurement parsing");
check('"gage height in Alaska"', plan("gage height in Alaska").args, { state: "ak", parameter: "gageHeight" });
check("two-letter code", plan("discharge in tx").args, { state: "tx", parameter: "discharge" });
check("multi-word state", plan("water temperature in west virginia").args.state, "wv");
check("river narrows the search", plan("gage height in wyoming at big sandy river").args.nameContains, "big sandy river");
check("city resolves to its state", plan("precipitation in cleveland").args.state, "oh");
// "Kansas City" is in Missouri; the state matcher used to win because
// "kansas" is a substring, leaving "city" as the apparent place.
check("city containing a state name", plan("weather in kansas city").args.state, "mo");
check("oklahoma city likewise", plan("weather in oklahoma city").args.state, "ok");

section("typos must not silently change the answer");
// Each of these previously lost a field and quietly became a different query.
check('"hiehgt" still finds gage height', plan("gage hiehgt in wyoming").args.parameter, "gageHeight");
check('"Alaskak" still finds the state', plan("gage height of Alaskak").args.state, "ak");
check('"clevland"', plan("gage height in clevland").args.state, "oh");
check('"tallahasee"', plan("precipitation in tallahasee").args.state, "fl");
check("misspelled city yields the correct spelling", plan("precipitation in tallahasee").args.nameContains, "tallahassee");
// "stage" and "state" are one edit apart and mean different things.
check("short words get no fuzzy slack", toolOf("what is the current state"), undefined);

section("filler words are not place names");
// Each of these leaked into nameContains and matched no gauge, silently
// falling back to statewide - an answer that looked right and was not.
check('"amount"', plan("precipitation amount in omaha nebraska").args.nameContains, "omaha");
check('"estimate"', plan("precipitation estimate in tallahasee").args.nameContains, "tallahassee");
check('"weekly" is not a place', plan("Milwaukee weekly temperature average").args.place, "milwaukee");
check('"friday" is not a place', plan("Milwaukee temperature at Friday").args.place, "milwaukee");

section("the page decides what an ambiguous word means");
// env-vocab lists bare "temperature" as a water synonym, which is right on a
// USGS page and wrong on weather.gov.
check("bare temperature on a water page", toolOf("temperature in st louis", { global: "USGS" }), "waterCurrentConditions");
check("bare temperature on a forecast page", toolOf("temperature in st louis", { global: "FCP" }), "weatherConditions");
check("qualifying it overrides the page", toolOf("water temperature in st louis", { global: "FCP" }), "waterCurrentConditions");
check("air temperature anywhere", toolOf("air temperature in st louis", { global: "USGS" }), "weatherConditions");

section("intent routing");
check("flooding", toolOf("is there flooding in Idaho"), "waterFloodStatus");
check("near flood stage (contains 'stage')", toolOf("which gauges are near flood stage in Idaho"), "waterFloodStatus");
check("alerts", toolOf("any flood warnings in Alaska"), "waterAlerts");
check("humidity has no water equivalent", toolOf("humidity in boise"), "weatherConditions");
check("a named day is a forecast, not now", toolOf("Milwaukee temperature on Friday"), "weatherForecast");
check("a week is a forecast", toolOf("weekly temperature in milwaukee"), "weatherForecast");
check("history is refused, not forecast", plan("temperature in milwaukee yesterday").args.when, "past");
// A maximum is not a current reading. Answering it with the thermometer's
// present value is why a number disagreed with weather.gov, which shows the
// forecast high.
check("max is a forecast high", plan("max temperature of chicago IL").args.when, "high");
check("min is a forecast low", plan("min temperature in chicago").args.when, "low");
check("bare temperature is still now", toolOf("temperature in chicago", { global: "FCP" }), "weatherConditions");
check("a river with no state is still answerable", toolOf("discharge of the bighorn river"), "waterFindGauges");
check("control instructions stay control", toolOf("set the parameter to gage height"), undefined);
check('"select Alaska" is not a data question', toolOf("select Alaska"), undefined);

section("page controls, no model");
const inv = { controls: [
  { kind: "button", label: "Daily", selector: "#p-daily", confidence: "high" },
  { kind: "button", label: "Weekly", selector: "#p-weekly", confidence: "high" },
  { kind: "button", label: "Year to date", selector: "#p-ytd", confidence: "high" },
  { kind: "button", label: "Date range", selector: "#range", confidence: "high" },
  { kind: "select", label: "Statistic", selector: "#stat", confidence: "high",
    options: [{ value: "avg", text: "Average" }, { value: "max", text: "Maximum" }] },
  { kind: "select", label: "Variable", selector: "#var", confidence: "high",
    options: [{ value: "temp", text: "Temperature" }, { value: "precip", text: "Precipitation" }] },
] };
const g = (q) => sb.planGenericTool(q, inv);
check("single control", g("year to date").calls.map((c) => c.args.selector), ["#p-ytd"]);
// One instruction, three widgets. Matching only the best one set the variable
// and ignored the rest, leaving a chart that looked answered.
check("three controls from one instruction",
  g("weekly average temperature").calls.map((c) => c.args.selector).sort(), ["#p-weekly", "#stat", "#var"]);
check("option named, not the dropdown's label",
  g("show precipitation").calls[0].args.value, "precip");
// Ambiguity is judged on overlapping words, not score: complementary
// controls are not rivals.
ensure("genuine rivals still stop it", !!g("show me the date").ambiguous, g("show me the date"));
check("rivals are the ones sharing a word",
  g("show me the date").ambiguous.map((c) => c.label).sort(), ["Date range", "Year to date"]);
check("unmatched words are reported", g("weekly average temperature in fahrenheit").unmatchedWords, ["fahrenheit"]);
ensure("nonsense matches nothing", g("fly me to the moon") === null, g("fly me to the moon"));

section("failures explain themselves");
const why = sb.explainFailure("barometric trend", { global: "GENERIC" }, { ok: true, result: inv }, { modelOff: true });
ensure("says what it checked", why.checked.length >= 2, why.checked);
ensure("lists what it can do", why.capabilities.dataQuestions.length >= 5, why.capabilities);
const unreadable = sb.explainFailure("weekly", { global: "GENERIC" }, { ok: false }, { modelOff: true });
// "I could not read the page" and "I read it and it is not there" are
// different problems with different fixes.
ensure("distinguishes an unreadable page", /couldn't read this page/i.test(unreadable.error), unreadable.error);

section("reading a page");
const page = loadPage(`<!doctype html><html><head><title>Station MKE</title></head><body>
  <h1>Milwaukee</h1>
  <dl><dt>Air temperature</dt><dd>64.4 °F</dd></dl>
  <table><caption>Readings</caption><tr><th>Time</th><th>Stage</th></tr>
  <tr><td>23:00</td><td>4.21 ft</td></tr></table>
  <div class="stat-value" aria-label="Gage height">4.21 ft</div>
  <svg><title>Weekly stage</title><text>Mon</text><circle aria-label="Tue 4.3 ft"/></svg>
  <canvas></canvas></body></html>`);
if (!page) skip("readPage", "jsdom not installed - npm i -D jsdom");
else {
  const d = page.GENERIC.readPage();
  check("title", d.title, "Station MKE");
  check("labelled pair", d.pairs[0], { label: "Air temperature", value: "64.4 °F" });
  check("table columns", d.tables[0].columns, ["Time", "Stage"]);
  check("table row", d.tables[0].rows[0], ["23:00", "4.21 ft"]);
  check("readout label", d.readouts[0].label, "Gage height");
  check("SVG chart point", d.chart.svgCharts[0].points, ["Tue 4.3 ft"]);
  const blank = loadPage(`<!doctype html><html><head><title>X</title></head><body><canvas></canvas></body></html>`);
  // An empty result reads as "no data here"; the truth is that the data is
  // pixels. Those are different answers.
  ensure("canvas-only says why it read nothing", /canvas/.test(blank.GENERIC.readPage().note || ""), blank.GENERIC.readPage().note);
}

section("answering from the page you are on");
const wxPage = loadPage(`<!doctype html><html><head><title>National Weather Service Chicago IL</title></head><body>
  <h1>Chicago, IL</h1>
  <li><p class="period">Today</p><p class="temp temp-high">High: 83 °F</p></li>
  <li><p class="period">Tonight</p><p class="temp temp-low">Low: 67 °F</p></li>
  <p>Humidity 52%</p><p>Wind Speed 9 mph</p></body></html>`);
if (!wxPage) skip("page values", "jsdom not installed");
else {
  const pd = wxPage.GENERIC.readPage();
  // Pages write "High: 83 °F", never "High temperature: 83", and these are a
  // single text run so readPairs/readReadouts never see them.
  check("inline labelled numbers are found", pd.labelledNumbers.map((n) => n.text),
    ["High: 83 °F", "Low: 67 °F", "Humidity 52%", "Wind Speed 9 mph"]);
  const hits = (q, place) => {
    const wants = sb.pageValueWants(q);
    const r = wants.length ? sb.findOnPage(pd, { wants, place: place || null }) : null;
    return r ? r.map((h) => h.label) : null;
  };
  // The unit stands in for the noun, or every forecast page looks empty.
  check("max temperature reads the page", hits("max temperature"), ["High: 83 °F"]);
  check("min temperature reads the page", hits("min temperature"), ["Low: 67 °F"]);
  check("humidity", hits("humidity"), ["Humidity 52%"]);
  // Both aspects must hold, or "Wind Speed 9 mph" answers "max temperature".
  ensure("a wind reading does not answer a temperature question",
    !(hits("max temperature") || []).some((h) => /wind/i.test(h)), hits("max temperature"));
  // Reading Milwaukee's numbers for a Chicago question would be worse than
  // fetching, so a page about somewhere else is not used.
  check("a question about elsewhere is not answered from this page", hits("max temperature in milwaukee", "milwaukee"), null);
  check("something the page lacks falls through", hits("gage height"), null);
  // A bare "high" is a qualifier, not a subject.
  check("bare qualifier asks for nothing", sb.pageValueWants("show me the high"), []);
}

section("model output parsing");
// The native tools API is restricted to 7-8B models, which measured as
// unusable here, so the model is prompted for JSON instead - and a small
// model obeys "JSON only" loosely. Each of these is a shape one actually
// emits; JSON.parse on the whole reply fails on every one of them.
const firstJson = loadOffscreenHelper("firstJsonObject");
check("bare object", firstJson('{"tool":"waterAlerts","args":{"state":"ak"}}').tool, "waterAlerts");
check("with a preamble", firstJson('Sure! Here is the call:\n{"tool":"x","args":{}}').tool, "x");
check("in code fences", firstJson('```json\n{"tool":"y","args":{"a":1}}\n```').args.a, 1);
check("still talking afterwards", firstJson('{"tool":"z","args":{}} Hope that helps!').tool, "z");
check("nested objects", firstJson('{"tool":"a","args":{"nested":{"deep":true}}}').args.nested.deep, true);
// A selector or gauge name can contain a brace; naive depth counting breaks.
check("braces inside strings", firstJson('{"tool":"pageClick","args":{"selector":"#a{b}"}}').args.selector, "#a{b}");
check("no JSON at all", firstJson("I cannot help with that"), null);
check("malformed JSON is rejected, not thrown", firstJson('{"tool": oops}'), null);

section("ask history survives the popup closing");
// A popup is destroyed on blur, so results cannot live in its DOM. These are
// the states the popup has to be able to redraw from storage alone.
(async () => {
  await sb.recordAsk("a1", "gage height in wyoming", { status: "running" });
  let h = await sb.readHistory();
  check("an ask is recorded before it finishes", h[0].status, "running");

  await sb.recordAsk("a1", "gage height in wyoming", {
    status: "done", plannedBy: "fast-path",
    display: { title: "gageHeight · WY", subtitle: "109 gauges", stats: [], rows: [] },
  });
  h = await sb.readHistory();
  check("completing updates in place, not appended", h.length, 1);
  check("and becomes renderable", h[0].display.title, "gageHeight · WY");
  check("keeps when it was asked", h[0].at, h[0].at);

  await sb.recordAsk("a2", "nonsense", { status: "error", error: "nothing matched" });
  h = await sb.readHistory();
  check("errors are kept too", h[1].status, "error");

  // Whole payloads would exhaust the quota within a few asks.
  await sb.recordAsk("a3", "read this page", {
    status: "done", display: { title: "p", stats: [], rows: [] }, result: { huge: "x".repeat(500000) },
  });
  h = await sb.readHistory();
  ensure("raw payloads are not stored", h[2].result === undefined, Object.keys(h[2]));

  for (let i = 0; i < 40; i++) await sb.recordAsk(`b${i}`, `q${i}`, { status: "done" });
  h = await sb.readHistory();
  ensure("history is capped", h.length <= 30, h.length);
  check("and keeps the newest", h[h.length - 1].instruction, "q39");
  finishHistory();
})();

function finishHistory() {
section("feed capture");
const capturePage = loadPage(`<!doctype html><html><head><title>Canvas chart</title></head><body><canvas></canvas></body></html>`);
if (!capturePage) skip("feed capture", "jsdom not installed");
else {
  const fs2 = require("fs"), pathMod = require("path");
  // A canvas page has nothing readable, which is exactly when the data the
  // page fetched becomes the only answer.
  const before = capturePage.GENERIC.capturedFeeds();
  check("reports when capture is not installed", before.installed, false);

  capturePage.fetch = async () => ({ status: 200, headers: { get: () => "application/json" },
    clone() { return { text: async () => '{"series":[1,2,3],"unit":"ft"}' }; } });
  const sc = capturePage.document.createElement("script");
  sc.textContent = fs2.readFileSync(pathMod.join(__dirname, "..", "page", "feed-capture.js"), "utf8");
  capturePage.document.body.appendChild(sc);

  ensure("installs", !!capturePage.__wcFeedCapture, capturePage.__wcFeedCapture);
  const empty = capturePage.GENERIC.capturedFeeds();
  // Installed-but-empty and not-installed need different advice.
  ensure("distinguishes installed-but-empty", /reload/.test(empty.note || ""), empty.note);

  (async () => {
    await capturePage.fetch("https://x.gov/api/gauges/1/observations?f=json");
    await capturePage.fetch("https://x.gov/logo.png");
    await new Promise((r) => setTimeout(r, 60));
    const after = capturePage.GENERIC.capturedFeeds();
    check("captures data requests only", after.count, 1);
    check("summarises the payload", after.feeds[0].keys, ["series", "unit"]);
    const one = capturePage.GENERIC.capturedFeed("observations");
    check("returns the parsed body", one.parsed.series, [1, 2, 3]);
    check("missing feed is reported, not thrown", capturePage.GENERIC.capturedFeed("nope").found, false);
    finishCapture();
  })();
}

function finishCapture() {
if (process.argv.includes("--live")) {
  section("live agency APIs");
  (async () => {
    const run = (name, args) => sb.executeToolCall("GENERIC", { name, args });
    try {
      const wi = await run("waterCurrentConditions", { state: "WI", parameter: "discharge" });
      ensure("USGS returns gauges", wi.result.gaugesReporting > 0, wi.result.gaugesReporting);
      ensure("discharge aggregates", !!wi.result.range, wi.result.range);

      // Stage is measured from each gauge's own datum, so a cross-gauge
      // range is arithmetic on incompatible references.
      const ak = await run("waterCurrentConditions", { state: "AK", parameter: "gage height" });
      ensure("gage height refuses to aggregate", ak.result.range === null, ak.result.range);
      ensure("and says why", /datum/.test(ak.result.notComparable || ""), ak.result.notComparable);

      // "%SNAKE%" once returned SNAKEDEN BRANCH, and dropping "river"
      // entirely pushed the real Snake River out of the result window.
      const snake = await run("waterFindGauges", { place: "snake river" });
      ensure("snake river excludes Snake Creek",
        snake.result.gauges.every((x) => /\bsnake\b/i.test(x.name)), snake.result.gauges.slice(0, 3));

      const bighorn = await run("waterFindGauges", { place: "bighorn river", parameter: "discharge" });
      ensure("bighorn river is found without a state", bighorn.result.found > 0, bighorn.result.found);

      const wx = await run("weatherConditions", { state: "WI", place: "milwaukee" });
      ensure("weather returns a temperature", wx.result.airTemperatureF !== null, wx.result);
      ensure("weather names its station", !!wx.result.station, wx.result.station);

      const fc = await run("weatherForecast", { state: "WI", place: "milwaukee", when: "week" });
      ensure("forecast returns days", fc.result.days.length > 0, fc.result.days.length);
      ensure("forecast is labelled a forecast", /forecast/i.test(fc.result.display.caveat || ""), fc.result.display.caveat);
    } catch (err) {
      failed++; failures.push({ label: "live APIs", actual: err.message, expected: "no throw" });
      console.log(`  FAIL live APIs threw: ${err.message}`);
    }
    report();
  })();
} else {
  console.log("\n(live API tests skipped - pass --live to run them)");
  report();
}
}

}

function report() {
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  for (const f of failures) {
    console.log(`\n  ${f.label}\n    got      ${JSON.stringify(f.actual)}\n    expected ${JSON.stringify(f.expected)}`);
  }
  process.exit(failed ? 1 : 0);
}
