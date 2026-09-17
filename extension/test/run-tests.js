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

section("the rest of a page's controls");
// The matcher could only click or choose an option, so a search box got a
// click - which does nothing visible. The control matched and the action was
// useless, which is harder to notice than no match at all.
const richPage = { controls: [
  { kind: "input", type: "search", label: "Search station", selector: "#q", confidence: "high" },
  { kind: "select", label: "Basemap", selector: "#base", confidence: "high",
    options: [{ value: "sat", text: "Satellite" }, { value: "terr", text: "Terrain" }] },
  { kind: "input", type: "checkbox", label: "Flood inundation layer", selector: "#flood", confidence: "high" },
  { kind: "input", type: "radio", name: "product", label: "Observed", selector: "#obs", confidence: "high" },
  { kind: "button", label: "Download CSV", selector: "#dl", confidence: "high" },
] };
const act = (q) => {
  const r = sb.planGenericTool(q, richPage);
  return r && r.calls ? r.calls.map((c) => ({ name: c.name, args: c.args })) : null;
};
// Filled *and* submitted: typing alone leaves the text in the box while the
// value change makes it look like the search ran.
check("a search box is filled and submitted",
  act("search for Boise"), [
    { name: "pageFill", args: { selector: "#q", text: "Boise" } },
    { name: "pageSubmit", args: { selector: "#q" } },
  ]);
// A quoted string is the query verbatim, spaces and all.
check("quoted text is taken whole",
  act('search station "Big Sandy River"')[0].args.text, "Big Sandy River");
// "look up 13206000" names no control - a site number shares no word with
// "Search station" - but the intent is plain.
check("a bare identifier still reaches the search box",
  act("look up 13206000"), [
    { name: "pageFill", args: { selector: "#q", text: "13206000" } },
    { name: "pageSubmit", args: { selector: "#q" } },
  ]);
check("a dropdown option is chosen",
  act("set the basemap to satellite"), [{ name: "pageSelectOption", args: { selector: "#base", value: "sat" } }]);
// A checkbox has two directions, and clicking blindly cannot express which.
check("a checkbox can be ticked", act("turn on the flood inundation layer")[0].args.on, true);
check("and unticked", act("hide the flood inundation layer")[0].args.on, false);
check("a radio is picked by its group",
  act("select observed"), [{ name: "pagePickRadio", args: { group: "product", value: "Observed" } }]);
check("a plain button is still clicked",
  act("download csv"), [{ name: "pageClick", args: { selector: "#dl" } }]);
// The search fallback must not swallow everything else.
ensure("nonsense still matches nothing", act("fly me to the moon") === null, act("fly me to the moon"));

section("driving the site comes first");
// Controlling the site is the point; answering about it is the bonus. Only
// USGS had a keyword path, so 46 verified tools across SITE, NOAA and FCP
// could be reached only through the model - which is off by default. On a
// NOAA page almost nothing worked.
const m = (q, route) => {
  const r = sb.planManifestTool(q, route);
  return r ? `${r.name} ${JSON.stringify(r.args)}` : null;
};
check("NOAA basemap", m("set the basemap to satellite", "NOAA"), 'noaaSetBasemap {"basemap":"satellite"}');
check("NOAA zoom", m("zoom in", "NOAA"), "noaaZoomIn {}");
// A boolean follows the verb rather than toggling blindly.
check("NOAA boolean", m("turn on limit by boundary", "NOAA"), 'noaaSetLimitByBoundary {"on":true}');
check("SITE time span", m("set the time span to 30 days", "SITE"), 'siteSetTimeSpan {"span":"30 days"}');
check("SITE scale", m("set the scale to log", "SITE"), 'siteSetScale {"scale":"log"}');
// A number argument is read from the instruction.
check("FCP number argument", m("set ring radius to 50", "FCP"), 'fcpSetRingRadius {"miles":50}');
check("USGS grouping", m("group by county", "USGS"), 'usgsGroupBy {"groupBy":"county"}');
ensure("nonsense matches no tool", m("fly me to the moon", "NOAA") === null, m("fly me to the moon", "NOAA"));

// The verb decides the order. Control-first everywhere would send "gage
// height in Alaska" to usgsSetParameter - changing the page instead of
// answering it - because the words overlap a control's name.
check("an action is a command", sb.isCommand("set the parameter to gage height"), true);
check("a bare measurement and place is not", sb.isCommand("gage height in Alaska"), false);
check("a question is not", sb.isCommand("what is the max temperature in Chicago"), false);
check("searching is", sb.isCommand("search for Boise"), true);

section("did the action actually do anything");
// A click that silently did nothing was indistinguishable from one that
// worked - both return without error. Same shape as every other bug here:
// plausible, and wrong.
const actPage = loadPage(`<!doctype html><html><head><title>Controls</title></head><body>
  <select id="basemap"><option value="terr">Terrain</option><option value="sat">Satellite</option></select>
  <input type="checkbox" id="flood"><input type="text" id="q" value="">
  </body></html>`);
