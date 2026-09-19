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
// Declared up here, not beside report(): the nested call sites below run
// first, and a `let` declared after them is in the temporal dead zone.
let reported = false;

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
  [...new Set(g("weekly average temperature").calls.map((c) => c.args.selector))].sort(), ["#p-weekly", "#stat", "#var"]);
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
// Picking the option is only half of it. Plenty of dropdowns sit beside a Go
// button and do nothing on change alone, so "click Alaska" left the box
// reading Alaska on the same page it started on. The follow-through stands
// down by itself when the dropdown navigates on its own.
check("a dropdown option is chosen, then followed through",
  act("set the basemap to satellite"), [
    { name: "pageSelectOption", args: { selector: "#base", value: "sat" } },
    { name: "pageSubmit", args: { selector: "#base" } },
  ]);
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
  u("select idaho"), 'pageSelectOption {"selector":"#state-select-list","value":"idaho"} + pageSubmit {"selector":"#state-select-list"}');
// The verb is not what makes it a dropdown - the control is.
check("and clicking it means the same",
  u("click idaho"), u("select idaho"));

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

// The page you're on is read before any agency API, so the same two
// quantities have to be told apart there too - a forecast page prints
// inches and a percentage side by side.
const forecastPage = {
  url: "https://forecast.weather.gov/MapClick.php?lat=37.77&lon=-122.42",
  title: "National Weather Service Forecast for: San Francisco CA",
  headings: ["San Francisco CA"], text: "san francisco ca",
  pairs: [
    { label: "Precipitation last hour", value: "0.00 in" },
    { label: "Chance of precipitation", value: "15%" },
  ],
  readouts: [], labelledNumbers: [], tables: [],
};
// Days across the top, the measurement down the side - the layout that once
// answered a Wednesday question with Tuesday's column.
const forecastTable = { ...forecastPage, pairs: [],
  tables: [{ columns: ["", "Wednesday", "Thursday"], rows: [
    ["Chance of precipitation", "5%", "15%"],
    ["Precipitation", "0.00 in", "0.00 in"],
  ] }],
};
const onPage = (page, q, day) => {
  const hits = sb.findOnPage(page, { wants: sb.pageValueWants(q), place: "san francisco", day: day || null });
  return hits ? hits.map((h) => `${h.label} = ${h.value}`).join(" | ") : null;
};
check("the page's chance is not the page's rainfall",
  onPage(forecastPage, "probability of precipitation in san francisco"), "Chance of precipitation = 15%");
check("and the rainfall is not the chance",
  onPage(forecastPage, "how much rain has fallen in san francisco"), "Precipitation last hour = 0.00 in");
check("a named day picks its column",
  onPage(forecastTable, "chance of rain on thursday in san francisco", "thursday"),
  "Chance of precipitation \u00b7 Thursday: 15% = 15%");
// "PoP" is a column header, never how anyone phrases a question - so it
// matches a row and not an instruction, where it would catch "population".
check("a PoP column reads as a chance", sb.conceptMatches("precipChance", "pop 15%"), true);
check("and not as rainfall", sb.conceptMatches("precipitation", "pop 15%"), false);
check("population is not a forecast", sb.pageValueWants("population of san francisco").length, 0);

section("one table, one place");
// A page can name many places and hold a table about one of them. Matching
// the place anywhere in the body let every name on the page claim that table:
// "denver colorado max temp" and "pueblo max temp" returned the same number
// from the same row, and both looked deliberate.
const idssPage = {
  url: "https://www.weather.gov/forecastpoints/", title: "IDSS Forecast Points",
  headings: ["Boulder Creek at Boulder, CO"],
  text: "Forecast points: Boulder, Denver, Fort Collins, Greeley, Pueblo",
  pairs: [], readouts: [], labelledNumbers: [],
  // One data column on purpose. With several, "no day named" resolves to
  // today's column, and the expected value would change with the day the
  // suite is run - these tests are about which place may claim the table,
  // not about which column wins.
  tables: [{ columns: ["", "Thu Sep 17"], rows: [["Max Temp, \u00b0F", "82"]] }],
};
const fromIdss = (place) => {
  const hits = sb.findOnPage(idssPage, { wants: sb.pageValueWants("max temp"), place, day: null });
  return hits ? hits[0].value : null;
};
check("the heading's place gets the table", fromIdss("boulder"), "82");
check("a place merely listed does not", fromIdss("denver"), null);
check("nor does another one", fromIdss("pueblo"), null);
check("and with no place asked, the table stands", fromIdss(null), "82");
// Prose still has to work where no heading names a place, or two real pages
// break: weather.gov's point forecast names its point in a bare paragraph,
// and an IDSS page names the point you clicked with nothing but "IDSS
// Forecast Points" above it.
check("prose decides when no heading names a place",
  sb.tableIsAbout({ title: "Point Forecast", headings: [], text: "0 miles n of hermantown, mn" }, "hermantown"), true);
check("and an IDSS page is read the same way",
  sb.tableIsAbout({ title: "IDSS Forecast Points", headings: ["IDSS Forecast Points"], text: "hermantown mn max temp" }, "hermantown"), true);
// A heading ending in a state is the page naming its own subject.
check("a state-suffixed heading is a subject",
  sb.locationHeadings({ headings: ["Boulder Creek at Boulder, CO", "Detailed Forecast"] }).length, 1);
check("a generic heading is not",
  sb.locationHeadings({ headings: ["IDSS Forecast Points", "Weekly Summary"] }).length, 0);

section("arithmetic over what the page shows");
// "Average temperature of pine level this week" returned 93 - Thursday's max
// temperature. The row was right and the cell was real, but the words
// "average" and "this week" were dropped without trace, so a question about
// seven days was answered with one of them.
const weekGrid = {
  title: "IDSS Forecast Points", headings: ["IDSS Forecast Points"], text: "pine level nc",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Weekly Summary", "Thu Sep 17", "Fri Sep 18", "Sat Sep 19"], rows: [
    ["Max Temp, °F", "93", "89", "91"],
    ["Min Temp, °F", "70", "68", "69"],
  ] }],
};
const calc = (q) => {
  const agg = sb.aggregateWanted(q);
  const r = agg && sb.aggregateOnPage(weekGrid, { wants: sb.pageValueWants(q), place: "pine level", agg });
  return r ? `${r.statistic} ${r.value}${r.unit} over ${r.over}` : null;
};
check("an average is averaged", calc("average temperature of pine level this week"),
  "average 91.0°F over 3 columns");
check("and it shows every number it used",
  sb.aggregateOnPage(weekGrid, { wants: ["temperature"], place: null, agg: { fn: "mean", word: "average" } }).points.length, 3);

// "Max temp" names the row called Max Temp. Reading it as a calculation
// would answer a different question, so an extreme needs a span before it
// counts as one.
check("a bare extreme is a row, not a calculation", sb.aggregateWanted("max temp"), null);
check("the same extreme over a week is a calculation", sb.aggregateWanted("max temp this week").fn, "max");
check("an average needs no span at all", sb.aggregateWanted("average temperature").fn, "mean");

// A cell that is a dash, a heading or empty is not zero. Averaging it in
// would drag every result toward nothing.
check("a dash is not zero", sb.cellNumber("—"), null);
check("nor is a heading", sb.cellNumber("Max Temp, °F"), null);
check("a thousands separator survives", sb.cellNumber("1,240 cfs"), 1240);
check("a negative survives", sb.cellNumber("-3.5"), -3.5);

// Tables come in both orientations, so the series runs along either axis.
const downColumn = { title: "Gauges", headings: [], text: "",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Site", "Discharge, cfs"], rows: [["A", "100"], ["B", "300"], ["C", "200"]] }] };
const byCol = sb.aggregateOnPage(downColumn, { wants: ["discharge"], place: null, agg: { fn: "sum", word: "total" } });
check("a column is summed down", `${byCol.value} over ${byCol.over}`, "600 over 3 rows");

// A chart's series and a map's features are numbers too.
const series = [{ label: "Sep 14", value: "56" }, { label: "Sep 15", value: "64" }, { label: "Sep 16", value: "63" }];
check("a chart series averages", sb.aggregateOverSeries(series, { fn: "mean", word: "average" }, "temperature").value, "61.0");
check("one point is not a series", sb.aggregateOverSeries(series.slice(0, 1), { fn: "mean", word: "average" }, "x"), null);
// Hovered points arrive as tooltip text, not tidy values.
const hovered = [{ text: "Sep 14: 56 °F" }, { text: "Sep 15: 64 °F" }];
check("tooltip text still yields numbers", sb.aggregateOverSeries(hovered, { fn: "max", word: "highest" }, "temp").value, "64");
// The date in "Sep 14: 56 °F" is a number too, and the nearer one.
check("a date is not the reading", sb.cellNumber("Sep 14: 56 \u00b0F"), 56);
check("even with no unit to go on", sb.cellNumber("Sep 15: 64"), 64);
check("a plain cell is unaffected", sb.cellNumber("93"), 93);

// A calculated number must never read as one that was simply on the page.
const card = sb.computedDisplay(sb.aggregateOnPage(weekGrid, { wants: ["temperature"], place: null, agg: { fn: "mean", word: "average" } }), "IDSS");
check("the card says it calculated", /calculated from 3 columns/.test(card.subtitle), true);
check("and the tool is on every route",
  ["GENERIC", "USGS", "NOAA", "FCP", "SITE"].every((r) => sb.toolsFor(r).some((d) => d.name === "pageCompute")), true);

section("three ways to be confidently wrong");
// Half the state codes are ordinary English words. Matching them without
// regard to case made "Sign in" a location heading, which declared the page
// to be about Indiana and shut off page reading for the whole site.
const heads = (h) => sb.locationHeadings({ headings: [h] }).length;
check("a login link is not Indiana", heads("Sign in"), 0);
check("nor is a zoom control", heads("Zoom in"), 0);
check("and a contact link is not Maine", heads("Contact me"), 0);
check("a state written as a state still counts", heads("Boulder Creek at Boulder, CO"), 1);
check("with or without the comma", heads("2 Miles S Hermantown MN"), 1);

// Stage is measured from each gauge's own datum. The API path refuses to
// average it across gauges; calculating it off a page reached the same
// meaningless number - 0.46 ft and 2004 ft averaging to 669 - by another door.
const stageTable = { title: "Gauges", headings: [], text: "", pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Site", "Gage height, ft"], rows: [["A", "0.46"], ["B", "2004.1"], ["C", "3.2"]] }] };
const stageCol = sb.aggregateOnPage(stageTable, { wants: ["gageHeight"], place: null, agg: { fn: "mean", word: "average" } });
check("stage across gauges is refused", stageCol.value, null);
check("and the refusal says why", /datum/.test(stageCol.refused), true);
check("the card does not show a number",
  sb.computedDisplay(stageCol, "Gauges").stats.length, 0);
// One gauge over time shares a datum, so that average is real.
const overTime = { title: "Site", headings: [], text: "", pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Gage height, ft", "Mon", "Tue", "Wed"], rows: [["Gage height, ft", "3.1", "3.4", "3.2"]] }] };
check("one gauge over time still averages",
  sb.aggregateOnPage(overTime, { wants: ["gageHeight"], place: null, agg: { fn: "mean", word: "average" } }).value, "3.2");

// "Pine Level, NC" is a town; "water level" is a reading. Stripping the
// measurement noun from both turned the town into "Pine" and looked it up.
check("a town keeps its second word", sb.extractPlaceHint("max temp of pine level", {}), "pine level");
check("a measurement does not become one", sb.extractPlaceHint("water level in wyoming", {}), "wyoming");
check("and a bare measurement is still no place", sb.extractPlaceHint("discharge of level", {}), null);

section("zero is not the same as could not look");
// The capability badge reported "any site - 0 controls" on a site that had
// never been enabled. The inventory call had thrown, the error was swallowed,
// and the count of an empty array was published as a finding. Worse, the
// panel only offers "Enable on this site" when the capability call fails -
// so looking successful hid the one button that fixes it.
const blockedCaps = { ok: true, route: "GENERIC", tools: [], pageControls: null,
  pageBlocked: 'not enabled on this site yet. Click "Enable on this site" in the popup first.' };
check("a blocked page reports no count", blockedCaps.pageControls, null);
check("and says why instead", /not enabled/.test(blockedCaps.pageBlocked), true);
// A page that really has nothing still reports a number, which is a finding.
const emptyCaps = { ok: true, route: "GENERIC", tools: [], pageControls: 0, pageBlocked: null };
check("an empty page still counts", emptyCaps.pageControls, 0);
check("and is not called blocked", emptyCaps.pageBlocked, null);

// Every site the extension claims to have verified tools for has to be
// reachable without the user finding a button first, or the tools are
// decorative on a fresh install.
const mf = require(require("path").join(__dirname, "..", "manifest.json"));
const grantedBy = (url) => (mf.host_permissions || []).some((p) =>
  new RegExp("^" + p.replace(/[.]/g, "\\.").replace(/\*/g, ".*")).test(url));
check("USGS state pages are granted at install", grantedBy("https://waterdata.usgs.gov/state/wi"), true);
check("so are monitoring locations", grantedBy("https://waterdata.usgs.gov/monitoring-location/05427718/"), true);
check("so is NOAA water", grantedBy("https://water.noaa.gov/"), true);
check("so are weather.gov forecast points", grantedBy("https://www.weather.gov/forecastpoints"), true);
// Anything else is opt-in by design, not by oversight.
check("an unrelated site is still opt-in", grantedBy("https://example.gov/"), false);

section("the verb is not the instruction");
// "Click Alaska" and "select Alaska" are the same request. A tool's name
// carries one verb - selectState - so scoring against that literal word gave
// the synonym nothing: "select alaska" worked and "click alaska" planned
// nothing at all.
const asked = (q, route) => { const p = sb.planManifestTool(q, route || "USGS"); return p ? `${p.name} ${JSON.stringify(p.args)}` : null; };
const want = asked("select alaska");
check("select is the baseline", want, 'usgsSelectState {"state":"alaska"}');
for (const verb of ["click", "click on", "choose", "pick", "tap", "press", "switch to"]) {
  check(`${verb} means the same`, asked(`${verb} alaska`), want);
}
// The synonym must not survive into the value. Stripping only the literal
// name word left selectState returning {state: "pick alaska"}.
check("the verb never lands in the argument",
  ["click", "pick", "tap", "press"].every((v) => sb.planManifestTool(`${v} alaska`, "USGS").args.state === "alaska"), true);
// Enumerated values work the same way on another route.
const base = asked("set the basemap to satellite", "NOAA");
check("and on NOAA too", asked("click satellite", "NOAA"), base);
// Families stay apart: opening a panel is not setting a value.
check("open is not select", sb.verbFamily("open").includes("select"), false);
check("but click is", sb.verbFamily("click").includes("select"), true);

// The side panel needs Chrome 114. Without a declared minimum the panel
// simply never opens on anything older, with nothing said about why.
const mfv = require(require("path").join(__dirname, "..", "manifest.json"));
check("a minimum Chrome version is declared", mfv.minimum_chrome_version, "114");
// Every build called itself 0.5.0 for thirty commits, so a stale extension
// was indistinguishable from a current one and "did you reload" could not be
// answered by either side. The panel shows the version; the version has to
// move when the extension does.
ensure("the extension declares a version past 0.5.0",
  mfv.version !== "0.5.0" && /^\d+\.\d+/.test(mfv.version), mfv.version);
const panelHtml = require("fs").readFileSync(
  require("path").join(__dirname, "..", "popup", "popup.html"), "utf8");
ensure("and the panel shows it", /id="buildTag"/.test(panelHtml), "no build tag in the panel");

section("a sentence is not a selector");
// pageClick and its neighbours take a real CSS selector, and nothing anyone
// types is one - but the argument is a free string, so scoring filled it with
// the leftover words: "set the basemap to satellite" planned
// pageClick{selector: "basemap satellite"}, reported "click ... done", and
// changed nothing. Verb families made it total, since select, choose, pick
// and set all reach pageClick's own name word.
for (const q of ["click 30 day precipitation", "select 30 day precipitation", "set the basemap to satellite"]) {
  check(`"${q}" is not planned blind`, sb.planManifestTool(q, "GENERIC"), null);
}
// The tools that do know the page still plan normally.
check("a named route is unaffected",
  sb.planManifestTool("select alaska", "USGS").name, "usgsSelectState");
check("and so is an enum on another route",
  sb.planManifestTool("click satellite", "NOAA").name, "noaaSetBasemap");
// Auditing for the rest of the class turned up three more. A radio group's
// name attribute, a URL and a hex colour are all "free strings" by type and
// none of them is anything a person types - each was being filled with
// leftover words, winning the plan, and then failing.
check("a radio group is not guessed", sb.planManifestTool("pick observed radio", "GENERIC"), null);
check("nor is a colour", sb.planManifestTool("set the ring color to blue", "FCP"), null);
check("a real hex still works",
  sb.planManifestTool("set the ring color to #ff0000", "FCP").args.hex, "ff0000");
// A URL cannot survive word-splitting, so nothing that does survive is one.
check("a url is never assembled from words",
  ["pageReadUrl"].includes((sb.planManifestTool("read the url for precipitation", "GENERIC") || {}).name), false);
// The tools that legitimately take words from the sentence are untouched.
for (const [q, route, name] of [
  ["search for boise", "NOAA", "noaaSearch"],
  ["select alaska", "USGS", "usgsSelectState"],
  ["click satellite", "NOAA", "noaaSetBasemap"],
  ["open the layers panel", "NOAA", "noaaOpenLayers"],
  ["download csv", "SITE", "siteDownloadData"],
]) check(`${q} still plans`, sb.planManifestTool(q, route).name, name);

// Selector tools are recognised by their own schema, not by a hand-kept list.
check("a selector tool is detected from its schema",
  sb.needsRealSelector({ parameters: { properties: { selector: { type: "string" } }, required: ["selector"] } }), true);
check("and a value tool is not",
  sb.needsRealSelector({ parameters: { properties: { state: { type: "string" } }, required: ["state"] } }), false);
check("a group is page knowledge too",
  sb.needsRealSelector({ parameters: { properties: { group: { type: "string" } }, required: ["group"] } }), true);
check("and so is a url",
  sb.needsRealSelector({ parameters: { properties: { url: { type: "string" } }, required: ["url"] } }), true);

section("enabling a site you have not enabled");
// "Enable on this site" could not read the URL of any site it had not already
// been enabled on. Without the "tabs" permission chrome.tabs.query omits url
// for a tab the extension holds no host permission for - which is every site
// that button exists for. Enabling needed the URL; the URL needed enabling.
const mfp = require(require("path").join(__dirname, "..", "manifest.json"));
check("the tabs permission is declared", (mfp.permissions || []).includes("tabs"), true);
// It must not have been bought by widening host access instead.
check("and host access stays narrow",
  (mfp.host_permissions || []).some((h) => /^https:\/\/\*\/|^<all_urls>$/.test(h)), false);
check("broad access is still opt-in",
  (mfp.optional_host_permissions || []).includes("https://*/*"), true);
// The panel outlives navigation, so nothing about the current tab may be
// read once and kept.
const panel = require("fs").readFileSync(
  require("path").join(__dirname, "..", "popup", "popup.js"), "utf8");
ensure("the current origin is re-read on navigation",
  /onUpdated[\s\S]{0,200}rememberOrigin/.test(panel), "popup.js caches the origin once");
// A handler bound to a control that no longer exists throws at load and takes
// the whole panel with it, so trimming a debug field could silently break
// Ask. Every id the panel binds has to exist in its markup.
const panelMarkup = require("fs").readFileSync(
  require("path").join(__dirname, "..", "popup", "popup.html"), "utf8");
// Only the ids that get a handler bound to them. A control read or created
// at runtime - the model status line, for one - legitimately has no markup,
// and demanding one would make this a test of the test.
const boundIds = [...new Set([...panel.matchAll(/\bon\("([^"]+)",/g)].map((m) => m[1]))];
const orphans = boundIds.filter((id) => !panelMarkup.includes(`id="${id}"`));
check("every control the panel binds exists", orphans, []);
ensure("and there are some to check", boundIds.length >= 5, boundIds.length);

ensure("and on a tab switch",
  /onActivated\.addListener\(rememberOrigin\)/.test(panel), "no onActivated listener");

section("a river that names itself");
// "North fork elkhorn river discharge" came back as an offer to click two
// unrelated links. Two faults in a row, each of which alone would have been
// enough.
//
// extractPlaceHint required a locational preposition - at, in, on, near, of -
// so a question that simply names a river found no place, and the data
// planner had nothing to plan with.
const wb = (q, ctx) => sb.extractPlaceHint(q, ctx || {});
check("a river names itself without a preposition",
  wb("north fork elkhorn river discharge", { parameterMatched: "discharge" }), "north fork elkhorn river");
check("to the last waterbody word, not the first",
  wb("middle fork salmon river discharge", { parameterMatched: "discharge" }), "middle fork salmon river");
check("a preposition still works", wb("discharge of the boise river", { parameterMatched: "discharge" }), "boise river");
// The rule that stopped "parameter" becoming a river has to survive: this
// needs a real waterbody word, and a control instruction has none.
check("a control instruction is still not a place",
  wb("set the parameter to gage height", { parameterMatched: "gage height" }), null);
check("nor is a question about the page", wb("what is the current state"), null);
// And the whole question now plans as data rather than falling through.
check("so the question plans as data",
  sb.planDataTool("north fork elkhorn river discharge", { global: "NOAA" }).name, "waterFindGauges");

section("the handler itself answers");
// Every other test here drives a planner directly. None of them touches
// chrome.runtime.onMessage -> smartAsk -> respond, which is the only thing
// the extension actually runs. A throw or a missed respond() in that handler
// fails every ask at once and is invisible to all 390 of them.
const realPage = loadPage(
  `<!doctype html><html><head><title>Drought</title></head><body>
     <nav><a href="/skip">Skip to main content</a></nav>
     <a class="nav-link" href="/current">Current Conditions</a>
     <label for="layer">Data layer</label>
     <select id="layer"><option value="cur">Current</option><option value="p30">30-Day Precipitation</option></select>
     <table><tr><th>Gauge</th><th>Max Temp, °F</th></tr>
       <tr><td>Site A</td><td>81</td></tr><tr><td>Site B</td><td>85</td></tr></table>
   </body></html>`, { url: "https://www.drought.gov/" });
if (!realPage) skip("end to end", "jsdom not installed");
else {
  const live = loadBackground({ page: realPage });
  const ask = (q) => live.__ask({ type: "smartAsk", instruction: q });
  const quietly = console.log;
  runAsync(async () => {
    console.log = () => {};                    // the handler logs every ask
    try {
      // A command reaches the page and acts on it.
      const cmd = await ask("select 30 day precipitation");
      console.log = quietly;
      ensure("a command is planned and run", cmd.ok === true, cmd.error || cmd);
      ensure("against a real control", /Applied|done/i.test((cmd.display || {}).title || ""), cmd.display);

      console.log = () => {};
      const caps = await ask("what can I do here");
      console.log = quietly;
      ensure("capabilities answer", caps.ok === true, caps.error || caps);
      ensure("and count the page's controls", caps.pageControls > 0, caps.pageControls);

      console.log = () => {};
      const mcp = await ask("webmcp");
      console.log = quietly;
      ensure("webmcp answers on any page", mcp.ok === true, mcp.error || mcp);
      // A browser without the API still derives tools, and saying only
      // "unavailable" hid the part that works on a site nobody wrote code
      // for. The count must be what the page yielded, not what got
      // registered.
      ensure("and reports tools derived without the API",
        (mcp.webmcp || {}).derived > 0 || /derived/.test((mcp.display || {}).subtitle || ""),
        mcp.webmcp || mcp.display);
      console.log = () => {};
      const capsMcp = await ask("what can I do here");
      console.log = quietly;
      const mcpRow = (capsMcp.display.rows || []).find((r) => r.name === "WebMCP");
      ensure("the capability card counts them too", mcpRow && /\d+ tools/.test(mcpRow.value), mcpRow);
      ensure("and does not just say unavailable", mcpRow && mcpRow.value !== "unavailable", mcpRow);
      check("with its own card", (mcp.display || {}).title, "WebMCP on this page");

      // A page that could not be read has to say why. The reason was being
      // discarded by the catch, so the card said only "could not read this
      // page's controls" - on a page whose controls the badge had counted
      // moments earlier, which reads as nonsense with nothing to act on.
      const broken = loadBackground({ page: realPage });
      broken.chrome.tabs.sendMessage = async () => { throw new Error("timed out waiting for the page bundle to reply"); };
      console.log = () => {};
      const unreadable = await broken.__ask({ type: "smartAsk", instruction: "go to contact" });
      console.log = quietly;
      ensure("an unreadable page says why",
        (unreadable.checked || []).some((c) => /timed out/.test(c)), unreadable.checked);

      // The self-test has to survive whatever it is diagnosing, or it tells
      // you less than the problem did.
      console.log = () => {};
      const diag = await ask("diagnose");
      console.log = quietly;
      ensure("diagnose answers", !!(diag.display && diag.display.rows.length), diag);
      ensure("and names the build", diag.steps.some((x) => x.name === "extension version" && x.state === "ok"), diag.steps);
      ensure("a browser without WebMCP is not a failure",
        !diag.steps.some((x) => x.name === "WebMCP" && x.state === "failed"), diag.steps);

      // The same test, run where the page cannot be reached at all.
      const blind = loadBackground({ page: realPage });
      blind.chrome.tabs.sendMessage = async () => { throw new Error("timed out waiting for the page bundle to reply"); };
      console.log = () => {};
      const broke = await blind.__ask({ type: "smartAsk", instruction: "diagnose" });
      console.log = quietly;
      ensure("it still reports when the page is unreachable",
        broke.steps.some((x) => x.name === "page bundle reachable" && x.state === "failed"), broke.steps);
      ensure("and names the first failure in the headline",
        /page bundle reachable/.test((broke.display || {}).subtitle || ""), (broke.display || {}).subtitle);

      // The last step of the agent loop. A model shown the page's own tools
      // picks one by name - click30DayPrecipitation - and the executor has to
      // know how to run it. It was looking only in TOOL_DEFS, so a correct
      // choice came back as "no tool by that name exists" and the loop was
      // open at the end.
      for (const call of [{ name: "clickCurrentConditions", args: {} }, { name: "readThisPage", args: {} }]) {
        const ran = await live.executeToolCall("GENERIC", call).catch((e) => ({ ok: false, error: e.message }));
        ensure(`a model-chosen page tool runs: ${call.name}`, ran.ok === true, ran.error || ran);
      }
      // And one that does not exist is refused, not invented.
      const bogus = await live.executeToolCall("GENERIC", { name: "notARealTool", args: {} })
        .then(() => null).catch((e) => e.message);
      ensure("an unknown tool is refused", /no tool named/.test(bogus || ""), bogus);

      // "model:" puts a question to the model with the page's own tools,
      // skipping every cheap path. Without it the model is only reached once
      // everything else has failed, so there is no way to find out whether it
      // would have got something right.
      console.log = () => {};
      const forced = await ask("model: select 30 day precipitation");
      console.log = quietly;
      ensure("model: is recognised as a request for the model",
        /model is switched off|still loading|webllm/i.test(
          `${(forced.display || {}).title || ""} ${forced.error || ""} ${forced.plannedBy || ""}`), forced);
      // The same question without the prefix is answered without it.
      console.log = () => {};
      const unforced = await ask("select 30 day precipitation");
      console.log = quietly;
      ensure("and the prefix is what makes the difference",
        unforced.ok === true && unforced.plannedBy !== "webllm", unforced);

      // The model's job is to name one tool, so the prompt should be the
      // tools and almost nothing else. It was 3,136 tokens for that one
      // decision - 2,071 of them an env-vocab table and forty rows of
      // inventory prose, both written when the model still had to build a
      // CSS selector. Prefill on a small model is where the time goes, and
      // "the model is slow" was mostly this.
      const routing = await live.agentTools("GENERIC", "select 30 day precipitation", { max: 12 });
      const catalogue = routing.all.map((t) => {
        const spec = (t.parameters && t.parameters.properties) || {};
        const props = Object.entries(spec).map(([k, v]) =>
          Array.isArray(v.enum) && v.enum.length <= 8 ? `${k}: ${v.enum.join("|")}` : k);
        const gist = String(t.description || "").split(/[.\u2013-]/)[0].trim().slice(0, 60);
        return `${t.name}(${props.join(", ")})${gist ? " - " + gist : ""}`;
      }).join("\n");
      // The model can only pick from what it is shown. !d.run was meant to
      // drop the agency lookups and also dropped pageCompute, so "average
      // reservoir storage" reached a model with no averaging tool in its
      // list and nothing to pick but a wrong answer.
      ensure("the model can reach the one tool that calculates",
        routing.all.some((t) => t.name === "pageCompute"), routing.all.map((t) => t.name));
      ensure("and the agency lookups stay out of the routing list",
        !routing.all.some((t) => /^water|^weather/.test(t.name)), routing.all.map((t) => t.name));
      // Naming it has to work, not just seeing it.
      const computed = await live.executeToolCall("GENERIC", { name: "pageCompute", args: { fn: "mean", of: "max temp" } })
        .catch((e) => ({ ok: false, error: e.message }));
      ensure("and running it by name works", computed.ok !== false, computed.error || computed);

      // The model picks a number; the arguments are filled here. Asking it to
      // write the tool name and every argument spent around thirty decode
      // tokens on a decision carrying about four bits, and decode is most of
      // the wait.
      const computeDef = routing.all.find((t) => t.name === "pageCompute");
      if (computeDef) {
        const filled = live.argsForTool(computeDef, "average reservoir storage",
          live.meaningfulWords("average reservoir storage"));
        // An enum value is a machine's word for it; nobody types "mean".
        check("a human word maps to the schema's enum", filled.fn, "mean");
        // And the word naming the calculation is not part of what is calculated.
        check("the aggregate word stays out of the subject", filled.of, "reservoir storage");
        const misspelt = live.argsForTool(computeDef, "average resevoir storage",
          live.meaningfulWords("average resevoir storage"));
        check("a typo survives into the subject", misspelt.of, "resevoir storage");
      }
      check("total maps to sum",
        live.argsForTool(computeDef, "total storage", live.meaningfulWords("total storage")).fn, "sum");
      check("highest maps to max",
        live.argsForTool(computeDef, "highest storage", live.meaningfulWords("highest storage")).fn, "max");

      // What the model is shown first matters: a small model picking from a
      // numbered list pulls hard toward entry one. Scoring the readers as
      // infinitely relevant put readThisPage at number 1 for every question,
      // so "average reservoir storage" was offered a page dump first and the
      // calculating tool sixth.
      const order = (q) => live.agentTools("GENERIC", q, { max: 12 }).then((k) => k.all.map((t) => t.name));
      const forMaths = await order("average max temp");
      check("a calculation puts the calculating tool first", forMaths[0], "pageCompute");
      ensure("and the readers are kept, at the end",
        forMaths.indexOf("readThisPage") >= forMaths.length - 3, forMaths);
      // A command is unaffected by that prior.
      const forCommand = await order("click current conditions");
      ensure("a command still ranks its own control first",
        /^click/i.test(forCommand[0]), forCommand.slice(0, 3));

      ensure("the routing prompt stays under ~400 tokens",
        catalogue.length < 1600, `${Math.round(catalogue.length / 4)} tokens`);
      ensure("and no page context is bolted on when tools describe the page",
        routing.page.length > 0, "no page tools, so context is still needed");
      // Enums survive the trimming: they are what stops a model inventing a
      // value the page does not offer.
      const withEnum = routing.all.find((t) => Object.values((t.parameters || {}).properties || {})
        .some((v) => Array.isArray(v.enum) && v.enum.length));
      if (withEnum) ensure("an enum is still spelled out", /\|/.test(catalogue) || /: /.test(catalogue), catalogue.slice(0, 120));

      // Nonsense must fail as an answer, not as a crash.
      console.log = () => {};
      const junk = await ask("fly me to the moon");
      console.log = quietly;
      ensure("nonsense is explained, not thrown", junk.ok === false && !!junk.display, junk);
    } finally {
      console.log = quietly;
    }
  });
}

section("the same page on a different machine");
// A question with no day named resolved the column from new Date(), so the
// answer depended on where the reader was sitting: the same forecast table
// read 79 in Los Angeles and 88 in Kiritimati, both confidently. A page that
// labels a column "Today" has said which day it means, and that beats any
// clock.
const dayTable = (cols) => ({ title: "Point Forecast", headings: [], text: "x",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: cols, rows: [["Max Temp, \u00b0F", "82", "79", "88"]] }] });
const columnFor = (cols) => {
  const h = sb.findOnPage(dayTable(cols), { wants: ["high", "temperature"], place: null, day: null });
  return h ? h[0].label : null;
};
check("the page's own label decides the day",
  columnFor(["Weekly Summary", "Today", "Fri Sep 18", "Sat Sep 19"]),
  "Max Temp, \u00b0F \u00b7 Today: 82");
check("and so do the NWS period names",
  columnFor(["Weekly Summary", "This Afternoon", "Tonight", "Saturday"]),
  "Max Temp, \u00b0F \u00b7 This Afternoon: 82");
// With nothing stated, the clock is the only guide left - but whichever
// column it lands on is always named in the answer, so two readers who
// disagree can see why.
const fallback = columnFor(["Weekly Summary", "Thu Sep 17", "Fri Sep 18", "Sat Sep 19"]);
ensure("a clock-chosen column still names itself", /Sep \d+:/.test(fallback || ""), fallback);
// A named day always wins over both.
const named = sb.findOnPage(dayTable(["Weekly Summary", "Today", "Fri Sep 18", "Sat Sep 19"]),
  { wants: ["high", "temperature"], place: null, day: "saturday" });
check("a day the user named beats the page's label", named[0].label, "Max Temp, \u00b0F \u00b7 Sat Sep 19: 88");

section("how much needs a model at all");
// The point of handing a model the page's own tools is that it should rarely
// be needed. This measures that rather than assuming it: a fixture of real
// instruction shapes against pages built like the sites this runs on, scored
// by the deterministic path alone. It asserts a floor, so a change that
// quietly pushes work onto the model shows up here instead of in a latency
// complaint.
const archetypes = {
  mapSite: `<!doctype html><html><body>
    <nav><a href="/">Home</a><a href="/about">About</a><button>Sign in</button></nav>
    <a class="map-tab" href="#p30">30-Day Precipitation</a>
    <a class="map-tab" href="#cur">Current Conditions</a>
    <label for="basemap">Basemap</label>
    <select id="basemap"><option>Streets</option><option>Satellite</option><option>Topographic</option></select>
    <label for="q">Search</label><input id="q" type="search">
    <label for="alerts">Email alerts</label><input id="alerts" type="checkbox">
    </body></html>`,
  dataSite: `<!doctype html><html><body>
    <label for="state">Select a state</label>
    <select id="state"><option>Idaho</option><option>Minnesota</option><option>Alaska</option></select>
    <label for="param">Parameter</label>
    <select id="param"><option>Discharge</option><option>Gage height</option></select>
    <button id="dl">Download data</button>
    <table><tr><th>Day</th><th>Max Temp, °F</th></tr>
      <tr><td>Today</td><td>81</td></tr><tr><td>Friday</td><td>85</td></tr></table>
    </body></html>`,
};
const fixtures = [
  ["mapSite",  "click 30 day precipitation",      "click30DayPrecipitation"],
  ["mapSite",  "select 30 day precipitation",     "click30DayPrecipitation"],
  ["mapSite",  "show current conditions",         "clickCurrentConditions"],
  ["mapSite",  "set the basemap to satellite",    "chooseBasemap"],
  ["mapSite",  "click satellite",                 "chooseBasemap"],
  ["mapSite",  "turn on email alerts",            "toggleEmailAlerts"],
  ["mapSite",  "search for boise",                "searchSearch"],
  ["dataSite", "select minnesota",                "chooseSelectAState"],
  ["dataSite", "choose alaska",                   "chooseSelectAState"],
  ["dataSite", "set the parameter to gage height","chooseParameter"],
  ["dataSite", "download data",                   "clickDownloadData"],
  ["dataSite", "read this page",                  "readThisPage"],
];
const pages = {};
for (const [name, html] of Object.entries(archetypes)) pages[name] = loadPage(html, { url: "https://example.gov/" });
if (!pages.mapSite) skip("model necessity", "jsdom not installed");
else {
  const resolved = [];
  for (const [site, q, want] of fixtures) {
    const page = pages[site];
    const tools = page.GENERIC.pageTools().tools;
    // The deterministic path, scoring the page's own tools exactly as the
    // model would be asked to.
    const pick = sb.planDeclaredTool(q, tools.map((t) => ({ ...t, declaredBy: "page" })));
    resolved.push({ q, want, got: pick ? pick.tool.name : null });
  }
  const right = resolved.filter((r) => r.got === r.want);
  const missed = resolved.filter((r) => r.got !== r.want);
  // A floor, not a target. Below this something has regressed; above it, the
  // model is handling a genuinely small residue.
  ensure(`the scorer alone resolves ${right.length}/${resolved.length} without a model`,
    right.length >= 9, missed.map((m) => `${m.q} -> ${m.got}`));
  // Whatever it cannot resolve must fall through cleanly, not wrongly: a
  // wrong tool run confidently is worse than no tool at all.
  const wrong = missed.filter((m) => m.got !== null);
  ensure("and what it cannot resolve is declined, not guessed",
    wrong.length <= 3, wrong.map((m) => `${m.q} -> ${m.got} (wanted ${m.want})`));
}

section("a real site nobody wrote code for");
// From waterdatafortexas.org, which has no manifest and was never opened
// while this was being built. Its statewide page has a column called
// "Reservoir Storage (acre-ft)" and eight rows that are the same reservoir on
// eight different dates.
const txPage = {
  title: "Statewide reservoir conditions", headings: [], text: "texas reservoirs",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["", "Date", "Percent Full", "Reservoir Storage (acre-ft)"], rows: [
    ["Today", "2026-09-18", "71", "26,810,632"],
    ["Yesterday", "2026-09-17", "71", "26,839,775"],
    ["2 days ago", "2026-09-16", "71", "26,919,558"],
    ["1 week ago", "2026-09-11", "72", "27,081,104"],
    ["1 month ago", "2026-08-18", "73", "27,500,000"],
  ] }],
};
const txAsk = (q) => {
  const agg = sb.aggregateWanted(q);
  if (!agg) return null;
  const subject = sb.meaningfulWords(q).filter((w) => !["total", "sum", "average", "avg", "mean", "highest", "of"].includes(w));
  const match = subject.length ? (label) => subject.every((w) => sb.wordMatchesText(w, label)) : null;
  return sb.aggregateOnPage(txPage, { wants: sb.pageValueWants(q), place: null, agg, match });
};
// The subject is a word this vocabulary has never met, so it has to be matched
// against the page's own wording. Without that the question skipped the page
// and ended up clicking two navigation links - answered by navigating away.
// Typed as it was actually typed. A plain substring match handled the
// correctly spelled version and missed this one, so the fix passed its own
// test and failed the person who reported it.
const misspelt = txAsk("total resevoir storage");
ensure("a typo still finds the column", !!misspelt, "resevoir did not match Reservoir Storage");
const totalled = txAsk("total reservoir storage");
ensure("an unknown subject still finds its column", !!totalled, "no column matched");
// And then the sum is refused, because those rows are eight snapshots of one
// number: adding them gave a statewide total of 219,891,203 acre-ft.
check("summing a time series is refused", totalled.value, null);
ensure("and says what to ask instead", /average/.test(totalled.refused || ""), totalled.refused);
// An average over the same rows is meaningful, and carries the right unit.
const averaged = txAsk("average reservoir storage");
check("an average is allowed", averaged.value !== null, true);
// The rows read 26,803,406 and the answer read 27485497.1 - one quantity in
// two notations, one of them unreadable at that size.
check("and is grouped the way the page writes its numbers",
  /^\d{1,3}(,\d{3})+/.test(averaged.value), true);
check("a page that does not group is left alone",
  sb.formatStat("mean", 61, ["56", "64", "63"]), "61.0");
check("and acre-ft is not ft", averaged.unit, "acre-ft");
// The unit trap on its own: "ft" lives inside "acre-ft".
check("acre-ft reads whole", sb.cellUnit("26,810,632 acre-ft"), "acre-ft");
check("plain ft still reads", sb.cellUnit("3.21 ft"), "ft");
// A table of places, not times, is summable as before.
const byPlace = { ...txPage, tables: [{ columns: ["Reservoir", "Storage"], rows: [
  ["Lake A", "100"], ["Lake B", "200"], ["Lake C", "300"]] }] };
const placeSum = sb.aggregateOnPage(byPlace, { wants: [], place: null,
  agg: { fn: "sum", word: "total" }, match: (l) => l.includes("storage") });
check("a total across places still works", placeSum.value, "600");

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

// With the blind path closed, these reach the planner that reads the page -
// which finds the option inside the dropdown and follows through to it.
const dropPage = loadPage(`<!doctype html><html><body>
  <label for="layer">Map layer</label>
  <select id="layer">
    <option value="cur">Current conditions</option>
    <option value="p30">30 Day Precipitation</option>
  </select><button type="submit">Go</button></body></html>`, { url: "https://example.gov/map" });
if (!dropPage) skip("dropdown options", "jsdom not installed");
else {
  const inv = dropPage.GENERIC.inventory();
  const pick = (q) => {
    const g = sb.planGenericTool(q, inv);
    return g && g.calls ? g.calls.map((c) => `${c.name} ${JSON.stringify(c.args)}`).join(" + ") : null;
  };
  const expected = 'pageSelectOption {"selector":"#layer","value":"p30"} + pageSubmit {"selector":"#layer"}';
  check("an option inside a dropdown is found", pick("select 30 day precipitation"), expected);
  check("clicking it means the same", pick("click 30 day precipitation"), expected);
  check("and so does choosing it", pick("choose 30 day precipitation"), expected);
}

// postMessage structured-clones its payload and a DOM node cannot be cloned.
// click() returned the element it clicked, so a click that had already worked
// came home as "HTMLAnchorElement object could not be cloned" - an action
// reported as a failure after the fact, which is the kind of error people
// retry until something breaks.
const clickPage = loadPage(`<!doctype html><html><body>
  <a id="tab" class="map-tab" href="https://example.gov/p">30-Day Precipitation</a>
  </body></html>`, { url: "https://example.gov/" });
if (!clickPage) skip("click results travel", "jsdom not installed");
else {
  const r = clickPage.GENERIC.click("#tab");
  check("a click says what it clicked", r, { clicked: "a", label: "30-Day Precipitation" });
  ensure("and the answer can be posted home",
    (() => { try { structuredClone(r); return true; } catch (e) { return false; } })(), r);
}

section("WebMCP: what the page says about itself");
// Everything else here reconstructs a page's abilities from its markup. A
// page that registers navigator.modelContext tools has stated them outright,
// with real schemas - so those come first and the guessing never runs.
const declared = [
  { name: "setBasemap", description: "Change the map basemap style",
    inputSchema: { type: "object", properties: { style: { type: "string", enum: ["satellite", "topographic"] } }, required: ["style"] } },
  { name: "clearAllFilters", description: "Remove every filter currently applied",
    inputSchema: { type: "object", properties: {} } },
];
const chose = (q) => { const p = sb.planDeclaredTool(q, declared); return p ? `${p.tool.name} ${JSON.stringify(p.args)}` : null; };
check("a declared tool is matched from plain English", chose("set the basemap to satellite"), 'setBasemap {"style":"satellite"}');
check("with the same verb synonyms as everything else", chose("click satellite"), chose("set the basemap to satellite"));
check("a no-argument tool still matches", chose("clear all filters"), "clearAllFilters {}");
check("and an unrelated question matches nothing", chose("what is the weather in boise"), null);
// pageMcpCall's name must come from the page, so it is never planned blind.
// Ordering is the whole feature. The block sat below both the page reader and
// the data lookups, so a page that declared its tools was scraped anyway.
const bgSrc = require("fs").readFileSync(
  require("path").join(__dirname, "..", "background.js"), "utf8");
ensure("declared tools are consulted before the page is read",
  bgSrc.indexOf('invokeOnActiveTab("mcpTools"') < bgSrc.indexOf("const wants = commandLike"),
  "the WebMCP rung sits below scraping");
// Publishing left no trace in the UI, so the only way to see WebMCP working
// was to open a page written to demonstrate it - which says nothing about the
// site you are actually on. Asking about it is now a question the panel
// answers, on whatever page you happen to be.
const asksAboutMcp = (q) => /\bweb ?mcp\b|\bmodel ?context\b|\b(declared|published) tools\b/i.test(q);
for (const q of ["webmcp", "what webmcp tools are here", "list published tools", "model context"]) {
  check(`"${q}" is answerable`, asksAboutMcp(q), true);
}
check("and an ordinary command is not swallowed", asksAboutMcp("set the basemap to satellite"), false);
check("nor is a data question", asksAboutMcp("north fork elkhorn river discharge"), false);

check("calling a declared tool is not guessed at",
  (sb.planManifestTool("call the mcp tool", "GENERIC") || {}).name !== "pageMcpCall", true);

const mcpPage = loadPage("<!doctype html><html><body><p>plain</p></body></html>", { url: "https://example.gov/" });
if (!mcpPage) skip("WebMCP on a page", "jsdom not installed");
else {
  // A browser without the API says so, rather than failing somewhere later.
  // The API moved from navigator to document. navigator still works but warns
  // on every access, which filled the extension's error list with noise on
  // any page this touches repeatedly.
  const bare = mcpPage.GENERIC.mcpInfo();
  check("an unsupporting browser is reported plainly", bare.available, false);
  ensure("and says what it would need", /modelContext/.test(bare.note), bare.note);

  // Now a browser that has it.
  const registered = [];
  Object.defineProperty(mcpPage.navigator, "modelContext", {
    configurable: true,
    value: { registerTool: (def) => registered.push(def) },
  });
  const out = mcpPage.GENERIC.mcpRegister([
    { name: "pageClick", fn: "click", argOrder: ["selector"],
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
      description: "Click something on the page" },
    { name: "notARealFunction", fn: "nopeNotHere", argOrder: [] },
  ]);
  check("the page's verified controls are published", out.registered, 1);
  check("a tool with no implementation is skipped", out.names, ["pageClick"]);
  check("and the browser actually received it", registered.length, 1);
  ensure("with a schema attached", !!registered[0].inputSchema, registered[0]);

  // Registered tools are readable and runnable even where the API exposes
  // no way to enumerate or invoke from page script.
  const listed = mcpPage.GENERIC.mcpTools();

  check("what was registered can be read back", listed.tools.map((t) => t.name), ["pageClick"]);
  check("and it says where it read them", listed.readFrom, "local registry");

  // Provenance decides the cascade. Tools this extension publishes come back
  // from the browser's own list looking exactly like the page's, and
  // preferring those over reading the page would route our own functions
  // through a longer pipe to reach themselves.
  check("a published tool is marked as ours", listed.tools[0].declaredBy, "extension");
  check("and is not counted as page-declared",
    listed.tools.filter((t) => t.declaredBy === "page").length, 0);
}

// Same again, but where the browser exposes its own enumeration - the case
// where the two provenances arrive side by side and have to be told apart.
const mixedPage = loadPage("<!doctype html><html><body><p>x</p></body></html>", { url: "https://water.noaa.gov/" });
if (!mixedPage) skip("WebMCP provenance", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(mixedPage.navigator, "modelContext", {
    configurable: true,
    value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  // The site's own tool, registered before the extension arrives.
  shelf.push({ name: "siteOwnTool", description: "Something the site declares", inputSchema: { type: "object", properties: {} } });
  mixedPage.GENERIC.mcpRegister([
    { name: "pageClick", fn: "click", argOrder: ["selector"], description: "Click something",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  ]);
  const all = mixedPage.GENERIC.mcpTools();
  check("both are visible", all.tools.length, 2);
  check("the site's is the page's", all.tools.find((t) => t.name === "siteOwnTool").declaredBy, "page");
  check("ours is still ours", all.tools.find((t) => t.name === "pageClick").declaredBy, "extension");
}

// Publishing the extension's own primitives gives an agent half a toolbox it
// cannot use: click(selector) means nothing until it has fetched an inventory
// and built a selector. That is the blind-selector problem this project spent
// its time removing from its own planner, handed to somebody else.
const agentPage = loadPage(`<!doctype html><html><body>
  <a class="map-tab" href="#p30">30-Day Precipitation</a>
  <label for="layer">Data layer</label>
  <select id="layer"><option>Current</option><option>Drought Outlook</option></select>
  <label for="q">Search</label><input id="q" type="search">
  <label for="alerts">Email alerts</label><input id="alerts" type="checkbox">
  </body></html>`, { url: "https://example.gov/" });
if (!agentPage) skip("tools an agent can use", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(agentPage.navigator, "modelContext", {
    configurable: true, value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  const out = agentPage.GENERIC.mcpPublishControls();
  const byName = (n) => shelf.find((t) => t.name === n);

  ensure("controls become tools in their own right", out.registered > 4, out);
  // The whole point: an agent never sees, and never needs, a selector.
  check("no selector reaches the schema",
    shelf.some((t) => JSON.stringify(t.inputSchema).includes("selector")), false);

  // Named verb-first from the page's own words: an agent reads the name
  // before anything else, and a label starting with a digit cannot begin an
  // identifier on its own.
  ensure("named verb-first from its own label", !!byName("click30DayPrecipitation"), shelf.map((t) => t.name));
  ensure("a dropdown says choose", shelf.some((t) => /^chooseDataLayer/.test(t.name)), shelf.map((t) => t.name));
  ensure("a checkbox says toggle", shelf.some((t) => /^toggleEmailAlerts/.test(t.name)), shelf.map((t) => t.name));

  // A dropdown publishes what it will accept, so an agent cannot invent a
  // value the page does not offer.
  const layer = shelf.find((t) => /layer/i.test(t.name));
  check("a dropdown declares its options",
    layer.inputSchema.properties.value.enum, ["Current", "Drought Outlook"]);
  // A checkbox is a boolean, not a click.
  const alerts = shelf.find((t) => /alert/i.test(t.name));
  check("a checkbox takes a boolean", alerts.inputSchema.properties.on.type, "boolean");
  // A search box takes text, and says it can submit.
  const search = shelf.find((t) => /search/i.test(t.name));
  check("a text field takes text", search.inputSchema.required, ["text"]);

  // Driving is half of it. An agent that cannot read the result is blind.
  for (const r of ["readThisPage", "listPageControls", "listPageDataRequests"]) {
    ensure(`${r} is published`, !!byName(r), shelf.map((t) => t.name));
  }

  // Publishing twice must not double-register.
  const again = agentPage.GENERIC.mcpPublishControls();
  check("republishing adds nothing", again.registered, 0);
}

// document.modelContext is the current spelling; navigator.modelContext is
// deprecated and warns on every access.
const docMcp = loadPage("<!doctype html><html><body><p>x</p></body></html>", { url: "https://example.gov/" });
if (!docMcp) skip("modelContext on document", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(docMcp.document, "modelContext", {
    configurable: true, value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  docMcp.GENERIC.mcpRegister([{ name: "pageClick", fn: "click", argOrder: ["selector"], description: "Click",
    parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } }]);
  const got = docMcp.GENERIC.mcpTools();
  check("document.modelContext is used", got.readFrom, "document.modelContext.getTools");
  check("and its tools are found", got.tools.length, 1);
  // Preferred over the deprecated one when both exist.
  Object.defineProperty(docMcp.navigator, "modelContext", {
    configurable: true, value: { registerTool() {}, getTools: () => [{ name: "fromNavigator" }] },
  });
  check("document wins over navigator", docMcp.GENERIC.mcpTools().readFrom, "document.modelContext.getTools");
}

// The older spelling still has to work, for a browser that only has that one.
const navMcp = loadPage("<!doctype html><html><body><p>x</p></body></html>", { url: "https://example.gov/" });
if (!navMcp) skip("modelContext on navigator", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(navMcp.navigator, "modelContext", {
    configurable: true, value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  navMcp.GENERIC.mcpRegister([{ name: "pageClick", fn: "click", argOrder: ["selector"], description: "Click",
    parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } }]);
  check("navigator alone still works",
    navMcp.GENERIC.mcpTools().readFrom, "navigator.modelContext.getTools");
}

// Reloading the extension must actually take effect on tabs that are already
// open. The bridge guarded itself with a boolean, so the first build to touch
// a page owned it: window.GENERIC was replaced on re-injection but the old
// listener stayed, and any fix to the bridge did nothing until the page was
// reloaded too - indistinguishable from a fix that did not work.
const reinject = loadPage("<!doctype html><html><body><a id=a href=\"/x\">Contact</a></body></html>", { url: "https://example.gov/" });
if (!reinject) skip("re-injection replaces the bridge", "jsdom not installed");
else {
  const first = reinject.__wcPageBridge;
  ensure("the bridge handler is reachable", typeof first === "function", typeof first);
  const again = reinject.document.createElement("script");
  again.textContent = require("fs").readFileSync(
    require("path").join(__dirname, "..", "page", "generic-bundle.js"), "utf8");
  const quiet = console.log; console.log = () => {};
  reinject.document.body.appendChild(again);
  console.log = quiet;
  ensure("re-injection replaces it", reinject.__wcPageBridge !== first, "the old listener survived");
  ensure("and the manifest is replaced too", typeof reinject.GENERIC.click === "function", "GENERIC lost");
}

// A shadow DOM made the whole page unreadable. createTreeWalker's
// SHOW_ELEMENT filters what nextNode() returns but not currentNode, which
// starts as the root - and for a shadow tree that root is a ShadowRoot, with
// no tagName and no getAttribute. inventory() threw on the first such page it
// met and the extension reported "could not read this page's controls" on a
// page full of them. USGS state pages are built this way, so it was all of
// them.
const shadowPage = loadPage(`<!doctype html><html><body>
  <div id="host"></div>
  <a href="/x">Plain link</a>
  <script>
    const r = document.getElementById("host").attachShadow({ mode: "open" });
    r.innerHTML = "<button id=inner>Get more information</button><select id=s><option>A</option></select>";
  <\/script></body></html>`, { url: "https://waterdata.usgs.gov/state/Minnesota/" });
if (!shadowPage) skip("shadow DOM", "jsdom not installed");
else {
  let inv = null, threw = null;
  try { inv = shadowPage.GENERIC.inventory(); } catch (e) { threw = e.message; }
  ensure("a shadow DOM does not crash the inventory", !threw, threw);
  ensure("and its controls are found",
    (inv.controls || []).some((c) => c.label === "Get more information"),
    (inv.controls || []).map((c) => c.label));
  ensure("alongside the ones in the light DOM",
    (inv.controls || []).some((c) => c.label === "Plain link"),
    (inv.controls || []).map((c) => c.label));
  // Reading the page has to survive it too.
  let read = null;
  try { read = shadowPage.GENERIC.readPage(); } catch (e) { read = { error: e.message }; }
  ensure("and the page can still be read", !read.error, read.error);
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

      // The generics were dropped from the search, which threw away the word
      // order: NORTH FORK ELKHORN RIVER became "%NORTH ELKHORN F%" and
      // matched none of its two real gauges.
      const nf = await run("waterFindGauges", { place: "north fork elkhorn river", parameter: "discharge" });
      ensure("a generic in the middle of a name survives", nf.result.found > 0, nf.result.found);
      ensure("and the gauges really are that river",
        (nf.result.gauges || []).every((g) => /NORTH FORK ELKHORN/i.test(g.name)), (nf.result.gauges || []).map((g) => g.name));

      const bighorn = await run("waterFindGauges", { place: "bighorn river", parameter: "discharge" });
      ensure("bighorn river is found without a state", bighorn.result.found > 0, bighorn.result.found);

      const wx = await run("weatherConditions", { state: "WI", place: "milwaukee" });
      ensure("weather returns a temperature", wx.result.airTemperatureF !== null, wx.result);
      ensure("weather names its station", !!wx.result.station, wx.result.station);

      const fc = await run("weatherForecast", { state: "WI", place: "milwaukee", when: "week" });
      ensure("forecast returns days", fc.result.days.length > 0, fc.result.days.length);
      ensure("forecast is labelled a forecast", /forecast/i.test(fc.result.display.caveat || ""), fc.result.display.caveat);

      // A town NWS cannot place falls back to the middle of its state - a
      // real forecast for somewhere nobody asked about. Hermantown's high
      // came back as the state centre's, under the heading "hermantown".
      const miss = await run("weatherForecast", { state: "MN", place: "hermantown", when: "high" });
      ensure("a missed place says so in the headline",
        /not found/.test(miss.result.display.title), miss.result.display.title);
      ensure("and still names what it did use",
        /centre of MN/.test(miss.result.display.title), miss.result.display.title);
      // A place it can find must not be tarred with the same label.
      const hit = await run("weatherForecast", { state: "WI", place: "milwaukee", when: "high" });
      ensure("a found place is headlined plainly",
        !/not found/.test(hit.result.display.title), hit.result.display.title);
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

// Every jsdom guard above is written `if (!page) skip(...) else { ...`, and
// those else blocks nest instead of closing - so a single missing jsdom made
// the whole remainder of the file unreachable, the summary included. On a
// clean clone the suite printed a wall of skips, no counts at all, and exited
// 0, which reads as "all fine" to a person and to CI alike.
// The suite is otherwise synchronous; these few need to await. Tracked so the
// summary cannot print before they have finished.
let pendingAsync = 0;
function runAsync(fn) {
  pendingAsync++;
  fn().catch((err) => {
    failed++;
    failures.push({ label: "end to end threw", actual: String((err && err.message) || err), expected: "no throw" });
    console.log(`  FAIL end to end threw: ${(err && err.message) || err}`);
  }).finally(() => { pendingAsync--; });
}

function report() {
  if (reported) return;
  // The end-to-end checks are asynchronous; printing a summary before they
  // finish would report a pass they had not earned.
  if (pendingAsync > 0) { setTimeout(report, 25); return; }
  reported = true;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (skipped) {
    console.log(`\n  ${skipped} section(s) skipped. For the full suite:` +
      `\n    cd extension/test && npm install`);
  }
  for (const f of failures) {
    console.log(`\n  ${f.label}\n    got      ${JSON.stringify(f.actual)}\n    expected ${JSON.stringify(f.expected)}`);
  }
  process.exit(failed ? 1 : 0);
}

// Much of the suite runs asynchronously, so a plain call here would print a
// summary and process.exit() out from under tests still in flight - it cut
// 287 down to 71. An exit hook fires once the event loop has drained, which
// is the only point at which "did the summary ever run" can be answered.
process.on("exit", () => {
  if (reported) return;
  reported = true;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (skipped) {
    console.log(`\n  ${skipped} section(s) skipped. For the full suite:` +
      `\n    cd extension/test && npm install`);
  }
  process.exitCode = failed ? 1 : 0;
});