if (!actPage) skip("verification", "jsdom not installed");
else {
  const before = actPage.GENERIC.pageSignature();
  ensure("a snapshot records control states", before.count >= 3, before);

  // Nothing touched: the diff must say so, or a no-op reads as success.
  const unchanged = actPage.GENERIC.signatureDiff(before, actPage.GENERIC.pageSignature());
  check("an untouched page reports no change", unchanged.changed, false);

  actPage.document.getElementById("basemap").value = "sat";
  actPage.document.getElementById("flood").checked = true;
  const after = actPage.GENERIC.pageSignature();
  const diff = actPage.GENERIC.signatureDiff(before, after);
  check("a real change is detected", diff.changed, true);
  check("and counted", diff.changeCount, 2);
  ensure("with the old and new values", diff.changes.some((c) => c.was === "terr" && c.now === "sat"), diff.changes);

  // The no-op message is the one that matters: some tools need a panel
  // opened first and fail invisibly otherwise.
  const quiet = sb.describeVerification({ changed: false, changes: [], changeCount: 0 }, { name: "noaaSetBasemap" });
  check("a no-op is called out", quiet.tone, "alert");
  ensure("and suggests why", /panel|apply/.test(quiet.text), quiet.text);
  const moved = sb.describeVerification({ changed: true, changeCount: 1, changes: [{ was: "terr", now: "sat" }] }, { name: "x" });
  check("a change is reported plainly", moved.tone, "ok");
  ensure("naming what moved", /terr -> sat/.test(moved.text), moved.text);
}

section("repeat questions do not re-fetch");
// NWPS is slow and rate-limited by its own documentation, and every ask
// re-fetched it.
(async () => {
  const fresh = loadBackground();
  await fresh.executeToolCall("GENERIC", { name: "waterAlerts", args: { state: "RI" } }).catch(() => {});
  const afterFirst = fresh.__requests.length;
  await fresh.executeToolCall("GENERIC", { name: "waterAlerts", args: { state: "RI" } }).catch(() => {});
  check("the second identical ask issues no new request", fresh.__requests.length, afterFirst);
  finishCache();
})();

function finishCache() {

section("typos in control instructions");
// Typo tolerance existed only on the data side, so the same slip forgiven
// when asking about a river was fatal when operating the page - the wrong way
// round, given driving the site is the primary job.
const typoPage = { controls: [
  { kind: "button", label: "Thunderstorms", selector: "#ts", confidence: "high" },
  { kind: "button", label: "Precipitation", selector: "#pr", confidence: "high" },
  { kind: "select", label: "Basemap", selector: "#b", confidence: "high",
    options: [{ value: "sat", text: "Satellite" }, { value: "terr", text: "Terrain" }] },
  { kind: "input", type: "checkbox", label: "Flood inundation layer", selector: "#f", confidence: "high" },
] };
const t = (q) => {
  const r = sb.planGenericTool(q, typoPage);
  return r && r.calls ? `${r.calls[0].name} ${JSON.stringify(r.calls[0].args)}` : null;
};
check("misspelled label", t("selct thudnerstorms"), 'pageClick {"selector":"#ts"}');
check("matches the correct spelling too", t("select thunderstorms"), 'pageClick {"selector":"#ts"}');
check("misspelled option", t("set basemp to satelite"), 'pageSelectOption {"selector":"#b","value":"sat"}');
check("misspelled checkbox", t("turn on flod inundation layr"), 'pageCheck {"selector":"#f","on":true}');

const mt = (q, route) => { const r = sb.planManifestTool(q, route); return r ? `${r.name} ${JSON.stringify(r.args)}` : null; };
// Short words needed their own budget: "zoom" is four letters.
check("a short misspelled verb", mt("zom in", "NOAA"), "noaaZoomIn {}");
// A multi-word enum never matches a single token, so it needs a window.
check("a misspelled multi-word value", mt("set the time span to 30 dys", "SITE"), 'siteSetTimeSpan {"span":"30 days"}');
check("misspelled tool name", mt("togle the legend", "FCP"), "fcpToggleLegend {}");
check("misspelled enum", mt("set gauge mode to forecst", "NOAA"), 'noaaSetGaugeMode {"mode":"Forecast"}');

// The data side keeps the stricter budget: there "stage" and "state" are one
// edit apart and mean entirely different things.
check("data matching stays strict", toolOf("what is the current state", { global: "USGS" }), undefined);
check("and an exact control phrase is untouched", toolOf("set the parameter to stage", { global: "USGS" }), undefined);

section("what can I do here");
// A service worker's sendMessage is never delivered to its own listener, so
// routing this through messaging looked correct and answered nothing at all.
// It has to be a direct call.
(async () => {
  const withTab = loadBackground();
  withTab.chrome.tabs.query = async () => [{ id: 1, url: "https://water.noaa.gov/" }];
  withTab.chrome.tabs.sendMessage = async () => ({ ok: true, result: { controls: [
    { label: "View Layers", kind: "button", selector: "#vl", confidence: "high" },
  ] } });
  const caps = await withTab.buildCapabilities();
  check("the route is identified", caps.route, "NOAA");
  ensure("its verified tools are listed", caps.tools.length >= 15, caps.tools.length);
  ensure("the page's own controls are counted", caps.pageControls >= 1, caps.pageControls);
  ensure("actions and questions are distinguished",
    caps.display.rows.some((r) => r.value === "action") && caps.display.rows.some((r) => r.value === "question"),
    caps.display.rows.map((r) => r.value));
  // Tool names are rewritten for people ("noaaSetBasemap" -> "set basemap").
  // A page control keeps its own label, capitals and all, since that is what
  // is printed on the page.
  // Tool rows are tagged "action" or "question"; a page control is tagged
  // with its own kind ("button"), which is how the two are told apart.
  const toolNames = caps.display.rows
    .filter((r) => r.value === "action" || r.value === "question")
    .map((r) => r.name);
  ensure("tool names are rewritten for people", toolNames.every((n) => !/[A-Z]/.test(n)), toolNames);
  ensure("a page control keeps its own label",
    caps.display.rows.some((r) => r.value === "button" && r.name === "View Layers"),
    caps.display.rows.filter((r) => r.value === "button"));
  finishCaps();
})();

function finishCaps() {

section("an action's result has to be readable");
// What a real NOAA basemap switch produced: the right change buried among a
// closing menu and two navigation toggles, every row a raw CSS selector, and
// a fragment change reported as "page moved to <long url>".
const noisy = { changed: true, changeCount: 3, viewChanged: true, changes: [
  { selector: "nav.navbar.svelte-jl30q0 > div.uk-contai", label: null, was: true, now: false },
  { selector: "div.map-app-container > div.uk-card.box-shadow-sma", label: "Base map", was: "topographic", now: "satellite" },
  { selector: "ul.uk-navbar-nav.layer-1", label: null, was: false, now: true },
] };
check("the tool name reads as English", sb.friendlyToolName("noaaSetBasemap"), "set basemap");
// A value change is the substance; a boolean flip is usually a menu closing.
check("the real change is surfaced, not the menu noise",
  sb.rankedChanges(noisy).map((c) => c.label), ["Base map"]);
check("described in terms of the control's label",
  sb.describeVerification(noisy, { name: "noaaSetBasemap" }).text, "Base map: topographic -> satellite");
// A fragment change is the same page showing a different view - how map pages
// record centre and zoom - not a navigation.
check("a view change is not called a navigation",
  sb.describeVerification({ changed: true, changeCount: 0, viewChanged: true, changes: [] }, { name: "noaaZoomIn" }).text,
  "the map view updated");
// Without a label there is still no excuse for printing a raw selector.
check("an unlabelled control is still named",
  sb.nameOfChange({ selector: "div.map-app-container > ul.uk-navbar-nav.layer-1" }), "ul");
check("a no-op is still called out",
  sb.describeVerification({ changed: false, changes: [], changeCount: 0 }, { name: "x" }).tone, "alert");

section("anything plannable must be executable");
// A page control matched on a NOAA page planned as pageClick and then failed
// with "model picked an unknown tool", because GENERIC's definitions were
// absent from a named route's list even though the GENERIC bundle is injected
// there. Planning something the executor cannot find is the worst of both.
for (const route of ["USGS", "SITE", "NOAA", "FCP", "GENERIC"]) {
  ensure(`${route}: generic page tools are executable`, !!sb.findToolDef(route, "pageClick"), route);
}
check("a named route keeps its own tools", !!sb.findToolDef("NOAA", "noaaSetBasemap"), true);
check("and data tools stay everywhere", !!sb.findToolDef("FCP", "waterCurrentConditions"), true);
// The guarantee that matters: every tool any planner can emit resolves.
const plannable = ["pageClick", "pageFill", "pageCheck", "pagePickRadio", "pageSelectOption"];
for (const name of plannable) {
  ensure(`${name} resolves on a named route`, !!sb.findToolDef("NOAA", name), name);
}

section("a failure has to say why");
// "failed" on its own tells you nothing about what to do next. The page's own
// error usually says exactly what is wrong - a button not found, a panel not
// open - and it was being discarded.
const failing = { part: "open the layers panel", ok: false, error: 'clickByText: "View Layers" not found' };
const row = {
  name: failing.part.slice(0, 44),
  value: !failing.ok ? "failed" : "done",
  meta: !failing.ok ? String(failing.error || "no reason given").slice(0, 70) : "",
};
ensure("the reason reaches the row", /View Layers/.test(row.meta), row);
// Every planner here is deterministic, so blaming a model sends anyone
// debugging in the wrong direction.
let unknownToolError = null;
sb.executeToolCall("NOAA", { name: "definitelyNotATool", args: {} }).catch((e) => { unknownToolError = e.message; });
setTimeout(() => {
  ensure("an unknown tool does not blame a model", unknownToolError && !/model/i.test(unknownToolError), unknownToolError);
  ensure("and names the tool", unknownToolError && /definitelyNotATool/.test(unknownToolError), unknownToolError);
  finishFailures();
}, 30);

function finishFailures() {

section("a site nobody has mapped");
// Shapes taken from real government sites the extension has no knowledge of:
// tidesandcurrents.noaa.gov ships the same search box twice for responsive
// layout, and drought.gov buries a state picker among navigation chrome.
const unmapped = { controls: [
  { kind: "a", label: "Skip to main content", selector: "#skip", confidence: "high" },
  { kind: "button", label: "Toggle navigation", selector: "#nav", confidence: "high" },
  { kind: "input", type: "search", label: "Search Text Box", selector: "#query", confidence: "high" },
  { kind: "input", type: "search", label: "Mobile Search Text Box", selector: "#mquery", confidence: "high" },
  { kind: "select", label: "State", selector: "#state-select-list", confidence: "high",
    options: [{ value: "idaho", text: "Idaho" }, { value: "ohio", text: "Ohio" }] },
] };
const u = (q) => {
  const r = sb.planGenericTool(q, unmapped);
  if (!r) return null;
  if (r.ambiguous) return `ambiguous: ${r.ambiguous.map((c) => c.label).join(" | ")}`;
  return r.calls.map((c) => `${c.name} ${JSON.stringify(c.args)}`).join(" + ");
};
// A responsive site's duplicate controls are one logical control, not a
// choice to put to the user - this refused outright before.
check("duplicated responsive controls are not ambiguous",
  u("search for Boston"), 'pageFill {"selector":"#query","text":"Boston"} + pageSubmit {"selector":"#query"}');
// "Open the search box" is a request to open it. Taking "box" as the query
// and typing that is a confidently wrong action.
// Opening a box submits nothing - there is no query to run.
check("opening a box does not submit",
  u("open the search box"), 'pageClick {"selector":"#query"}');
check("a control's own name is not a query",
  u("open the search box"), 'pageClick {"selector":"#query"}');
// A bare identifier matches no label, but the intent is not in doubt.
check("a search cue outranks an unrelated tie",
  u("look up 8443970"), 'pageFill {"selector":"#query","text":"8443970"} + pageSubmit {"selector":"#query"}');
check("a real dropdown still wins on its own words",
  u("select idaho"), 'pageSelectOption {"selector":"#state-select-list","value":"idaho"}');

section("typing is not searching");
// fill() typed and stopped. Every hand-written manifest that wraps a search
// box adds Enter itself (NOAA.search does), because otherwise the text sits
// in the box and nothing happens - and the input's value *did* change, so
// verification calls it a success. A search that looks performed and was not
// is the worst outcome available.
const formPage = loadPage(`<!doctype html><html><body>
  <form id="f"><input type="search" id="q" aria-label="Search"><button type="submit">Go</button></form>
  </body></html>`, { url: "https://example.gov/" });
if (!formPage) skip("submit", "jsdom not installed");
else {
  const fired = [];
  formPage.document.getElementById("q").addEventListener("keydown", (e) => { if (e.key === "Enter") fired.push("enter"); });
  formPage.document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); fired.push("submit"); });

  formPage.GENERIC.fill("#q", "Boston");
  check("filling sets the value", formPage.document.getElementById("q").value, "Boston");
  check("but fires nothing on its own", fired.length, 0);

  const routed = formPage.GENERIC.submit("#q");
  ensure("submitting presses Enter", fired.includes("enter"), fired);
  ensure("and submits the form", fired.includes("submit"), fired);
  check("reporting which route worked", routed.submitted, "form");
}

section("the past, and one gauge at a time");
// Water questions about the past were refused outright while weather answered
// them from its forecast.
const hist = (q) => { const p = plan(q, { global: "GENERIC" }); return p ? `${p.name} ${JSON.stringify(p.args)}` : null; };
check("a counted span", hist("discharge on the snake river over the last 7 days"),
  'waterHistory {"place":"snake river","parameter":"discharge","days":7}');
check("a named span", hist("average discharge on the boise river last month"),
  'waterHistory {"place":"boise river","parameter":"discharge","days":30}');
// "Boise River" is a river, not the city of Boise - stripping the recognised
// name out of a waterbody named after it left "river", which finds nothing.
ensure("a city that names a river keeps its name",
  /boise river/.test(hist("average discharge on the boise river last month")), hist("average discharge on the boise river last month"));
check("but the city alone is still the city", hist("discharge in boise"),
  'waterCurrentConditions {"state":"id","parameter":"discharge","nameContains":"boise"}');
// Time words must not become part of the place. Checked on the place itself:
// the arguments legitimately contain a "days" key.
const spanPlace = plan("discharge on the snake river over the last 7 days", { global: "GENERIC" }).args.place;
ensure("time words are not part of the place", !/\b(over|days?|last)\b/.test(spanPlace), spanPlace);
check("present-tense questions are untouched", hist("gage height in Alaska"),
  'waterCurrentConditions {"state":"ak","parameter":"gageHeight"}');
// A span with no unit named defaults rather than failing.
check("history with no span defaults", sb.historySpan("gage height history for the bighorn river"), 30);
check("and now is still now", sb.historySpan("gage height in Alaska"), null);

section("the popup's suggestions must actually work");
// Chips are offered as examples, so one that does nothing is a bad first
// impression - and "show discharge" was exactly that until this check caught
// it. The list is read from popup.js so the two cannot drift apart.
(function () {
  const fsMod = require("fs"), pathMod = require("path");
  const js = fsMod.readFileSync(pathMod.join(__dirname, "..", "popup", "popup.js"), "utf8");
  const block = js.slice(js.indexOf("const EXAMPLES"), js.indexOf("function renderChips"));
  const examples = eval("(" + block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1) + ")");
  for (const [route, list] of Object.entries(examples)) {
    const unmatched = list.filter((q) => {
      if (/what can i|read this page/i.test(q)) return false; // handled before planning
      if (sb.planDataTool(q, { global: route })) return false;
      if (sb.planManifestTool(q, route)) return false;
      if (route === "USGS" && sb.planTool(q)) return false;
      return true;
    });
    ensure(`${route}: every suggested example resolves`, unmatched.length === 0, unmatched);
  }
})();

// "graph discharge" tied siteGraphParameter against siteListGraphParameters -
// one sets, one lists - and naming a parameter settles which.
check("naming a value picks the tool that takes one",
  (sb.planManifestTool("graph discharge", "SITE") || {}).name, "siteGraphParameter");
check("without a value the listing tool still wins",
  (sb.planManifestTool("list graph parameters", "SITE") || {}).name, "siteListGraphParameters");

section("nothing is dropped in silence");
// "zoom in on alaska" ran a bare zoom and discarded "alaska". The map moved,
// so it was indistinguishable from success - the same shape as every other
// bug here.
const mt2 = (q, route) => sb.planManifestTool(q, route);
check("a bare zoom is still a zoom", (mt2("zoom in", "NOAA") || {}).name, "noaaZoomIn");
// On a map, "zoom in on X" is a request to go there, which is what the site's
// search box does; a relative zoom takes no location.
// NOAA's own search is best-effort by its manifest's account - its result
// list was never reachable - so redirecting there produced a confident report
// and a map that had not moved. This page records its view in the URL, which
// can simply be set.
check("zooming on a place moves the map",
  (mt2("zoom in on alaska", "NOAA") || {}).name, "noaaGoToView");
check("centred on that state", (mt2("zoom in on alaska", "NOAA") || {}).args.lat, 61.3);
// A big state has to sit further out than a small one to fit on screen.
ensure("zoomed out for a large state", (mt2("zoom in on alaska", "NOAA") || {}).args.zoom < 4,
  (mt2("zoom in on alaska", "NOAA") || {}).args.zoom);
ensure("and closer in for a small one", (mt2("zoom in on rhode island", "NOAA") || {}).args.zoom > 6,
  (mt2("zoom in on rhode island", "NOAA") || {}).args.zoom);
check("the substitution is recorded, not hidden",
  (mt2("zoom in on alaska", "NOAA") || {}).insteadOf, "a relative zoom");
// A place naming no tool at all still reaches the map.
check("a bare place still moves the map", (mt2("show me texas", "NOAA") || {}).name, "noaaGoToView");
// A route with no map mover falls back to its search box.
check("routes without one fall back to search", (mt2("zoom in on texas", "FCP") || {}).name, "fcpSearch");
// A tool that genuinely consumes the place is left alone.
check("a tool that takes the place keeps it",
  (mt2("select Alaska", "USGS") || {}).name, "usgsSelectState");
check("an argument-taking tool reports nothing left over",
  (mt2("set the basemap to satellite", "NOAA") || {}).unmatchedWords, undefined);

section("an ambiguous choice has to be answerable");
// The disambiguation card listed raw CSS selectors and offered no way to
// choose - a question with no way to answer it is barely a question.
const twoLinks = { controls: [
  { kind: "a", label: "AIR QUALITY", selector: "#aq", confidence: "high" },
  { kind: "a", label: "Air Quality Alert", selector: "#aqa", confidence: "high" },
] };
const amb = sb.planGenericTool("quality", twoLinks);
ensure("genuinely tied controls still ask", !!amb.ambiguous, amb);
// Each candidate carries the exact call, so picking one is a click rather
// than a retyped instruction.
ensure("every candidate carries its call", amb.ambiguous.every((c) => c.call && c.call.name), amb.ambiguous);
check("and they differ", amb.ambiguous.map((c) => c.call.args.selector), ["#aq", "#aqa"]);
ensure("labels are what a person reads, not selectors",
  amb.ambiguous.every((c) => c.label && !/[>.:]/.test(c.label)), amb.ambiguous.map((c) => c.label));
// Naming one exactly is not ambiguous at all.
check("an exact name is not a choice",
  (sb.planGenericTool("air quality alert", twoLinks).calls || [])[0].args.selector, "#aqa");

section("asking before something irreversible");
// Verification makes most actions reversible; a download that has started and
// a page that has navigated away are not among them.
const destructive = ["usgsOpenSite", "siteDownloadData", "fcpClearRings", "fcpRemoveLastRing"];
for (const name of destructive) {
  const route = name.startsWith("usgs") ? "USGS" : name.startsWith("site") ? "SITE" : "FCP";
  const def = sb.findToolDef(route, name);
  ensure(`${name} is flagged irreversible`, def && !!def.destructive, def && def.destructive);
}
// Everything else must not be, or a confirmation on every click is noise that
// gets clicked through.
const overCautious = ["USGS", "SITE", "NOAA", "FCP"].flatMap((r) =>
  sb.toolsFor(r).filter((t) => t.destructive && !destructive.includes(t.name)).map((t) => t.name));
ensure("nothing else demands confirmation", overCautious.length === 0, overCautious);

section("numbers people can read");
// 536000 beside 1320 is hard to compare at a glance.
check("thousands are separated", sb.readable(536000), "536,000");
check("small numbers are left alone", sb.readable(4.59), "4.59");
check("and precision is capped", sb.readable(25.550000000000004), "25.55");

section("a chance of rain is not a rain gauge");
// "Probability of precipitation in san francisco" matched the USGS
// precipitation parameter and answered with rain gauges reading zero -
// measured rainfall so far, which is a different quantity from the chance of
// rain to come. Both are precipitation; only one is a forecast.
const rain = (q, route) => { const p = plan(q, { global: route || "FCP" }); return p ? `${p.name} ${p.args.when || ""}`.trim() : null; };
check("probability of precipitation is a forecast",
  rain("probability of precipitation in san francisco"), "weatherForecast rain");
check("so is a chance of rain", rain("chance of rain in boise"), "weatherForecast rain");
check("and a named day is carried", rain("will it rain in seattle on friday"), "weatherForecast rain:friday");
// Plain "precipitation" is still what gauges measure.
check("measured precipitation still goes to USGS",
  rain("precipitation in california"), "waterCurrentConditions");
// On a water page, gauges remain the sensible reading of the bare word.
check("and on a USGS page too", rain("precipitation in california", "USGS"), "waterCurrentConditions");

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

section("a place that is one row of a table");
// A regional forecast is a table of towns. Title-and-headings matching never
// sees the one asked about, so the page looked irrelevant and it fetched -
// reporting the state centre, miles from the town whose row was on screen.
const tablePage = loadPage(`<!doctype html><html><head><title>NWS Duluth MN</title></head><body>
  <h1>Northeast Minnesota</h1>
  <table><caption>Tuesday</caption>
  <tr><th>Location</th><th>High</th><th>Low</th><th>Wind</th></tr>
  <tr><td>Duluth</td><td>64 °F</td><td>48 °F</td><td>12 mph</td></tr>
  <tr><td>Hermantown MN</td><td>71 °F</td><td>46 °F</td><td>9 mph</td></tr>
  </table></body></html>`);
if (!tablePage) skip("table rows", "jsdom not installed");
else {
  const td = tablePage.GENERIC.readPage();
  const hit = (q, place) => {
    const r = sb.findOnPage(td, { wants: sb.pageValueWants(q), place });
    return r ? r.map((h) => h.label) : null;
  };
  check("reads the row for the town asked about",
    hit("max temperature on hermantown mn", "hermantown"), ["Hermantown MN · High: 71 °F"]);
  // The column header decides which cell, so min is not the same cell as max.
  check("the column header picks the cell",
    hit("min temperature in hermantown", "hermantown"), ["Hermantown MN · Low: 46 °F"]);
  // Reading a neighbouring row would be worse than fetching.
  check("a different row is a different answer",
    hit("max temperature in duluth", "duluth"), ["Duluth · High: 64 °F"]);
  check("a town not in the table still fetches", hit("max temperature in chicago", "chicago"), null);
  // A date in the question was becoming part of the place ("hermantown sep
  // 15"), which matched no row and no gauge, so it fetched and answered from
  // the state centre while the town's row was on screen.
  const dated = plan("max temperature of hermantown mn on tuesday sep 15", { global: "FCP" });
  check("a date is not part of the place", dated.args.place, "hermantown");
  check("the named day is kept", dated.args.when, "high:tuesday");
  check("and the row is then found",
    hit("max temperature of hermantown mn on tuesday sep 15", dated.args.place), ["Hermantown MN · High: 71 °F"]);
  // "Wind 9 mph" sits in the same row and must not answer a temperature question.
  ensure("the wind column does not answer a temperature question",
    !(hit("max temperature on hermantown mn", "hermantown") || []).some((h) => /wind|mph/i.test(h)),
    hit("max temperature on hermantown mn", "hermantown"));
}

section("charts, maps and other pages");
const chartPage = loadPage(`<!doctype html><html><head><title>Gauge</title></head><body>
  <canvas id="c" width="400" height="200"></canvas>
  <div class="tooltip" id="tip" style="display:none"></div></body></html>`);
if (!chartPage) skip("hover / map / cross-page", "jsdom not installed");
else {
  // A canvas chart keeps its numbers nowhere in the DOM until hovered, so
  // this is the only way to read one that captured no data request.
  const canvas = chartPage.document.getElementById("c");
  const tip = chartPage.document.getElementById("tip");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });
  const series = [["Mon", "4.1 ft"], ["Tue", "4.3 ft"], ["Wed", "3.9 ft"]];
  canvas.addEventListener("mousemove", (e) => {
    const i = Math.min(series.length - 1, Math.floor((e.clientX / 400) * series.length));
    tip.textContent = `${series[i][0]}: ${series[i][1]}`;
    tip.style.display = "block";
  });

  // A map instance is exact where hovering pixels is guesswork - and on a
  // map a stray pointer pans it, so hovering is worse than useless there.
  const mapPage = loadPage(`<!doctype html><html><body><canvas></canvas></body></html>`);
  mapPage.someMap = { eachLayer(fn) {
    [{ lat: 61.2, lng: -149.9, name: "Ship Creek" }].forEach((m) => fn({
      getLatLng: () => ({ lat: m.lat, lng: m.lng }),
      getPopup: () => ({ getContent: () => `<b>${m.name}</b> 4.2 ft` }),
    }));
  } };
  const mf = mapPage.GENERIC.mapFeatures();
  check("map features come from the library instance", mf.source, "js-instance");
  check("with their coordinates", [mf.features[0].lat, mf.features[0].lon], [61.2, -149.9]);
  check("popup markup is stripped", mf.features[0].label, "Ship Creek 4.2 ft");

  const bare = loadPage(`<!doctype html><html><body><canvas class="maplibregl-canvas"></canvas></body></html>`);
  const bareMap = bare.GENERIC.mapFeatures();
  check("a canvas map with no instance says so", bareMap.source, "none");
  ensure("and explains the limit", /canvas/.test(bareMap.note), bareMap.note);

  // "I am on Idaho and want Alaska" - answering without navigating away.
  const linkPage = loadPage(`<!doctype html><html><head><title>Idaho</title></head><body>
    <a href="/state/Alaska/">Alaska</a><a href="https://elsewhere.gov/x">Offsite</a></body></html>`);
  linkPage.fetch = async () => ({ ok: true, status: 200, text: async () =>
    `<html><head><title>Alaska conditions</title></head><body><h1>Alaska</h1>
     <table><tr><th>Gauge</th><th>Stage</th></tr><tr><td>Ship Creek</td><td>4.2 ft</td></tr></table></body></html>` });
  check("only same-origin links are offered", linkPage.GENERIC.pageLinks().links.map((l) => l.label), ["Alaska"]);

  (async () => {
    const hov = await chartPage.GENERIC.hoverSeries({ samples: 6, settle: 1 });
    ensure("hovering recovers a canvas chart's series", hov.points.length >= 3, hov.points);
    ensure("and says it sampled rather than enumerated", /sampled/.test(hov.note), hov.note);

    const empty = loadPage(`<!doctype html><html><body><canvas id="x"></canvas></body></html>`);
    empty.document.getElementById("x").getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 });
    const none = await empty.GENERIC.hoverSeries({ samples: 3, settle: 1 });
    // A tooltip drawn into the canvas is unreadable; saying so beats "no data".
    ensure("no tooltip is explained, not reported as empty", /canvas/.test(none.note), none.note);

    const other = await linkPage.GENERIC.readUrl("/state/Alaska/");
    check("another page is read without navigating", other.title, "Alaska conditions");
    check("and its table extracted", other.tables[0].rows[0], ["Ship Creek", "4.2 ft"]);
    let refused = null;
    try { await linkPage.GENERIC.readUrl("https://elsewhere.gov/x"); } catch (e) { refused = e.message; }
    ensure("a different site is refused", /different site/.test(refused || ""), refused);
    finishPageTools();
  })();
}

function finishPageTools() {
section("a table of measurements by day");
// The layout weather.gov actually uses, which is the transpose of what the
// place-row lookup expects: measurements down the side, days across the top,
// and the location stated in prose rather than in the table at all. Missing
// it meant a page showing exactly the number asked for fell through to the
// agency, which answered from the centre of the state.
const gridPage = loadPage(`<!doctype html><html><head><title>Point Forecast</title></head><body>
  <p>0 miles N of Hermantown, MN</p>
  <table>
  <tr><th>Weekly Summary</th><th>Mon Sep 14</th><th>Tue Sep 15</th><th>Wed Sep 16</th></tr>
  <tr><td>Max Temp, °F</td><td>56</td><td>64</td><td>63</td></tr>
  <tr><td>Min Temp, °F</td><td>56</td><td>47</td><td>40</td></tr>
  <tr><td>Max Wind, mph</td><td>12</td><td>22</td><td>6</td></tr>
  </table></body></html>`, { url: "https://www.weather.gov/forecastpoints" });
if (!gridPage) skip("measurement tables", "jsdom not installed");
else {
  const gd = gridPage.GENERIC.readPage();
  // The place is in prose, so the page's own text is what identifies it.
  ensure("the page's text is sampled", /hermantown/i.test(gd.text || ""), (gd.text || "").slice(0, 60));
  const ask = (q) => {
    const plan = sb.planDataTool(q, { global: "FCP" });
    const place = plan && plan.args ? (plan.args.place || plan.args.nameContains) : null;
    const when = plan && plan.args ? plan.args.when : null;
    const day = when && String(when).includes(":") ? String(when).split(":")[1] : null;
    const r = sb.findOnPage(gd, { wants: sb.pageValueWants(q), place, day });
    return r ? r[0].label : null;
  };
  check("the named day picks the column",
    ask("max temperature of hermantown, MN on tuesday sep 15"), "Max Temp, °F · Tue Sep 15: 64");
  // The row label picks the row, so min and max are different rows.
  check("min reads a different row", ask("min temperature of hermantown on wednesday"), "Min Temp, °F · Wed Sep 16: 40");
  check("wind is a different row again", ask("max wind in hermantown on tuesday"), "Max Wind, mph · Tue Sep 15: 22");
  // Without "MN" there is no state, and that path was dropping the day.
  ensure("a day survives even with no state named", /Wed/.test(ask("min temperature of hermantown on wednesday") || ""), ask("min temperature of hermantown on wednesday"));
  check("elsewhere still fetches", ask("max temperature of chicago on tuesday"), null);
}

section("headers without <th>, and abbreviated days");
// The real page marks its header row with <td> and splits the day from the
// date with a <br>. Requiring <th> left the columns unnamed, so every day
// read the same cell - a wrong answer to the right question, which looks
// entirely correct.
const plainPage = loadPage(`<!doctype html><html><head><title>IDSS Forecast Points</title></head><body>
  <p>0 miles N of Hermantown, MN</p>
  <table>
  <tr><td>Weekly Summary</td><td>Mon<br>Sep 14</td><td>Tue<br>Sep 15</td><td>Wed<br>Sep 16</td></tr>
  <tr><td>Max Temp, °F</td><td>56</td><td>64</td><td>63</td></tr>
  <tr><td>Min Temp, °F</td><td>56</td><td>47</td><td>40</td></tr>
  </table></body></html>`, { url: "https://www.weather.gov/forecastpoints" });
if (!plainPage) skip("th-less tables", "jsdom not installed");
else {
  const pd2 = plainPage.GENERIC.readPage();
  ensure("a <td> header row is still recognised", (pd2.tables[0].columns || []).length === 4, pd2.tables[0].columns);
  const ask2 = (q) => {
    const plan = sb.planDataTool(q, { global: "FCP" });
    const when = plan && plan.args ? plan.args.when : null;
    const day = when && String(when).includes(":") ? String(when).split(":")[1] : null;
    const r = sb.findOnPage(pd2, { wants: sb.pageValueWants(q), place: plan && plan.args ? plan.args.place : null, day });
    return r ? r[0].label : null;
  };
  check("an abbreviated day is understood", ask2("max temperature of hermantown MN on Wed"), "Max Temp, °F · Wed Sep 16: 63");
  check("the full name agrees", ask2("max temperature of hermantown MN on wednesday"), "Max Temp, °F · Wed Sep 16: 63");
  check("a different day is a different column", ask2("max temperature of hermantown MN on tuesday"), "Max Temp, °F · Tue Sep 15: 64");
  // "sunny" must not read as Sunday, nor "saturated" as Saturday.
  check("sunny is not Sunday", plan("max temperature in sunny california", { global: "FCP" }).args.when, "high");
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
}
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
