/* background.js - the service worker.
 *
 * Eight things live here:
 *   1. NAMED_MANIFESTS - sites with a real, hand-written manifest, checked
 *      first: USGS's state page, USGS's monitoring-location page (SITE),
 *      water.noaa.gov (NOAA), and weather.gov/forecastpoints (FCP), each via
 *      its own page/*-bundle.js (regenerated from the source manifest by
 *      scripts/build-bundles.js, not hand-edited). Anything else routes to
 *      the zero-manifest tier (page/generic-bundle.js, window.GENERIC)
 *      automatically - no per-site entry needed here at all. This is the
 *      actual generalization: adding a new GENERIC-eligible site used to
 *      mean editing this file *and* manifest.json's host_permissions, then
 *      reloading the extension. Now it means clicking "Enable on this site"
 *      in the popup once - see (3).
 *   2. invokeOnActiveTab(fn, args) - checks the site is actually permitted
 *      (chrome.permissions.contains, not just "did we hardcode a route for
 *      it"), injects the bridge + whichever bundle applies, calls
 *      <fn>(...args) on the real page, returns the result. Proven live on
 *      USGS, Drought.gov, EPA, and the National Water Dashboard.
 *   3. planTool(instruction) - a stub stand-in for an LLM, USGS-route only
 *      for now. Plain keyword matching, not a model. It exists to prove
 *      the *shape* of the loop (typed instruction -> a tool call gets
 *      picked -> it actually runs) without needing an API key or spending
 *      anything.
 *   4. ensureOffscreenDocument() - a service worker has no WebGPU access at
 *      all, so the actual WebLLM engine can't run here. It runs in
 *      offscreen/offscreen.js instead, inside a hidden document this
 *      function creates on demand, the one context in an extension that
 *      does have WebGPU. Confirmed working live: model loads, runs, answers.
 *   5. llmPing relay - forwards a test prompt to the offscreen document and
 *      back. Confirmed working. Not tool-calling, just proves the model
 *      loads and answers at all.
 *   6. TOOL_DEFS + llmPlan - WebLLM's version of the real thing, using the
 *      offscreen document. Requires a real (large) one-time model download
 *      and WebGPU. Confirmed loading and answering; tool-calling itself
 *      still mid-test as of this writing.
 *   7. askGemini + geminiPlan - a second, parallel path to the exact same
 *      TOOL_DEFS and the exact same invokeOnActiveTab execution afterward,
 *      calling Google's Gemini API (free tier, needs an API key from
 *      aistudio.google.com/apikey, saved via the popup) instead of a local
 *      model. No download, no WebGPU, no offscreen document - a plain
 *      fetch() from this file. Traded away "fully local" for "instant and
 *      still free." An explicit, separate choice a user opts into (needs a
 *      key), not something smartAsk below falls back to on its own.
 *   8. smartAsk - the actual intended default: try the free, instant
 *      planTool() stub first; only reach for WebLLM if that didn't match,
 *      and only if it has actually finished loading (checked via
 *      offscreen.js's llmStatus, not assumed) - never a silent multi-minute
 *      wait a user didn't ask for. This is the answer to the real tension
 *      in this project's goal: fully local and free, but also easy to use
 *      from the first click, not just eventually. Untested live.
 */

// env-vocab.js lives one directory above extension/ in the source repo -
// extensions can only load files packaged inside their own directory (the
// same reason page/usgs-bundle.js exists as a copy of web-controls.js
// rather than an import), so extension/lib/env-vocab.js is a generated copy
// (see scripts/build-bundles.js), with window.ENV_VOCAB's assignment
// rewritten to globalThis.ENV_VOCAB since a service worker has no `window`.
importScripts("lib/env-vocab.js");

// Every ask and its result is logged to the service worker console, which is
// where anyone debugging an install is told to look. Tests silence it by
// setting this, rather than by replacing console.log - doing that meant a
// run which ended mid-section printed its summary into a no-op and looked
// like it had simply stopped.
const debugLog = (...args) => { if (!globalThis.__wcQuiet) console.log(...args); };

const NAMED_MANIFESTS = [
  { test: /^https:\/\/waterdata\.usgs\.gov\/state\//, bundle: "page/usgs-bundle.js", global: "USGS" },
  { test: /^https:\/\/waterdata\.usgs\.gov\/monitoring-location\//, bundle: "page/site-bundle.js", global: "SITE" },
  { test: /^https:\/\/water\.noaa\.gov\//, bundle: "page/noaa-bundle.js", global: "NOAA" },
  { test: /^https:\/\/(www\.)?weather\.gov\/forecastpoints/, bundle: "page/forecastpoints-bundle.js", global: "FCP" },
];

const GENERIC_BUNDLE = "page/generic-bundle.js";
const FEED_CAPTURE = "page/feed-capture.js";
const FEED_CAPTURE_ID = "wc-feed-capture";
const PUBLISH_TOOLS = "page/publish-tools.js";
const PUBLISH_TOOLS_ID = "wc-publish-tools";

function routeFor(url) {
  return NAMED_MANIFESTS.find((r) => r.test.test(url || "")) || { bundle: GENERIC_BUNDLE, global: "GENERIC" };
}

function originPatternFor(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch (e) {
    return null;
  }
}

async function ensureInjected(tabId, bundle) {
  // isolated world first (the relay), then the page's own world (WC + the
  // manifest that bundle exposes). Re-injecting on every call is wasteful
  // but simple and safe for a proof of concept: both files guard against
  // installing duplicate listeners.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/bridge.js"],
  });
  // GENERIC goes in alongside any named manifest, never instead of it. A
  // hand-written manifest only covers the controls someone thought to map;
  // inventory()/click() cover everything else on the page, which is how a
  // USGS or NOAA page can still answer "click weekly average". The shared
  // bridge resolves a call against whichever global owns the function, named
  // manifests first, so the two coexist rather than compete.
  // feed-capture first: it patches fetch/XHR, and anything the bundles do
  // afterwards should be visible to it. On an already-loaded page this is
  // too late to have caught the page's own startup requests - that is what
  // the document_start registration below is for - but it catches anything
  // the page fetches from here on.
  const files = bundle === GENERIC_BUNDLE
    ? [FEED_CAPTURE, bundle]
    : [FEED_CAPTURE, bundle, GENERIC_BUNDLE];
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files,
  });
}

// Publishing this route's verified tools onto the page, so the site becomes
// usable by any agent that speaks WebMCP - without the site implementing a
// line of it.
//
// This is also what makes the feature testable on a real site. Consuming
// needs a page that declares tools, and no live site does yet, so that half
// can only be exercised against a page written for the purpose. Publishing
// needs nothing from anybody: it runs on water.noaa.gov as it stands.
//
// Best-effort by design. A browser without navigator.modelContext returns a
// count of zero and the extension carries on exactly as before - nothing
// above this depends on it having worked.
async function publishTools(routeGlobal, tabId) {
  // Two sources, and the order matters. A hand-written manifest was verified
  // against the real site, so its tools go first and own their names. The
  // page's own controls fill in everything nobody thought to map - which on
  // an unmapped site is all of it.
  const defs = (TOOL_DEFS[routeGlobal] || [])
    .filter((d) => !d.run && d.fn && !needsRealSelector(d))
    .map((d) => ({ name: d.name, fn: d.fn, argOrder: d.argOrder || [], description: d.description, parameters: d.parameters }));

  const call = (fn, args) => (tabId
    ? invokeOnTab(tabId, fn, args).catch(() => ({ ok: false }))
    : invokeOnActiveTab(fn, args).catch(() => ({ ok: false })));

  const manifest = defs.length ? await call("mcpRegister", [defs]) : { ok: true, result: { registered: 0, names: [] } };
  const page = await call("mcpPublishControls", [{}]);
  const a = (manifest.ok && manifest.result) || { registered: 0, names: [] };
  const b = (page.ok && page.result) || { registered: 0, names: [] };
  return {
    registered: (a.registered || 0) + (b.registered || 0),
    fromManifest: a.registered || 0,
    fromPage: b.registered || 0,
    names: [...(a.names || []), ...(b.names || [])],
  };
}

// Publishing has to happen without anybody asking, or a site is only
// agent-usable once a human has opened this panel on it - which defeats the
// point. Every page load on an origin already granted gets the bundles and
// the tools, whether or not the panel is ever opened.
const PUBLISHED_RECENTLY = new Map();

// Publishing is idempotent but not free. Guarded by the same map the page-load
// path uses, so a page is published to once however it is reached.
async function publishOnce(tabId, routeGlobal) {
  const [tab] = tabId ? [{ id: tabId }] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  const full = await chrome.tabs.get(tab.id).catch(() => null);
  const url = full && full.url;
  if (!url) return;
  if (PUBLISHED_RECENTLY.get(tab.id) === url) return;
  PUBLISHED_RECENTLY.set(tab.id, url);
  await publishTools(routeGlobal, tab.id);
}
async function autoPublish(tabId, url) {
  if (!url || !/^https?:/.test(url)) return;
  const pattern = originPatternFor(url);
  if (!pattern) return;
  // Never prompt from here. An origin the user has not granted is simply
  // left alone - a permission prompt nobody asked for is worse than a site
  // that is not yet agent-usable.
  const granted = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
  if (!granted) return;
  const last = PUBLISHED_RECENTLY.get(tabId);
  if (last === url) return; // a SPA re-announcing the same page
  PUBLISHED_RECENTLY.set(tabId, url);
  try {
    const route = routeFor(url);
    await ensureInjected(tabId, route.bundle);
    const out = await publishTools(route.global, tabId);
    if (out.registered) debugLog(`[webmcp] published ${out.registered} tools on ${url}`);
  } catch (e) { /* a page that cannot be injected is not an error worth raising */ }
}

// Guarded. A listener registered against an API this browser does not have
// throws at the top level of the service worker, which kills the worker
// outright - every ask then fails with no error anyone can see, which is the
// single worst failure this extension has.
if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === "complete" && tab && tab.url) autoPublish(tabId, tab.url);
  });
}
if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => PUBLISHED_RECENTLY.delete(tabId));
}

// A chart asks for its data while the page loads, so an interceptor injected
// when someone finally types a question has already missed it. Registering
// feed-capture as a document_start content script means an enabled site is
// captured from its next load onward, without needing the popup open.
async function registerFeedCapture() {
  try {
    const granted = await chrome.permissions.getAll();
    const origins = (granted.origins || []).filter((o) => /^https?:/.test(o));
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [FEED_CAPTURE_ID] }).catch(() => []);
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [FEED_CAPTURE_ID] });
    if (!origins.length) return;
    const drop = await chrome.scripting.getRegisteredContentScripts({ ids: [PUBLISH_TOOLS_ID] }).catch(() => []);
    if (drop.length) await chrome.scripting.unregisterContentScripts({ ids: [PUBLISH_TOOLS_ID] });
    await chrome.scripting.registerContentScripts([{
      id: FEED_CAPTURE_ID,
      matches: origins,
      js: [FEED_CAPTURE],
      runAt: "document_start",
      world: "MAIN",
      allFrames: false,
    }, {
      // Publishing, on the page, without the service worker in the loop.
      // It ran through tabs.onUpdated and a message round trip, so a site
      // became agent-usable only once three separate things had gone right.
      // At document_end in the MAIN world it needs none of them - and it
      // costs nothing where the browser has no modelContext, because the
      // script checks for that before walking anything.
      id: PUBLISH_TOOLS_ID,
      matches: origins,
      js: [GENERIC_BUNDLE, PUBLISH_TOOLS],
      runAt: "document_end",
      world: "MAIN",
      allFrames: false,
    }]);
  } catch (e) {
    // Registration is an enhancement: without it capture still works for
    // requests made after an ask, just not for the page's startup load.
    console.log("[feed-capture] could not register at document_start:", String((e && e.message) || e));
  }
}
// Clicking the toolbar icon opens the side panel rather than a popup. A
// popup is destroyed the moment it loses focus - clicking the page, another
// tab - which is the constraint the ask-history mechanism exists to work
// around. A panel stays open beside the page, so a slow answer has somewhere
// to land and the page can be watched while it changes.
chrome.runtime.onInstalled.addListener(() => {
  if (!chrome.sidePanel) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.log("[sidePanel]", String((e && e.message) || e)));
});

chrome.runtime.onStartup.addListener(registerFeedCapture);
chrome.runtime.onInstalled.addListener(registerFeedCapture);
chrome.permissions.onAdded.addListener(registerFeedCapture);
chrome.permissions.onRemoved.addListener(registerFeedCapture);

// The same call, aimed at a named tab rather than whichever is in front -
// autopublishing runs on a page load that may not be the active tab.
async function invokeOnTab(tabId, fn, args) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url) throw new Error("no such tab");
  const pattern = originPatternFor(tab.url);
  if (!pattern) throw new Error("can't determine this page's origin");
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) throw new Error("not enabled on this site yet");
  const route = routeFor(tab.url);
  await ensureInjected(tabId, route.bundle);
  const result = await chrome.tabs.sendMessage(tabId, { type: "call", fn, args });
  return { ...result, calledOn: route.global };
}

async function invokeOnActiveTab(fn, args) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) throw new Error("no active tab");
  const pattern = originPatternFor(tab.url);
  if (!pattern) throw new Error("can't determine this page's origin");
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) {
    throw new Error(`not enabled on this site yet. Click "Enable on this site" in the popup first.`);
  }
  const route = routeFor(tab.url);
  await ensureInjected(tab.id, route.bundle);
  const result = await chrome.tabs.sendMessage(tab.id, { type: "call", fn, args });
  return { ...result, calledOn: route.global }; // which manifest actually ran, for the popup log
}

// Stub planner: instruction text -> { fn, args } on the USGS manifest, or
// null if nothing matched. Ordered rules, first match wins. Nowhere near
// what a real model would handle (no real language understanding, no
// argument extraction beyond what's baked into each rule), but it proves
// the loop end to end with zero cost and zero external dependency.
const PLANNER_RULES = [
  { test: /gage height|gauge height|\bstage\b/i, fn: "setParameter", args: ["gage height"] },
  { test: /discharge|streamflow|\bflow\b/i, fn: "setParameter", args: ["discharge"] },
  { test: /water temp|\btemperature\b|\btemp\b/i, fn: "setParameter", args: ["water temperature"] },
  { test: /water level|groundwater/i, fn: "setParameter", args: ["water level"] },
  { test: /huc.?8/i, fn: "groupBy", args: ["huc8"] },
  { test: /huc.?6/i, fn: "groupBy", args: ["huc6"] },
  { test: /\bcounty\b/i, fn: "groupBy", args: ["county"] },
  { test: /hide.*map/i, fn: "setMap", args: [false] },
  { test: /show.*map/i, fn: "setMap", args: [true] },
  { test: /state|status|summary|current/i, fn: "getState", args: [] },
];

function planTool(instruction) {
  // "select Alaska" / "switch to Montana" - the state name is the argument,
  // which the static rules below can't express. Checked first because
  // "show Texas" would otherwise fall into the getState catch-all rule.
  // planDataTool has already run by this point and claimed anything that
  // named a measurement too, so a bare state here means navigation.
  if (/\b(?:select|switch|go|change|jump|view|show|open)\b/i.test(instruction)) {
    const target = findStateInText(instruction);
    if (target) return { fn: "selectState", args: [target.name] };
  }
  for (const rule of PLANNER_RULES) {
    if (rule.test.test(instruction)) return { fn: rule.fn, args: rule.args };
  }
  return null;
}

// The data-tool equivalent of planTool: recognizes a question like "what's
// the gage height in Alaska" with no model at all, which matters because this
// is the tier that works on every machine regardless of GPU or download.
// Heuristic, deliberately: naming BOTH a state and a measurement is a strong
// signal of a data question, since control instructions ("select Alaska",
// "set the parameter to gage height") almost never mention both at once.
// Anything subtler is what the model tier is for.
// Words that carry no location information, so whatever survives them is
// probably the river or place the person actually named.
// Filler words that are also found inside real place names, kept when the
// word before them is not itself filler.
const NAMEABLE_FILLER = new Set(["level", "levels", "depth", "rate", "site", "station"]);

const PLACE_FILLER = new Set([
  "the", "a", "an", "at", "in", "on", "of", "for", "near", "around", "by",
  "and", "or", "is", "are", "was", "what", "whats", "how", "show", "me", "my",
  "tell", "give", "get", "find", "current", "currently", "latest", "now",
  "today", "average", "avg", "mean", "median", "high", "highest", "low",
  "lowest", "max", "maximum", "min", "minimum", "level", "levels", "reading",
  "readings", "value", "values", "data", "right", "please", "like", "would",
  "amount", "amounts", "total", "totals", "rate", "depth", "condition",
  "conditions", "status", "report", "much", "many", "there", "its",
  "estimate", "estimates", "estimated", "forecast", "observed", "recent",
  "measurement", "measurements", "gauge", "gage", "station", "site",
  "weather", "climate", "outside", "air", "currently", "conditions",
  "windy", "hot", "cold", "humid", "warm", "cool", "it", "is", "how",
  "temperature", "temp", "humidity", "wind", "pressure", "dewpoint",
  // Time and statistic words. "Milwaukee weekly temperature average" was
  // taking "weekly" as the place and reporting the centre of Wisconsin.
  "weekly", "daily", "monthly", "hourly", "yearly", "annual", "annually",
  "week", "weeks", "month", "months", "year", "years", "day", "days",
  "over", "during", "since", "ago", "night", "nights", "tonight", "tomorrow",
  "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "weekend", "next", "this", "last", "past", "coming",
  // Dates. "max temperature of hermantown mn on tuesday sep 15" was taking
  // "hermantown sep 15" as the place, which matched no table row and no
  // gauge, so it fell through to the agency and answered from the state
  // centre while the town's row sat on screen.
  "jan", "january", "feb", "february", "mar", "march", "apr", "april", "may",
  "jun", "june", "jul", "july", "aug", "august", "sep", "sept", "september",
  "oct", "october", "nov", "november", "dec", "december", "am", "pm",
]);

// Pulls the place out of an instruction by elimination: strip the parts we
// positively identified (the state, the measurement) and the filler, and
// whatever meaningful words remain are the river or town being asked about.
// "gage height in wyoming at big sandy river" -> "big sandy river", which is
// exactly what USGS's gauge names contain, so it works as a name filter.
function extractPlaceHint(instruction, { stateMatched, parameterMatched, cityMatched } = {}) {
  let t = (instruction || "").toLowerCase();
  // "Boise River" is a river, not the city of Boise. Stripping the recognised
  // name out of a waterbody named after it leaves "river", which finds
  // nothing. Applies to whichever field matched it - a city often supplies
  // the state, in which case it is stripped as the state instead.
  const namesAWaterbody = (phrase) => phrase && new RegExp(
    "\\b" + String(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\s+(river|creek|lake|bay|slough|fork|bayou|reservoir|brook|run)\\b", "i").test(t);
  if (namesAWaterbody(cityMatched)) cityMatched = null;
  if (namesAWaterbody(stateMatched)) stateMatched = null;
  for (const phrase of [stateMatched, parameterMatched, cityMatched]) {
    if (!phrase) continue;
    t = t.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
  }
  // Only words following a locational preposition count as a place. Without
  // this, leftover instruction words became one: "set the parameter to gage
  // height" searched the country for a river called "parameter", and "what is
  // the current state" for one called "state" - both control instructions
  // turned into data queries. "at big sandy river" is a place; "to gage
  // height" is not.
  let tail = t.match(/\b(?:at|in|on|near|along|around|for|of)\s+(.+)$/);
  if (!tail) {
    // A waterbody names itself. "North Fork Elkhorn River discharge" carries
    // no preposition, and requiring one meant the most natural way anybody
    // names a river resolved to no place at all - the question then fell
    // past the data planner entirely and came back as an offer to click an
    // unrelated link.
    //
    // Safe because it needs an actual waterbody word: "set the parameter to
    // gage height" has none, so the rule that stops "parameter" becoming a
    // river still holds.
    const named = Array.from(WATERBODY_GENERICS)
      .filter((w) => w.length > 3 && !["the", "near", "above", "below"].includes(w))
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    // Greedy to the LAST waterbody word, not the first: "north fork elkhorn
    // river" is one name, and stopping at "fork" searched for a river called
    // North Fork.
    const wb = t.match(new RegExp(`\\b([a-z0-9'\\- ]*\\b(?:${named.join("|")}))\\b`));
    if (!wb) return null;
    tail = [wb[0], wb[1]];
  }
  const raw = tail[1].split(/[^a-z0-9]+/).filter(Boolean);
  const words = raw.filter((w, i) => {
    if (w.length <= 1 || /^\d+$/.test(w)) return false;
    if (!PLACE_FILLER.has(w)) return true;
    // A measurement noun can also be half a town's name. "Pine Level, NC" is
    // a place; "water level" is a reading. What separates them is what comes
    // before: an ordinary word makes it a name, a measurement word does not.
    // Dropping it turned Pine Level into Pine and searched for the wrong town.
    return NAMEABLE_FILLER.has(w) && i > 0 && !PLACE_FILLER.has(raw[i - 1]);
  });
  return words.length ? words.join(" ") : null;
}

// Which kind of measurement a bare word like "temperature" means depends on
// the page you're asking from: on weather.gov it's the air, on a USGS gauge
// page it's the water. env-vocab lists "temperature" and "temp" as water
// synonyms because it was written for USGS, which is right there and wrong on
// a forecast site - so the route settles it rather than the word alone.
const WATER_ROUTES = new Set(["USGS", "SITE", "NOAA"]);

// How far back a question reaches, in days, or null if it is about now.
// Water questions about the past were refused outright while weather answered
// them from its forecast.
const HISTORY_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

function historySpan(text) {
  const t = String(text || "");
  const counted = t.match(/\b(?:last|past|previous|over the last|over the past)\s+(\d+)\s*(day|week|month|year)s?\b/i)
    || t.match(/\b(\d+)[- ](day|week|month|year)s?\b/i);
  if (counted) return (Number(counted[1]) || 1) * (HISTORY_UNIT_DAYS[counted[2].toLowerCase()] || 1);
  const named = t.match(/\b(?:last|past|previous)\s+(week|month|year)\b/i);
  if (named) return HISTORY_UNIT_DAYS[named[1].toLowerCase()];
  if (/\bhistory\b|\bhistorical\b|\btrend\b|\bover time\b/i.test(t)) return 30;
  return null;
}

function planDataTool(instruction, route) {
  const text = instruction || "";
  const routeGlobal = (route && route.global) || "GENERIC";
  const bareTemperature = /\btemp(erature)?\b/i.test(text) && !/\bwater\s+temp/i.test(text) && !/\bair\s+temp/i.test(text);
  const wantsWeather = /\bhumidity\b|\bdew ?point\b|\bwind\b|\bbarometric\b|\bpressure\b|\bweather\b|\bair temp\w*\b|\bhow (?:hot|cold|windy|humid)\b/i.test(text)
    || /\bprobability of precip\w*\b|\bchance of (rain|precip\w*|showers|storms)\b|\bwill it (rain|snow)\b|\bforecast\b/i.test(text)
    || (bareTemperature && !WATER_ROUTES.has(routeGlobal));

  const city = findCityInText(text);
  const namedState = findStateInText(text);
  // "Kansas City" is in Missouri, not Kansas, and "Oklahoma City" is its own
  // place - when the city name contains the state name, the longer match is
  // the one that was meant, so the city wins. Otherwise an explicit state
  // wins, since "omaha, iowa" is the asker's call to make.
  const cityOverridesState = city && namedState && city.matched.includes(namedState.matched);
  const state = cityOverridesState
    ? { name: city.city, code: city.code, matched: city.matched }
    : namedState || (city && { name: city.city, code: city.code, matched: city.matched });
  if (!state) {
    // Every one of these APIs is state-scoped, so a river with no state can't
    // be looked up - USGS has no national name search. Recognizing that the
    // question was well-formed but under-specified lets smartAsk ask for the
    // missing piece instead of reporting a flat failure.
    // A named river with no state used to be a dead end. USGS can be asked
    // where its own gauges are, which beats any hand-kept place table, so
    // this is answerable after all - and often without needing the state.
    const parameter = findParameterInText(text);
    const place = extractPlaceHint(text, { parameterMatched: parameter && parameter.matched });
    if (!place) return null;

    // Checked here too: a question naming only a river has no state, and
    // returned from this branch before ever reaching the check below.
    const pastHere = historySpan(text);
    if (pastHere && parameter) {
      return { name: "waterHistory", args: { place, parameter: parameter.canonical, days: pastHere } };
    }

    // A weather question about an unrecognized place stays a weather
    // question - weatherConditions resolves the state from the place itself
    // rather than falling back to water data for want of a state.
    //
    // The time has to survive too. Dropping it here meant "min temperature of
    // hermantown on wednesday" lost the day, and a table lookup then read
    // whichever column came first - yesterday's.
    if (wantsWeather) {
      const when = forecastWhen(text);
      return when
        ? { name: "weatherForecast", args: { place, when } }
        : { name: "weatherConditions", args: { place } };
    }
    return {
      name: "waterFindGauges",
      args: { place, ...(parameter ? { parameter: parameter.canonical } : {}) },
    };
  }

  // Order matters: "near flood stage" contains "stage", which is also a
  // gage-height synonym, so flooding has to be checked before parameters.
  // Always the code, never the display name - a city-derived "state" carries
  // the city's own name, which resolveStateCode would reject.
  if (/\balerts?\b|\bwarnings?\b|\bwatch(es)?\b|\badvisor(y|ies)\b/i.test(text)) {
    return { name: "waterAlerts", args: { state: state.code, floodOnly: /flood/i.test(text) } };
  }
  if (/\bflood(ing|ed)?\b|\bhigh water\b/i.test(text)) {
    return { name: "waterFloodStatus", args: { state: state.code } };
  }

  // Weather before water: "air temperature" and "water temperature" share a
  // word, and humidity/wind/pressure have no water equivalent at all, so the
  // weather cues have to be checked first or they'd resolve to a water
  // parameter or to nothing.
  //
  // A bare "temperature", qualified by neither "air" nor "water", is decided
  // by where it was asked: a water page means the water, anywhere else means
  // the air, which is what the word means in ordinary use.
  if (wantsWeather) {
    // The city wins over the leftovers, not the other way round: when a city
    // supplied the state, its own name is stripped as the state, so whatever
    // survives is usually a stray word ("weekly"), and preferring it lost
    // Milwaukee entirely.
    const placeHint = extractPlaceHint(text, {
      stateMatched: state.matched,
      cityMatched: city && city.matched,
    });
    const place = (city && city.city) || placeHint;
    const when = forecastWhen(text);
    return {
      name: when ? "weatherForecast" : "weatherConditions",
      args: { state: state.code, ...(place ? { place } : {}), ...(when ? { when } : {}) },
    };
  }

  const parameter = findParameterInText(text);
  if (!parameter) return null;

  // Strip the city as it was actually typed - which may be misspelled - so a
  // typo can't survive into the filter. What's left is any further place
  // detail ("big sandy river"); if nothing is, the city's correct spelling
  // is the filter, since that's the form gauge names actually use.
  let place = extractPlaceHint(text, {
    stateMatched: state.matched,
    parameterMatched: parameter.matched,
    cityMatched: city && city.matched,
  });
  if (!place && city) place = city.city;

  const past = historySpan(text);
  if (past && place) {
    return { name: "waterHistory", args: { place, parameter: parameter.canonical, days: past } };
  }
  // A named river beats a city: "gage height in wyoming at big sandy river"
  // is asking about that river, not about Wyoming generally. Falls back to
  // statewide if the name matches no gauge.

  return {
    name: "waterCurrentConditions",
    args: {
      state: state.code,
      parameter: parameter.canonical,
      ...(place ? { nameContains: place } : {}),
    },
  };
}

// Real tool definitions for the WebLLM planner, one set per route. Same
// tools and descriptions as webmcp-register.js's navigator.modelContext
// versions, reshaped for WebLLM's OpenAI-compatible function-calling format
// (type: "function", function: {name, description, parameters}) instead of
// the W3C draft's shape - same underlying schemas either way. argOrder maps
// the named arguments a tool-calling model returns (an object, since that's
// what JSON Schema properties describe) back to the positional array
// invokeOnActiveTab/the page bridge actually expects.
const TOOL_DEFS = {
  USGS: [
    {
      name: "usgsSetParameter", fn: "setParameter", argOrder: ["parameter"],
      description: "Set which water parameter is shown on this USGS state map (discharge, gage height, water level, water temperature, or all).",
      parameters: { type: "object", properties: { parameter: { type: "string", description: "e.g. discharge, gage height, water temperature, water level, all" } }, required: ["parameter"] },
    },
    {
      name: "usgsGroupBy", fn: "groupBy", argOrder: ["groupBy"],
      description: "Group the map's stream sites by county, HUC-8 subbasin, or HUC-6 basin.",
      parameters: { type: "object", properties: { groupBy: { type: "string", enum: ["county", "huc8", "huc6"] } }, required: ["groupBy"] },
    },
    {
      name: "usgsSetRecency", fn: "setRecency", argOrder: ["recency"],
      description: "Filter sites to only those with data in the last 120 days, or show all years of historical data.",
      parameters: { type: "object", properties: { recency: { type: "string", enum: ["120 days", "all"] } }, required: ["recency"] },
    },
    {
      name: "usgsGetState", fn: "getState", argOrder: [],
      description: "Read the current parameter, grouping, sort order, recency filter, and map visibility on this page.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "usgsSelectState", fn: "selectState", argOrder: ["state"],
      description: "Switch this page to a different US state or territory, e.g. 'select Alaska' while viewing Idaho. Navigates the page to that state's stream gauges.",
      parameters: { type: "object", properties: { state: { type: "string", description: "state or territory name, e.g. Alaska" } }, required: ["state"] },
    },
    {
      name: "usgsListParameters", fn: "listParameters", argOrder: [],
      description: "List the water parameters this page can display, and which one is currently selected.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "usgsSortBy", fn: "sortBy", argOrder: ["order"],
      description: "Change the sort order of the site list.",
      parameters: { type: "object", properties: { order: { type: "string", enum: ["name-ascending", "name-descending", "id-ascending", "id-descending"] } }, required: ["order"] },
    },
    {
      name: "usgsSetMap", fn: "setMap", argOrder: ["visible"],
      description: "Show or hide the map on this page.",
      parameters: { type: "object", properties: { visible: { type: "boolean" } }, required: ["visible"] },
    },
    {
      name: "usgsSelectCounty", fn: "selectCounty", argOrder: ["county"],
      description: "Filter the page to a single county. Only works when the page is grouped by county (see usgsGroupBy).",
      parameters: { type: "object", properties: { county: { type: "string", description: "county name, e.g. Ada" } }, required: ["county"] },
    },
    {
      name: "usgsListDataTypes", fn: "listDataTypes", argOrder: [],
      description: "List the data-type filter checkboxes available on this page and which are checked.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "usgsToggleDataType", fn: "toggleDataType", argOrder: ["dataType", "on"],
      description: "Check or uncheck one data-type filter, by USGS parameter code or name.",
      parameters: { type: "object", properties: { dataType: { type: "string", description: "e.g. 00060 or discharge" }, on: { type: "boolean" } }, required: ["dataType"] },
    },
    {
      name: "usgsSetDataTypeMatch", fn: "setDataTypeMatch", argOrder: ["match"],
      description: "Require sites to have all of the selected data types, or at least one of them.",
      parameters: { type: "object", properties: { match: { type: "string", enum: ["all", "any"] } }, required: ["match"] },
    },
    {
      name: "usgsOpenSite", fn: "openSite", argOrder: ["siteId"], destructive: "leaves this page",
      description: "Navigate away from this page to one gauge's own monitoring-location page, by USGS site id.",
      parameters: { type: "object", properties: { siteId: { type: "string", description: "USGS site number, e.g. 13206000" } }, required: ["siteId"] },
    },
  ],
  SITE: [
    {
      name: "siteListGraphParameters", fn: "listGraphParameters", argOrder: [],
      description: "List the water parameters available to graph on this USGS monitoring-location page, and which one is currently selected.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "siteGraphParameter", fn: "graphParameter", argOrder: ["parameter"],
      description: "Switch the graph on this USGS monitoring-location page to a different water parameter.",
      parameters: { type: "object", properties: { parameter: { type: "string", description: "e.g. discharge, gage height, water temperature, specific conductance, dissolved oxygen, pH, turbidity, precipitation" } }, required: ["parameter"] },
    },
    {
      name: "siteSetTimeSpan", fn: "setTimeSpan", argOrder: ["span"],
      description: "Set the graph's time span to a quick preset.",
      parameters: { type: "object", properties: { span: { type: "string", enum: ["7 days", "30 days", "1 year"] } }, required: ["span"] },
    },
    {
      name: "siteSetScale", fn: "setScale", argOrder: ["scale"],
      description: "Set the graph's y-axis scale.",
      parameters: { type: "object", properties: { scale: { type: "string", enum: ["linear", "log"] } }, required: ["scale"] },
    },
    {
      name: "siteViewTabularData", fn: "viewTabularData", argOrder: [],
      description: "Switch this monitoring-location page to show the data as a table instead of a graph.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "siteViewRelatedGraphs", fn: "viewRelatedGraphs", argOrder: [],
      description: "Show related graphs for this monitoring location.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "siteExpandAllDataCollections", fn: "expandAllDataCollections", argOrder: [],
      description: "Expand every collapsed data-collection section on this page.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "siteSetDateRange", fn: "setDateRange", argOrder: ["start", "end"],
      description: "Set a custom start and end date for the graph. Opens the custom date-range panel itself.",
      parameters: { type: "object", properties: { start: { type: "string", description: "e.g. 2024-01-15" }, end: { type: "string", description: "optional end date, e.g. 2024-06-30" } }, required: ["start"] },
    },
    {
      name: "siteSetDaysBefore", fn: "setDaysBefore", argOrder: ["days"],
      description: "Set the graph to show the given number of days before today. Opens the custom date-range panel itself.",
      parameters: { type: "object", properties: { days: { type: "number" } }, required: ["days"] },
    },
    {
      name: "siteDownloadData", fn: "downloadData", argOrder: ["sets"], destructive: "starts a file download",
      description: "Download data from this monitoring location as a file. Opens the download dialog itself.",
      parameters: { type: "object", properties: { sets: { type: "array", items: { type: "string", enum: ["data", "location", "metadata"] }, description: "which data sets to include; defaults to ['data']" } } },
    },
  ],
  NOAA: [
    {
      name: "noaaMapNote", fn: "mapNote", argOrder: [],
      description: "Explain why individual map markers/gauges on this page can't be clicked directly (the map renders to a canvas, not clickable DOM elements). Call this before attempting to interact with a specific marker.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaSearch", fn: "search", argOrder: ["query"],
      description: "Type a location into the search box and submit it. Whether a selectable result list appears afterward is unconfirmed - best-effort only.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "noaaGoToView", fn: "goToView", argOrder: ["lon", "lat", "zoom"],
      description: "Move the map to a longitude, latitude and zoom. Reliable where search is not, because this page records its map view in the URL.",
      parameters: {
        type: "object",
        properties: { lon: { type: "number" }, lat: { type: "number" }, zoom: { type: "number", description: "roughly 3 for a large state, 8 for a city" } },
        required: ["lon", "lat"],
      },
    },
    {
      name: "noaaMapView", fn: "mapView", argOrder: [],
      description: "Read where the map is currently centred and how far it is zoomed in.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaGeolocate", fn: "geolocate", argOrder: [],
      description: "Center the map on the browser's current geolocation.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaZoomIn", fn: "zoomIn", argOrder: [],
      description: "Zoom the map in one step.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaZoomOut", fn: "zoomOut", argOrder: [],
      description: "Zoom the map out one step.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaHome", fn: "home", argOrder: [],
      description: "Reset the map to its default home view.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaOpenLayers", fn: "openLayers", argOrder: [],
      description: "Open the layers panel. Required before noaaSetBasemap or noaaListBasemaps will find anything.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaCloseLayers", fn: "closeLayers", argOrder: [],
      description: "Close the layers panel.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaListBasemaps", fn: "listBasemaps", argOrder: [],
      description: "List available basemap styles and which one is selected. Only works after noaaOpenLayers.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaSetBasemap", fn: "setBasemap", argOrder: ["basemap"],
      description: "Set the map's basemap style. Only works after noaaOpenLayers has been called first.",
      parameters: { type: "object", properties: { basemap: { type: "string", enum: ["topographic", "satellite", "dark", "light"] } }, required: ["basemap"] },
    },
    {
      name: "noaaToggleSection", fn: "toggleSection", argOrder: ["name"],
      description: "Expand or collapse a section of the layers panel.",
      parameters: { type: "object", properties: { name: { type: "string", enum: ["river gauge", "hazards", "precipitation estimate", "national water model", "flood inundation", "national snow analysis", "administrative boundaries"] } }, required: ["name"] },
    },
    {
      name: "noaaSetGaugeProduct", fn: "setGaugeProduct", argOrder: ["product"],
      description: "Select which river gauge product is shown: observations+forecast, the ensemble forecast (HEFS), or the long-range outlook (LRO).",
      parameters: { type: "object", properties: { product: { type: "string", enum: ["obsFcst", "HEFS", "LRO"], description: "obsFcst, HEFS, or LRO" } }, required: ["product"] },
    },
    {
      name: "noaaSetGaugeMode", fn: "setGaugeMode", argOrder: ["mode"],
      description: "Switch the gauge display between observation and forecast mode.",
      parameters: { type: "object", properties: { mode: { type: "string", enum: ["Observation", "Forecast"] } }, required: ["mode"] },
    },
    {
      name: "noaaListFloodCategories", fn: "listFloodCategories", argOrder: [],
      description: "List flood-category filter checkboxes and which are checked.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "noaaToggleFloodCategory", fn: "toggleFloodCategory", argOrder: ["label", "on"],
      description: "Check or uncheck a flood-category filter, e.g. 'Minor Flood'.",
      parameters: { type: "object", properties: { label: { type: "string" }, on: { type: "boolean" } }, required: ["label"] },
    },
    {
      name: "noaaSetLimitByBoundary", fn: "setLimitByBoundary", argOrder: ["on"],
      description: "Toggle limiting displayed gauges by boundary.",
      parameters: { type: "object", properties: { on: { type: "boolean" } } },
    },
    {
      name: "noaaSetPartnerFimOnly", fn: "setPartnerFimOnly", argOrder: ["on"],
      description: "Toggle showing only partner flood-inundation-mapping gauges.",
      parameters: { type: "object", properties: { on: { type: "boolean" } } },
    },
  ],
  FCP: [
    {
      name: "fcpMapNote", fn: "mapNote", argOrder: [],
      description: "Explain why individual forecast-point pins on this page can't be clicked directly (OpenLayers renders them to a canvas/vector layer, not clickable DOM elements). Call this before attempting to interact with a specific pin.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpSearch", fn: "search", argOrder: ["query"],
      description: "Type a location into the search box. Whether a selectable result list appears afterward is unconfirmed - best-effort only.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "fcpZoomIn", fn: "zoomIn", argOrder: [],
      description: "Zoom the map in one step.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpZoomOut", fn: "zoomOut", argOrder: [],
      description: "Zoom the map out one step.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpToggleFullscreen", fn: "toggleFullscreen", argOrder: [],
      description: "Toggle full-screen map display.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpToggleAttributions", fn: "toggleAttributions", argOrder: [],
      description: "Toggle the map attributions display.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpOpenLayers", fn: "openLayers", argOrder: [],
      description: "Open the layer switcher panel.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpToggleOverview", fn: "toggleOverview", argOrder: [],
      description: "Toggle the small overview/locator map inset.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpListBasemaps", fn: "listBasemaps", argOrder: [],
      description: "List available basemap styles and which one is selected.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpSetBasemap", fn: "setBasemap", argOrder: ["basemap"],
      description: "Set the map's basemap style.",
      parameters: { type: "object", properties: { basemap: { type: "string", enum: ["community", "dark-gray", "human-geography", "imagery", "light-gray", "navigation", "newspaper", "oceans", "outdoor", "streets", "terrain", "topographic"] } }, required: ["basemap"] },
    },
    {
      name: "fcpOpenPlotOrderConfig", fn: "openPlotOrderConfig", argOrder: [],
      description: "Open the plot-order configuration panel. Only opens the panel, does not itself change any setting.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpOpenPlotLookConfig", fn: "openPlotLookConfig", argOrder: [],
      description: "Open the plot-appearance configuration panel. Only opens the panel, does not itself change any setting.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpOpenRingConfig", fn: "openRingConfig", argOrder: [],
      description: "Open the range-ring configuration panel.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpSetRingRadius", fn: "setRingRadius", argOrder: ["miles"],
      description: "Set the range ring's radius in miles. Opens the ring config panel itself.",
      parameters: { type: "object", properties: { miles: { type: "number" } }, required: ["miles"] },
    },
    {
      name: "fcpSetRingColor", fn: "setRingColor", argOrder: ["hex"],
      description: "Set the range ring's color. Opens the ring config panel itself.",
      parameters: { type: "object", properties: { hex: { type: "string", pattern: "^#?[0-9a-f]{3,8}$", description: "e.g. #ff0000" } }, required: ["hex"] },
    },
    {
      name: "fcpAddRing", fn: "addRing", argOrder: [],
      description: "Add a range ring at the last clicked/searched location. Opens the ring config panel itself.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpRemoveLastRing", fn: "removeLastRing", argOrder: [], destructive: "removes a range ring",
      description: "Remove the most recently added range ring.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpClearRings", fn: "clearRings", argOrder: [], destructive: "removes every range ring",
      description: "Remove all range rings.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpToggleLegend", fn: "toggleLegend", argOrder: [],
      description: "Toggle the map legend display.",
      parameters: { type: "object", properties: {} },
    },
  ],
  GENERIC: [
    {
      name: "pageCompute",
      description: "Calculate a statistic over numbers this page shows - the average, total, highest, lowest, median, count or spread of a table row or column, a chart's series, or a map's features. Use whenever the question asks for a calculation rather than a single reading, such as 'average temperature this week' or 'total rainfall across the gauges'. Lists the numbers it used so the result can be checked.",
      parameters: { type: "object", properties: {
        fn: { type: "string", enum: ["mean", "sum", "max", "min", "median", "count", "range"], description: "which calculation" },
        of: { type: "string", description: "what to calculate over, in the page's own words, e.g. 'temperature', 'discharge', 'gage height'" },
        source: { type: "string", enum: ["auto", "table", "chart", "map"], description: "where to read the numbers from; auto tries the table, then the chart, then the map" },
      }, required: ["fn", "of"] },
      run: ({ fn, of, source }) => pageComputeRun({ fn, of, source }),
    },
    {
      name: "pageToolCall", fn: "pageToolCall", argOrder: ["name", "args"], needsPageKnowledge: true,
      description: "Run one of this page's own tools by name, as listed for this page. No CSS selector is involved - the tool names the thing it acts on.",
      parameters: { type: "object", properties: {
        name: { type: "string", description: "the tool's name, exactly as listed for this page" },
        args: { type: "object", description: "arguments matching that tool's own schema" },
      }, required: ["name"] },
    },
    {
      name: "pageMcpTools", fn: "mcpTools", argOrder: [],
      description: "List the WebMCP tools this page declares about itself through navigator.modelContext. A page that publishes its own tools has stated what it can do, with real schemas, so these are more reliable than anything inferred from its markup.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageMcpCall", fn: "mcpCall", argOrder: ["name", "args"], needsPageKnowledge: true,
      description: "Run one of the WebMCP tools this page declares. Use the exact name from pageMcpTools.",
      parameters: { type: "object", properties: {
        name: { type: "string", description: "the tool's name, exactly as pageMcpTools reported it" },
        args: { type: "object", description: "arguments matching that tool's own inputSchema" },
      }, required: ["name"] },
    },
    {
      name: "pageMcpPublish", fn: "mcpRegister", argOrder: ["tools"], needsPageKnowledge: true,
      description: "Publish this page's verified controls as WebMCP tools, so any agent that speaks navigator.modelContext can drive the site - whether or not the site itself ever implements it.",
      parameters: { type: "object", properties: { tools: { type: "array", description: "tool definitions to register" } } },
    },
    {
      name: "pageHoverChart", fn: "hoverSeries", argOrder: ["selector"],
      description: "Read a chart's values by hovering across it, for charts that only reveal numbers in a tooltip. Slower and sampled; prefer pageFeeds when the underlying data request was captured.",
      parameters: { type: "object", properties: { selector: { type: "string", description: "optional CSS selector for the chart; the largest one is used otherwise" } } },
    },
    {
      name: "pageMapInfo", fn: "mapInfo", argOrder: [],
      description: "Report whether this page has a map, which library draws it, and whether it can be driven by script at all - answers 'can you click the map' before anything tries to.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageMapFeatures", fn: "mapFeatures", argOrder: [],
      description: "Read the markers and their data from a map on this page, using the map library's own instance where one is reachable. Reports plainly when the map is canvas-only and has nothing readable.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageReadUrl", fn: "readUrl", argOrder: ["url"],
      description: "Read another page of the same site without navigating to it - use to answer about a different state, gauge or location than the one currently open. Same-origin only, and reads server HTML, so a page that builds itself in JavaScript arrives empty.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
    {
      name: "pageLinks", fn: "pageLinks", argOrder: [],
      description: "List the links on this page, to find the URL of another page worth reading with pageReadUrl.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageFeeds", fn: "capturedFeeds", argOrder: [],
      description: "List the data requests this page made - the source behind a chart or map whose contents are drawn to a canvas and cannot be read from the page itself.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageFeed", fn: "capturedFeed", argOrder: ["match"],
      description: "Return one captured data response in full, by a fragment of its URL - use after pageFeeds to read the actual series behind a chart.",
      parameters: { type: "object", properties: { match: { type: "string", description: "part of the URL, e.g. observations" } }, required: ["match"] },
    },
    {
      name: "pageRead", fn: "readPage", argOrder: [],
      description: "Read the data shown on the current page - tables, labelled values, numeric readouts, and any SVG chart's labels. Use to answer questions about what this page says, as opposed to changing what it displays.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageInventory", fn: "inventory", argOrder: [],
      description: "List every interactive control on the current page with a CSS selector for each, so they can be acted on directly.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageClick", fn: "click", argOrder: ["selector"],
      description: "Click an element on the page by CSS selector, e.g. one returned by pageInventory.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
    {
      name: "pageWaitFor", fn: "waitForSelector", argOrder: ["selector"],
      description: "Wait for an element to appear, for use between an action that opens a panel and one that acts inside it. Waiting for the page to stop changing is not the same as waiting for a particular thing.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
    {
      name: "pageReadControl", fn: "readControl", argOrder: ["selector"],
      description: "Read one control's current state - its value, what is selected, whether it is checked, whether it is disabled. Answers 'what is set right now' for a single control.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
    {
      name: "pageUndo", fn: "restore", argOrder: ["changes"],
      description: "Put controls back to their previous values, using the change list a verified action recorded.",
      parameters: { type: "object", properties: { changes: { type: "array", description: "the `verified.changes` from an earlier action" } }, required: ["changes"] },
    },
    {
      name: "pageBack", fn: "goBack", argOrder: [],
      description: "Go back to the previous page, after an action navigated away.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageScrollTo", fn: "scrollToElement", argOrder: ["selector"],
      description: "Scroll a control into view, for reading something below the fold.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
    {
      name: "pageSubmit", fn: "submit", argOrder: ["selector"],
      description: "Submit a field after filling it - presses Enter, or submits the surrounding form, or clicks its submit button. Typing alone leaves the text sitting in the box.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
    {
      name: "pageFill", fn: "fill", argOrder: ["selector", "text"],
      description: "Type text into an input or textarea on the page by CSS selector.",
      parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] },
    },
    {
      name: "pageCheck", fn: "check", argOrder: ["selector", "on"],
      description: "Tick or untick a checkbox by CSS selector - layer toggles, filters, 'show only ...' options.",
      parameters: { type: "object", properties: { selector: { type: "string" }, on: { type: "boolean", description: "true to tick, false to untick" } }, required: ["selector"] },
    },
    {
      name: "pagePickRadio", fn: "pickRadio", argOrder: ["group", "value"],
      description: "Choose one option from a radio group, by the group's name attribute and the option's value or visible label.",
      parameters: { type: "object", properties: { group: { type: "string", description: "the radios' shared name attribute; pass anything if they have none" }, value: { type: "string" } }, required: ["group", "value"] },
    },
    {
      name: "pageClickText", fn: "clickText", argOrder: ["text"],
      description: "Click a button or link by its visible text, when no selector is known.",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    {
      name: "pageSelectOption", fn: "selectOption", argOrder: ["selector", "value"],
      description: "Choose an option in a <select> dropdown by CSS selector and the option's value or visible text.",
      parameters: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } }, required: ["selector", "value"] },
    },
  ],
};

/* ---------------------------------------------------------------------------
 * Data tools - answer questions with real numbers, rather than operate a page.
 *
 * A fundamentally different kind of tool from everything above. A control tool
 * (usgsSetParameter, pageClick, ...) is injected into the active tab and
 * manipulates its DOM. A data tool is a plain fetch() from this service worker
 * to a public agency API: no injection, no page bridge, no DOM at all. That
 * difference is the whole point - it can answer "what's the gage height in
 * Alaska" no matter which page the user is currently on, without navigating or
 * clicking anything first, which no amount of control tooling can do.
 *
 * URLs and response shape follow hydro-harvester's already-proven adapters
 * (hydro-harvester.user.js's `usgs` object). USGS Water Services needs no API
 * key and allows direct browser requests; one statewide call returns every
 * reporting gauge (verified: 126 gauges for Alaska in ~1.7s).
 */

// Agencies go down - waterservices.usgs.gov returned 503 for an extended
// period while this was being written, while USGS's OGC API, NWS and NOAA
// stayed up. "returned 503" is jargon that reads like a bug in the question;
// saying which service is unavailable, and that the others still work, is the
// difference between a dead end and a usable answer.
// NOAA's NWPS is slow and rate-limited by its own documentation, and every
// ask re-fetched. A short memo makes a repeated question instant and keeps
// the extension from being the reason a rate limit is hit. Deliberately brief
// - these are current conditions, and stale readings were a real bug once.
const FETCH_CACHE = new Map();
const CACHE_TTL_MS = 120000;

function cacheGet(url) {
  const hit = FETCH_CACHE.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { FETCH_CACHE.delete(url); return null; }
  return hit.value;
}

function cacheSet(url, value) {
  FETCH_CACHE.set(url, { at: Date.now(), value });
  // The worker is not long-lived, but an unbounded map is still wrong.
  if (FETCH_CACHE.size > 40) FETCH_CACHE.delete(FETCH_CACHE.keys().next().value);
}

async function fetchJson(url, service) {
  const cached = cacheGet(url);
  if (cached) return cached;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`couldn't reach ${service} - check the network connection`);
  }
  if (res.status >= 500) {
    throw new Error(`${service} is not responding right now (${res.status}). That's an outage at their end, not a problem with the question - other sources may still work.`);
  }
  if (res.status === 429) {
    throw new Error(`${service} is rate-limiting requests right now - wait a moment and ask again`);
  }
  if (!res.ok) throw new Error(`${service} rejected that request (${res.status})`);
  try {
    const body = await res.json();
    cacheSet(url, body);
    return body;
  } catch (e) {
    throw new Error(`${service} returned something that wasn't JSON - the service may be mid-outage`);
  }
}

const US_STATES = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi",
  wyoming: "wy", "district of columbia": "dc", "puerto rico": "pr",
};

// ENV_VOCAB canonical concept -> the USGS parameter code the API wants. The
// synonym half of this ("stage", "flow", "cfs", ...) already lives in
// env-vocab.js; this is just the last hop from concept to wire format.
const USGS_PARAM_CODES = {
  discharge: "00060", gageHeight: "00065", waterTemperature: "00010",
  specificConductance: "00095", dissolvedOxygen: "00300", pH: "00400",
  turbidity: "63680", precipitation: "00045", groundwaterLevel: "72019",
};

// Whether a cross-gauge min/median/max means anything for this parameter.
//
// Gage height does NOT aggregate: stage is measured against each gauge's own
// datum, so some read against a local streambed and others against sea level.
// Alaska simultaneously reports 0.46 ft and 2004.62 ft of "gage height" and
// both are correct - a range over them is arithmetic on incompatible units,
// however tidy it looks. Absolute-scale measurements aggregate fine.
const AGGREGATABLE_PARAMS = {
  discharge: true, waterTemperature: true, precipitation: true,
  specificConductance: true, dissolvedOxygen: true, pH: true, turbidity: true,
  groundwaterLevel: true, // depth below land surface: a real common reference
  gageHeight: false,
};

function resolveStateCode(text) {
  const t = (text || "").trim().toLowerCase();
  if (US_STATES[t]) return US_STATES[t];
  if (/^[a-z]{2}$/.test(t) && Object.values(US_STATES).includes(t)) return t;
  return null;
}

// Scans free text for a state name, so "what's the gage height in Alaska"
// resolves without the caller having to isolate the state first. Longest
// names first, so "west virginia" wins over "virginia".
/* ---------------------------------------------------------------------------
 * Typo tolerance.
 *
 * Exact matching meant one slip silently changed the answer: "gage hiehgt in
 * wyoming" found no parameter, so the data path was skipped entirely and the
 * question fell to the disabled model; "Alaskak" lost the state and quietly
 * became a page-control action instead. Both look like the tool ignoring you.
 *
 * Optimal string alignment (Levenshtein plus adjacent transpositions) is what
 * this needs rather than plain edit distance - real typing errors are mostly
 * transpositions. "hiehgt" is 4 substitutions from "height" but only 2
 * transpositions, so plain Levenshtein would miss it at any sane threshold.
 */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      // the transposition case: "hi" typed where "ih" was meant
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[m][n];
}

// Short phrases get no slack at all: "stage" and "state" are one edit apart
// and mean entirely different things here, so anything under 6 characters
// must match exactly.
function allowedTypos(phrase) {
  if (phrase.length < 6) return 0;
  return phrase.length >= 9 ? 2 : 1;
}

// Slides a window the same length as the phrase across the text, so a
// multi-word phrase ("gage height") can be matched against the same number
// of typed words ("gage hiehgt").
// Like fuzzyPhraseInText, but returns the misspelled text it matched, so the
// caller can strip exactly those words back out of the instruction.
function fuzzyMatchedText(text, phrase) {
  const allowed = allowedTypos(phrase);
  if (!allowed) return null;
  const tokens = (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const words = phrase.split(/\s+/);
  for (let i = 0; i + words.length <= tokens.length; i++) {
    const window = tokens.slice(i, i + words.length).join(" ");
    if (Math.abs(window.length - phrase.length) > allowed) continue;
    if (editDistance(window, phrase) <= allowed) return window;
  }
  return null;
}

function fuzzyPhraseInText(text, phrase) {
  const allowed = allowedTypos(phrase);
  if (!allowed) return false;
  const tokens = (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const words = phrase.split(/\s+/);
  for (let i = 0; i + words.length <= tokens.length; i++) {
    const window = tokens.slice(i, i + words.length).join(" ");
    if (Math.abs(window.length - phrase.length) > allowed) continue;
    if (editDistance(window, phrase) <= allowed) return true;
  }
  return false;
}

// People ask about cities, not states ("precipitation in Cleveland"), but
// every one of these APIs is state-scoped. This maps a city to its state so
// the question is answerable at all, and the city name doubles as a filter -
// USGS names gauges after the town they sit in ("...at Omaha, Nebr."), so a
// name match is often exactly the local gauge the person wanted.
//
// Deliberately city->state only, no coordinates: a wrong state is obvious and
// fixable, whereas plausible-looking wrong coordinates would silently return
// the wrong gauges. Distance-based search can come later from a real dataset.
// Names identical to a state ("Washington") are omitted to avoid fighting the
// state matcher.
const US_CITIES = {
  "new york city": "ny", "los angeles": "ca", chicago: "il", houston: "tx", phoenix: "az",
  philadelphia: "pa", "san antonio": "tx", "san diego": "ca", dallas: "tx", "san jose": "ca",
  austin: "tx", jacksonville: "fl", "fort worth": "tx", columbus: "oh", charlotte: "nc",
  "san francisco": "ca", indianapolis: "in", seattle: "wa", denver: "co", "oklahoma city": "ok",
  nashville: "tn", "el paso": "tx", boston: "ma", portland: "or", "las vegas": "nv",
  detroit: "mi", memphis: "tn", louisville: "ky", baltimore: "md", milwaukee: "wi",
  albuquerque: "nm", tucson: "az", fresno: "ca", sacramento: "ca", "kansas city": "mo",
  mesa: "az", atlanta: "ga", omaha: "ne", "colorado springs": "co", raleigh: "nc",
  "virginia beach": "va", "long beach": "ca", miami: "fl", oakland: "ca", minneapolis: "mn",
  tulsa: "ok", bakersfield: "ca", wichita: "ks", arlington: "tx", aurora: "co",
  tampa: "fl", "new orleans": "la", cleveland: "oh", honolulu: "hi", anaheim: "ca",
  lexington: "ky", stockton: "ca", "corpus christi": "tx", henderson: "nv", riverside: "ca",
  "newark": "nj", "saint paul": "mn", "st paul": "mn", "santa ana": "ca", cincinnati: "oh",
  irvine: "ca", orlando: "fl", pittsburgh: "pa", "st louis": "mo", "saint louis": "mo",
  greensboro: "nc", "jersey city": "nj", anchorage: "ak", lincoln: "ne", plano: "tx",
  durham: "nc", buffalo: "ny", chandler: "az", chula: "ca", "chula vista": "ca",
  madison: "wi", lubbock: "tx", "st petersburg": "fl", reno: "nv", laredo: "tx",
  scottsdale: "az", "north las vegas": "nv", "baton rouge": "la", irving: "tx", chesapeake: "va",
  gilbert: "az", winston: "nc", "winston salem": "nc", fremont: "ca", "san bernardino": "ca",
  boise: "id", birmingham: "al", spokane: "wa", rochester: "ny", modesto: "ca",
  "des moines": "ia", "salt lake city": "ut", "little rock": "ar", tacoma: "wa", fontana: "ca",
  oxnard: "ca", "fayetteville": "nc", "moreno valley": "ca", huntsville: "al", yonkers: "ny",
  glendale: "az", amarillo: "tx", montgomery: "al", akron: "oh", "grand rapids": "mi",
  "sioux falls": "sd", columbia: "sc", augusta: "ga", mobile: "al", "knoxville": "tn",
  worcester: "ma", tempe: "az", "port st lucie": "fl", providence: "ri", "fort lauderdale": "fl",
  chattanooga: "tn", "santa clarita": "ca", "cape coral": "fl", ontario: "ca", dayton: "oh",
  "overland park": "ks", "santa rosa": "ca", "oceanside": "ca", "garden grove": "ca", elkgrove: "ca",
  jackson: "ms", "fort wayne": "in", "rancho cucamonga": "ca", "sioux city": "ia", shreveport: "la",
  tallahassee: "fl", "cedar rapids": "ia", "eugene": "or", salem: "or", peoria: "il",
  springfield: "mo", "fort collins": "co", lansing: "mi", "ann arbor": "mi", flint: "mi",
  toledo: "oh", "green bay": "wi", billings: "mt", missoula: "mt", "cheyenne": "wy",
  casper: "wy", fargo: "nd", bismarck: "nd", "rapid city": "sd", "great falls": "mt",
  "idaho falls": "id", pocatello: "id", "coeur d alene": "id", "twin falls": "id", nampa: "id",
  ogden: "ut", provo: "ut", "grand junction": "co", pueblo: "co", "santa fe": "nm",
  "las cruces": "nm", flagstaff: "az", yuma: "az", "sioux city": "ia", davenport: "ia",
  "iowa city": "ia", topeka: "ks", "kansas city ks": "ks", "st joseph": "mo", columbia_mo: "mo",
  fairbanks: "ak", juneau: "ak", "grand forks": "nd", duluth: "mn", rochester_mn: "mn",
  "eau claire": "wi", "la crosse": "wi", appleton: "wi", "traverse city": "mi", kalamazoo: "mi",
  "south bend": "in", evansville: "in", "terre haute": "in", bloomington: "in", muncie: "in",
  charleston: "sc", savannah: "ga", macon: "ga", "myrtle beach": "sc", asheville: "nc",
  wilmington: "nc", roanoke: "va", richmond: "va", norfolk: "va", "newport news": "va",
  "morgantown": "wv", huntington: "wv", frankfort: "ky", "bowling green": "ky", paducah: "ky",
  "baton": "la", lafayette: "la", "lake charles": "la", monroe: "la", biloxi: "ms",
  hattiesburg: "ms", tupelo: "ms", "fort smith": "ar", fayetteville_ar: "ar", jonesboro: "ar",
  "hot springs": "ar", "sioux": "ia", trenton: "nj", "atlantic city": "nj", camden: "nj",
  allentown: "pa", erie: "pa", scranton: "pa", harrisburg: "pa", "state college": "pa",
  bridgeport: "ct", "new haven": "ct", hartford: "ct", stamford: "ct", burlington: "vt",
  manchester: "nh", concord: "nh", portsmouth: "nh", portland_me: "me", bangor: "me",
  augusta_me: "me", albany: "ny", syracuse: "ny", binghamton: "ny", "niagara falls": "ny",
  "white plains": "ny", springfield_ma: "ma", cambridge: "ma", lowell: "ma", "new bedford": "ma",
};

function findCityInText(text) {
  const t = (text || "").toLowerCase();
  // Longest first: "kansas city" must beat "kansas", "new york city" beat "new york".
  const names = Object.keys(US_CITIES)
    .filter((n) => !n.includes("_"))
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)) {
      return { city: name, code: US_CITIES[name], matched: name };
    }
  }
  // Same typo tolerance states and parameters already had - city names are
  // long and easy to misspell ("tallahasee"), and without this the city is
  // lost, which loses the state with it and sinks the whole question.
  for (const name of names) {
    const hit = fuzzyMatchedText(t, name);
    if (hit) return { city: name, code: US_CITIES[name], matched: hit, corrected: name };
  }
  return null;
}

// Two-letter codes that are also ordinary English words. These only count as
// a state when the writer capitalized them, otherwise "precipitation in
// Fremont" matches Indiana and "rain or snow" matches Oregon.
const AMBIGUOUS_STATE_CODES = new Set(["in", "or", "me", "hi", "ok", "de", "la", "pa", "ma", "mo", "oh", "id", "co"]);

function findStateInText(text) {
  const raw = text || "";
  const lower = raw.toLowerCase();

  // Full names first, longest first so "west virginia" beats "virginia".
  const names = Object.keys(US_STATES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) return { name, code: US_STATES[name], matched: name };
  }

  // Then two-letter codes - people write "fremont ca" far more often than
  // "fremont california".
  const nameByCode = {};
  for (const [name, code] of Object.entries(US_STATES)) nameByCode[code] = name;
  for (const m of raw.matchAll(/\b([A-Za-z]{2})\b/g)) {
    const code = m[1].toLowerCase();
    if (!nameByCode[code]) continue;
    if (AMBIGUOUS_STATE_CODES.has(code) && m[1] !== m[1].toUpperCase()) continue;
    return { name: nameByCode[code], code, matched: m[1].toLowerCase() };
  }

  // Last resort, same reasoning as parameters: "Alaskak" shouldn't silently
  // lose the state and turn a question into a page action.
  for (const name of names) {
    if (fuzzyPhraseInText(lower, name)) return { name, code: US_STATES[name], matched: name, corrected: name };
  }
  return null;
}

// Same idea for the parameter, using env-vocab's synonym tables. Synonyms
// under 3 characters ("ft", "do") are skipped - they collide with ordinary
// words far too often to match safely against free text.
function findParameterInText(text) {
  if (typeof ENV_VOCAB === "undefined") return null;
  const t = (text || "").toLowerCase();
  const candidates = [];
  for (const [canonical, synonyms] of Object.entries(ENV_VOCAB.parameters)) {
    if (!USGS_PARAM_CODES[canonical]) continue;
    for (const s of synonyms) {
      if (s.length >= 3) candidates.push({ canonical, synonym: s });
    }
  }
  candidates.sort((a, b) => b.synonym.length - a.synonym.length);
  for (const c of candidates) {
    if (new RegExp(`\\b${c.synonym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)) {
      return { canonical: c.canonical, code: USGS_PARAM_CODES[c.canonical], matched: c.synonym };
    }
  }
  // Only after every exact match has failed, so a correctly spelled term can
  // never lose to a fuzzy hit on something else.
  for (const c of candidates) {
    if (fuzzyPhraseInText(t, c.synonym)) {
      return { canonical: c.canonical, code: USGS_PARAM_CODES[c.canonical], matched: c.synonym, corrected: c.synonym };
    }
  }
  return null;
}

// NWPS has no usable state filter (a state.abbreviation query hangs past 40s),
// so gauges are fetched by bounding box and filtered by state afterward, the
// same approach hydro-harvester settled on. Boxes are deliberately generous;
// out-of-state gauges get dropped by the filter, not by the box.
const STATE_BBOX = {
  al: [-88.5, 30.1, -84.9, 35.1], ak: [-179.2, 51.0, -129.9, 71.6], az: [-114.9, 31.3, -109.0, 37.1],
  ar: [-94.7, 33.0, -89.6, 36.6], ca: [-124.5, 32.5, -114.1, 42.1], co: [-109.1, 36.9, -102.0, 41.1],
  ct: [-73.8, 40.9, -71.7, 42.1], de: [-75.8, 38.4, -75.0, 39.9], dc: [-77.2, 38.8, -76.9, 39.0],
  fl: [-87.7, 24.4, -79.9, 31.1], ga: [-85.7, 30.3, -80.8, 35.1], hi: [-160.3, 18.8, -154.7, 22.3],
  id: [-117.3, 41.9, -110.9, 49.1], il: [-91.6, 36.9, -87.4, 42.6], in: [-88.1, 37.7, -84.7, 41.8],
  ia: [-96.7, 40.3, -90.1, 43.6], ks: [-102.1, 36.9, -94.5, 40.1], ky: [-89.6, 36.4, -81.9, 39.2],
  la: [-94.1, 28.8, -88.8, 33.1], me: [-71.2, 42.9, -66.9, 47.5], md: [-79.5, 37.8, -75.0, 39.8],
  ma: [-73.6, 41.1, -69.8, 42.9], mi: [-90.5, 41.6, -82.3, 48.3], mn: [-97.3, 43.4, -89.4, 49.5],
  ms: [-91.7, 30.1, -88.0, 35.1], mo: [-95.9, 35.9, -89.0, 40.7], mt: [-116.1, 44.3, -104.0, 49.1],
  ne: [-104.1, 39.9, -95.2, 43.1], nv: [-120.1, 34.9, -114.0, 42.1], nh: [-72.6, 42.6, -70.5, 45.4],
  nj: [-75.6, 38.8, -73.8, 41.4], nm: [-109.1, 31.2, -102.9, 37.1], ny: [-79.8, 40.4, -71.8, 45.1],
  nc: [-84.4, 33.8, -75.4, 36.7], nd: [-104.1, 45.9, -96.5, 49.1], oh: [-84.9, 38.3, -80.5, 42.4],
  ok: [-103.1, 33.6, -94.4, 37.1], or: [-124.6, 41.9, -116.4, 46.3], pa: [-80.6, 39.7, -74.6, 42.6],
  ri: [-71.9, 41.1, -71.1, 42.1], sc: [-83.4, 32.0, -78.5, 35.3], sd: [-104.1, 42.4, -96.4, 46.0],
  tn: [-90.4, 34.9, -81.6, 36.7], tx: [-106.7, 25.8, -93.5, 36.6], ut: [-114.1, 36.9, -109.0, 42.1],
  vt: [-73.5, 42.7, -71.4, 45.1], va: [-83.7, 36.5, -75.2, 39.5], wa: [-124.9, 45.5, -116.9, 49.1],
  wv: [-82.7, 37.1, -77.7, 40.7], wi: [-92.9, 42.4, -86.8, 47.1], wy: [-111.1, 40.9, -104.0, 45.1],
  pr: [-67.3, 17.9, -65.2, 18.6],
};

// NWPS's own floodCategory values, worst first.
const FLOOD_RANK = { major: 5, moderate: 4, minor: 3, action: 2, no_flooding: 1, not_defined: 0 };
const FLOOD_LABEL = {
  major: "Major flood", moderate: "Moderate flood", minor: "Minor flood",
  action: "Action stage", no_flooding: "No flooding", not_defined: "No thresholds set",
};

// "3h ago" reads better than a raw timestamp, and sidesteps the gauge's
// timezone differing from the reader's.
function relativeAge(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// One statewide call, summarized rather than returned whole. A state can have
// well over a hundred reporting gauges, so handing back every record would be
// useless to a person and would blow up the prompt if it were ever fed back to
// a model. "The gage height in Alaska" has no single answer, and this says so
// honestly: a count, the range, and a handful of named examples.
async function usgsCurrentConditions({ state, parameter, nameContains }) {
  const stateCode = resolveStateCode(state) || (findStateInText(state) || {}).code;
  if (!stateCode) throw new Error(`don't recognize "${state}" as a US state`);

  // Accept a raw USGS code, an ENV_VOCAB canonical name (what planDataTool
  // hands over), or free text containing a synonym - a canonical key is not
  // listed among its own synonyms, so it needs its own check.
  const known = USGS_PARAM_CODES[parameter]
    ? { canonical: parameter, code: USGS_PARAM_CODES[parameter] }
    : findParameterInText(parameter) || {};
  const paramCode = /^\d{5}$/.test(parameter || "") ? parameter : known.code;
  if (!paramCode) {
    throw new Error(`don't recognize "${parameter}" as a water parameter. Try discharge, gage height, water temperature, ...`);
  }

  const url = "https://waterservices.usgs.gov/nwis/iv/?format=json" +
    `&stateCd=${stateCode}&parameterCd=${paramCode}&siteStatus=active`;
  const data = await fetchJson(url, "USGS Water Services");

  const series = (data && data.value && data.value.timeSeries) || [];
  let readings = series.map((ts) => {
    const point = ts.values && ts.values[0] && ts.values[0].value && ts.values[0].value[0];
    const value = point ? Number(point.value) : null;
    return {
      siteCode: ts.sourceInfo && ts.sourceInfo.siteCode && ts.sourceInfo.siteCode[0].value,
      name: (ts.sourceInfo && ts.sourceInfo.siteName) || "unknown",
      value,
      unit: (ts.variable && ts.variable.unit && ts.variable.unit.unitCode) || "",
      observedAt: point ? point.dateTime : null,
      // USGS reports missing data as -999999 rather than omitting the point
      valid: value !== null && Number.isFinite(value) && value > -999998,
    };
  }).filter((r) => r.valid);

  // USGS's "active" site list still serves gauges whose newest reading is
  // years old - seen live: a California precipitation gauge last reporting in
  // 2012, returned alongside genuinely current ones. Letting those into a
  // "current conditions" answer quietly corrupts the range, so they're
  // dropped and counted rather than shown.
  const STALE_HOURS = 24;
  const isStale = (r) => r.observedAt && (Date.now() - new Date(r.observedAt).getTime()) > STALE_HOURS * 3600e3;
  const staleExcluded = readings.filter(isStale).length;
  readings = readings.filter((r) => !isStale(r));
  const reportingStatewide = readings.length;

  // A name filter that matches nothing falls back to the whole state rather
  // than returning an empty answer - "no gauge is named Cleveland" is not the
  // same as "there is no data", and the statewide numbers are still the best
  // available answer to the question that was actually asked.
  const filter = (nameContains || "").trim().toLowerCase();
  let filterMissed = false;
  if (filter) {
    const matched = readings.filter((r) => r.name.toLowerCase().includes(filter));
    if (matched.length) readings = matched;
    else filterMissed = true;
  }

  const values = readings.map((r) => r.value);
  const unit = (readings[0] && readings[0].unit) || "";
  const canAggregate = AGGREGATABLE_PARAMS[known.canonical] !== false;
  const notComparable = canAggregate
    ? null
    : "gage height is measured from each gauge's own datum (some local, some sea level), so readings are not comparable between gauges - only each gauge's own value is meaningful";
  return {
    parameter: known.canonical || paramCode,
    parameterCode: paramCode,
    state: stateCode.toUpperCase(),
    gaugesReporting: readings.length,
    staleExcluded: staleExcluded || undefined,
    unit,
    // Omitted entirely when the parameter doesn't aggregate, rather than
    // computed-and-flagged, so nothing downstream - a model summarizing this
    // included - can lift a meaningless number out and present it as a real
    // statewide figure.
    range: values.length && canAggregate
      ? { min: Math.min(...values), median: median(values), max: Math.max(...values) }
      : null,
    notComparable: notComparable || undefined,
    examples: readings.slice(0, 5).map((r) => ({ name: r.name, siteCode: r.siteCode, value: r.value, observedAt: r.observedAt })),
    note: readings.length > 5
      ? `${readings.length} gauges report this - showing 5. Narrow with nameContains (e.g. a river name) for a specific one.`
      : undefined,
    source: "USGS Water Services (waterservices.usgs.gov), no API key required",
    // Presentation is decided here, by the tool that knows what its numbers
    // mean, so popup.js can stay a generic renderer instead of growing a
    // switch over every data tool's shape.
    display: {
      title: `${known.canonical || paramCode} · ${stateCode.toUpperCase()}`,
      subtitle: !readings.length
        ? "no gauges reporting this right now"
        : filterMissed
          ? `no gauge named "${nameContains}" · showing all ${readings.length} in ${stateCode.toUpperCase()}`
          : `${readings.length} gauge${readings.length === 1 ? "" : "s"} reporting${filter ? ` near ${nameContains}` : ""}`,
      stats: values.length && canAggregate ? [
        { label: "low", value: `${readable(Math.min(...values))} ${unit}` },
        { label: "median", value: `${readable(median(values))} ${unit}` },
        { label: "high", value: `${readable(Math.max(...values))} ${unit}` },
      ] : [],
      caveat: notComparable || undefined,
      rows: readings.slice(0, 5).map((r) => ({
        name: r.name,
        value: `${readable(r.value)} ${r.unit}`,
        meta: relativeAge(r.observedAt),
      })),
      note: [
        readings.length > 5 ? `+ ${readings.length - 5} more gauges` : null,
        staleExcluded ? `${staleExcluded} stale gauge${staleExcluded === 1 ? "" : "s"} excluded` : null,
      ].filter(Boolean).join(" · ") || undefined,
      source: "USGS Water Services",
    },
  };
}

// Which gauges are at or above action stage. NWPS carries each gauge's flood
// category inline, so one bounding-box sweep answers this with no per-gauge
// follow-up (Idaho: 224 in-state gauges in ~3s).
async function nwpsFloodStatus({ state }) {
  const stateCode = resolveStateCode(state) || (findStateInText(state) || {}).code;
  if (!stateCode) throw new Error(`don't recognize "${state}" as a US state`);
  const box = STATE_BBOX[stateCode];
  if (!box) throw new Error(`no bounding box on file for ${stateCode.toUpperCase()}`);

  const [w, s, e, n] = box;
  const url = "https://api.water.noaa.gov/nwps/v1/gauges" +
    `?bbox.xmin=${w}&bbox.xmax=${e}&bbox.ymin=${s}&bbox.ymax=${n}&srid=EPSG_4326`;
  const data = await fetchJson(url, "NOAA's National Water Prediction Service");

  const gauges = ((data && data.gauges) || [])
    .filter((g) => g.state && String(g.state.abbreviation).toLowerCase() === stateCode)
    .map((g) => {
      const observed = (g.status && g.status.observed) || {};
      const forecast = (g.status && g.status.forecast) || {};
      const category = observed.floodCategory || "not_defined";
      const observedRank = FLOOD_RANK[category] || 0;
      const forecastRank = FLOOD_RANK[forecast.floodCategory] || 0;
      return {
        id: g.lid,
        name: g.name,
        stage: observed.primary != null ? Number(observed.primary) : null,
        unit: observed.primaryUnit || "",
        category,
        forecastCategory: forecast.floodCategory || null,
        observedAt: observed.validTime || null,
        observedRank,
        forecastRank,
        rank: Math.max(observedRank, forecastRank),
      };
    });

  // "Flooding" here means action stage or worse, observed OR forecast - a
  // forecast of flooding is the whole point of a risk question, and action
  // stage is where agencies actually start responding. Currently-flooding
  // gauges sort above merely-forecast ones.
  const flooding = gauges
    .filter((g) => g.rank >= FLOOD_RANK.action)
    .sort((a, b) => b.rank - a.rank || b.observedRank - a.observedRank);
  const nowCount = flooding.filter((g) => g.observedRank >= FLOOD_RANK.action).length;
  const forecastOnly = flooding.length - nowCount;

  return {
    state: stateCode.toUpperCase(),
    gaugesChecked: gauges.length,
    atOrAboveActionStage: flooding.length,
    floodingNow: nowCount,
    forecastOnly,
    gauges: flooding.slice(0, 10).map((g) => ({
      name: g.name, id: g.id, stage: g.stage, unit: g.unit,
      observed: FLOOD_LABEL[g.category] || g.category,
      forecast: g.forecastCategory ? (FLOOD_LABEL[g.forecastCategory] || g.forecastCategory) : null,
      drivenBy: g.forecastRank > g.observedRank ? "forecast" : "observed",
    })),
    source: "NOAA National Water Prediction Service, no API key required",
    display: {
      title: `Flood status · ${stateCode.toUpperCase()}`,
      subtitle: flooding.length
        ? `${nowCount} flooding now, ${forecastOnly} forecast · of ${gauges.length} gauges`
        : `all ${gauges.length} gauges below action stage`,
      stats: [],
      rows: flooding.slice(0, 8).map((g) => {
        const observedLabel = FLOOD_LABEL[g.category] || g.category;
        const forecastLabel = g.forecastCategory ? (FLOOD_LABEL[g.forecastCategory] || g.forecastCategory) : null;
        // Say which of the two put this gauge on the list, otherwise a
        // forecast-driven row reads as a flat contradiction ("No flooding"
        // under a heading about gauges at or above action stage).
        const byForecast = g.forecastRank > g.observedRank;
        return {
          name: g.name,
          value: g.stage != null ? `${g.stage} ${g.unit}` : "—",
          meta: (byForecast ? `forecast ${forecastLabel} · now ${observedLabel}` : observedLabel) +
            (g.observedAt ? ` · ${relativeAge(g.observedAt)}` : ""),
          tone: g.rank >= FLOOD_RANK.moderate ? "alert" : "warn",
        };
      }),
      note: flooding.length > 8 ? `+ ${flooding.length - 8} more` : undefined,
      source: "NOAA NWPS",
    },
  };
}

// Active NWS alerts. Fast and simple - a plain state query, no bbox needed.
async function nwsAlerts({ state, floodOnly = true }) {
  const stateCode = resolveStateCode(state) || (findStateInText(state) || {}).code;
  if (!stateCode) throw new Error(`don't recognize "${state}" as a US state`);

  const data = await fetchJson(`https://api.weather.gov/alerts/active?area=${stateCode.toUpperCase()}`, "the National Weather Service");

  let alerts = ((data && data.features) || []).map((f) => f.properties || {});
  if (floodOnly) alerts = alerts.filter((p) => /flood/i.test(p.event || ""));

  const SEVERITY_TONE = { Extreme: "alert", Severe: "alert", Moderate: "warn", Minor: "ok" };
  return {
    state: stateCode.toUpperCase(),
    activeAlerts: alerts.length,
    filter: floodOnly ? "flood-related only" : "all active alerts",
    alerts: alerts.slice(0, 10).map((p) => ({
      event: p.event, severity: p.severity, urgency: p.urgency,
      area: p.areaDesc, headline: p.headline, effective: p.effective,
    })),
    source: "National Weather Service (api.weather.gov), no API key required",
    display: {
      title: `${floodOnly ? "Flood alerts" : "Active alerts"} · ${stateCode.toUpperCase()}`,
      subtitle: alerts.length ? `${alerts.length} active` : "none active right now",
      stats: [],
      rows: alerts.slice(0, 8).map((p) => ({
        name: p.event || "alert",
        value: p.severity || "",
        meta: (p.areaDesc || "").slice(0, 80),
        tone: SEVERITY_TONE[p.severity] || "warn",
      })),
      note: alerts.length > 8 ? `+ ${alerts.length - 8} more` : undefined,
      source: "NWS",
    },
  };
}

// Generic words in a waterbody name. Dropped before searching because USGS
// abbreviates them unpredictably - "BIGHORN RIVER AT THERMOPOLIS" sits beside
// "BIGHORN R AT NEIBER" and "BIGHORN R BEL BLACK WILLOW DRAW", so searching
// the full phrase "bighorn river" silently misses a third of the gauges.
// Searching the distinctive tokens instead catches every spelling.
const WATERBODY_GENERICS = new Set([
  "river", "riv", "creek", "crk", "ck", "lake", "lk", "reservoir", "res",
  "fork", "branch", "brook", "bayou", "canal", "ditch", "run", "slough",
  "stream", "pond", "the", "at", "near", "nr", "above", "below", "abv", "bel",
]);

// Any river, creek, lake or landmark USGS has named a gauge after - which is
// the authoritative answer to "where is this", far better than a hand-kept
// table of place names that would be wrong at the edges and endless to
// maintain. Returns the gauges and, when a measurement is named, their
// current readings - so no state is needed at all.
async function usgsFindGauges({ place, parameter, state }) {
  const tokens = (place || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !WATERBODY_GENERICS.has(w));
  if (!tokens.length) throw new Error(`"${place}" doesn't contain a name to search for`);

  // The generic word is dropped from the tokens (USGS abbreviates it
  // unpredictably) but kept for narrowing, because dropping it entirely was
  // too broad to be useful: "snake river" matched so many gauges containing
  // SNAKE that the actual Snake River fell outside the result window and the
  // answer came back as Snake Creek, Georgia.
  //
  // One letter does the narrowing neatly: "%SNAKE R%" matches both "SNAKE
  // RIVER AT..." and the abbreviated "SNAKE R AT...", while excluding SNAKE
  // CREEK and SNAKEDEN. Some names put the generic first ("LAKE TAHOE"), so
  // both orders are tried.
  // Order matters, and dropping the generics threw it away. "North Fork
  // Elkhorn River" became the tokens NORTH + ELKHORN and the pattern
  // "%NORTH ELKHORN F%", which matches nothing: the real gauge is NORTH FORK
  // ELKHORN RIVER, with the generic in the middle. The river exists, has two
  // gauges, and the search returned zero - so the question fell past the data
  // planner and came back as an offer to click an unrelated link.
  //
  // So the pattern is built from the words as written, generics included,
  // joined by wildcards. Only a trailing generic is shortened to its first
  // letter, which is the one USGS abbreviates unpredictably ("SNAKE R AT"),
  // and which was the reason for dropping them in the first place.
  const words = (place || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const last = words[words.length - 1];
  const trailingGeneric = WATERBODY_GENERICS.has(last) && last.length > 2 ? last : null;
  const body = (trailingGeneric ? words.slice(0, -1) : words).map((w) => w.toUpperCase());
  const forward = trailingGeneric
    ? `%${body.join("%")} ${trailingGeneric[0].toUpperCase()}%`
    : `%${body.join("%")}%`;
  // Some names put the generic first - "LAKE TAHOE", "FORK CREEK".
  const reversed = trailingGeneric ? `%${trailingGeneric.toUpperCase()} ${body.join("%")}%` : null;
  const patterns = reversed ? [forward, reversed] : [forward];

  // Only letters, digits and spaces survive tokenizing, so nothing can break
  // out of the quoted CQL strings below.
  const cql = patterns.map((p) => `monitoring_location_name LIKE '${p}'`).join(" OR ");
  const url = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items" +
    `?filter=${encodeURIComponent(cql)}&limit=200&f=json`;
  const data = await fetchJson(url, "USGS monitoring-location search");

  const all = ((data && data.features) || []).map((f) => {
    const p = f.properties || {};
    return { id: p.monitoring_location_number, name: p.monitoring_location_name, state: p.state_name };
  }).filter((g) => g.id && g.name);

  // The CQL wildcard matches inside words, so '%SNAKE%' happily returns
  // SNAKEDEN BRANCH, and dropping the generic ("river") removes the only
  // thing that would have excluded Bighorn *Park*. Both were returning
  // confidently wrong gauges in the wrong states, so the broad query is
  // treated as a candidate set and narrowed here.
  const wholeWord = all.filter((g) =>
    tokens.every((t) => new RegExp(`\\b${t}\\b`, "i").test(g.name)));

  // USGS names a gauge after its waterbody first - "BIGHORN RIVER AT
  // WORLAND", "SNAKE RIVER NEAR MORAN" - so a name *starting* with the term
  // is almost certainly the waterbody itself, while a later mention is
  // usually a landmark it happens to pass ("GORE CREEK ABOVE BIGHORN PARK").
  const leading = wholeWord.filter((g) => new RegExp(`^\\s*${tokens[0]}\\b`, "i").test(g.name));
  let gauges = leading.length ? leading : wholeWord;

  // Naming a state has to actually narrow, or the advice to name one is a
  // dead end - the same shape as telling someone to ask for an average that
  // then does not work.
  const wantState = state ? resolveStateCode(state) : null;
  if (wantState) {
    const inState = gauges.filter((g) => resolveStateCode(g.state || "") === wantState);
    if (inState.length) gauges = inState;
  }
  const states = [...new Set(gauges.map((g) => g.state).filter(Boolean))];
  if (!gauges.length) {
    // Every source here is a US federal agency. A place outside that coverage
    // is not a spelling mistake, and saying "no gauge by that name" invites
    // someone to keep trying - worse, a same-named US place would have
    // answered confidently about the wrong continent.
    return {
      place, found: 0, coverage: "united states only",
      display: {
        title: `No gauge named "${place}"`,
        subtitle: "USGS has no monitoring location with that name",
        stats: [], rows: [],
        caveat: "USGS, NWS and NOAA cover the United States only - somewhere outside it will never be found here, however it is spelled",
        note: "if it is a US river, try its full name or add the state",
        source: "USGS monitoring locations",
      },
    };
  }

  const known = USGS_PARAM_CODES[parameter] ? { canonical: parameter, code: USGS_PARAM_CODES[parameter] }
    : findParameterInText(parameter || "") || {};
  if (!known.code) {
    return {
      place, found: gauges.length, states,
      gauges: gauges.slice(0, 10),
      display: {
        title: `${place} · ${gauges.length} gauge${gauges.length === 1 ? "" : "s"}`,
        subtitle: states.join(", "),
        stats: [],
        rows: gauges.slice(0, 8).map((g) => ({ name: g.name, value: g.state || "", meta: g.id })),
        note: gauges.length > 8 ? `+ ${gauges.length - 8} more` : undefined,
        source: "USGS monitoring locations",
      },
    };
  }

  // Ask those exact gauges for the measurement, by id - no state involved.
  const ids = gauges.slice(0, 60).map((g) => g.id).join(",");
  const ivUrl = "https://waterservices.usgs.gov/nwis/iv/?format=json" +
    `&sites=${ids}&parameterCd=${known.code}`;
  const ivRes = await fetch(ivUrl);
  const ivData = ivRes.ok ? await ivRes.json() : null;
  const series = (ivData && ivData.value && ivData.value.timeSeries) || [];

  const readings = series.map((ts) => {
    const point = ts.values && ts.values[0] && ts.values[0].value && ts.values[0].value[0];
    const value = point ? Number(point.value) : null;
    return {
      name: (ts.sourceInfo && ts.sourceInfo.siteName) || "unknown",
      siteCode: ts.sourceInfo && ts.sourceInfo.siteCode && ts.sourceInfo.siteCode[0].value,
      value, unit: (ts.variable && ts.variable.unit && ts.variable.unit.unitCode) || "",
      observedAt: point ? point.dateTime : null,
    };
  }).filter((r) => r.value !== null && Number.isFinite(r.value) && r.value > -999998);

  const canAggregate = AGGREGATABLE_PARAMS[known.canonical] !== false;
  const values = readings.map((r) => r.value);
  const unit = (readings[0] && readings[0].unit) || "";

  // Gauges spread across several states are not one river. "Smith River"
  // matches nine, from New Hampshire to Alaska, and a median across them -
  // 132 ft3/s - describes nothing that exists. The same fault as averaging
  // gage heights from different datums, arriving by a different route: the
  // numbers are comparable in unit and meaningless in aggregate.
  const oneRiver = states.length <= 1;
  const summarisable = canAggregate && oneRiver;

  return {
    place, parameter: known.canonical, parameterCode: known.code,
    found: gauges.length, states,
    reporting: readings.length,
    range: values.length && summarisable
      ? { min: Math.min(...values), median: median(values), max: Math.max(...values) } : null,
    notComparable: !oneRiver && values.length
      ? `these gauges are in ${states.length} different states, so they are different rivers that share a name - a low, median or high across them would describe nothing`
      : undefined,
    readings: readings.slice(0, 10),
    source: "USGS monitoring locations + Water Services, no API key required",
    display: {
      title: `${known.canonical} · ${place}`,
      // A gauge existing and a gauge measuring this are different things, and
      // conflating them would read as "no such river".
      subtitle: readings.length
        ? `${readings.length} of ${gauges.length} gauges reporting · ${states.join(", ")}`
        : `${gauges.length} gauge${gauges.length === 1 ? "" : "s"} found in ${states.join(", ")}, but none report ${known.canonical}`,
      stats: values.length && summarisable ? [
        { label: "low", value: `${readable(Math.min(...values))} ${unit}` },
        { label: "median", value: `${readable(median(values))} ${unit}` },
        { label: "high", value: `${readable(Math.max(...values))} ${unit}` },
      ] : [],
      caveat: !canAggregate
        ? "gage height is measured from each gauge's own datum, so readings are not comparable between gauges"
        : !oneRiver && values.length
          ? `${states.length} different rivers share this name, so no low, median or high is shown - name a state to get one`
          : undefined,
      rows: (readings.length ? readings.slice(0, 8) : gauges.slice(0, 8)).map((r) => ({
        name: r.name,
        value: r.value != null ? `${r.value} ${r.unit}` : (r.state || ""),
        meta: r.observedAt ? relativeAge(r.observedAt) : r.id,
      })),
      // Several unrelated rivers can share a name - there are Snake Rivers in
      // Idaho, Minnesota, Nebraska and Colorado - so say so rather than let
      // a spread of states read as a matching bug.
      note: !readings.length
        ? "try discharge or gage height, which more gauges report"
        : states.length > 2
          ? `${states.length} states have a waterbody by this name - add a state to narrow it`
          : undefined,
      source: "USGS",
    },
  };
}

// Air temperature, humidity and the rest are weather, not water - USGS
// doesn't measure them, so these come from NWS observation stations.
//
// NWS is location-based rather than state-based (its /stations?state= listing
// is alphabetically capped before reaching the reporting ICAO stations), so a
// coordinate is needed. Rather than ship a fabricated table of city
// coordinates, one is derived: a USGS gauge named after the place *within the
// resolved state*, falling back to the state's own bounding-box centre. The
// state constraint is what makes this safe - an unconstrained name search for
// "OMAHA" returns an Omaha Lake in Arkansas. The reporting station and its
// description are always named, so an imprecise fix is visible rather than
// silent.
async function nwsPointFor({ stateCode, place }) {
  if (place) {
    const stateName = Object.keys(US_STATES).find((n) => US_STATES[n] === stateCode);
    const tokens = place.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !WATERBODY_GENERICS.has(w));
    if (tokens.length && stateName) {
      const title = stateName.replace(/\b\w/g, (c) => c.toUpperCase());
      const cql = `state_name = '${title}' AND monitoring_location_name LIKE '%${tokens.join("%").toUpperCase()}%'`;
      const url = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items" +
        `?filter=${encodeURIComponent(cql)}&limit=5&f=json`;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const d = await res.json();
          const feats = ((d && d.features) || []).filter((f) => f.geometry && f.geometry.coordinates);
          // USGS writes the settlement last ("... at Omaha, Nebr.") and the
          // waterbody first, so a leading match is usually a creek that
          // merely shares the name - "SOUTH OMAHA CREEK" sits 70 miles from
          // Omaha and was picking a Sioux City weather station. Prefer a
          // trailing mention, which really is the town the gauge is in.
          // The town must *begin* the segment after "at" or a comma. Allowing
          // anything in between matched "PETTIBONE CREEK AT NORTH CHICAGO"
          // for Chicago, which put the weather station 40 miles away in
          // Waukegan - a different city with different weather.
          const town = new RegExp(`(?:\\bat\\s+|,\\s*)${tokens.join("\\s+")}\\b`, "i");
          const hit = feats.find((f) => town.test(f.properties.monitoring_location_name)) || feats[0];
          if (hit) {
            const [lon, lat] = hit.geometry.coordinates;
            return { lat, lon, basis: `near ${hit.properties.monitoring_location_name}` };
          }
        }
      } catch (e) { /* fall through to the state centre */ }
    }
  }
  const box = STATE_BBOX[stateCode];
  if (!box) throw new Error(`no location on file for ${stateCode.toUpperCase()}`);
  const [w, s, e, n] = box;
  return { lat: (s + n) / 2, lon: (w + e) / 2, basis: `centre of ${stateCode.toUpperCase()}` };
}

// A question about Friday, or about a week, is not a question about now.
// Answering it with current conditions looks answered while being wrong,
// which is worse than refusing - so a time cue routes to the forecast
// instead. Returns what was asked for, or null for "right now".
const FORECAST_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// People abbreviate days, and the tables being read do too ("Wed Sep 16").
// Matching full names only meant "on Wed" lost the day silently and answered
// about today instead - a wrong answer that looks entirely right.
const DAY_ABBREVIATIONS = {
  mon: "monday", tue: "tuesday", tues: "tuesday", wed: "wednesday", weds: "wednesday",
  thu: "thursday", thur: "thursday", thurs: "thursday", fri: "friday",
  sat: "saturday", sun: "sunday",
};

function findDayInText(text) {
  const t = (text || "").toLowerCase();
  const full = FORECAST_DAYS.find((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (full) return full;
  // Word-boundary matching keeps "sun" out of "sunny" and "sat" out of
  // "saturate".
  for (const [abbr, day] of Object.entries(DAY_ABBREVIATIONS)) {
    if (new RegExp(`\\b${abbr}\\b`).test(t)) return day;
  }
  return null;
}

function forecastWhen(text) {
  const t = (text || "").toLowerCase();
  // "Probability of precipitation" is a forecast NWS publishes, not something
  // a gauge measures. Matching it against the USGS precipitation parameter
  // answered with rain gauges reading zero - measured rainfall so far, which
  // is a different quantity from the chance of rain to come.
  if (/\bprobability of precip\w*\b|\bchance of (rain|precip\w*|showers|storms)\b|\bwill it (rain|snow)\b|\bpop\b/.test(t)) {
    const namedDay = findDayInText(t);
    return namedDay ? `rain:${namedDay}` : "rain";
  }
  // A maximum or minimum is not a current reading. Answering "max
  // temperature in Chicago" with whatever the thermometer says right now is
  // the same silent substitution as answering "Friday" with today - and it
  // is why the number disagreed with weather.gov, which shows the forecast
  // high. NWS gives the day's high as its daytime period and the night's low
  // as the night period.
  // "max ... on tuesday" is both an extreme and a day; answering with today's
  // high ignores half the question.
  const namedDay = findDayInText(t);
  if (/\b(max|maximum|high|highest|hottest|warmest)\b/.test(t)) return namedDay ? `high:${namedDay}` : "high";
  if (/\b(min|minimum|low|lowest|coldest|coolest)\b/.test(t)) return namedDay ? `low:${namedDay}` : "low";
  if (/\b(this |next |coming )?week\b|\bweekly\b|\b7[- ]day\b|\bseven[- ]day\b/.test(t)) return "week";
  if (/\btomorrow\b/.test(t)) return "tomorrow";
  if (/\btonight\b/.test(t)) return "tonight";
  if (/\bweekend\b/.test(t)) return "weekend";
  const day = findDayInText(t);
  if (day) return day;
  if (/\bforecast\b|\bwill it\b|\bgoing to be\b/.test(t)) return "week";
  // "yesterday" and "last week" are history, which NWS's forecast cannot
  // answer - flagged so the caller can say so rather than quietly forecast.
  if (/\byesterday\b|\blast (week|month|night)\b|\bpast\b/.test(t)) return "past";
  return null;
}

async function nwsForecast({ state, place, when }) {
  if (when === "past") {
    throw new Error("NWS provides forecasts and current observations, not history - past conditions would need a different source");
  }
  const located = await resolveWeatherPoint({ state, place });
  const pRes = await fetch(`https://api.weather.gov/points/${located.lat.toFixed(4)},${located.lon.toFixed(4)}`,
    { headers: { Accept: "application/geo+json" } });
  if (!pRes.ok) throw new Error(`NWS returned ${pRes.status} for that location`);
  const forecastUrl = ((await pRes.json()).properties || {}).forecast;
  if (!forecastUrl) throw new Error("NWS has no forecast for that location");

  const fRes = await fetch(forecastUrl, { headers: { Accept: "application/geo+json" } });
  if (!fRes.ok) throw new Error(`NWS forecast returned ${fRes.status}`);
  const periods = (((await fRes.json()).properties) || {}).periods || [];
  if (!periods.length) throw new Error("NWS returned an empty forecast");

  // A named place that could not be found falls back to the middle of its
  // state, which is a real forecast for somewhere nobody asked about -
  // Hermantown's high came back as 72 when the town's own was 62, under the
  // heading "hermantown". The basis said "centre of MN" further down, but the
  // headline is what gets read. So a miss is named in the headline instead.
  const missed = place && /^centre of /.test(located.basis || "");
  const label = missed ? `${place} not found · ${located.basis}`
    : place || located.stateCode.toUpperCase();
  const dayLike = (p) => p.name.toLowerCase();

  // The chance of rain, optionally for a named day.
  if (when === "rain" || /^rain:/.test(when)) {
    const day = when.split(":")[1];
    const wanted = day
      ? periods.filter((p) => p.name.toLowerCase().includes(day))
      : periods.slice(0, 4);
    if (!wanted.length) {
      throw new Error(`NWS's forecast reaches ${periods[periods.length - 1].name}, which doesn't include ${day}`);
    }
    const chance = (p) => {
      const v = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
      return v == null ? 0 : v;
    };
    const peak = wanted.reduce((a, b) => (chance(b) > chance(a) ? b : a), wanted[0]);
    return {
      place: label, when: "chance of precipitation",
      periods: wanted.map((p) => ({ name: p.name, chance: chance(p), forecast: p.shortForecast })),
      locatedBy: located.basis,
      source: "National Weather Service forecast, no API key required",
      display: {
        title: `Chance of precipitation · ${label}`,
        subtitle: `${peak.name}: ${chance(peak)}% · forecast, not measured rainfall`,
        stats: [{ label: "peak", value: `${chance(peak)}%` }],
        rows: wanted.map((p) => ({ name: p.name, value: `${chance(p)}%`, meta: p.shortForecast })),
        note: located.basis,
        source: "NWS forecast",
      },
    };
  }

  // An extreme, optionally for a named day: "high:tuesday" means Tuesday's
  // daytime period rather than the next one available.
  if (when === "high" || when === "low" || /^(high|low):/.test(when)) {
    const [kind, day] = when.split(":");
    const wantDaytime = kind === "high";
    const period = day
      ? periods.find((p) => p.name.toLowerCase().includes(day) && p.isDaytime === wantDaytime)
      : periods.find((p) => p.isDaytime === wantDaytime);
    if (!period && day) {
      throw new Error(`NWS's forecast reaches ${periods[periods.length - 1].name}, which doesn't include ${day}`);
    }
    if (!period) throw new Error(`NWS's forecast has no ${wantDaytime ? "daytime" : "night"} period left today`);
    return {
      place: label, when, periods: [{ name: period.name, temperature: period.temperature, unit: period.temperatureUnit, forecast: period.shortForecast }],
      locatedBy: located.basis,
      source: "National Weather Service forecast, no API key required",
      display: {
        title: `${wantDaytime ? "High" : "Low"} · ${label}`,
        subtitle: `${period.name} · forecast, not the current reading`,
        stats: [{ label: wantDaytime ? "high" : "low", value: `${period.temperature}°${period.temperatureUnit}` }],
        rows: [{ name: period.name, value: `${period.temperature}°${period.temperatureUnit}`, meta: period.shortForecast }],
        note: located.basis,
        source: "NWS forecast",
      },
    };
  }

  // A named day, tonight or tomorrow: the matching period, and its night.
  if (when !== "week" && when !== "weekend") {
    const wanted = periods.filter((p) => dayLike(p).includes(when));
    const hit = wanted.length ? wanted : periods.filter((p) => dayLike(p).startsWith(when));
    if (!hit.length) {
      throw new Error(`NWS's forecast only reaches ${periods[periods.length - 1].name} - "${when}" is outside it`);
    }
    return {
      place: label, when, periods: hit.map((p) => ({ name: p.name, temperature: p.temperature, unit: p.temperatureUnit, forecast: p.shortForecast, wind: p.windSpeed })),
      locatedBy: located.basis,
      source: "National Weather Service forecast, no API key required",
      display: {
        title: `Forecast · ${label}`,
        subtitle: hit.map((p) => p.name).join(" and "),
        stats: hit.slice(0, 3).map((p) => ({ label: p.name.split(" ")[p.name.split(" ").length - 1] === "Night" ? "low" : "high", value: `${p.temperature}°${p.temperatureUnit}` })),
        rows: hit.map((p) => ({ name: p.name, value: `${p.temperature}°${p.temperatureUnit}`, meta: p.shortForecast })),
        note: located.basis,
        source: "NWS forecast",
      },
    };
  }

  // A week: the daytime highs, which is what "weekly average" means to a
  // person. Labelled as a forecast average, not a historical one.
  const days = periods.filter((p) => p.isDaytime).slice(0, when === "weekend" ? 7 : 7);
  const temps = days.map((p) => p.temperature).filter((n) => Number.isFinite(n));
  const avg = temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null;
  const unit = (days[0] && days[0].temperatureUnit) || "F";
  return {
    place: label, when: "week",
    averageHigh: avg, high: temps.length ? Math.max(...temps) : null, low: temps.length ? Math.min(...temps) : null,
    days: days.map((p) => ({ name: p.name, temperature: p.temperature, forecast: p.shortForecast })),
    locatedBy: located.basis,
    source: "National Weather Service forecast, no API key required",
    display: {
      title: `Forecast week · ${label}`,
      subtitle: `${days.length}-day outlook · daytime highs`,
      stats: [
        { label: "avg high", value: `${avg}°${unit}` },
        { label: "warmest", value: `${Math.max(...temps)}°${unit}` },
        { label: "coolest", value: `${Math.min(...temps)}°${unit}` },
      ],
      rows: days.map((p) => ({ name: p.name, value: `${p.temperature}°${p.temperatureUnit}`, meta: p.shortForecast })),
      caveat: "this is the forecast for the coming week, not an average of past readings",
      note: located.basis,
      source: "NWS forecast",
    },
  };
}

const cToF = (c) => (c == null ? null : Math.round((c * 9 / 5 + 32) * 10) / 10);

// 536000 and 1320 are hard to compare at a glance; 536,000 and 1,320 are not.
function readable(n) {
  if (n == null || !Number.isFinite(Number(n))) return String(n);
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// Both weather tools need the same thing: a state, and a coordinate inside
// it. Kept in one place so they can't drift apart.
async function resolveWeatherPoint({ state, place }) {
  let stateCode = resolveStateCode(state) || (findStateInText(state || "") || {}).code
    || (findCityInText(place || state || "") || {}).code;

  // No state and an unfamiliar place: ask USGS where anything by that name
  // is. The city table only holds ~200 places, so this is what makes weather
  // work for the rest of the country rather than failing on Vancouver.
  if (!stateCode && place) {
    const found = await usgsFindGauges({ place }).catch(() => null);
    const firstState = found && found.states && found.states[0];
    if (firstState) stateCode = US_STATES[firstState.toLowerCase()];
  }
  if (!stateCode) throw new Error(`don't recognize "${state || place}" as a US state or known place`);

  const point = await nwsPointFor({ stateCode, place });
  return { ...point, stateCode };
}

async function nwsConditions({ state, place }) {
  const located = await resolveWeatherPoint({ state, place });
  const stateCode = located.stateCode;
  const point = located;
  const pRes = await fetch(`https://api.weather.gov/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`,
    { headers: { Accept: "application/geo+json" } });
  if (!pRes.ok) throw new Error(`NWS returned ${pRes.status} for that location`);
  const stationsUrl = ((await pRes.json()).properties || {}).observationStations;
  if (!stationsUrl) throw new Error("NWS has no observation stations for that location");

  const sRes = await fetch(stationsUrl, { headers: { Accept: "application/geo+json" } });
  const stations = sRes.ok ? (((await sRes.json()).features) || []) : [];
  if (!stations.length) throw new Error("no NWS observation stations near that location");

  // The nearest station is not always reporting, so walk a few.
  let obs = null, station = null;
  for (const st of stations.slice(0, 4)) {
    const id = st.properties && st.properties.stationIdentifier;
    if (!id) continue;
    const r = await fetch(`https://api.weather.gov/stations/${id}/observations/latest`,
      { headers: { Accept: "application/geo+json" } });
    if (!r.ok) continue;
    const body = await r.json();
    if (body && body.properties && body.properties.temperature && body.properties.temperature.value != null) {
      obs = body.properties;
      station = { id, name: st.properties.name };
      break;
    }
  }
  if (!obs) throw new Error("NWS stations near that location aren't reporting right now");

  const val = (k) => (obs[k] && obs[k].value != null ? obs[k].value : null);
  const tempC = val("temperature"), dewC = val("dewpoint");
  const humidity = val("relativeHumidity"), windKmh = val("windSpeed"), pressurePa = val("barometricPressure");
  const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

  const stats = [];
  if (tempC != null) stats.push({ label: "temp", value: `${cToF(tempC)}°F` });
  if (humidity != null) stats.push({ label: "humidity", value: `${round(humidity, 0)}%` });
  if (dewC != null) stats.push({ label: "dew pt", value: `${cToF(dewC)}°F` });

  const rows = [];
  if (obs.textDescription) rows.push({ name: "Conditions", value: obs.textDescription, meta: "" });
  if (tempC != null) rows.push({ name: "Air temperature", value: `${cToF(tempC)}°F / ${round(tempC)}°C`, meta: "" });
  if (humidity != null) rows.push({ name: "Relative humidity", value: `${round(humidity, 0)}%`, meta: "" });
  if (dewC != null) rows.push({ name: "Dew point", value: `${cToF(dewC)}°F / ${round(dewC)}°C`, meta: "" });
  if (windKmh != null) rows.push({ name: "Wind speed", value: `${round(windKmh * 0.621371)} mph`, meta: "" });
  if (pressurePa != null) rows.push({ name: "Pressure", value: `${round(pressurePa / 3386.39, 2)} inHg`, meta: "" });

  return {
    state: stateCode.toUpperCase(),
    place: place || undefined,
    station: station.name ? `${station.name} (${station.id})` : station.id,
    locatedBy: point.basis,
    observedAt: obs.timestamp,
    conditions: obs.textDescription,
    airTemperatureC: round(tempC), airTemperatureF: cToF(tempC),
    relativeHumidityPercent: round(humidity, 0),
    dewPointC: round(dewC), windSpeedMph: round(windKmh == null ? null : windKmh * 0.621371),
    pressureInHg: round(pressurePa == null ? null : pressurePa / 3386.39, 2),
    source: "National Weather Service (api.weather.gov), no API key required",
    display: {
      title: `Weather now · ${place || stateCode.toUpperCase()}`,
      // Named explicitly: this is an observation at a specific station, which
      // is not what weather.gov's page shows for a city (a forecast for a
      // grid square), so the two legitimately differ.
      subtitle: `observed at ${station.name || station.id} · ${relativeAge(obs.timestamp)}`,
      stats, rows,
      note: point.basis,
      source: "NWS",
    },
  };
}

// History, which weather has had (through the forecast) and water has not:
// time questions about water were refused outright. USGS's daily-values
// service answers them - a daily mean per day, which is the right grain for
// "average discharge last month" and far less data than instantaneous values.
async function usgsTimeSeries({ site, place, parameter, days = 30 }) {
  const known = USGS_PARAM_CODES[parameter]
    ? { canonical: parameter, code: USGS_PARAM_CODES[parameter] }
    : findParameterInText(parameter || "") || {};
  if (!known.code) throw new Error(`don't recognize "${parameter}" as a water parameter`);

  let siteCode = /^\d{8,15}$/.test(String(site || "").trim()) ? String(site).trim() : null;
  let siteLabel = siteCode;
  // A name rather than a number: find the gauge first, the same way a
  // question naming a river does.
  if (!siteCode && (place || site)) {
    const found = await usgsFindGauges({ place: place || site });
    const first = (found.gauges || [])[0];
    if (!first) throw new Error(`couldn't find a gauge for "${place || site}"`);
    siteCode = first.id;
    siteLabel = first.name;
  }
  if (!siteCode) throw new Error("name a gauge, by USGS site number or by river");

  const span = Math.max(1, Math.min(365, Math.round(Number(days) || 30)));
  const end = new Date();
  const start = new Date(end.getTime() - span * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const url = "https://waterservices.usgs.gov/nwis/dv/?format=json" +
    `&sites=${siteCode}&parameterCd=${known.code}&statCd=00003&startDT=${iso(start)}&endDT=${iso(end)}`;

  const data = await fetchJson(url, "USGS Water Services");
  const ts = (data && data.value && data.value.timeSeries || [])[0];
  if (!ts) {
    return {
      site: siteCode, name: siteLabel, parameter: known.canonical, days: span, points: [],
      display: {
        title: `${known.canonical} history`,
        subtitle: `${siteLabel} reports no daily values for this parameter`,
        stats: [], rows: [],
        note: "not every gauge records every measurement - try discharge or gage height",
        source: "USGS daily values",
      },
    };
  }

  const points = ((ts.values && ts.values[0] && ts.values[0].value) || [])
    .map((p) => ({ date: String(p.dateTime).slice(0, 10), value: Number(p.value) }))
    .filter((p) => Number.isFinite(p.value) && p.value > -999998);
  const values = points.map((p) => p.value);
  const unit = (ts.variable && ts.variable.unit && ts.variable.unit.unitCode) || "";
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const round = (n) => (n == null ? null : Math.round(n * 100) / 100);

  // Gage height is measured from each gauge's own datum, but a single gauge
  // compared against itself over time is perfectly coherent - unlike the
  // cross-gauge case, where averaging is meaningless.
  return {
    site: siteCode, name: ts.sourceInfo && ts.sourceInfo.siteName || siteLabel,
    parameter: known.canonical, unit, days: span,
    count: points.length,
    mean: round(mean), min: round(Math.min(...values)), max: round(Math.max(...values)),
    first: points[0], last: points[points.length - 1],
    points: points.slice(-60),
    source: "USGS daily values (daily means), no API key required",
    display: {
      title: `${known.canonical} · last ${span} days`,
      subtitle: `${ts.sourceInfo && ts.sourceInfo.siteName || siteLabel} · ${points.length} daily means`,
      stats: values.length ? [
        { label: "mean", value: `${round(mean)} ${unit}` },
        { label: "min", value: `${round(Math.min(...values))} ${unit}` },
        { label: "max", value: `${round(Math.max(...values))} ${unit}` },
      ] : [],
      rows: points.slice(-6).reverse().map((p) => ({ name: p.date, value: `${p.value} ${unit}`, meta: "" })),
      note: "daily means at one gauge - comparable over time, unlike readings across gauges",
      source: "USGS",
    },
  };
}

// One gauge's full record: flood thresholds, the current category, the USGS
// site it pairs with. Answers "how close to flooding is this one" where
// waterFloodStatus answers it for a whole state.
async function nwpsGaugeDetail({ gauge }) {
  const id = String(gauge || "").trim().toUpperCase();
  if (!id) throw new Error("name a gauge, by its NWPS id (e.g. ACKI1)");
  const data = await fetchJson(`https://api.water.noaa.gov/nwps/v1/gauges/${encodeURIComponent(id)}`,
    "NOAA's National Water Prediction Service");

  const observed = (data.status && data.status.observed) || {};
  const forecast = (data.status && data.status.forecast) || {};
  const categories = (data.flood && data.flood.categories) || {};
  // NWPS writes -9999 where a threshold is not defined, which would read as a
  // real stage far below the river.
  const thresholds = Object.entries(categories)
    .map(([name, c]) => ({ name, stage: c && c.stage }))
    .filter((t) => Number.isFinite(t.stage) && t.stage > -9000);

  return {
    gauge: id,
    name: data.name,
    state: data.state && data.state.abbreviation,
    usgsId: data.usgsId || null,
    observed: { stage: observed.primary, unit: observed.primaryUnit, category: FLOOD_LABEL[observed.floodCategory] || observed.floodCategory, at: observed.validTime },
    forecast: { stage: forecast.primary, category: FLOOD_LABEL[forecast.floodCategory] || forecast.floodCategory },
    floodThresholds: thresholds,
    source: "NOAA National Water Prediction Service, no API key required",
    display: {
      title: `${data.name || id}`,
      subtitle: [data.state && data.state.abbreviation, observed.primary != null ? `${observed.primary} ${observed.primaryUnit || ""}` : null,
        FLOOD_LABEL[observed.floodCategory] || observed.floodCategory].filter(Boolean).join(" · "),
      stats: thresholds.slice(0, 3).map((t) => ({ label: t.name, value: `${t.stage} ${observed.primaryUnit || "ft"}` })),
      rows: [
        observed.primary != null ? { name: "Observed now", value: `${observed.primary} ${observed.primaryUnit || ""}`, meta: observed.validTime ? relativeAge(observed.validTime) : "" } : null,
        forecast.primary != null ? { name: "Forecast", value: `${forecast.primary} ${observed.primaryUnit || ""}`, meta: FLOOD_LABEL[forecast.floodCategory] || "" } : null,
        data.usgsId ? { name: "USGS gauge", value: data.usgsId, meta: "same site in USGS data" } : null,
      ].filter(Boolean),
      note: thresholds.length ? "stats are this gauge's own flood thresholds" : "no flood thresholds defined for this gauge",
      source: "NOAA NWPS",
    },
  };
}

// Available on every route, unlike TOOL_DEFS' per-site control tools - a data
// question doesn't care what page is open.
const DATA_TOOLS = [
  {
    name: "waterCurrentConditions",
    run: usgsCurrentConditions,
    description: "Look up current water readings at USGS stream gauges in a US state, without navigating to or clicking anything on any page. Use this to ANSWER a question about water conditions (e.g. 'what is the gage height in Alaska', 'how high is the discharge in Idaho'), as opposed to changing what a page displays.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", description: "US state name or two-letter code, e.g. Alaska or AK" },
        parameter: { type: "string", description: "which measurement: discharge, gage height, water temperature, specific conductance, dissolved oxygen, pH, turbidity, or precipitation" },
        nameContains: { type: "string", description: "optional filter on the gauge name, e.g. a river or town, to narrow a statewide answer to one place" },
      },
      required: ["state", "parameter"],
    },
  },
  {
    name: "weatherConditions",
    run: nwsConditions,
    description: "Current weather at the nearest National Weather Service station: air temperature, relative humidity, dew point, wind speed, barometric pressure and sky conditions. Use for weather questions - USGS measures water, not air.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", description: "US state name or two-letter code" },
        place: { type: "string", description: "optional city or place to locate the nearest station" },
      },
      required: ["state"],
    },
  },
  {
    name: "weatherForecast",
    run: nwsForecast,
    description: "National Weather Service forecast for a coming day or the week ahead - use for questions naming a day ('temperature on Friday'), tomorrow, tonight, or a week. weatherConditions answers 'right now' instead.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", description: "US state name or two-letter code" },
        place: { type: "string", description: "optional city or place" },
        when: { type: "string", description: "a weekday name, tonight, tomorrow, or week" },
      },
      required: ["when"],
    },
  },
  {
    name: "waterHistory",
    run: usgsTimeSeries,
    description: "Daily values at one gauge over a period - use for questions about the past week, month or year at a named river or USGS site number, such as average discharge last month.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "river or gauge name" },
        site: { type: "string", description: "USGS site number, if known" },
        parameter: { type: "string", description: "discharge, gage height, water temperature, ..." },
        days: { type: "number", description: "how many days back, up to 365; defaults to 30" },
      },
      required: ["parameter"],
    },
  },
  {
    name: "waterGaugeDetail",
    run: nwpsGaugeDetail,
    description: "One river gauge's full record: its flood thresholds, current and forecast stage, and the USGS site it pairs with. Use for 'how close to flooding is this gauge'.",
    parameters: {
      type: "object",
      properties: { gauge: { type: "string", description: "NWPS gauge id, e.g. ACKI1" } },
      required: ["gauge"],
    },
  },
  {
    name: "waterFindGauges",
    run: usgsFindGauges,
    description: "Find USGS gauges anywhere in the country by the name of a river, creek, lake or landmark, and optionally report a measurement at them. Use when a place is named but no state is - e.g. 'water temperature of the Bighorn River'.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "river, creek, lake or landmark name, e.g. Bighorn River" },
        parameter: { type: "string", description: "optional measurement: discharge, gage height, water temperature, ..." },
        state: { type: "string", description: "optional state, to pick between rivers that share a name - e.g. CA" },
      },
      required: ["place"],
    },
  },
  {
    name: "waterFloodStatus",
    run: nwpsFloodStatus,
    description: "Check which river gauges in a US state are at or above flood action stage, observed or forecast. Use for questions about flooding, high water, or whether rivers are near flood stage.",
    parameters: {
      type: "object",
      properties: { state: { type: "string", description: "US state name or two-letter code" } },
      required: ["state"],
    },
  },
  {
    name: "waterAlerts",
    run: nwsAlerts,
    description: "List active National Weather Service alerts for a US state - flood watches, warnings and advisories by default. Use for questions about warnings, watches, or advisories currently in effect.",
    parameters: {
      type: "object",
      properties: {
        state: { type: "string", description: "US state name or two-letter code" },
        floodOnly: { type: "boolean", description: "true (default) for flood-related alerts only; false for every active alert" },
      },
      required: ["state"],
    },
  },
];

/* ---------------------------------------------------------------------------
 * Model-free matching against a page's own controls.
 *
 * The named manifests (USGS, SITE, NOAA, FCP) each have a hand-written fast
 * path, but an arbitrary site had none - every instruction on an unmapped
 * page fell straight to the model, which is precisely the slow, unreliable
 * tier. Yet inventory() already returns every control with a human label and
 * a real selector, so "click year to date" can be matched against those
 * labels directly, with no model involved at all.
 *
 * This is the cheap half of a two-stage design: match literally here, and
 * leave genuinely ambiguous phrasing to a model. It deliberately refuses to
 * guess - a wrong click on an unknown page is worse than saying "did you
 * mean one of these three".
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "to", "on", "in", "of", "for", "and", "or", "is", "are",
  "please", "click", "press", "select", "choose", "set", "show", "switch",
  "change", "toggle", "open", "me", "my", "it", "this", "that", "button",
  "option", "tab", "give", "get", "want", "would", "like", "can", "you",
]);

// Accents folded away before anything is compared. Splitting on [^a-z0-9]
// treated every accented letter as a word boundary, so "Espanol" could never
// reach a link labelled "Espanol" - the label tokenised to "espa" and "ol",
// two fragments matching nothing. Every federal site carries that link by
// law, and the same break hit "Mayaguez", "Canon City" and every other
// place name a river gauge is named after.
function foldAccents(text) {
  try { return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  catch (e) { return String(text || ""); }
}

function meaningfulWords(text) {
  return foldAccents(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    // A lone digit is a word. Dropping anything shorter than two characters
    // turned "7-day anomaly" into "day anomaly", which matched a Current Data
    // Layer box and typed the rest into it - while the 7-day button sat right
    // there. On a river page the number is the whole distinction: 1-day,
    // 3-day and 7-day are different questions, and 30-day survived only by
    // having two digits.
    .filter((w) => (w.length > 1 || /^[0-9]$/.test(w)) && !STOP_WORDS.has(w));
}

// How well one control's label answers the instruction. Whole-phrase hits
// score far above scattered word hits, so "year to date" prefers a control
// actually labelled "Year to date" over one merely containing "date".
function scoreControl(control, words, phrase, opts = {}) {
  const label = foldAccents(control.label || "").toLowerCase();
  if (!label) return 0;
  // A hidden input cannot be clicked, typed into or seen. Five of them sat in
  // the candidate list on mywaterway.epa.gov, tied with the real search box,
  // and one tie-break away from being "the control you asked for".
  if (String(control.type || "").toLowerCase() === "hidden") return 0;
  let score = 0;
  if (phrase && label.includes(phrase)) score += 10 + phrase.length / 10;
  for (const w of words) {
    const hit = wordMatchesText(w, label);
    if (hit === "exact") score += 2;
    else if (hit === "fuzzy") score += 1.5; // below exact, never instead of it
  }
  if (label === phrase) score += 10;
  // Compared the same way on both sides. The instruction's phrase has its
  // filler words stripped - "Secretary of Energy" arrives as "secretary
  // energy" - while the label kept its "of", so an exact match never
  // registered and the control named word for word tied with "Deputy
  // Secretary of Energy". Whole-label matches are the strongest signal a
  // page offers and were the one thing not being recognised.
  if (phrase && meaningfulWords(control.label || "").join(" ") === phrase) score += 10;
  // A dropdown's label is often a category ("Variable") while the thing the
  // user actually named is one of its options ("Precipitation"), so options
  // count too - scored below a label hit, since naming the option is a
  // slightly weaker signal about which control was meant.
  for (const o of control.options || []) {
    const text = String(o.text || o.value || "").toLowerCase();
    if (!text) continue;
    if (text === phrase) score += 8;
    else if (words.some((w) => wordMatchesText(w, text) === "exact")) score += 3;
    else if (words.some((w) => wordMatchesText(w, text))) score += 2.5;
  }
  // A low-confidence row is a cursor:pointer guess, not a known control.
  if (control.confidence === "low") score -= 1.5;

  // Between two controls of the same name, the one on the screen. Federal
  // sites carry their search twice - header and collapsed mobile menu - and
  // document order picked the mobile one, so usa.gov typed into a field
  // nobody could see and the page did nothing at all. Small, and smaller
  // still where something is known to open it: a layer behind a panel is
  // hidden too, and reaching those is the entire point of the disclosure
  // work, so this must not outweigh a genuine name match.
  if (score > 0 && control.hidden) score -= control.revealedBy ? 0.5 : 2;

  // A thing you can switch on beats a thing you can only navigate to, when
  // both are called the same. water.noaa.gov has "Flood Inundation Mapping"
  // as a navbar link and as a map layer, and the link kept winning - so
  // "enable flood inundation" left the page instead of turning anything on,
  // and "enable snow water equivalent" offered five nav links. The layer is
  // what was meant: a link cannot be enabled.
  // Only among controls that matched something: a free gift to every select
  // on the page let a Basemap dropdown that matched no word at all outrank a
  // button the instruction actually named.
  const kind = String(control.kind || "").toLowerCase();
  const type = String(control.type || "").toLowerCase();
  if (score > 0 && (type === "checkbox" || type === "radio" || kind === "checkbox"
      || kind === "select" || (control.options && control.options.length))) {
    score += 3;
  }

  // The same principle one step along: where the instruction carries text to
  // put somewhere, a control that can hold text beats one that cannot. On
  // mywaterway.epa.gov "search for smith river" tied the search box against a
  // submit button and a drawer-opening button, all on the word "search", and
  // the tie went to whichever came first in the document - so the query was
  // never typed anywhere. A button cannot be typed into, exactly as a link
  // cannot be enabled.
  if (score > 0 && opts.wantsText) {
    if (TEXT_INPUT_KINDS.has(type) || kind === "textarea") score += 4;
    else if (kind === "button" || type === "submit" || type === "button") score -= 1;
  }
  return score;
}

// Typo tolerance for control matching.
//
// editDistance and allowedTypos already existed, but only the data side used
// them - states, cities, measurements. Every control matcher compared
// exactly, so "selct thudnerstorms" found nothing at all while "select
// thunderstorms" worked. The same slip that was forgiven when asking about a
// river was fatal when operating the page, which is the wrong way round given
// driving the site is the primary job.
//
// Exact matches are always tried first and scored higher, so correct spelling
// can never lose to a fuzzy hit elsewhere.
// Control matching gets a slightly more permissive budget than data matching.
// Data compares against a global vocabulary where "stage" and "state" are one
// edit apart and mean different things, so short words must match exactly.
// Control compares against the labels of one specific page, where the risk of
// a four-letter collision is far lower and the cost of refusing "zom in" is
// an action that simply does not happen.
function controlTypoBudget(word) {
  if (word.length < 4) return 0;
  if (word.length < 6) return 1;
  return word.length >= 9 ? 2 : 1;
}

function wordMatchesText(rawWord, rawText) {
  const word = foldAccents(rawWord).toLowerCase();
  const text = foldAccents(rawText).toLowerCase();
  if (!word || !text) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A short word matching by prefix is noise. "Go to mayaguez tide gauge"
  // offered a USAGov footer link and a webmaster address, because "go"
  // prefix-matched "Government" and "gov" - the only word of four that
  // matched anything, and the one word that carried no meaning.
  const boundary = word.length <= 3 ? "\\b" : "";
  if (new RegExp(`\\b${escaped}${boundary}`).test(text)) return "exact";

  // People close up compounds that a page spaces out, and the reverse.
  // "Dewpoint" and "Dew Point/Humidity" are the same thing, and matching
  // token against token never sees it. Long words only: closing up the
  // spaces makes short ones match almost anything.
  if (word.length >= 5 && String(text).replace(/[^a-z0-9]+/g, "").includes(word.replace(/[^a-z0-9]+/g, ""))) {
    return "exact";
  }

  // A multi-word value ("30 days", "year to date") never matches a single
  // token, so it needs a sliding window across the text instead.
  if (/\s/.test(word)) {
    const parts = word.split(/\s+/);
    const tokens = String(text).split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      const window = tokens.slice(i, i + parts.length).join(" ");
      const allowed = controlTypoBudget(word.length > window.length ? word : window);
      if (allowed && editDistance(window, word) <= allowed) return "fuzzy";
    }
    return false;
  }

  for (const token of String(text).split(/[^a-z0-9]+/)) {
    if (!token) continue;
    // The longer of the two sets the budget: matching "sat" against
    // "satellite" is not a typo, it is a different word.
    const allowed = controlTypoBudget(token.length > word.length ? token : word);
    if (!allowed) continue;
    if (Math.abs(token.length - word.length) > allowed) continue;
    if (editDistance(token, word) <= allowed) return "fuzzy";
  }
  return false;
}

// Which instruction words a control's label or options actually account for.
// Used to let several controls divide one instruction between them.
function wordsCoveredBy(control, words) {
  const label = foldAccents(control.label || "").toLowerCase();
  const optionText = (control.options || [])
    .map((o) => foldAccents(o.text || o.value || "").toLowerCase()).join(" ");
  const hay = `${label} ${optionText}`;
  const hit = words.filter((w) => wordMatchesText(w, hay));
  // A control matched only by the instruction's verb has not been matched.
  // "Enable snow depth" clicked a control literally labelled "Enabled" -
  // covered by the word "enable" and nothing else - alongside a nav link
  // called National Snow Analysis, and left "depth" unaccounted for.
  const subject = hit.filter((w) => !verbFamily(w) && !CONTROL_VERB.test(w));
  if (subject.length) return hit;

  // Unless the control is genuinely called that. "Close", "Search",
  // "Download", "Reset" and "Clear" are ordinary button names as well as
  // verbs, and the rule above made every one of them permanently
  // unreachable - "click Close" matched nothing on three of five federal
  // sites tested. A label that IS the word is the strongest signal there is,
  // not the weakest. Still strict: the whole label has to be that word, so
  // "Enabled" is not reached by "enable", which is the case the rule exists
  // for.
  const bare = label.replace(/[^a-z0-9]+/g, " ").trim();
  if (bare && hit.some((w) => w === bare)) return hit;
  return [];
}

// Picks the option inside a <select> that the instruction named.
function matchOption(control, words) {
  const options = control.options || [];
  if (!options.length) return null;
  // Weighed, not first-past-the-post. This took the first option where any
  // single word matched, so "set the time span to 30 day" picked "1 day" -
  // the first option in the list, matched on the word "day" alone, with the
  // number that was the entire point of the instruction ignored. Every
  // option is scored, and an option matched whole beats one matched in part.
  const phrase = words.join(" ");
  let best = null, bestScore = 0;
  for (const o of options) {
    const text = String(o.text || o.value || "").toLowerCase();
    if (!text) continue;
    let score = 0;
    if (meaningfulWords(text).join(" ") === phrase) score += 10;
    for (const w of words) {
      const hit = wordMatchesText(w, text);
      if (hit === "exact") score += 2;
      else if (hit) score += 1;   // fuzzy, below exact, never instead of it
    }
    if (score > bestScore) { best = o; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

// What the instruction wants done to a checkbox. Absent an explicit verb,
// ticking is the safer reading: someone naming a filter usually wants it on.
const TURN_ON = /\b(turn on|enable|show|tick|check|add|include|display|select)\b/i;
const TURN_OFF = /\b(turn off|disable|hide|untick|uncheck|remove|exclude|clear|deselect)\b/i;

function checkboxIntent(instruction) {
  if (TURN_OFF.test(instruction)) return false;
  if (TURN_ON.test(instruction)) return true;
  return true;
}

// The text to type. A quoted string is unambiguous; otherwise whatever
// follows a search cue is the query, since "search for Boise" means Boise and
// not "search for". Falling back to the leftover words handles "Boise in the
// search box".
// Words that name the control rather than anything to put in it. "Open the
// search box" is a request to open it; taking "box" as the query and typing
// that is a confidently wrong action.
const CONTROL_NOUNS = /\b(box|bar|field|input|form|textbox|text box|widget|control|panel)\b/gi;

function valueToType(instruction, control) {
  const quoted = (instruction || "").match(/["']([^"']{2,60})["']/);
  if (quoted) return quoted[1];

  const cue = (instruction || "").match(/\b(?:search(?:\s+for)?|look\s*up|find|type|enter|query)\b[:\s]+(.{2,60})$/i);
  if (cue) {
    const cleaned = cue[1]
      .replace(/\s+(in|into|on)\s+the\s+(search|box|field|bar).*$/i, "")
      .replace(CONTROL_NOUNS, " ")
      .replace(/\b(the|a|an)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Nothing left but the control's own name: there is no query here.
    return cleaned.length >= 2 ? cleaned : null;
  }

  const label = (control.label || "").toLowerCase();
  const leftovers = meaningfulWords(instruction)
    .filter((w) => !label.includes(w) && !CONTROL_NOUNS.test(w));
  CONTROL_NOUNS.lastIndex = 0; // the /g flag makes .test stateful
  return leftovers.length ? leftovers.join(" ") : null;
}

const TEXT_INPUT_KINDS = new Set(["text", "search", "email", "url", "tel", "number", "textarea"]);

function toolCallFor(control, words, instruction = "") {
  const kind = String(control.kind || "").toLowerCase();
  const type = String(control.type || "").toLowerCase();

  if (kind === "select" || (control.options && control.options.length)) {
    const option = matchOption(control, words);
    if (!option) return null;
    // Picking an option is often only half of it: plenty of dropdowns sit in
    // a form with a Go button and do nothing on change alone. "Click Alaska"
    // means land on Alaska's page, not leave the box reading Alaska. submit()
    // recognises a select that navigates on its own and stands down.
    return { name: "pageSelectOption", args: { selector: control.selector, value: option.value || option.text }, thenSubmit: true };
  }

  // A search box needs filling, not clicking - clicking one does nothing
  // visible, which is exactly how this failed before: the control matched and
  // the action was useless.
  if (TEXT_INPUT_KINDS.has(type) || TEXT_INPUT_KINDS.has(kind)) {
    const value = valueToType(instruction, control);
    // "Open the search box" names no query, so clicking it - which focuses
    // and opens a collapsed one - is what was actually asked for.
    if (!value) return { name: "pageClick", args: { selector: control.selector } };
    return { name: "pageFill", args: { selector: control.selector, text: value }, thenSubmit: true };
  }

  if (type === "checkbox" || kind === "checkbox") {
    return { name: "pageCheck", args: { selector: control.selector, on: checkboxIntent(instruction) } };
  }

  if (type === "radio" || kind === "radio") {
    return { name: "pagePickRadio", args: { group: control.name || control.label || "", value: control.label || control.value || "" } };
  }

  return { name: "pageClick", args: { selector: control.selector } };
}

// A responsive site ships the same control twice - a desktop copy and a
// mobile one, both in the DOM - so "Search Text Box" and "Mobile Search Text
// Box" tie, and treating them as rivals refuses a request that is not
// actually ambiguous. Normalising away the responsive qualifiers reveals they
// are the same thing, and either will do.
const RESPONSIVE_QUALIFIERS = /\b(mobile|desktop|tablet|small|large|compact|mini|primary|secondary|top|bottom|header|footer|sr[- ]only|screen[- ]reader)\b/gi;

function normalizedLabel(control) {
  return String(control.label || "")
    .toLowerCase()
    .replace(RESPONSIVE_QUALIFIERS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameControlRepeated(candidates) {
  const labels = candidates.map(normalizedLabel).filter(Boolean);
  return labels.length === candidates.length && new Set(labels).size === 1;
}

// Returns one or more tool calls, a short list to disambiguate, or null.
//
// One instruction often means several controls: "weekly average temperature"
// on a station page is a period, a statistic and a variable - three separate
// widgets. Matching only the single best control would set one of the three
// and silently ignore the rest, which is worse than failing, because the
// chart then looks answered while showing the wrong thing.
//
// So this assigns controls greedily: take the strongest match, strike the
// words it accounts for, and keep going while the remaining words still
// describe something. Each control must earn its place with words no earlier
// control already claimed.
// Does this instruction carry text that has to go somewhere? Quoted text
// always does; otherwise a search cue with something after it. Used to decide
// whether a control that can hold text should outrank one that cannot.
function carriesText(instruction) {
  const t = String(instruction || "");
  if (/["'“‘][^"'”’]{2,60}["'”’]/.test(t)) return true;
  return /\b(?:search(?:\s+for)?|look\s*up|find|type|enter|query)\b[:\s]+\S{2,}/i.test(t);
}

// The thing you can actually type into. Both search fallbacks took the first
// control in document order whose label merely contained the word "search" -
// which on mywaterway.epa.gov is a button called "Open search drawer". It got
// a click, the query went nowhere, and the card reported a search. A button
// is never the box, however it is labelled: a real text field first, and one
// that also says "search" ahead of one that does not.
function findSearchBox(controls) {
  const typeOf = (c) => String(c.type || c.kind || "").toLowerCase();
  const textual = (c) => TEXT_INPUT_KINDS.has(typeOf(c)) || typeOf(c) === "textarea";

  // Federal sites carry the same search twice - once in the header and once
  // inside the collapsed mobile menu - and taking the first in document
  // order took the mobile one. usa.gov filled
  // #search-field-small-mobile-menu, which is not on the screen, and the
  // page did exactly nothing. A box nobody can see is the last resort, not
  // the first; and one that can be opened first beats one that cannot be
  // opened at all.
  const rank = (c) => {
    let r = 0;
    if (!c.hidden) r += 4;                 // on the screen now
    else if (c.revealedBy) r += 2;         // openable, and the runner opens it
    if (/\bsearch\b/i.test(c.label || "")) r += 1;
    if (typeOf(c) === "search") r += 1;
    return r;
  };
  const boxes = controls.filter(textual);
  if (!boxes.length) return null;
  return boxes.slice().sort((a, b) => rank(b) - rank(a))[0];
}

function planGenericTool(instruction, inventory) {
  const controls = (inventory && inventory.controls) || [];
  if (!controls.length) return null;

  const allWords = meaningfulWords(instruction);
  if (!allWords.length) return null;
  const wantsText = carriesText(instruction);
  const phrase = allWords.join(" ");

  const calls = [];
  const matched = [];
  const used = new Set();
  let remaining = [...allWords];

  while (remaining.length) {
    const scored = controls
      .filter((c) => !used.has(c.selector))
      .map((c) => ({ control: c, score: scoreControl(c, remaining, remaining.join(" "), { wantsText }) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) break;

    const best = scored[0];
    const runnerUp = scored[1];
    // A near-tie only means ambiguity when the two controls are claiming the
    // SAME words - "Year to date" and "Date range" both answering "date".
    // Controls covering different words aren't rivals, they're the separate
    // halves of one instruction ("weekly" + "average" + "temperature"), and
    // treating those as ambiguous was rejecting exactly the case this whole
    // multi-control pass exists to handle.
    const sameWords = (a, b) => {
      const x = wordsCoveredBy(a, remaining).slice().sort().join(" ");
      const y = wordsCoveredBy(b, remaining).slice().sort().join(" ");
      return x === y;
    };
    const tied = scored.filter((x) => best.score - x.score < 2 && sameWords(x.control, best.control));
    // Several copies of one control are not a choice to put to the user.
    // Nor are several controls called the same thing. nps.gov carries three
    // labelled exactly "Search" - a link, a button and a text field - and
    // census.gov, nasa.gov, data.gov and AirNow all do something similar.
    // "Which one did you mean?" offers a list the person cannot tell apart
    // either, since the only thing shown is the label they all share. Acting
    // on the best of them and reporting what moved beats handing back a
    // question with no way to answer it.
    const oneLabel = tied.length > 1 && new Set(
      tied.map((x) => String(x.control.label || "").trim().toLowerCase()).filter(Boolean)).size === 1;
    const duplicates = tied.length > 1
      && (sameControlRepeated(tied.map((x) => x.control)) || oneLabel);
    const rivals = !duplicates && runnerUp && best.score - runnerUp.score < 2 && sameWords(best.control, runnerUp.control);
    if (rivals) {
      if (!calls.length) {
        // "look up 8443970" tied three unrelated links on a real site, and
        // asking which was meant is the wrong answer when the instruction
        // plainly says to search and the page has somewhere to type.
        // Only when there is something to type. The word "search" alone is not
        // a query: "click Search" means press the button of that name, and
        // routing it to the box filled nothing into nothing and reported a
        // search on five of seventeen sites tested.
        const searching = carriesText(instruction);
        const box = searching && findSearchBox(controls);
        if (box) {
          const call = toolCallFor(box, allWords, instruction);
          if (call) {
            const submitAfter = call.thenSubmit;
            delete call.thenSubmit;
            const calls = [call];
            const matched = [{ label: box.label, selector: box.selector, covered: allWords }];
            if (submitAfter) {
              calls.push({ name: "pageSubmit", args: { selector: box.selector } });
              matched.push({ label: `submit ${box.label || "search"}`, selector: box.selector, covered: [] });
            }
            return { calls, matched, unmatchedWords: [], phrase };
          }
        }
        return {
          // Each candidate carries the call it would make, so picking one is
          // a click rather than a retyped instruction.
          ambiguous: scored
            .filter((x) => sameWords(x.control, best.control))
            .slice(0, 5)
            .map((x) => ({
              label: x.control.label, selector: x.control.selector, kind: x.control.kind,
              call: toolCallFor(x.control, allWords, instruction),
            }))
            .filter((c) => c.call),
        };
      }
      break; // some controls already settled; don't guess at the leftovers
    }

    const call = toolCallFor(best.control, remaining, instruction);
    if (!call) break;
    // Typing a query and never submitting it leaves the page unchanged while
    // the input's value change makes it look like the action worked.
    const follow = call.thenSubmit ? { name: "pageSubmit", args: { selector: call.args.selector } } : null;
    delete call.thenSubmit;

    const covered = wordsCoveredBy(best.control, remaining);
    if (!covered.length) break;

    // One instruction should not toggle two of the same thing. "Click flood
    // depth gauge" matched Flood Inundation Mapping on "flood" and Snow
    // Depth on "depth", covered every word between them, and switched on two
    // unrelated layers. The legitimate multi-control case is different in
    // kind as well as in count - "weekly average temperature" sets a period,
    // a statistic and a variable, three different sorts of control - so a
    // second control of a kind already used is a sign the instruction named
    // one thing and it has been read as two.
    // Which kind repeats is the whole distinction. Setting three dropdowns
    // is one configuration - "weekly average temperature" picks a period, a
    // statistic and a variable, and each match is on an option inside its
    // own select. Ticking two checkboxes, or following two links, is two
    // separate actions, and one instruction rarely means two.
    const ONE_AT_A_TIME = new Set(["checkbox", "radio", "a", "link", "button"]);
    // The kind of an <input type=checkbox> is "input"; what distinguishes it
    // is the type. Checking only kind meant every checkbox looked like every
    // other input and the rule never fired on the case it was written for.
    const kindOf = (c) => String(c.type || c.kind || "").toLowerCase();
    const kind = kindOf(best.control);
    const sameKindAlready = matched.some((m) => m.kindKey === kind);
    const listsSeveral = /\band\b|,|\bthen\b/i.test(instruction);
    if (ONE_AT_A_TIME.has(kind) && sameKindAlready && !listsSeveral) break;

    calls.push(call);
    matched.push({ label: best.control.label, selector: best.control.selector, covered,
      kind: best.control.kind, kindKey: kindOf(best.control) });
    if (follow) {
      calls.push(follow);
      matched.push({ label: `submit ${best.control.label || "search"}`, selector: best.control.selector, covered: [] });
    }
    used.add(best.control.selector);
    remaining = remaining.filter((w) => !covered.includes(w));
  }

  // "look up 13206000" names no control - a site number shares no words with
  // "Search station" - but the intent is plain. When the instruction asks to
  // search and the page has somewhere to type, that is the control meant,
  // even though scoring found nothing.
  if (!calls.length) {
    const searching = carriesText(instruction);
    if (searching) {
      const box = findSearchBox(controls);
      if (box) {
        const call = toolCallFor(box, allWords, instruction);
        if (call) {
          const submitAfter = call.thenSubmit;
          delete call.thenSubmit;
          const calls = [call];
          const matched = [{ label: box.label, selector: box.selector, covered: allWords }];
          if (submitAfter) {
            calls.push({ name: "pageSubmit", args: { selector: box.selector } });
            matched.push({ label: `submit ${box.label || "search"}`, selector: box.selector, covered: [] });
          }
          return { calls, matched, unmatchedWords: [], phrase };
        }
      }
    }
    return null;
  }
  // A plan that leaves the distinguishing word behind is not a plan.
  // "Click snow depth" matched a nav link called National Snow Analysis on
  // the word "snow", reported "nothing on this page matched: depth", and
  // clicked it anyway - so the one word that said which thing was meant was
  // printed as a caveat and then ignored.
  //
  // If a word that is neither a verb nor filler goes unaccounted for, the
  // control named is not on this page, and saying so beats pressing the
  // nearest thing that shares a word with it.
  //
  // Except for words that were typed. `search station "Big Sandy River"`
  // covers "station" and leaves big/sandy/river over, which outnumber it and
  // sank the whole plan - yet those three words are the query, sitting in the
  // pageFill this very plan is about to run. A word that went into the box is
  // accounted for; counting it as missed rejects exactly the searches that
  // name their target, while "search for Boise" survived only by being short.
  const typed = new Set(calls.flatMap((c) => c.name === "pageFill"
    ? meaningfulWords(String((c.args && c.args.text) || "")) : []));
  const missedSubject = remaining.filter((w) =>
    !verbFamily(w) && !CONTROL_VERB.test(w) && w.length > 2 && !typed.has(w)
    && !looksLikeMisspelledVerb(w));
  const coveredSubject = matched.reduce((n, m) => n + (m.covered || [])
    .filter((w) => !verbFamily(w) && !CONTROL_VERB.test(w)).length, 0);
  if (missedSubject.length && missedSubject.length >= coveredSubject) return null;

  return { calls, matched, unmatchedWords: remaining, phrase };
}

// Controls that scored something but not enough to act on. A failure that
// names the three closest things on the page is far more useful than one
// that lists the first twelve in DOM order - it tells you whether your
// wording was close, or whether the control simply isn't there.
function nearMissControls(instruction, inventory, limit = 8) {
  const controls = (inventory && inventory.controls) || [];
  const words = meaningfulWords(instruction);
  if (!words.length || !controls.length) return [];
  const phrase = words.join(" ");

  // Scored first, then anything merely sharing a word. A failure that lists
  // what is actually on the page is the difference between "it doesn't work"
  // and knowing why: on a page reporting 71 controls, six were shown and all
  // six came from the alert banner, so nobody could tell whether the control
  // being asked for existed at all.
  const scored = controls
    .map((c) => ({ control: c, score: scoreControl(c, words, phrase) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const shared = controls.filter((c) => {
    if (scored.some((x) => x.control === c)) return false;
    const label = String(c.label || "").toLowerCase();
    return words.some((w) => w.length > 2 && !verbFamily(w) && wordMatchesText(w, label));
  }).map((c) => ({ control: c, score: 0 }));

  return [...scored, ...shared]
    .slice(0, limit)
    .map((x) => ({
      label: x.control.label, selector: x.control.selector, kind: x.control.kind,
      hidden: x.control.hidden || undefined,
    }));
}

// Everything this extension could do on the page currently open. Built from
// the same tables the planners use, so it can't drift out of step with what
// is actually wired up.
function capabilitiesFor(routeGlobal) {
  return {
    dataQuestions: DATA_TOOLS.map((t) => t.name),
    pageTools: (TOOL_DEFS[routeGlobal] || []).map((t) => t.name),
    route: routeGlobal,
  };
}

// Assembles the "I couldn't do that" answer once every path has genuinely
// been tried: data tools, the named-manifest keyword path, and a full scan of
// the page's own controls. It reports what was understood, what was searched,
// and what is available - so the reply is a diagnosis rather than a shrug.
function explainFailure(instruction, route, inv, { modelOff }) {
  const parameter = findParameterInText(instruction);
  const state = findStateInText(instruction);
  const city = findCityInText(instruction);

  const understood = [];
  if (parameter) understood.push(`measurement: ${parameter.canonical}${parameter.corrected ? " (corrected)" : ""}`);
  if (state) understood.push(`state: ${state.name}`);
  if (city) understood.push(`city: ${city.city}`);

  const missing = [];
  if (parameter && !state && !city) missing.push("no state or city - these data sources are all state-scoped");
  if (!parameter && (state || city)) missing.push("no measurement named (discharge, gage height, water temperature, ...)");
  if (!parameter && !state && !city) missing.push("nothing recognizable as a place or a measurement");

  // A page that couldn't be read at all is a different problem from a page
  // that was read and didn't contain it - saying so avoids sending someone
  // hunting for better wording when the real issue is access.
  const pageReadable = !!(inv && inv.ok);
  const controls = pageReadable ? (inv.result.controls || []) : [];
  const near = pageReadable ? nearMissControls(instruction, inv.result) : [];
  const caps = capabilitiesFor(route.global);

  const rows = [];
  if (near.length) {
    for (const c of near) rows.push({ name: c.label || "(unlabelled)", value: "closest match", meta: c.selector, tone: "warn" });
  } else if (pageReadable) {
    for (const c of controls.filter((c) => c.label && c.confidence !== "low").slice(0, 6)) {
      rows.push({ name: c.label, value: c.kind || "", meta: c.selector });
    }
  }

  const checked = [
    `data questions (${caps.dataQuestions.length} available)`,
    route.global !== "GENERIC" ? `${route.global} page tools (${caps.pageTools.length})` : null,
    pageReadable ? `${controls.length} controls on this page`
      // Why, not just that. "Could not read this page's controls" sent people
      // rewording a question when the real answer was a timeout or a missing
      // permission - and on a page whose controls had been read moments
      // earlier it read as nonsense.
      : `could not read this page's controls${inv && inv.error ? ` - ${String(inv.error).slice(0, 70)}` : ""}`,
  ].filter(Boolean);

  return {
    ok: false,
    error: pageReadable
      ? `Couldn't find anything matching that. Checked ${checked.join(", ")}.`
      : `Couldn't read this page's controls, so only data questions were available - and that wasn't one. ${
          route.global === "GENERIC" ? 'If this is a new site, click "Enable on this site" first.' : ""
        }`.trim(),
    understood: understood.length ? understood : undefined,
    missing: missing.length ? missing : undefined,
    checked,
    nearMisses: near.length ? near : undefined,
    capabilities: caps,
    modelOff: modelOff || undefined,
    display: {
      title: "Couldn't do that",
      subtitle: understood.length
        ? `understood - ${understood.join(", ")}`
        : "nothing in that matched a place, a measurement, or a control on this page",
      stats: [],
      rows,
      note: near.length
        ? `${controls.length} controls on this page; these share a word with what you asked`
        : (missing.length ? missing[0] : undefined),
      source: pageReadable ? `${controls.length} controls scanned` : "page not readable",
      checked,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Answering from the page you are looking at.
 *
 * A data tool calls the agency directly, which is what makes it work from any
 * page - but it is the wrong instinct when the page already shows the answer.
 * Asked for a maximum on a forecast page, fetching a separate figure from NWS
 * and reporting that is both surprising and, because a station observation is
 * not a grid-square forecast, a different number from the one on screen.
 *
 * So data questions look at the page first and fall back to the agency. The
 * page is only trusted when it is plausibly about the same place: a question
 * naming somewhere the page never mentions is not answerable from it, and
 * silently reading Milwaukee's numbers for a question about Chicago would be
 * far worse than fetching.
 */
// A unit can stand in for the noun: pages write "High: 83 °F", never "High
// temperature: 83". Requiring the word "temperature" made every forecast page
// look as though it showed none.
const PAGE_VALUE_TERMS = {
  high: { terms: ["high", "max", "maximum", "hottest", "warmest"] },
  low: { terms: ["low", "min", "minimum", "coldest", "coolest"] },
  temperature: { terms: ["temperature", "temp"], unit: /°\s?[cf]\b|\bdegrees\b/i },
  humidity: { terms: ["humidity", "humid"] },
  dewpoint: { terms: ["dew point", "dewpoint", "dew"] },
  wind: { terms: ["wind", "gust"], unit: /\bmph\b|\bkts?\b|\bkm\/h\b/i },
  pressure: { terms: ["pressure", "barometric", "inhg"] },
  // Two quantities share the word "precipitation": how much has fallen, and
  // how likely it is to fall. A forecast page prints both, inches beside a
  // percentage, so a question about one must not be answered with the other.
  // The chance terms double as row matchers - "Chance of precipitation" is
  // both how it is asked and how weather.gov labels it.
  precipChance: {
    terms: ["chance of precip", "chance of rain", "chance of showers", "chance of storms",
      "chance of snow", "probability of precip", "precipitation probability",
      "will it rain", "will it snow"],
    // A "PoP" column header, which no one types as a question.
    unit: /\bpop\b/,
  },
  precipitation: {
    terms: ["precipitation", "precip", "rain", "rainfall"],
    // Keeps the measured concept off the chance row, which also says "precip".
    exclude: /\bchance\b|\bprobabilit|\bpop\b/,
  },
  gageHeight: { terms: ["gage height", "gauge height", "stage"] },
  discharge: { terms: ["discharge", "streamflow", "flow", "cfs"] },
};

function conceptMatches(concept, text) {
  const def = PAGE_VALUE_TERMS[concept];
  if (!def) return false;
  if (def.exclude && def.exclude.test(text)) return false;
  if (def.terms.some((t) => text.includes(t))) return true;
  return def.unit ? def.unit.test(text) : false;
}

function pageValueCandidates(pageData) {
  const rows = [];
  for (const p of (pageData.pairs || [])) rows.push({ label: p.label, text: `${p.label} ${p.value}`, value: p.value });
  for (const r of (pageData.readouts || [])) rows.push({ label: r.label || r.text, text: `${r.label || ""} ${r.text}`, value: r.text });
  for (const n of (pageData.labelledNumbers || [])) rows.push({ label: n.text, text: n.text, value: n.text });
  return rows;
}

// Does the page look like it is about the place that was asked about? Title
// and headings only - a forecast page mentions dozens of place names in its
// navigation, and matching those would make every page look relevant.
function pageIsAbout(pageData, place) {
  if (!place) return true; // no place named: the page is the obvious subject
  const hay = [pageData.title || "", ...(pageData.headings || [])].join(" ").toLowerCase();
  return place.toLowerCase().split(/\s+/).every((w) => w.length < 3 || hay.includes(w));
}

/* ---------------------------------------------------------------------------
 * Arithmetic over what the page shows.
 *
 * "Average temperature this week" answered with Thursday's max: the row was
 * found, one cell was picked, and the words "average" and "this week" were
 * discarded without trace. A table of seven days holds the answer, but only
 * if something adds them up.
 *
 * These are deliberately plain functions over numbers already extracted from
 * the page - a table row, a chart series, a map's features. Nothing here
 * fetches, and nothing guesses at a number's meaning: the caller has already
 * decided which row is the subject.
 */
const STATS = {
  mean: (v) => v.reduce((a, b) => a + b, 0) / v.length,
  sum: (v) => v.reduce((a, b) => a + b, 0),
  max: (v) => Math.max(...v),
  min: (v) => Math.min(...v),
  count: (v) => v.length,
  range: (v) => Math.max(...v) - Math.min(...v),
  median: (v) => {
    const s = [...v].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
};

// A cell is "64", "64 °F", "1,240 cfs", "-3.5", "15%". A cell that is only a
// label, a date or a dash carries no number and must not read as zero.
// Longest first: "acre-ft" must not read as "ft", which turned 26.8 million
// acre-feet into 26.8 million feet.
const UNIT_RE = /(acre-?ft|°\s?[CF]|%|\b(?:ft|cfs|in|mph|kts?|cms)\b)/i;
function cellNumber(cell) {
  const t = String(cell == null ? "" : cell).trim();
  if (!t || /^[-–—.\s]*$/.test(t)) return null;
  // A chart tooltip reads "Sep 14: 56 °F", and taking the first number in it
  // gives 14 - the date. A series of those averages to a confident number
  // with nothing to do with the chart. So a number wearing a unit wins, then
  // the number after the last colon, and only then the first one.
  const withUnit = t.match(new RegExp(`(-?\\d[\\d,]*\\.?\\d*)\\s*${UNIT_RE.source}`, "i"));
  const afterColon = t.includes(":") ? t.slice(t.lastIndexOf(":") + 1).match(/-?\d[\d,]*\.?\d*/) : null;
  const m = withUnit ? [withUnit[1]] : afterColon || t.match(/-?\d[\d,]*\.?\d*/);
  if (!m) return null;
  const n = Number(String(m[0]).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cellUnit(cell) {
  const m = String(cell == null ? "" : cell).match(UNIT_RE);
  return m ? m[1].replace(/\s+/g, "") : "";
}

// Which calculation the question asks for, if any.
//
// "Average" and "total" ask for one on their own. "Max" and "min" do not:
// "max temp" names the row called "Max Temp", and treating that as a
// calculation would answer a different question than the one asked. They
// count only alongside a span - "max temp this week" - where a single cell
// cannot be what was meant.
// The words that name the calculation rather than the thing calculated.
// What people say for values a schema spells its own way.
const ENUM_SYNONYMS = {
  mean: ["average", "avg"],
  sum: ["total", "combined", "altogether"],
  max: ["highest", "maximum", "peak", "hottest", "warmest", "largest", "biggest"],
  min: ["lowest", "minimum", "coldest", "coolest", "smallest"],
  median: ["middle"],
  count: ["how many", "number of"],
  range: ["spread", "difference", "swing"],
};

const AGGREGATE_WORDS = new Set(["average", "avg", "mean", "total", "sum", "combined",
  "altogether", "median", "count", "spread", "highest", "hottest", "warmest", "max",
  "maximum", "peak", "lowest", "coldest", "coolest", "min", "minimum", "how", "many", "of"]);

const SPAN_CUE = /\b(this|next|the)\s+(week|month)\b|\bover the (week|month|period)\b|\ball (days?|week)\b|\beach day\b|\b\d+[- ]day\b|\bweekly\b|\bacross\b/;
function aggregateWanted(text) {
  const t = (text || "").toLowerCase();
  const span = SPAN_CUE.test(t);
  if (/\b(average|avg|mean)\b/.test(t)) return { fn: "mean", word: "average" };
  if (/\b(total|sum|combined|altogether)\b/.test(t)) return { fn: "sum", word: "total" };
  if (/\b(median)\b/.test(t)) return { fn: "median", word: "median" };
  if (/\b(how many|count of|number of)\b/.test(t)) return { fn: "count", word: "count" };
  if (/\b(spread|difference between|swing)\b/.test(t)) return { fn: "range", word: "spread" };
  if (!span) return null;
  if (/\b(highest|hottest|warmest|max|maximum|peak)\b/.test(t)) return { fn: "max", word: "highest" };
  if (/\b(lowest|coldest|coolest|min|minimum)\b/.test(t)) return { fn: "min", word: "lowest" };
  return null;
}

// Rounded the way the inputs were written: whole degrees stay whole, a stage
// in hundredths keeps them. An average of integers is the one case that
// earns a decimal it was not given, because that is what an average is.
function formatStat(fn, value, samples) {
  if (fn === "count") return String(value);
  // Grouped the way the page wrote them. The rows read 26,803,406 and the
  // answer read 27485497.1 - the same quantity in two notations, one of them
  // unreadable at that size.
  const grouped = samples.some((x) => /\d,\d{3}/.test(String(x)));
  const decimals = Math.max(...samples.map((s) => {
    const m = String(s).match(/\.(\d+)/);
    return m ? m[1].length : 0;
  }), fn === "mean" ? 1 : 0);
  const fixed = value.toFixed(Math.min(decimals, 3));
  return grouped ? Number(fixed).toLocaleString("en-US", { maximumFractionDigits: Math.min(decimals, 3) }) : fixed;
}

function computeOver(fn, values) {
  const nums = values.map(cellNumber).filter((n) => n !== null);
  if (!nums.length) return null;
  return { value: STATS[fn](nums), used: nums.length, numbers: nums };
}

// Aggregating a table needs both of its orientations. A forecast grid puts
// the measurement down the side and days across the top; a gauge listing puts
// the measurement in a column header and one site per row. Either way the
// series is there, read along a different axis.
// Stage is measured from each gauge's own datum, so a column of it spanning
// several sites is arithmetic on incompatible references - 0.46 ft and 2004 ft
// are both correct readings of different rivers. The API path already refuses
// this; calculating it off a page reaches the same wrong number by a
// different route. Along a row is fine: that is one site over time.
// "Today", "Yesterday", "2 days ago", "1 week ago" down the side means each
// row is the same measurement at a different moment. Averaging or taking an
// extreme over that is meaningful; adding them together is not - it produced
// a statewide reservoir "total" of 219,891,203 acre-ft by summing eight
// snapshots of the same 26.8 million.
const TIME_LABEL = /^(today|yesterday|tomorrow|now|current)\b|\b\d+\s*(day|week|month|year)s?\s*ago\b|^\w{3,9}\s+\d{1,2}(,\s*\d{4})?$/i;
function looksLikeTimeSeries(labels) {
  const named = labels.filter((l) => String(l).trim());
  if (named.length < 3) return false;
  const timeish = named.filter((l) => TIME_LABEL.test(String(l).trim()));
  return timeish.length >= Math.ceil(named.length * 0.6);
}

function datumBlocked(subject, orientation) {
  if (orientation !== "column") return false;
  return conceptMatches("gageHeight", String(subject).toLowerCase());
}

function aggregateOnPage(pageData, { wants, place, agg, match }) {
  // Either a known concept ("temperature") or, when the caller names
  // something this vocabulary has never heard of, a plain word match against
  // the page's own labels.
  const hits = match || ((label) => wants.every((c) => conceptMatches(c, label)));
  if (!agg || (!match && !wants.length)) return null;
  if (!tableIsAbout(pageData, place)) return null;

  for (const table of pageData.tables || []) {
    const columns = table.columns || [];

    // The measurement names a row: read across it.
    for (const row of table.rows || []) {
      const label = String(row[0] || "");
      if (!label || !hits(label.toLowerCase())) continue;
      const cells = row.slice(1);
      const got = computeOver(agg.fn, cells);
      if (!got || got.used < 2) continue;
      return {
        subject: label, statistic: agg.word, over: `${got.used} columns`,
        value: formatStat(agg.fn, got.value, cells), unit: cellUnit(label) || cellUnit(cells.find((c) => cellNumber(c) !== null)),
        points: cells.map((c, i) => ({ name: String(columns[i + 1] || `column ${i + 2}`), value: String(c) }))
          .filter((pt) => cellNumber(pt.value) !== null),
      };
    }

    // The measurement names a column: read down it.
    const col = columns.findIndex((c) => c && hits(String(c).toLowerCase()));
    if (col === -1) continue;
    const cells = (table.rows || []).map((r) => r[col]);
    const got = computeOver(agg.fn, cells);
    if (!got || got.used < 2) continue;
    if (agg.fn === "sum" && looksLikeTimeSeries((table.rows || []).map((r) => r[0]))) {
      return {
        subject: String(columns[col]), statistic: agg.word, over: `${got.used} rows`,
        value: null, unit: "",
        refused: "these rows are the same measurement at different times, so adding them together means nothing - ask for the average instead, or name the row you want",
        points: (table.rows || []).map((r) => ({ name: String(r[0] || "row"), value: String(r[col]) }))
          .filter((pt) => cellNumber(pt.value) !== null),
      };
    }
    if (datumBlocked(columns[col], "column") && agg.fn !== "count") {
      return {
        subject: String(columns[col]), statistic: agg.word, over: `${got.used} rows`,
        value: null, unit: "", refused: "each gauge measures stage from its own datum, so these cannot be combined",
        points: (table.rows || []).map((r) => ({ name: String(r[0] || "row"), value: String(r[col]) }))
          .filter((pt) => cellNumber(pt.value) !== null),
      };
    }
    return {
      subject: String(columns[col]), statistic: agg.word, over: `${got.used} rows`,
      value: formatStat(agg.fn, got.value, cells), unit: cellUnit(String(columns[col])) || cellUnit(cells.find((c) => cellNumber(c) !== null)),
      points: (table.rows || []).map((r) => ({ name: String(r[0] || "row"), value: String(r[col]) }))
        .filter((pt) => cellNumber(pt.value) !== null),
    };
  }
  return null;
}

// The same arithmetic over a series that was never in the DOM - a chart read
// by hover, or a map's features. Both hand back objects with a numeric field
// rather than table cells, so the values are pulled out first.
function aggregateOverSeries(points, agg, subject) {
  if (!agg || !Array.isArray(points) || points.length < 2) return null;
  const cells = points.map((p) => (p && typeof p === "object" ? (p.value != null ? p.value : p.text) : p));
  const got = computeOver(agg.fn, cells);
  if (!got || got.used < 2) return null;
  return {
    subject: subject || "series", statistic: agg.word, over: `${got.used} points`,
    value: formatStat(agg.fn, got.value, cells), unit: cellUnit(cells.find((c) => cellNumber(c) !== null)),
    points: points.slice(0, 40).map((p, i) => ({
      name: String((p && (p.label || p.name || p.at)) || `point ${i + 1}`),
      value: String((p && (p.value != null ? p.value : p.text)) != null ? (p.value != null ? p.value : p.text) : p),
    })).filter((pt) => cellNumber(pt.value) !== null),
  };
}

// One card for any of them, so a number that was calculated never looks like
// a number that was read.
function computedDisplay(result, pageTitle) {
  if (result.refused) {
    return {
      title: `${result.subject} cannot be combined`.slice(0, 70),
      subtitle: result.refused,
      stats: [],
      rows: result.points.slice(0, 12).map((pt) => ({ name: pt.name.slice(0, 40), value: pt.value.slice(0, 20), meta: "" })),
      note: (pageTitle || "").slice(0, 70),
      source: "read from this page, not combined",
    };
  }
  const unit = result.unit ? ` ${result.unit}` : "";
  return {
    title: `${result.statistic} ${result.subject}`.replace(/\s+/g, " ").slice(0, 70),
    subtitle: `${result.value}${unit} · calculated from ${result.over} on this page`,
    stats: [{ label: result.statistic, value: `${result.value}${unit}` }],
    rows: result.points.slice(0, 12).map((pt) => ({ name: pt.name.slice(0, 40), value: pt.value.slice(0, 20), meta: "" })),
    note: (pageTitle || "").slice(0, 70),
    source: "calculated from this page",
  };
}

const STAT_WORDS = { mean: "average", sum: "total", max: "highest", min: "lowest",
  median: "median", count: "count", range: "spread" };

// pageCompute: arithmetic over whichever of the page's surfaces actually
// holds the numbers. A table is tried first because its labels are readable
// and its values exact. A chart is next, and is a reading of a picture - the
// series is sampled by hover, so it is approximate and says so. A map's
// features are last, since their numbers live in whatever the site chose to
// call its properties.
async function pageComputeRun({ fn, of, source = "auto" }) {
  if (!STATS[fn]) throw new Error(`no such calculation: ${fn}`);
  const agg = { fn, word: STAT_WORDS[fn] || fn };
  // "This week" says when, and a place says where; neither names the thing
  // being measured. Carrying them into the subject made the failure read
  // "nothing gave temperature week fremont as numbers", which describes a
  // phrase nobody was looking for.
  // argsForTool hands over already-tokenised words, so "this week" arrives
  // as a bare "week" that SPAN_CUE cannot see. Strip the span words
  // themselves, and the place, since neither names the thing measured.
  const SPAN_WORD = /^(this|next|last|past|week|month|year|today|tonight|tomorrow|day|days|weekly|monthly)$/i;
  const subject = String(of || "").split(/\s+/)
    .filter((w) => w && !SPAN_WORD.test(w)).join(" ").trim();
  const wants = pageValueWants(subject);
  const word = subject.toLowerCase();
  // An unknown subject still has to find its row; the page's own wording is
  // the only guide left.
  // Per word, and fuzzily: the phrase as typed rarely appears verbatim in a
  // column header, and "resevoir" should still find Reservoir Storage.
  const subjectWords = meaningfulWords(word).filter((w) => !AGGREGATE_WORDS.has(w));
  const match = wants.length ? null
    : (label) => subjectWords.length > 0 && subjectWords.every((w) => wordMatchesText(w, label));
  const tried = [];

  if (source === "auto" || source === "table") {
    const read = await invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
    if (read.ok) {
      const r = aggregateOnPage(read.result, { wants, place: null, agg, match });
      if (r) return { ...r, source: "table", display: computedDisplay(r, read.result.title) };
    }
    tried.push("table");
  }

  // The page's own downloads come before its pictures. A chart is a drawing
  // of a series the site already fetched; the fetch is exact and the drawing
  // is sampled, so reading the request beats hovering over the canvas every
  // time - and on a page whose numbers live only in a chart, it is the
  // difference between an answer and "nothing gave that as numbers".
  if (source === "auto" || source === "feed" || source === "chart") {
    const feeds = await invokeOnActiveTab("capturedSeries", [{}]).catch(() => ({ ok: false }));
    const series = (feeds.ok && feeds.result && feeds.result.series) || [];
    const subject = meaningfulWords(word).filter((w) => !AGGREGATE_WORDS.has(w) && w.length > 2);
    const named = series.find((sr) => subject.some((w) => wordMatchesText(w, sr.name.toLowerCase())));
    if (named && named.values.length) {
      const got = computeOver(fn, named.values.map(String));
      if (got) {
        const r = {
          subject: named.name.split(".").pop(), statistic: agg.word,
          over: `${got.used} points`, value: formatStat(fn, got.value, named.values.map(String)), unit: "",
          points: named.values.slice(0, 12).map((v, i) => ({ name: `point ${i + 1}`, value: String(v) })),
        };
        const d = computedDisplay(r, named.from || "this page");
        d.caveat = `from the page's own request to ${named.from || "this site"}, not a reading of the chart`;
        return { ...r, source: "page data", display: d };
      }
    }
    // Which failure it was, not just that there was one. "Nothing gave that
    // as numbers" is true whether the page downloaded nothing, downloaded
    // something with no matching field, or was never reloaded after the
    // site was enabled - and only the last is the person's to fix.
    if (!series.length) {
      const installed = feeds.ok && feeds.result && feeds.result.installed;
      tried.push(installed
        ? "page data (this page has downloaded nothing since it loaded)"
        : "page data (capture was not running - reload the page and ask again)");
    } else {
      tried.push(`page data (has ${series.map((sr) => sr.name.split(".").pop()).slice(0, 6).join(", ")})`);
    }
  }

  if (source === "auto" || source === "chart") {
    const hov = await invokeOnActiveTab("hoverSeries", [{}]).catch(() => ({ ok: false }));
    const pts = hov.ok && hov.result && hov.result.points;
    if (pts && pts.length) {
      const r = aggregateOverSeries(pts, agg, subject || "chart");
      if (r) {
        const d = computedDisplay(r, "chart");
        d.subtitle += " · read by hovering, so sampled";
        return { ...r, source: "chart", approximate: true, display: d };
      }
    }
    tried.push("chart");
  }

  if (source === "auto" || source === "map") {
    const mf = await invokeOnActiveTab("mapFeatures", [{}]).catch(() => ({ ok: false }));
    const feats = mf.ok && mf.result && (mf.result.features || mf.result.markers);
    if (feats && feats.length) {
      // The numbers are in properties the site named itself, so the subject
      // is matched against those keys rather than assumed.
      const pts = feats.map((f) => {
        const props = (f && f.properties) || {};
        const key = Object.keys(props).find((k) => word && k.toLowerCase().includes(word));
        const v = key ? props[key] : (f && f.label);
        return { label: (f && (f.label || f.name)) || "feature", value: v };
      });
      const r = aggregateOverSeries(pts, agg, subject || "map features");
      if (r) return { ...r, source: "map", display: computedDisplay(r, "map") };
    }
    tried.push("map");
  }

  throw new Error(`nothing on this page gave ${subject || "that"} as numbers to calculate over (tried ${tried.join(", ") || source})`);
}

// A heading that ends in a state - "Boulder Creek at Boulder, CO", "2 Miles
// S Hermantown MN" - is the page declaring what it is about. A heading like
// "IDSS Forecast Points" declares nothing.
function locationHeadings(pageData) {
  return (pageData.headings || []).filter((h) => {
    // Case-sensitive, because half the state codes are also ordinary words:
    // "Sign in" ends in Indiana, "Contact me" in Maine, "Zoom in" again in
    // Indiana. Matching those made a login heading the page's subject and
    // shut off page reading entirely. A state written as a state is
    // capitalised - "Boulder, CO", "Hermantown MN" - and a sentence ending
    // in a lowercase word is a sentence.
    const m = String(h).match(/,\s*([A-Z]{2})\b/) || String(h).match(/\b([A-Z]{2})\s*$/);
    return m && Object.prototype.hasOwnProperty.call(STATE_BBOX, m[1].toLowerCase());
  });
}

// Whether a table on this page can be read as being about the place asked
// for. Title and headings are a strong claim and settle it.
//
// Body prose is weaker but necessary: weather.gov's point forecast names its
// point in a bare paragraph, and an IDSS page names the point you clicked
// with nothing but "IDSS Forecast Points" in its headings. Left unqualified,
// though, prose let any name printed anywhere claim the table - a page
// listing Denver, Pueblo and Fort Collins answered for all three from the one
// table it was showing, each answer looking deliberate.
//
// The line between the two: if any heading names a location, that heading is
// the subject and prose cannot overrule it. Only when no heading names one
// does prose get to decide.
function tableIsAbout(pageData, place) {
  if (!place) return true;
  if (pageIsAbout(pageData, place)) return true;
  if (locationHeadings(pageData).length) return false;
  const text = (pageData.text || "").toLowerCase();
  return place.toLowerCase().split(/\s+/).every((w) => w.length < 3 || text.includes(w));
}

// A place can be one row of a table rather than the subject of the page - a
// regional forecast lists dozens of towns, and the answer for the one asked
// about is in its row. Title-and-headings matching never sees that, so the
// tables are searched by row first, and the column whose header matches the
// question decides which cell to read.
// Forecast tables come in both orientations, and assuming one silently
// answers from the wrong cell.
//
//   A. rows are places, columns are measurements
//        Location   | High  | Low
//        Hermantown | 71 °F | 46 °F
//
//   B. rows are measurements, columns are days - the page itself being about
//      one place, stated in its text rather than in the table
//        Weekly Summary | Mon Sep 14 | Tue Sep 15
//        Max Temp, °F   |     56     |     64
//
// B was being missed entirely, so a page showing exactly the number asked for
// fell through to the agency and answered from the state centre instead.
function findInTables(pageData, { wants, place, day }) {
  const inB = findMeasurementRows(pageData, { wants, place, day });
  if (inB) return inB;
  if (!place) return null;
  // "Smith River" appears in a gauge table as "SMITH R NR CRESCENT CITY".
  // A literal includes() never matches it, which is the same abbreviation
  // the USGS name search already had to handle - agencies shorten the
  // generic word and nothing else. So the distinctive words must all be
  // there, and a trailing river/creek/lake may be a single letter.
  const parts = place.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const distinctive = parts.filter((w) => !WATERBODY_GENERICS.has(w) && w.length > 1);
  const generic = parts.find((w) => WATERBODY_GENERICS.has(w) && w.length > 2);
  const matchesPlace = (cell) => {
    const text = String(cell).toLowerCase();
    if (!distinctive.length) return text.includes(place.toLowerCase());
    if (!distinctive.every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text))) return false;
    if (!generic) return true;
    // river | riv | r, immediately after the name.
    return new RegExp(`\\b${generic[0]}[a-z]*\\b`).test(text);
  };
  for (const table of pageData.tables || []) {
    const columns = table.columns || [];
    for (const row of table.rows || []) {
      const rowIndex = row.findIndex((cell) => matchesPlace(cell));
      if (rowIndex === -1) continue;
      const hits = [];
      for (let i = 0; i < row.length; i++) {
        if (i === rowIndex) continue;
        const cell = String(row[i] || "");
        if (!/\d/.test(cell)) continue;
        // Prefer the column header as the label; fall back to the cell, which
        // often carries its own ("High 67").
        const header = String(columns[i] || "").toLowerCase();
        const context = `${header} ${cell}`.toLowerCase();
        if (wants.every((concept) => conceptMatches(concept, context))) {
          hits.push({ label: `${row[rowIndex]} · ${columns[i] || "value"}: ${cell}`, value: cell, fromTable: true });
        }
      }
      if (hits.length) return hits.slice(0, 6);
    }
  }
  return null;
}

// Orientation B: the row label names the measurement and the columns are
// days. The page is about one place, so that has to be confirmed from its
// text - the table itself never mentions it.
function findMeasurementRows(pageData, { wants, place, day }) {
  if (!wants.length) return null;
  if (!tableIsAbout(pageData, place)) return null;

  for (const table of pageData.tables || []) {
    const columns = table.columns || [];
    for (const row of table.rows || []) {
      const label = String(row[0] || "").toLowerCase();
      if (!label || !wants.every((concept) => conceptMatches(concept, label))) continue;

      // Which column. A named day matches a header by its first three
      // letters ("tuesday" -> "Tue Sep 15"); with no day, the first cell
      // carrying a number is the nearest one.
      let index = -1;
      if (day) {
        const abbr = day.slice(0, 3);
        index = columns.findIndex((c) => String(c).toLowerCase().includes(abbr));
      }
      // No day named: today, not simply the first column - these tables often
      // begin with yesterday, so "first numeric cell" quietly answers about
      // the wrong day.
      if (index === -1) {
        // The page's own word for it beats the reader's clock. A forecast
        // table that labels a column "Today" is stating which day it means;
        // deriving it from new Date() instead made the answer depend on where
        // the reader is sitting - the same table read 79 in Los Angeles and 88
        // in Kiritimati, both confidently, because their "today" differ.
        index = columns.findIndex((c) => /\btoday\b|\bthis afternoon\b|\btonight\b/i.test(String(c)));
      }
      if (index === -1) {
        // No such label: fall back to the reader's clock, which is right for
        // a reader in the same timezone as the place and defensible anywhere,
        // because the column it picks is always named in the answer.
        const today = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
        index = columns.findIndex((c) => String(c).toLowerCase().includes(today));
      }
      if (index === -1) index = row.findIndex((cell, i) => i > 0 && /\d/.test(String(cell)));
      if (index === -1 || !row[index]) continue;

      // "MonSep 14" when a <br> separates the day from the date; readable
      // again with a space, and honest about an unnamed column.
      const column = String(columns[index] || "").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "this column";
      return [{
        label: `${row[0]} · ${column}: ${row[index]}`,
        value: String(row[index]),
        fromTable: true,
      }];
    }
  }
  return null;
}

// When the vocabulary has never met the word.
//
// "How full is lake conroe" found nothing: PAGE_VALUE_TERMS knows
// temperature and discharge and gage height, and does not know "full". The
// answer was a column away - Percent Full, row Conroe, 71 - and the question
// instead went hunting for something to click.
//
// A page names its own columns. Matching the question's words against those
// headers needs no vocabulary at all, which is the whole point: a site this
// has never seen uses words nobody has added to a list yet.
function findByOwnWords(pageData, instruction, place) {
  const words = meaningfulWords(instruction)
    .filter((w) => w.length > 2 && !PLACE_FILLER.has(w));
  if (words.length < 2) return null;
  const placeWords = String(place || "").toLowerCase().split(/\s+/).filter(Boolean);

  // Deliberately not built from the extracted place, which is unreliable on
  // a sentence this vocabulary does not understand - "how full is lake
  // conroe" yields "full lake", swallowing the very word that names the
  // column. Instead: one word finds the column, a different one finds the
  // row. Whichever words those turn out to be.
  for (const table of pageData.tables || []) {
    const columns = table.columns || [];
    for (let col = 1; col < columns.length; col++) {
      const header = String(columns[col] || "").toLowerCase();
      if (!header) continue;
      const namesColumn = words.filter((w) => wordMatchesText(w, header));
      if (!namesColumn.length) continue;
      const rest = words.filter((w) => !namesColumn.includes(w));
      if (!rest.length) continue;

      for (const row of table.rows || []) {
        const label = String(row[0] || "");
        if (!label) continue;
        const lower = label.toLowerCase();
        if (!rest.some((w) => wordMatchesText(w, lower))) continue;
        // A place named in the question must not be contradicted by the row.
        if (placeWords.length && !placeWords.some((w) => w.length > 2 && wordMatchesText(w, lower))
          && !rest.some((w) => wordMatchesText(w, lower))) continue;
        if (cellNumber(row[col]) === null) continue;
        return [{ label: `${label} \u00b7 ${columns[col]}`, value: String(row[col]), fromTable: true }];
      }
    }
  }
  return null;
}

function findOnPage(pageData, { wants, place, day }) {
  // Tables first: they can answer about a place the page is not itself about.
  const inTable = findInTables(pageData, { wants, place, day });
  if (inTable) return inTable;
  if (!pageIsAbout(pageData, place)) return null;
  const known = wants.filter((w) => PAGE_VALUE_TERMS[w]);
  if (!known.length) return null;

  const hits = [];
  for (const row of pageValueCandidates(pageData)) {
    const text = (row.text || "").toLowerCase();
    if (!/\d/.test(text)) continue;
    // Every requested aspect must hold: "max temperature" needs both a
    // maximum and a temperature, or "Max wind 20 mph" would answer it.
    if (known.every((concept) => conceptMatches(concept, text))) hits.push(row);
  }
  return hits.length ? hits.slice(0, 6) : null;
}

// Which aspects an instruction is asking for, in PAGE_VALUE_TERMS' vocabulary.
function pageValueWants(text) {
  const t = (text || "").toLowerCase();
  const wants = [];
  for (const [key, def] of Object.entries(PAGE_VALUE_TERMS)) {
    if (def.terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t))) wants.push(key);
  }
  // A bare "high" or "max" with nothing else is a qualifier, not a subject.
  if (wants.length === 1 && (wants[0] === "high" || wants[0] === "low")) return [];
  // "Chance of rain" matches the rainfall terms too, and every want has to
  // hold at once - so keeping both would demand a row that is somehow
  // measured and forecast together, and nothing on the page would match.
  if (wants.includes("precipChance")) return wants.filter((w) => w !== "precipitation");
  return wants;
}

/* ---------------------------------------------------------------------------
 * Matching a hand-written manifest's tools, without a model.
 *
 * Driving the site is the point of this extension; answering questions about
 * it is a bonus. Yet only USGS had a keyword path - the 46 tools across SITE,
 * NOAA and FCP could be reached only through the model, which is off by
 * default because it is slow and huge. So on a NOAA page almost nothing
 * worked, despite seventeen verified tools sitting right there.
 *
 * The tool definitions already carry everything needed to match against:
 * a name, a description written in the user's vocabulary, and enumerated
 * argument values. Scoring an instruction against those reaches every tool
 * with no model at all. A hand-written manifest is preferred over GENERIC's
 * selector guessing whenever it matches, because it was verified against the
 * real site.
 */
function toolVocabulary(def) {
  // "noaaSetBasemap" -> "noaa set basemap"; the route prefix is noise.
  const fromName = def.name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .replace(/^(usgs|site|noaa|fcp|page)\s+/, "");
  const enums = [];
  const props = (def.parameters && def.parameters.properties) || {};
  for (const spec of Object.values(props)) {
    if (Array.isArray(spec.enum)) enums.push(...spec.enum.map(String));
  }
  return { fromName, description: (def.description || "").toLowerCase(), enums };
}

// "Click Alaska" and "select Alaska" ask for exactly the same thing, but a
// tool's name carries only one verb - selectState - and scoring against that
// literal word gave the synonym someone actually typed nothing at all. So
// "select alaska" worked and "click alaska" planned nothing.
//
// Grouped rather than flattened, because the families are not interchangeable
// with each other: "open the layers panel" and "set the basemap" are
// different requests, and collapsing every verb into one would make them
// score alike.
const VERB_FAMILIES = [
  // "use" and "make" are out: they are verbs, but they are also ordinary
  // words in ordinary labels. With them in, a link called "Terms of Use"
  // scored against any instruction containing "click" - twice, once for
  // "click" and once for "use" - and reached the threshold on verbs alone.
  ["select", "choose", "pick", "click", "tap", "press", "set", "switch", "change"],
  ["toggle", "turn", "enable", "disable", "check", "uncheck", "tick"],
  ["open", "expand", "show", "display", "reveal"],
  ["close", "collapse", "hide", "dismiss"],
  ["search", "find", "lookup", "query"],
  ["download", "export", "save"],
  ["zoom", "pan", "move", "centre", "center"],
];
function verbFamily(word) {
  return VERB_FAMILIES.find((f) => f.includes(word)) || null;
}

// A verb the person misspelled. Typo tolerance covered every label on the
// page but never the verb in front of it, so "selct thudnerstorms" matched
// Thunderstorms perfectly and was then thrown away: "selct" matched no
// control, counted as a missed subject, and one missed against one covered
// trips the gate. The tolerance here is deliberately tighter than the one for
// labels - distance 1, five letters up - because the loose budget would read
// "peak" as a typo of "pick" and quietly discount a word that means a great
// deal on a river page. A near-miss of a verb is only ever excused, never
// treated as a match for anything.
function looksLikeMisspelledVerb(word) {
  if (!word || word.length < 5 || verbFamily(word)) return false;
  return VERB_FAMILIES.some((family) =>
    family.some((verb) => verb.length >= 5 && Math.abs(verb.length - word.length) <= 1
      && editDistance(verb, word) === 1));
}

// A tool's name word against the instruction, with any verb standing in for
// the rest of its family.
function nameWordHit(word, text) {
  const family = verbFamily(word);
  if (!family) return wordMatchesText(word, text);
  for (const synonym of family) {
    const hit = wordMatchesText(synonym, text);
    if (hit) return hit;
  }
  return false;
}

// pageClick, pageFill and their neighbours take a real CSS selector. Nothing
// in a typed sentence is one, but the argument is a free string, so scoring
// filled it with whatever words were left over: "set the basemap to
// satellite" planned pageClick{selector: "basemap satellite"}. The verb
// families made it total - select, choose, pick and set all reach pageClick's
// name word - so it hijacked nearly every command before the planner that
// actually reads the page ever ran.
//
// These tools are reachable two ways that do work: planGenericTool, which
// matches against a live inventory and emits the selector it found, and the
// model, which is shown that same inventory. Neither needs this one.
// A selector is the clearest case, but not the only one: pagePickRadio needs
// the radio group's name attribute, which nobody types either - planned blind
// it filled group and value with the same leftover words and picked a group
// that does not exist.
function needsRealSelector(def) {
  const props = (def.parameters && def.parameters.properties) || {};
  const required = (def.parameters && def.parameters.required) || [];
  // A url belongs here too. meaningfulWords strips punctuation before any of
  // this runs, so "read the url https://waterdata.usgs.gov/wi" arrives as
  // "https waterdata usgs gov wi" - a real URL cannot survive the trip, and
  // anything that does survive is not one.
  // Some tools say so outright, because the giveaway is not in the schema:
  // pageMcpCall's "name" must be one the page declared, and no sentence
  // contains it.
  if (def.needsPageKnowledge) return true;
  return ["selector", "group", "url"].some((k) => Boolean(props[k]) && required.includes(k));
}

function scoreManifestTool(def, words, instruction) {
  const { fromName, description, enums } = toolVocabulary(def);
  const text = instruction.toLowerCase();
  let score = 0;

  // The tool's own name is the strongest signal: "set basemap" naming
  // setBasemap is not a coincidence.
  const nameWords = fromName.split(/\s+/).filter((w) => w.length > 2);
  for (const w of nameWords) {
    const hit = nameWordHit(w, text);
    if (hit === "exact") score += 3;
    else if (hit === "fuzzy") score += 2.25;
  }
  if (nameWords.length && nameWords.every((w) => nameWordHit(w, text))) score += 4;

  // An enumerated value appearing verbatim all but names the tool -
  // "satellite" belongs to exactly one.
  for (const value of enums) {
    const v = value.toLowerCase();
    if (v.length <= 2) continue;
    const hit = wordMatchesText(v, text);
    if (hit === "exact") score += 5;
    else if (hit === "fuzzy") score += 4;
  }

  // Description words carry less weight: they are prose, and prose overlaps.
  for (const w of words) {
    if (w.length > 3 && wordMatchesText(w, description)) score += 1;
  }
  return score;
}

// Fills a tool's arguments from the instruction, using the schema to know
// what kind of value each one wants.
function argsForTool(def, instruction, words) {
  const props = (def.parameters && def.parameters.properties) || {};
  const required = (def.parameters && def.parameters.required) || [];
  const text = instruction.toLowerCase();
  const args = {};

  for (const [key, spec] of Object.entries(props)) {
    if (Array.isArray(spec.enum)) {
      // Exact across all values first: a correctly spelled option must never
      // lose to a near-miss on a different one.
      const exact = spec.enum.find((v) => wordMatchesText(String(v).toLowerCase(), text) === "exact");
      let hit = exact !== undefined ? exact
        : spec.enum.find((v) => wordMatchesText(String(v).toLowerCase(), text));
      // An enum value is a machine's word for it, and people use their own:
      // nobody types "mean". Without this, pageCompute could be picked by
      // the model and then not filled, because "average" appears nowhere in
      // mean|sum|max|min|median|count|range.
      if (hit === undefined) {
        hit = spec.enum.find((v) => (ENUM_SYNONYMS[String(v).toLowerCase()] || [])
          .some((word) => wordMatchesText(word, text)));
      }
      if (hit !== undefined) args[key] = hit;
      continue;
    }
    if (spec.type === "boolean") {
      args[key] = !TURN_OFF.test(instruction);
      continue;
    }
    if (spec.type === "number") {
      const n = text.match(/\b(\d+(?:\.\d+)?)\b/);
      if (n) args[key] = Number(n[1]);
      continue;
    }
    if (spec.type === "array") continue; // defaults are better than a guess
    // A free string: quoted text, else the words the tool's own name does not
    // already account for.
    const quoted = instruction.match(/["']([^"']{2,60})["']/);
    if (quoted) { if (!spec.pattern || new RegExp(spec.pattern, "i").test(quoted[1])) args[key] = quoted[1]; continue; }
    // The tool's own name words, plus whatever stood in for them. Stripping
    // only the literal name left the synonym in the value: selectState ate
    // "select alaska" down to "alaska" but handed back "pick alaska".
    const nameWords = new Set(toolVocabulary(def).fromName.split(/\s+/));
    const standIns = new Set();
    for (const w of nameWords) for (const v of (verbFamily(w) || [])) standIns.add(v);
    // The word naming the calculation is not part of the thing calculated:
    // "average reservoir storage" fills fn=mean, and of should be "reservoir
    // storage", not the whole phrase - which matched no column at all.
    const leftover = words.filter((w) => !nameWords.has(w) && !standIns.has(w)
      && !(args.fn !== undefined && AGGREGATE_WORDS.has(w)));
    if (!leftover.length) continue;
    const value = leftover.join(" ");
    // Some free strings are only free in type. A url is a url and a hex
    // colour is a hex colour; filling either with leftover words produced a
    // tool call that could only fail, having first won the plan and shut out
    // the planner that would have got it right.
    if (spec.pattern && !new RegExp(spec.pattern, "i").test(value)) continue;
    args[key] = value;
  }

  // A required argument with nothing to fill it means this is the wrong tool.
  for (const key of required) if (args[key] === undefined) return null;
  return args;
}

// Driving the site is the primary job; answering about it is the bonus. So an
// instruction phrased as an action is treated as one, and only a question
// goes looking for data first.
//
// Ordering alone cannot decide this. Control-first everywhere would send
// "gage height in Alaska" to usgsSetParameter - changing the page instead of
// answering - because the words overlap a control's name. Data-first
// everywhere buries the main purpose. The verb settles it: "set the parameter
// to gage height" acts, "gage height in Alaska" answers.
const CONTROL_VERB = /\b(click|press|select|choose|pick|set|change|switch|toggle|turn|enable|disable|open|close|expand|collapse|show|hide|display|search|look ?up|find|type|enter|download|zoom|group|sort|view|go to|navigate|apply|reset|clear|check|uncheck|tick)\b/i;

function isCommand(instruction) {
  return CONTROL_VERB.test(instruction || "");
}

// Words the chosen tool did not account for. Silently discarding them is how
// "zoom in on alaska" became a bare zoom: the action ran, the map moved, and
// the place was gone - indistinguishable from success.
function wordsLeftOver(def, args, words) {
  const consumed = new Set(toolVocabulary(def).fromName.split(/\s+/));
  for (const value of Object.values(args || {})) {
    for (const w of String(value).toLowerCase().split(/[^a-z0-9]+/)) if (w) consumed.add(w);
  }
  // A synonym that stood in for the tool's verb was accounted for, even
  // though it never appears in the tool's name.
  return words.filter((w) => !consumed.has(w) && !CONTROL_VERB.test(w) && !verbFamily(w));
}

// A bounding box gives both a centre and a sensible zoom: a big state has to
// be further out than a small one to fit on screen. Tuned against the zoom
// values the NOAA map itself writes into its URL.
function viewForBox(box) {
  const [w, s, e, n] = box;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s));
  const zoom = span > 30 ? 3 : span > 12 ? 4.5 : span > 6 ? 5.5 : span > 3 ? 6.5 : 7.5;
  return { lon: (w + e) / 2, lat: (s + n) / 2, zoom };
}

// On a map, "zoom in on Alaska" is not a zoom - it is a request to go there,
// and a relative zoom takes no location, so the place would be dropped.
//
// Moving the map directly is preferred over the site's search box wherever
// the route can: NOAA's search is best-effort by its own manifest's account
// (its result list was never reachable), so redirecting there produced a
// confident report and a map that had not moved.
function redirectToPlace(instruction, routeGlobal, leftovers) {
  if (!leftovers.length) return null;
  const text = leftovers.join(" ");
  const state = findStateInText(text);
  const city = findCityInText(text);
  if (!state && !city) return null;

  const mover = (TOOL_DEFS[routeGlobal] || []).find((d) => !d.run && /goToView$/i.test(d.name));
  const box = state && STATE_BBOX[state.code];
  if (mover && box) {
    const view = viewForBox(box);
    return {
      name: mover.name,
      args: { lon: Math.round(view.lon * 1e4) / 1e4, lat: Math.round(view.lat * 1e4) / 1e4, zoom: view.zoom },
      insteadOf: "a relative zoom",
      movedTo: state.name,
    };
  }

  const search = (TOOL_DEFS[routeGlobal] || []).find((d) => !d.run && /search/i.test(d.name));
  if (!search) return null;
  const key = Object.keys((search.parameters && search.parameters.properties) || {})[0];
  if (!key) return null;
  const name = (state && state.name) || city.city;
  return { name: search.name, args: { [key]: name.replace(/\b\w/g, (c) => c.toUpperCase()) }, insteadOf: "a relative zoom" };
}

// Scoring a sentence against tools the page declared. The same scorer the
// hand-written manifests use, pointed at schemas that arrived at runtime -
// a declared tool carries a name, a description and an inputSchema, which is
// everything scoreManifestTool reads.
function planDeclaredTool(instruction, tools) {
  const words = meaningfulWords(instruction);
  if (!words.length || !tools || !tools.length) return null;
  const defs = tools.map((t) => ({
    name: t.name, description: t.description, parameters: t.inputSchema, __tool: t,
  }));
  const scored = defs
    .map((def) => ({ def, score: scoreManifestTool(def, words, instruction) }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const args = argsForTool(scored[0].def, instruction, words);
  if (args === null) return null;
  return { tool: scored[0].def.__tool, args };
}

function planManifestTool(instruction, routeGlobal) {
  const defs = (TOOL_DEFS[routeGlobal] || []).filter((d) => !d.run && !needsRealSelector(d));
  if (!defs.length) return null;
  const words = meaningfulWords(instruction);
  if (!words.length) return null;

  const scored = defs
    .map((def) => ({ def, score: scoreManifestTool(def, words, instruction) }))
    .filter((x) => x.score >= 4)          // a single description word is not enough
    .sort((a, b) => b.score - a.score);
  // "Click on st johns river" scored noaaSetGaugeProduct a bare 4 and ran it
  // with product: "st johns river" - a river name poured into an argument
  // that takes obsFcst, HEFS or LRO. The words that made it win were the
  // verb; the words that mattered were left over entirely.
  //
  // So a bare pass needs the instruction to be mostly about this tool. If
  // most of what was said goes unaccounted for, the match was the verb and
  // nothing else, and acting on it invents an answer.
  if (scored.length && scored[0].score < 7) {
    const leftOver = wordsLeftOver(scored[0].def, argsForTool(scored[0].def, instruction, words) || {}, words);
    // A majority, and more than one word. "Download csv" leaves "csv" over
    // and is plainly about downloading; "click on st johns river" leaves
    // the whole subject over and is about nothing this tool does.
    if (leftOver.length >= 2 && leftOver.length > words.length / 2) return null;
  }
  if (!scored.length) {
    // "show me Texas" names no tool, but on a map page the intent is plain
    // and the same redirect applies.
    return redirectToPlace(instruction, routeGlobal, words);
  }

  // A near-tie is usually a coin flip on a real action, but not always. When
  // the instruction supplies a value, a tool that takes one is what was
  // meant: "graph discharge" tied siteGraphParameter against
  // siteListGraphParameters - one sets, one lists - and naming a parameter
  // settles which. Tools whose arguments cannot be filled at all drop out.
  const tied = scored.filter((x) => scored[0].score - x.score < 2);
  const viable = tied
    .map((x) => ({ ...x, args: argsForTool(x.def, instruction, words) }))
    .filter((x) => x.args);
  if (!viable.length) return null;
  let chosen = viable[0];
  if (viable.length > 1) {
    const argCount = (x) => Object.keys(x.args).length;
    const most = Math.max(...viable.map(argCount));
    const takers = viable.filter((x) => argCount(x) === most);
    // Still tied among tools consuming the same values: genuinely ambiguous,
    // so refuse rather than guess at a real action.
    if (takers.length > 1) return null;
    chosen = takers[0];
  }

  const leftovers = wordsLeftOver(chosen.def, chosen.args, words);
  const redirected = redirectToPlace(instruction, routeGlobal, leftovers);
  if (redirected) return redirected;
  return { name: chosen.def.name, args: chosen.args, unmatchedWords: leftovers.length ? leftovers : undefined };
}

/* ---------------------------------------------------------------------------
 * Did the action actually do anything?
 *
 * Every control path returned whatever the page function returned, and none
 * of them checked the page changed. A click that silently did nothing was
 * indistinguishable from one that worked - both come back without error.
 * That is the same failure shape as every other bug here: plausible, and
 * wrong.
 *
 * verify-usgs.js has done this for one manifest all along (call, read the DOM
 * back, assert it changed). This is the same idea for any action on any page:
 * snapshot the control states, act, wait for the page to settle, snapshot
 * again, and report what moved.
 *
 * Verification never fails the action. If snapshotting is unavailable the
 * result passes through untouched - knowing less about a successful action is
 * better than refusing to perform it.
 */
// One goal, as many steps as it takes.
//
// Everything multi-step here was a hardcoded pair: open a panel then act, or
// click and if that did nothing try once more. Neither reaches three. And
// three is the ordinary case on these sites - "enable flood inundation" on
// water.noaa.gov is press Layers, expand the Flood Inundation accordion,
// tick the box inside it - so the depth of the hardcoding was the limit on
// what could be asked for.
//
// The loop is the same judgement applied repeatedly: look at the page as it
// is now, plan the best step toward the words not yet accounted for, run it,
// look again. What makes it terminate is progress - a step must either
// account for a word or reveal controls that were not there before. A step
// that does neither ends it, which is what stops a page of forty buttons
// being pressed one after another in the name of a goal it cannot reach.
//
// Opening something is progress even though it accounts for no words. That
// is the whole reason panels exist, and the reason a pure word-coverage loop
// would stop at the closed door.
async function pursueGoal(routeGlobal, instruction, { maxSteps = 4, avoid = [] } = {}) {
  const steps = [];
  // Controls a caller has already tried. Without this the loop re-plans from
  // scratch, picks the same best match, and presses it a second time - which
  // on a toggle undoes the first press and on a link means two navigations.
  const actedOn = new Set(avoid.filter(Boolean));
  const subjectOf = (words) => words.filter((w) =>
    w.length > 2 && !verbFamily(w) && !CONTROL_VERB.test(w));

  let remaining = subjectOf(meaningfulWords(instruction));
  let lastCount = -1;
  let deadEnds = 0;
  const stateCommand = /\b(enable|disable|select|check|uncheck|tick|turn\s+(on|off)|switch\s+(on|off))\b/i
    .test(instruction);

  for (let step = 0; step < maxSteps; step++) {
    const inv = await invokeOnActiveTab("inventory", [{ includeHidden: true }])
      .catch(() => ({ ok: false }));
    if (!inv.ok) break;
    const all = (inv.result && inv.result.controls) || [];
    const controls = all.filter((c) => !actedOn.has(c.selector));
    const countNow = all.length;

    const plan = planGenericTool(instruction, { ...inv.result, controls });
    // An ambiguous plan is not an empty one. Live on water.noaa.gov the loop
    // went straight to door-hunting on its first move, because "Flood
    // Inundation" the accordion and "Flood Inundation Mapping" the navbar
    // link are a genuine tie by label - and a tie carries candidates but no
    // calls, which read here as "nothing on this page matches".
    //
    // Asking is the outer path's job. In here the whole method is to act and
    // check: try the best of them, and if it moves nothing the next pass
    // strikes it off and takes the next. That settles a tie better than any
    // amount of scoring, and it is the reason this loop exists.
    let call = plan && plan.calls && plan.calls[0];
    let ambiguousPick = null;
    if (!call && plan && plan.ambiguous && plan.ambiguous.length) {
      ambiguousPick = plan.ambiguous.find((c) => c.call && !actedOn.has(c.selector)) || null;
      if (ambiguousPick) call = ambiguousPick.call;
    }

    if (!call) {
      // Nothing matches as the page stands. Something may open onto it - and
      // the door worth trying is the one named after what was asked for, not
      // whichever comes first.
      const doors = await invokeOnActiveTab("disclosures", [{ match: instruction }])
        .catch(() => ({ ok: false }));
      const door = ((doors.ok && doors.result && doors.result.disclosures) || [])
        .find((d) => !actedOn.has(d.selector));
      if (!door) break;
      actedOn.add(door.selector);
      const opened = await invokeOnActiveTab("openDisclosure", [door.selector]).catch(() => null);
      forgetPageTools();
      const appeared = (opened && opened.ok && opened.result.appeared) || 0;
      steps.push({ did: "opened", label: door.label, appeared });
      if (!opened || !opened.ok) break;
      // A door that adds no controls has not necessarily failed. The panel
      // may hold things already counted - every pass reads hidden controls
      // too - or may render a moment later than the check. Live, the first
      // door opened and reported nothing revealed, and the loop stopped
      // there rather than looking again. Looking again is cheap; the budget
      // and the acted-on set are what stop it going round forever.
      if (!appeared && step >= maxSteps - 2) break;
      continue;
    }

    const target = (plan.matched && plan.matched[0]) || ambiguousPick || {};
    if (target.selector) actedOn.add(target.selector);
    const ran = await runVerified(routeGlobal, call);
    forgetPageTools();
    const r = (ran && ran.result) || {};
    const moved = r.itChanged === true || !!(ran && ran.verified && ran.verified.changed);
    // Proof, as distinct from motion. Asked to enable something, only that
    // control's own before and after shows it happened - a click that opened
    // a panel moved the page and proved nothing about the layer inside it.
    // A pageCheck, a radio pick or a dropdown choice sets state by
    // construction: if the page moved, something was switched. Only a bare
    // click is ambiguous about what it accomplished, and only those need the
    // control's own before and after to settle it. The derived tools report
    // that state; these raw primitives do not, so the tool's own nature
    // stands in for it.
    const SETS_STATE = /^page(Check|PickRadio|SelectOption|Fill)$/.test(call.name);
    const proven = r.itChanged === true ? true
      : r.itChanged === false ? false
      : SETS_STATE ? moved
      : !stateCommand && moved;
    steps.push({
      did: call.name, label: r.control || target.label || "", ok: ran.ok !== false,
      changed: moved, proven, was: r.was, now: r.now,
    });
    if (ran.ok === false) break;

    // What the instruction still has not accounted for.
    // What THIS step accounted for, not what the whole plan would have. A
    // plan can cover every word using several controls while only its first
    // one runs here - so "enable flood inundation" picked a radio called
    // Long Range Flood Outlook, which covers "flood", and the loop then
    // treated "inundation" as accounted for by a control it never touched.
    // It stopped after one step and reported the wrong layer switched on.
    const coveredNow = new Set(((plan.matched && plan.matched[0] && plan.matched[0].covered)
      || (ambiguousPick ? subjectOf(meaningfulWords(ambiguousPick.label || "")) : [])) || []);
    remaining = remaining.filter((w) => !coveredNow.has(w));
    lastCount = countNow;

    // Opening a panel changes the page and accounts for the words, because
    // the panel is named after what is inside it - so the loop declared the
    // job done having switched nothing on. The same mistake the outer path
    // made, living separately in here. Asked to enable something, only that
    // control's own before and after is proof; a click with no state of its
    // own is progress, not completion.
    if (proven) { if (!remaining.length) break; continue; }
    if (moved) continue;   // it did something, just not the thing asked for

    // Nothing moved - but striking the control off and pressing the next one
    // is only right where there is evidence it did nothing. A control that
    // reports its own state saying "still false" is evidence. A plain click
    // whose effect this cannot see is not: on a page whose buttons change
    // something unobservable, "click 30 day" pressed 30 day, could not tell
    // that it had worked, and went on to press 7 day. Absence of evidence is
    // not evidence, and the second press is the one that does harm.
    if (r.itChanged !== false && !stateCommand) break;

    // It acted and nothing moved. On these sites that usually means a nav
    // link named after the thing rather than the thing - water.noaa.gov has
    // "Flood Inundation Mapping" in its navbar and as a map layer. The link
    // accounts for every word, so a loop that stops when the words run out
    // stops on the wrong control having done nothing. The control is struck
    // off and the next one tried instead. Strictly bounded: two dead ends,
    // then stop, because pressing a page one control at a time in the hope
    // of stumbling onto the right one is its own kind of wrong.
    if (++deadEnds > 2) break;
  }

  const acted = steps.filter((st) => st.did !== "opened");
  return {
    steps,
    done: !remaining.length && acted.some((st) => st.proven),
    unaccounted: remaining,
    opened: steps.filter((st) => st.did === "opened").map((st) => st.label),
  };
}

async function runVerified(routeGlobal, toolCall) {
  const before = await invokeOnActiveTab("pageSignature", []).catch(() => ({ ok: false }));
  const result = await executeToolCall(routeGlobal, toolCall);
  if (!before.ok || result.ok === false) return result;

  // Actions are asynchronous far more often than not - a click starts a
  // fetch or a re-render - so comparing immediately would report a working
  // action as a no-op.
  const settled = await invokeOnActiveTab("settle", []).catch(() => ({ ok: false }));
  const after = await invokeOnActiveTab("pageSignature", []).catch(() => ({ ok: false }));
  if (!after.ok) return result;

  const diff = await invokeOnActiveTab("signatureDiff", [before.result, after.result]).catch(() => ({ ok: false }));
  if (!diff.ok) return result;

  if (diff.result.changed) forgetPageTools();
  return {
    ...result,
    verified: {
      changed: diff.result.changed,
      changeCount: diff.result.changeCount,
      changes: diff.result.changes,
      navigated: diff.result.navigated,
      waitedMs: settled.ok ? settled.result.waitedMs : undefined,
    },
  };
}

// A tool's name is for the model; a person reading the result wants English.
function friendlyToolName(name) {
  return String(name || "")
    .replace(/^(usgs|site|noaa|fcp|page)/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase().trim();
}

// An action changes one thing; a page changes several. A basemap switch also
// closed a menu and flipped two navigation toggles, and reporting all of them
// buries the answer. A change carrying a before and after value is the
// substance; a boolean flipping is usually a panel opening or a menu closing.
function rankedChanges(verified) {
  const changes = (verified && verified.changes) || [];
  const substantive = changes.filter((c) => c.was !== undefined && c.now !== undefined
    && typeof c.was !== "boolean" && typeof c.now !== "boolean");
  return (substantive.length ? substantive : changes).slice(0, 4);
}

// Selectors say nothing. A label, or failing that the tag, at least names the
// thing that moved.
function nameOfChange(change) {
  if (change.label) return change.label;
  const selector = String(change.selector || "");
  const tail = selector.split(">").pop().trim();
  return tail.split(/[.:#[]/)[0] || tail.slice(0, 30) || "a control";
}

// Turns the diff into something worth reading, rather than a selector dump.
function describeVerification(verified, toolCall) {
  if (!verified) return undefined;
  const top = rankedChanges(verified)[0];
  if (top && top.was !== undefined && top.now !== undefined) {
    return { tone: "ok", text: `${nameOfChange(top)}: ${top.was} -> ${top.now}` };
  }
  // A fragment change is the same page showing a different view, which is how
  // most map pages record centre and zoom.
  if (verified.viewChanged) return { tone: "ok", text: "the map view updated" };
  if (verified.navigated) {
    return { tone: "ok", text: `moved to ${verified.navigated.to.replace(/^https?:\/\//, "").split("?")[0].slice(0, 50)}` };
  }
  if (!verified.changed) {
    // The important case. Silence here is what made a failed action look
    // successful - some tools need a panel opened first, and say so.
    return {
      tone: "alert",
      text: `${toolCall.name} ran but nothing on the page changed - it may need a panel opened first, or the control may not apply here`,
    };
  }
  return { tone: "ok", text: `${verified.changeCount} thing${verified.changeCount === 1 ? "" : "s"} on the page changed` };
}

// Control tools depend on which site is open; data tools never do.
//
// GENERIC's tools belong on every route, because the GENERIC bundle is now
// injected alongside every named manifest - so a page control can be matched
// on a NOAA page, planned as pageClick, and then fail to execute because the
// definition was missing from that route's list. Planning something the
// executor cannot find is the worst of both.
function toolsFor(routeGlobal) {
  const named = TOOL_DEFS[routeGlobal] || [];
  const generic = routeGlobal === "GENERIC" ? [] : (TOOL_DEFS.GENERIC || []);
  return [...named, ...generic, ...DATA_TOOLS];
}

function toOpenAITools(defs) {
  return defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.parameters } }));
}

function findToolDef(route, name) {
  return toolsFor(route).find((d) => d.name === name);
}

// Check aistudio.google.com/apikey's own model list if this ever 404s -
// Google's free-tier model names change more often than most APIs'.
const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Same shape as toOpenAITools, wrapped the way Gemini's REST API wants it:
// one functionDeclarations array instead of one {type,function} object per
// tool. The actual JSON Schema in each tool's `parameters` is identical
// either way - both APIs happen to want plain JSON Schema here.
function toGeminiTools(defs) {
  return [{ functionDeclarations: defs.map((d) => ({ name: d.name, description: d.description, parameters: d.parameters })) }];
}

async function askGemini(instruction, defs, context) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    throw new Error('no Gemini API key saved. Get a free one at aistudio.google.com/apikey and save it in the popup.');
  }
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: instruction }] }],
      ...(context ? { systemInstruction: { parts: [{ text: context }] } } : {}),
      tools: toGeminiTools(defs),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  // Gemini's args come back as a real object already, unlike WebLLM/OpenAI's
  // JSON-stringified arguments - one less parsing step, one less way to fail.
  const callPart = parts.find((p) => p.functionCall);
  if (callPart) return { toolCall: { name: callPart.functionCall.name, args: callPart.functionCall.args || {} } };
  const textPart = parts.find((p) => p.text);
  return { toolCall: null, text: textPart ? textPart.text : "" };
}

// Shared by llmPlan, geminiPlan, and smartAsk below: whichever model
// decided on a tool call, actually running it is the same one step either
// way - look up the real manifest function behind the tool's WebMCP-style
// name, reorder the model's named arguments into the positional array
// invokeOnActiveTab expects, run it.
async function executeToolCall(routeGlobal, toolCall) {
  const def = findToolDef(routeGlobal, toolCall.name);
  // Not in TOOL_DEFS, so it is one of the page's own - derived from its
  // controls and named after them, which is the whole point of offering
  // those to a model. Without this the loop was open at the last step: the
  // model was handed click30DayPrecipitation, picked it correctly, and the
  // executor said no tool by that name exists.
  if (!def) {
    const viaPage = await invokeOnActiveTab("pageToolCall", [toolCall.name, toolCall.args || {}])
      .catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
    if (viaPage.ok) return { ...viaPage, calledOn: "page tool" };
    // Deliberately not "the model picked" - every planner here is
    // deterministic, and blaming a model that was never consulted sends
    // anyone debugging this in the wrong direction.
    throw new Error(`no tool named "${toolCall.name}" is available on this page${viaPage.error ? ` (${viaPage.error})` : ""}`);
  }
  // A data tool answers from an API and never touches the page, so it skips
  // the whole permission/injection/bridge path a control tool needs.
  if (def.run) {
    return { ok: true, result: await def.run(toolCall.args || {}), calledOn: "DATA" };
  }
  const args = def.argOrder.map((key) => toolCall.args[key]);
  return invokeOnActiveTab(def.fn, args);
}

// GENERIC's pageClick/pageFill/pageSelectOption all require a real CSS
// selector, but the model is never otherwise shown the page - without this,
// it has to guess a selector blind for anything it hasn't seen. inventory()
// is cheap and read-only, so it's run up front and stuffed into a system
// message instead of building a real multi-turn "call pageInventory, see
// results, then decide" loop - one well-populated turn is enough for a
// one-shot action like "select Alaska," and is a much smaller change.
function formatInventoryContext({ url, controlCount, patternCount, controls }, { maxControls = 40 } = {}) {
  const ranked = [...controls].sort((a, b) =>
    a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1);
  const shown = ranked.slice(0, maxControls);
  const omitted = controls.length - shown.length;
  const lines = shown.map((c, i) => {
    const opts = c.options ? ` options=[${c.options.map((o) => o.text || o.value).slice(0, 12).join(", ")}]` : "";
    const count = c.count > 1 ? ` (x${c.count})` : "";
    return `${i + 1}. [${c.confidence}] ${c.kind}${c.type ? ":" + c.type : ""} "${c.label}" selector="${c.selector}"${opts}${count}`;
  });
  return [
    `Page: ${url}`,
    `${controlCount} controls found, ${patternCount} distinct patterns` +
      (omitted > 0 ? `, showing top ${shown.length} (${omitted} lower-priority omitted)` : "") + ".",
    ...lines,
  ].join("\n");
}

async function buildGenericContext() {
  const inv = await invokeOnActiveTab("inventory", []);
  if (!inv.ok) return null; // don't fail the whole ask over a failed inventory call
  return formatInventoryContext(inv.result);
}

// Every route's TOOL_DEFS descriptions today are one line of plain English -
// none of them get ENV_VOCAB's synonym tables (SUPPLIED.PARAMS-style
// mappings already baked into web-controls.js/site-controls.js by hand, one
// per site, when this is the same domain knowledge every time). Computed
// once at load time since it doesn't depend on any page state.
function envVocabPreamble() {
  if (typeof ENV_VOCAB === "undefined") return null;
  const paramLines = Object.entries(ENV_VOCAB.parameters).map(([c, syn]) => `${c}: ${syn.join(", ")}`);
  const durLines = Object.entries(ENV_VOCAB.durations).map(([iso, ph]) => `${iso}: ${ph.join(", ")}`);
  return ["Domain vocabulary (synonyms -> canonical concept/code):",
    "Parameters:", ...paramLines, "Durations:", ...durLines].join("\n");
}
const ENV_VOCAB_CONTEXT = envVocabPreamble();

// Combines the two context sources: ENV_VOCAB (every route) and, for
// GENERIC specifically, the page's live inventory (see buildGenericContext
// above). Single entry point for smartAsk/llmPlan/geminiPlan to call.
// What a model should be choosing between on this page.
//
// It used to get the static TOOL_DEFS - pageClick{selector}, pageFill{selector}
// - plus forty rows of inventory pasted into its context as prose, and was
// expected to read the CSS and construct a selector. That is the blind-selector
// problem this project spent its time removing from the deterministic planner,
// handed to the model instead. Picking between named things is what models are
// good at; building selectors is what they are bad at.
//
// So the page's own tools come first: named from its labels, with enums drawn
// from its own options, and nothing to construct. The manifest's verified tools
// join them, because those were checked against the real site. The generic
// selector primitives are left out entirely.
/* ---------------------------------------------------------------------------
 * One list, one picker.
 *
 * There have been two systems in here. A control request goes through tools
 * derived from the page: ranked, picked, run, verified. A data question went
 * through something else entirely - a vocabulary of measurement words, a
 * hand-written table reader, a link walker, then an agency API - and never
 * reached the derived tools at all. They were built, counted, shown in the
 * card, and skipped.
 *
 * Every bug this week was in the second system. "Acre-ft" read as feet,
 * "storage" unknown, eight dates summed, nine rivers averaged: all of it
 * hand-written vocabulary meeting a page that had not read the vocabulary.
 * Meanwhile the derived layer was quietly right on four sites nobody had
 * written a line for.
 *
 * So: one list. The page's own controls, the tools that read and calculate,
 * the route's verified tools, and the agency lookups - ranked together and
 * picked once. A question and an instruction stop being different kinds of
 * thing, which is what makes a new site work without anybody deciding in
 * advance which kind of site it is.
 *
 * This runs ahead of the older cascade and stands aside unless it has a
 * clear winner, so nothing that already worked stops working while the
 * mechanism earns its place.
 */
// Which state a site belongs to, from its own address.
//
// "Smith river discharge" asked on cdec.water.ca.gov came back with nine
// rivers from New Hampshire to Alaska. Every reading correct, and the one
// that was obviously meant - California's - buried among eight that were
// not. The site had said which state it was about in its own hostname and
// nothing read it.
//
// Only ever used to narrow, only when no state was named, and always said
// out loud: a hint that quietly answers about the wrong place is worse than
// no hint at all.
function stateFromSite(url, title) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }

  // ca.gov, state.mn.us, dnr.wi.gov
  const suffix = host.match(/\.([a-z]{2})\.(gov|us)$/);
  if (suffix && STATE_BBOX[suffix[1]]) return { code: suffix[1], from: `${suffix[1]}.${suffix[2]}` };

  // waterdatafortexas.org, michigan.gov
  const hay = `${host} ${String(title || "").toLowerCase()}`;
  const named = findStateInText(hay.replace(/[^a-z ]+/g, " "));
  if (named && named.code) return { code: named.code, from: named.name || named.code };
  return null;
}

// Deriving tools means walking every control on the page, and a real portal
// has hundreds - CDEC has 667. Doing that on every ask, and then again when
// the older cascade asks for an inventory of its own, made a single question
// walk the page three times. On a heavy page that is the difference between
// an answer and a timeout.
//
// Cached per page for a few seconds, and thrown away the moment an action
// changes anything, because stale tools are worse than slow ones.
const TOOLS_CACHE = new Map();
const TOOLS_TTL_MS = 8000;

function forgetPageTools(tabId) {
  if (tabId === undefined) TOOLS_CACHE.clear();
  else TOOLS_CACHE.delete(tabId);
}

async function cachedPageTools(tabId, url) {
  const hit = TOOLS_CACHE.get(tabId);
  if (hit && hit.url === url && Date.now() - hit.at < TOOLS_TTL_MS) return hit.tools;
  const got = await invokeOnActiveTab("pageTools", [{}]).catch(() => ({ ok: false }));
  const tools = (got.ok && got.result && got.result.tools) || [];
  TOOLS_CACHE.set(tabId, { url, at: Date.now(), tools });
  return tools;
}

async function unifiedTools(routeGlobal, instruction, { acting = false } = {}) {
  const fromPage = await agentTools(routeGlobal, instruction, { max: 40 });
  // An instruction to do something cannot be satisfied by looking something
  // up. "Click on wildcat creek new london" was answered with a USGS gauge
  // record - the right creek, and not remotely what was asked. A lookup
  // answers; it does not act, so it is not a candidate when the sentence is
  // an instruction.
  const data = acting ? [] : DATA_TOOLS.map((d) => ({
    name: d.name, description: d.description, parameters: d.parameters, kind: "data",
  }));

  // And the mirror of it. A question cannot be answered by pressing
  // something: "wildcat creek new london discharge" picked the link named
  // Wildcat Creek, which clicks away from the page without reporting a
  // number. Derived tools are named verb-first precisely so this is legible
  // - click, choose, toggle and type act; read, list and compute report.
  //
  // Acting is still how a question sometimes gets answered, but that is the
  // job of following the site, which acts and then reads. It is not an
  // answer on its own.
  const acts = /^(click|choose|toggle|type|search)[A-Z]/;
  const fromThisPage = fromPage.all
    .map((t) => ({ ...t, kind: t.kind || "page" }))
    .filter((t) => acting || !acts.test(t.name));

  return [...fromThisPage, ...data];
}

// A pick worth acting on: clearly ahead, and ahead by enough. A near-tie
// means the question was ambiguous, and guessing at an ambiguous question is
// how confident wrong answers get made.
// How much of what was asked a tool accounts for *by its own name*. Words
// poured into a free-text argument do not count. A tool with a label or query
// parameter can absorb any word at all and still look like a match, which is
// how "enable flood inundation" chose a hand-written tool called toggle flood
// category: it covers "flood" by name and took "inundation" as a label, so
// the wrong layer switched on while the card said done. Measured on the name
// alone, not the description - a paragraph mentioning a word is not the same
// as a control called after it.
function namedCoverage(nameish, words) {
  const text = String(nameish || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  if (!text) return 0;
  return words.filter((w) => w.length > 2 && !verbFamily(w) && !CONTROL_VERB.test(w)
    && wordMatchesText(w, text)).length;
}

function confidentPick(tools, instruction) {
  const words = meaningfulWords(instruction);
  if (!words.length) return null;
  const asksForMaths = !!aggregateWanted(instruction);
  const asksToRead = /\b(read|say|says|what.s on|contents?|summar\w+)\b/i.test(instruction);
  const scored = tools
    .map((t) => {
      let score = scoreManifestTool(t, words, instruction);
      if (asksForMaths && t.name === "pageCompute") score += 12;
      if (asksToRead && /^(read|list)[A-Z]/.test(t.name)) {
        const named = words.some((w) => w.length > 3 && wordMatchesText(w, t.name.toLowerCase()));
        score += named ? 12 : (t.name === "readThisPage" ? 10 : 0);
      }
      return { t, score };
    })
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (!best || best.score < 6) return null;
  if (next && best.score - next.score < 2) return null;

  // Something other than the verb has to match. A tool whose score comes
  // entirely from words like click, set or choose has matched the shape of
  // the sentence and none of its content - which is how "click dew point"
  // reached "Terms of Use" four times in a row.
  const subject = words.filter((w) => !verbFamily(w) && !CONTROL_VERB.test(w));
  const vocab = toolVocabulary(best.t);
  const args = argsForTool(best.t, instruction, words);
  if (args === null) return null;

  const hits = subject.filter((w) =>
    wordMatchesText(w, vocab.fromName) || wordMatchesText(w, vocab.description)
    || vocab.enums.some((e) => wordMatchesText(w, String(e).toLowerCase())));
  if (subject.length && !hits.length) return null;

  // And nothing important may be dropped. "Click snow depth" matched a nav
  // link called National Snow Analysis on "snow" while "depth" - the word
  // that says which thing was meant - went unaccounted for. Half a subject
  // matched is a different control, not this one.
  // A word carried into an argument is not dropped: pageCompute's name says
  // nothing about reservoirs, and "average reservoir storage" is answered by
  // handing it "reservoir storage" as the thing to calculate over. Only a
  // word that reaches neither the tool nor its arguments has been lost.
  const inArgs = JSON.stringify(args || {}).toLowerCase();
  const dropped = subject.filter((w) => !hits.includes(w) && !wordMatchesText(w, inArgs));

  // Two ways a match can be good enough, and a plain ratio is neither.
  //
  // "Click on wildcat creek new london" leaves "new london" unaccounted for
  // and is still exactly right: the tool is called Wildcat Creek and every
  // word of it was named. "Click snow depth" also leaves one word of two,
  // but the tool is National Snow Analysis and one word in three matched -
  // a different control that happens to share a word.
  //
  // So: most of what was asked for, or most of what the tool is called.
  const nameWords = vocab.fromName.split(/\s+/).filter((w) => w.length > 2 && !verbFamily(w));
  const nameCovered = nameWords.filter((w) => subject.some((q) => wordMatchesText(q, w))).length;
  const mostOfTheAsk = hits.length > dropped.length;
  const mostOfTheName = nameWords.length > 0 && nameCovered >= Math.ceil(nameWords.length * 0.6);
  if (dropped.length && !mostOfTheAsk && !mostOfTheName) return null;
  return { tool: best.t, args, score: best.score, runnerUp: next ? next.t.name : null };
}

async function agentTools(routeGlobal, instruction = "", { max = 24 } = {}) {
  // !d.run was meant to drop the data lookups, which answer from an agency
  // rather than the page. It also dropped pageCompute, which orchestrates
  // page reads to do arithmetic - so the model was asked for "average
  // reservoir storage" with no tool capable of an average anywhere in its
  // list, and had nothing to pick but a wrong answer.
  const dataNames = new Set(DATA_TOOLS.map((d) => d.name));
  const verified = (TOOL_DEFS[routeGlobal] || [])
    .filter((d) => !dataNames.has(d.name) && !needsRealSelector(d));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
  const pageTools = tab && tab.id
    ? await cachedPageTools(tab.id, tab.url)
    : (((await invokeOnActiveTab("pageTools", [{}]).catch(() => ({ ok: false }))).result) || {}).tools || [];
  const combined = [
    ...verified.map((d) => ({ name: d.name, description: d.description, parameters: d.parameters })),
    ...pageTools.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
  ];

  // Tool choice degrades as the list grows, and a page can easily publish
  // fifty. The scorer that answers most instructions on its own is a cheap
  // relevance filter for the rest: rank by it, keep the top few, and always
  // keep the readers - a model that can act but cannot see the result is the
  // same blind agent in a different costume.
  const words = meaningfulWords(instruction);
  // The readers must be reachable, but scoring them as infinitely relevant
  // put readThisPage at number 1 for every question - and a small model
  // asked to pick from a numbered list has a strong pull toward the first
  // entry. "Average reservoir storage" was offered readThisPage first and
  // pageCompute sixth. Kept, but at the end, where being present costs
  // nothing and being first costs the answer.
  // Scored like everything else. Pinning them first made readThisPage the
  // answer to every question; burying them last meant "what does this page
  // say" could not reach them either and picked a random link. They compete
  // on merit, and are appended afterwards only if they did not make the cut,
  // so they stay reachable without being privileged.
  const always = new Set(["readThisPage", "listPageControls", "listPageDataRequests"]);
  // A question asking for a calculation is asking for the tool that
  // calculates, whatever nouns it also contains. Without this, "average
  // reservoir storage" put clickReservoirs first on a reservoir page -
  // a strong word match and entirely the wrong kind of thing.
  const asksForMaths = !!aggregateWanted(instruction);
  // A request to look at the page is a request for the tool that reads it,
  // however the page's own links happen to be worded.
  const asksToRead = /\b(read|say|says|show(ing)?|what.s on|contents?|summar\w+)\b/i.test(instruction);
  const bonus = (t) => {
    if (asksForMaths && t.name === "pageCompute") return 12;
    // The read bonus goes to whichever reader the question is actually
    // about, not always readThisPage - "read the map points" is a read, and
    // it is not a read of the page's text.
    if (asksToRead && /^(read|list)[A-Z]/.test(t.name)) {
      const named = meaningfulWords(instruction)
        .some((w) => w.length > 3 && wordMatchesText(w, t.name.toLowerCase()));
      return named ? 12 : (t.name === "readThisPage" ? 10 : 0);
    }
    // "Search for X" wants the box that takes text, not a link named Search.
    if (/\b(search|find|look ?up)\b/i.test(instruction)
      && ((t.parameters || {}).properties || {}).text) return 8;
    return 0;
  };
  const ranked = words.length
    ? combined
        .map((t) => ({ t, score: scoreManifestTool(t, words, instruction) + bonus(t) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.t)
    : combined;

  // Reachable even when they did not rank: a model that can act but cannot
  // read the result is working blind.
  const head = ranked.slice(0, max);
  const missing = combined.filter((t) => always.has(t.name) && !head.includes(t));
  return {
    verified, page: pageTools,
    all: [...head.slice(0, Math.max(1, max - missing.length)), ...missing],
    considered: combined.length,
  };
}

async function buildContext(routeGlobal) {
  const parts = [];
  if (ENV_VOCAB_CONTEXT) parts.push(ENV_VOCAB_CONTEXT);
  if (routeGlobal === "GENERIC") {
    const generic = await buildGenericContext();
    if (generic) parts.push(generic);
  }
  return parts.length ? parts.join("\n\n") : null;
}

const OFFSCREEN_URL = "offscreen/offscreen.html";
let creatingOffscreen = null; // avoids racing two createDocument calls at once

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"], // closest existing justification; WebLLM does its
    // real work via WebGPU + a Worker internally, and Chrome's offscreen
    // reason list (as of this writing) has no dedicated "WEBGPU" or
    // "AI_MODEL" value - WORKERS is the standard stand-in other on-device-
    // model extensions use for exactly this situation.
    justification: "Run the WebLLM model, which needs WebGPU, unavailable in a service worker.",
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// The local model is OFF unless explicitly switched on. Two reasons, both
// measured rather than assumed: an 8B model saturates the GPU for as long as
// it runs (minutes on ordinary hardware), which is felt as the whole machine
// slowing down, not just this extension being slow; and it downloads several
// gigabytes before it can answer anything at all. Neither is acceptable as a
// default for a tool whose fast paths already answer most questions in under
// a second. The debug tools can still load it explicitly - clicking a button
// labelled "load model" is its own consent.
async function isLocalModelEnabled() {
  const { localModelEnabled } = await chrome.storage.local.get("localModelEnabled");
  return localModelEnabled === true;
}

// Start loading the model as soon as the browser opens, or the extension is
// installed/reloaded, instead of waiting for someone to actually ask it
// something. Doesn't shrink the real download time, just moves the wait to
// before it's needed rather than during it - after the first successful
// load ever, the weights are cached locally, so this finishes fast on every
// later browser launch.
async function warmModel() {
  if (!(await isLocalModelEnabled())) return; // no download, no GPU, until asked for
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ target: "offscreen", type: "llmWarm" });
  } catch (e) { /* best effort - a real llmPing later will surface any real error */ }
}
chrome.runtime.onStartup.addListener(warmModel);
chrome.runtime.onInstalled.addListener(warmModel);

// MV3 service workers get terminated by Chrome after a period of perceived
// inactivity - confirmed live: a real WebLLM inference call (genuinely
// correct, just slow on this hardware) got killed mid-wait, surfacing as
// "the message channel closed before a response was received" with no
// error and no result, no matter how the response was being listened for.
// A pending chrome.* API call is supposed to reset Chrome's idle timer, but
// that didn't hold up for a multi-minute wait in practice. The standard
// workaround: ping some trivial API on an interval well under whatever the
// real threshold is, for exactly as long as the slow operation is pending.
function keepAlive() {
  const id = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  return () => clearInterval(id);
}

/* ---------------------------------------------------------------------------
 * Ask history.
 *
 * A popup is destroyed the moment it loses focus - clicking the page, another
 * tab, another window. Anything still running then has nowhere to deliver its
 * answer, and everything already on screen is gone on reopening. For a slow
 * ask (a model, a bounding-box sweep) that is most of them.
 *
 * The work itself already survives: it runs in the service worker, kept alive
 * across the wait. Only the *destination* was disappearing. So results are
 * written here as they complete, and the popup renders from this rather than
 * from its own memory - which also means an answer that arrives while the
 * popup is shut is waiting when it is next opened, instead of being lost.
 *
 * An ask is recorded as "running" before the work starts, so a popup opened
 * mid-flight shows it in progress rather than showing nothing at all.
 */
const HISTORY_KEY = "askHistory";
const HISTORY_LIMIT = 30;

async function readHistory() {
  const got = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
}

// Only the presentation and a short summary are kept. Whole payloads - a
// captured feed body, a statewide gauge list - would blow past the storage
// quota within a few asks, and the popup never renders them anyway.
function historyEntry(id, instruction, patch) {
  // Fields are listed rather than spread. Spreading let a caller's whole raw
  // result through - a captured feed body, a statewide gauge list - which
  // would exhaust the storage quota within a few asks, and the popup renders
  // none of it anyway.
  return {
    id, instruction, at: new Date().toISOString(),
    status: patch.status,
    plannedBy: patch.plannedBy,
    error: patch.error,
    hint: patch.hint,
    display: patch.display ? JSON.parse(JSON.stringify(patch.display)) : undefined,
  };
}

async function recordAsk(id, instruction, patch) {
  try {
    const history = await readHistory();
    const existing = history.findIndex((h) => h.id === id);
    const entry = historyEntry(id, instruction, patch);
    if (existing !== -1) entry.at = history[existing].at; // keep when it was asked
    if (existing !== -1) history[existing] = entry;
    else history.push(entry);
    while (history.length > HISTORY_LIMIT) history.shift();
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch (e) {
    // History is a convenience; never let it break the answer itself.
    console.log("[history] could not record:", String((e && e.message) || e));
  }
}

/* ---------------------------------------------------------------------------
 * "What can I do here?"
 *
 * Nobody can use what they cannot find: dozens of verified tools per route,
 * plus whatever inventory() turns up, and no way to learn any of them but to
 * guess.
 *
 * A plain function rather than a message handler, because smartAsk needs it
 * and a service worker's sendMessage is never delivered to its own listener -
 * routing "what can I do here" through messaging looked right and silently
 * answered nothing at all.
 */
// A self-test, because diagnosing this from screenshots has been the slowest
// part of building it. Each step is the real call the extension makes, run in
// the order it makes them, reporting what came back. One command, one output,
// no interpretation needed - and it never throws, because a diagnostic that
// crashes tells you less than one that reports the crash.
async function runDiagnostics() {
  const steps = [];
  // Three outcomes, not two. A browser with no WebMCP is not a fault to fix -
  // counting it as one would put a red mark on every working install and bury
  // the failure that matters underneath it.
  const step = async (name, fn, { optional = false } = {}) => {
    const t0 = Date.now();
    try {
      const value = await fn();
      steps.push({ name, state: "ok", value: String(value).slice(0, 90), ms: Date.now() - t0 });
    } catch (err) {
      steps.push({ name, state: optional ? "n/a" : "failed",
        value: String((err && err.message) || err).slice(0, 90), ms: Date.now() - t0 });
    }
  };

  // Nothing above the steps may throw, or the diagnostic fails to diagnose.
  const mf = (() => { try { return chrome.runtime.getManifest(); } catch (e) { return { version: "unknown" }; } })();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
  const url = (tab && tab.url) || "";

  await step("extension version", () => mf.version);
  await step("browser", () => ((typeof navigator !== "undefined" && navigator.userAgent) || "")
    .match(/Edg\/[\d.]+|Chrome\/[\d.]+/) || "unknown");
  await step("timezone", () => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await step("this tab", () => url || "no URL - is a normal http/https page open?");
  await step("route", () => routeFor(url).global);
  await step("permission for this origin", async () => {
    const pattern = originPatternFor(url);
    if (!pattern) throw new Error("not an http(s) page, so nothing can run here");
    const ok = await chrome.permissions.contains({ origins: [pattern] });
    if (!ok) throw new Error(`not granted - click "Enable on this site"`);
    return pattern;
  });
  await step("page bundle reachable", async () => {
    const r = await invokeOnActiveTab("pageSignature", []);
    if (!r.ok) throw new Error(r.error || "the page did not answer");
    return "bridge answered";
  });
  await step("inventory", async () => {
    const r = await invokeOnActiveTab("inventory", []);
    if (!r.ok) throw new Error(r.error || "inventory failed");
    return `${r.result.controlCount} controls, ${r.result.patternCount} patterns`;
  });
  await step("read page", async () => {
    const r = await invokeOnActiveTab("readPage", []);
    if (!r.ok) throw new Error(r.error || "readPage failed");
    const d = r.result;
    return `${(d.tables || []).length} tables, ${(d.labelledNumbers || []).length} numbers`;
  });
  await step("WebMCP", async () => {
    const r = await invokeOnActiveTab("mcpTools", []);
    if (!r.ok) throw new Error(r.error || "could not check");
    if (!r.result.available) throw new Error("no modelContext API in this browser (expected outside Edge 147+)");
    return `${r.result.tools.length} tools · ${r.result.readFrom || "none readable"}`;
  }, { optional: true });
  await step("agency API", async () => {
    const res = await fetch("https://api.weather.gov/points/44.98,-93.26", { headers: { Accept: "application/geo+json" } });
    if (!res.ok) throw new Error(`NWS returned ${res.status}`);
    return "NWS reachable";
  });

  const failed = steps.filter((x) => x.state === "failed");
  return {
    ok: failed.length === 0,
    steps,
    display: {
      title: failed.length ? `${failed.length} of ${steps.length} checks failed` : "All checks passed",
      subtitle: failed.length
        ? `first failure: ${failed[0].name} - ${failed[0].value}`
        : `v${mf.version} · everything this extension needs is working here`,
      stats: [],
      rows: steps.map((x) => ({
        name: x.name, value: x.state,
        meta: `${x.value}${x.ms > 200 ? ` · ${x.ms}ms` : ""}`,
        tone: x.state === "ok" ? "ok" : x.state === "n/a" ? "warn" : "alert",
      })),
      caveat: failed.length ? "copy this card and send it - the first failure is the one to fix" : undefined,
      source: "self-test",
    },
  };
}

/* ---------------------------------------------------------------------------
 * Following the site to the answer.
 *
 * Everything above is one step: pick a tool, run it, report. But a site is
 * not one step. "Smith river discharge" on a California water portal is
 * there - behind a River Forecast link, then a river, then its table - and a
 * single-step planner cannot reach it. It read the front page, found no
 * discharge, and answered from a national API instead: correct data about
 * nine rivers in nine states, when the site in front of it had the one that
 * was meant.
 *
 * So: look, move, look again. Reading a linked page rather than clicking it
 * matters - readUrl fetches same-origin HTML without navigating, so nothing
 * the person was looking at is disturbed, several candidates can be tried,
 * and a wrong guess costs nothing but a fetch.
 *
 * Bounded hard. Depth and breadth are small, every page is visited once, and
 * a link only gets followed if its own words overlap the question - an
 * unbounded crawl of a government site is not a feature.
 */
function scoreLink(label, words) {
  const text = String(label || "").toLowerCase();
  if (!text) return 0;
  let score = 0;
  for (const w of words) {
    if (w.length < 3) continue;
    const hit = wordMatchesText(w, text);
    if (hit === "exact") score += 3;
    else if (hit) score += 2;
  }
  // A page listing many of something is a likely route to one of them.
  if (/\b(list|index|all|stations?|gauges?|rivers?|reservoirs?|sites?|data|reports?|forecasts?)\b/.test(text)) score += 1;
  return score;
}

async function followToAnswer(instruction, { wants, agg, place, maxPages = 6, maxDepth = 2 }) {
  const words = meaningfulWords(instruction);
  if (!words.length) return null;

  const answerFrom = (pageData) => {
    if (agg) {
      const subject = words.filter((w) => !AGGREGATE_WORDS.has(w));
      const match = subject.length ? (label) => subject.every((w) => wordMatchesText(w, label)) : null;
      const computed = aggregateOnPage(pageData, { wants, place, agg, match });
      if (computed) return { kind: "calculated", computed };
    }
    if (wants.length) {
      const hits = findOnPage(pageData, { wants, place, day: null });
      if (hits) return { kind: "read", hits };
    }
    return null;
  };

  const seen = new Set();
  const trail = [];
  let fetches = 0;

  const walk = async (links, depth) => {
    if (depth > maxDepth) return null;
    const ranked = links
      .map((l) => ({ l, score: scoreLink(l.label, words) }))
      .filter((x) => x.score >= 3 && !seen.has(x.l.url))
      .sort((a, b) => b.score - a.score)
      .slice(0, depth === 1 ? 4 : 2);

    for (const { l } of ranked) {
      if (fetches >= maxPages) return null;
      seen.add(l.url);
      fetches++;
      const got = await invokeOnActiveTab("readUrl", [l.url]).catch(() => ({ ok: false }));
      if (!got.ok) { trail.push({ label: l.label, url: l.url, ok: false }); continue; }
      const answer = answerFrom(got.result);
      trail.push({ label: l.label, url: l.url, ok: true, answered: !!answer });
      if (answer) return { ...answer, from: l, trail: [...trail] };

      const deeper = (got.result.links || []).length
        ? got.result.links
        : ((await invokeOnActiveTab("pageLinks", [{}]).catch(() => ({ ok: false }))).result || {}).links || [];
      const below = await walk(deeper, depth + 1);
      if (below) return below;
    }
    return null;
  };

  const here = await invokeOnActiveTab("pageLinks", [{}]).catch(() => ({ ok: false }));
  const byLink = here.ok ? await walk(here.result.links || [], 1) : null;
  if (byLink) return byLink;

  // Links only reach what a site chose to link, and a data portal mostly
  // does not link its data - CDEC has a Smith River gauge and no page that
  // says so, because you are meant to search for it. So: use the site's own
  // search. A GET form is a URL with blanks in it and can be fetched without
  // the page moving; a POST form cannot, and is offered rather than done,
  // because submitting it navigates away from what someone was looking at.
  const subject = place || words.filter((w) => !AGGREGATE_WORDS.has(w)).join(" ");
  if (!subject) return null;
  const targets = await invokeOnActiveTab("searchTargets", []).catch(() => ({ ok: false }));
  const found = (targets.ok && targets.result && targets.result.targets) || [];
  if (!found.length) return null;

  const gettable = found.find((t) => t.method === "get");
  if (gettable) {
    const built = await invokeOnActiveTab("searchUrl", [subject, gettable]).catch(() => ({ ok: false }));
    if (built.ok && !seen.has(built.result.url)) {
      seen.add(built.result.url);
      const got = await invokeOnActiveTab("readUrl", [built.result.url]).catch(() => ({ ok: false }));
      if (got.ok) {
        const answer = answerFrom(got.result);
        trail.push({ label: `searched for "${subject}"`, url: built.result.url, ok: true, answered: !!answer });
        if (answer) {
          return { ...answer, from: { label: `search: ${subject}`, url: built.result.url }, trail: [...trail] };
        }
      }
    }
    return null;
  }

  // Only a POST search exists, which cannot be fetched. Submitting it would
  // navigate - and this is a question about data, not an instruction to do
  // anything. Someone asking what the discharge is has not asked to be taken
  // somewhere, and offering to move their page instead of answering was the
  // wrong trade even before it landed them on a 404.
  //
  // Driving a site's search is a fine thing to do when that is what was
  // asked for. It is not a fine thing to do instead of answering.
  return null;
}

async function buildCapabilities() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) throw new Error("no active tab");
  const route = routeFor(tab.url);

  // A tool with a run() of its own is normally a data lookup, listed further
  // down as a kind of question. pageCompute is neither: it orchestrates page
  // reads to do arithmetic, so filtering on run() alone dropped it from the
  // one card whose whole job is to say what you can do here.
  const dataNames = new Set(DATA_TOOLS.map((d) => d.name));
  const manifestTools = (TOOL_DEFS[route.global] || []).filter((d) => !d.run || !dataNames.has(d.name));
  // Swallowing this error reported "0 controls" - a confident count, from a
  // look that never happened. The commonest reason is that the site has not
  // been enabled yet, and the panel hides the Enable button precisely when
  // the answer looks successful, so the one action that would fix it becomes
  // unreachable. A count of zero and an inability to count are different
  // facts and are now reported as different facts.
  const inv = await invokeOnActiveTab("inventory", [])
    .catch((err) => ({ ok: false, error: String((err && err.message) || err) }));

  // What agents can see of this page. Publishing happens on every page load
  // and left no trace anywhere in the UI, so the only way to observe WebMCP
  // working was to open a page written to demonstrate it - which says nothing
  // about the site you are actually on.
  const mcp = await invokeOnActiveTab("mcpTools", []).catch(() => ({ ok: false }));
  const mcpTools = (mcp.ok && mcp.result && mcp.result.tools) || [];
  const mcpMine = mcpTools.filter((t) => t.declaredBy === "extension");
  const mcpTheirs = mcpTools.filter((t) => t.declaredBy === "page");
  // Deriving tools from the page needs no browser API; only registering them
  // does. Reporting "unavailable" and stopping there described the missing
  // API and hid the forty tools that exist regardless - which is the part
  // that actually works on a site nobody wrote code for.
  const mcpDerived = await invokeOnActiveTab("pageTools", [{}]).catch(() => ({ ok: false }));
  const mcpOffered = (mcpDerived.ok && mcpDerived.result && mcpDerived.result.tools) || [];
  const blocked = inv.ok ? null : (inv.error || "this page could not be read");
  const controls = inv.ok ? (inv.result.controls || []).filter((c) => c.label && c.confidence !== "low") : [];

  // Descriptions are written for people already, so their first sentence is
  // the most readable summary available.
  const firstSentence = (t) => String(t || "").split(/(?<=\.)\s/)[0];
  const friendly = (name) => name
    .replace(/^(usgs|site|noaa|fcp|page)/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();

  return {
    ok: true,
    route: route.global,
    tools: manifestTools.map((t) => t.name),
    pageControls: blocked ? null : controls.length,
    pageBlocked: blocked,
    webmcp: {
      available: !!(mcp.ok && mcp.result && mcp.result.available),
      derived: mcpOffered.length,
      published: mcpMine.length,
      declaredByPage: mcpTheirs.length,
      readFrom: (mcp.ok && mcp.result && mcp.result.readFrom) || null,
      names: mcpMine.slice(0, 8).map((t) => t.name),
    },
    display: {
      title: "What you can do here",
      subtitle: blocked
        ? `this page has not been read: ${blocked}`
        : route.global === "GENERIC"
          ? `${controls.length} controls on this page, plus ${DATA_TOOLS.length} kinds of question`
          : `${manifestTools.length} verified tools for ${route.global}, plus ${controls.length} controls found on the page`,
      stats: [],
      rows: [
        // Agents first: it is the only place this is visible at all.
        ...(mcpOffered.length || mcpTools.length ? [{
          name: "WebMCP",
          value: `${mcpOffered.length || mcpTools.length} tools`,
          meta: mcpTheirs.length
            ? `${mcpTheirs.length} declared by this site, ${mcpOffered.length} derived from it`
            : mcp.ok && mcp.result && !mcp.result.available
              ? `derived from this page - this browser cannot publish them (no modelContext API), but a model is offered them`
              : `${mcpOffered.length} derived from this page, ${mcpMine.length} published for other agents`,
        }] : []),
        ...manifestTools.slice(0, 10).map((t) => ({
          name: friendly(t.name), value: "action", meta: firstSentence(t.description).slice(0, 70),
        })),
        ...controls.slice(0, 6).map((c) => ({
          name: c.label.slice(0, 40), value: c.kind || "control", meta: c.selector,
        })),
        ...DATA_TOOLS.slice(0, 4).map((t) => ({
          name: friendly(t.name), value: "question", meta: firstSentence(t.description).slice(0, 70),
        })),
      ],
      note: "ask in plain English - name a control to use it, or a place and a measurement to look it up",
      source: route.global,
    },
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "offscreen") return; // that message is for offscreen.js, not this listener

  if (msg.type === "invoke") {
    (async () => {
      try {
        sendResponse(await invokeOnActiveTab(msg.fn, msg.args));
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // keep the channel open for the async response above
  }

  if (msg.type === "ask") {
    (async () => {
      const plan = planTool(msg.instruction || "");
      if (!plan) {
        sendResponse({ ok: false, error: "the stub planner didn't recognize that instruction (it only knows a handful of fixed phrases, see PLANNER_RULES)" });
        return;
      }
      try {
        const result = await invokeOnActiveTab(plan.fn, plan.args);
        sendResponse({ ...result, plannedCall: plan });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err), plannedCall: plan });
      }
    })();
    return true;
  }

  if (msg.type === "llmPing") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        // first call downloads the model (can take a while, real bandwidth
        // and disk space), subsequent calls reuse the same loaded engine
        // for as long as the offscreen document stays alive.
        const result = await chrome.runtime.sendMessage({ target: "offscreen", type: "llmPing", prompt: msg.prompt });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // The real thing: instruction -> WebLLM picks a tool -> it actually runs,
  // same execution path (invokeOnActiveTab) planTool()'s stub already used.
  // Only the "which tool" decision changed; everything downstream of that
  // decision is code already proven working across six sites.
  if (msg.type === "llmPlan") {
    (async () => {
      const stopKeepAlive = keepAlive();
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);
        const defs = toolsFor(route.global);
        const known = await agentTools(route.global, msg.instruction || "");
        const context = await buildContext(route.global);
        await ensureOffscreenDocument();
        const plan = await chrome.runtime.sendMessage({
          target: "offscreen", type: "llmPlan",
          instruction: msg.instruction, tools: toOpenAITools(known.all), context,
        });
        if (!plan.ok) { sendResponse(plan); return; }
        if (!plan.toolCall) {
          // the model answered in plain text instead of picking a tool -
          // a real, valid outcome, not an error (e.g. the instruction
          // wasn't actually asking to do anything on the page).
          sendResponse({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        sendResponse({ ...result, plannedBy: "webllm", toolCall: plan.toolCall });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      } finally {
        stopKeepAlive();
      }
    })();
    return true;
  }

  // Same shape as llmPlan above, same TOOL_DEFS, same invokeOnActiveTab
  // execution - only the "which tool" decision is different: a direct
  // fetch() to Gemini instead of the offscreen document's local model.
  if (msg.type === "geminiPlan") {
    (async () => {
      const stopKeepAlive = keepAlive();
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);
        // The page's own tools, like every other model path. This one was
        // still being handed toolsFor(route) - the static selector
        // primitives - so the only model in here capable of real judgment
        // was getting the worst inputs of the three.
        const known = await agentTools(route.global, msg.instruction || "", { max: 24 });
        const context = known.page.length ? null : await buildContext(route.global);
        const plan = await askGemini(msg.instruction, known.all, context);
        if (!plan.toolCall) {
          sendResponse({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        sendResponse({ ...result, plannedBy: "gemini", toolCall: plan.toolCall,
          fromPageTools: known.page.length });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      } finally {
        stopKeepAlive();
      }
    })();
    return true;
  }

  // Debug: run a hand-written tool call through the exact path a model's
  // output takes - findToolDef's name lookup, argOrder's named->positional
  // remapping, invokeOnActiveTab, injection, the page bridge - with no model
  // involved at all. Exists because "is the execution chain correct" and "is
  // the model working/fast enough" were tangled together, while every WebLLM
  // test cost minutes and failed for a different infrastructure reason each
  // time. This answers the first question in about a second, for free.
  if (msg.type === "runToolCall") {
    (async () => {
      // Reached from a confirmation button as well as the debug field, so a
      // destructive tool called this way has already been agreed to.
      const finish = (res) => {
        debugLog("[runToolCall]", msg.toolCall, "->", res);
        sendResponse(res);
      };
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);
        const call = msg.toolCall || {};
        // thenSubmit travelled with the call and was then ignored here, so
        // choosing "search this site" typed the query and stopped. The one
        // place a call arrives already agreed to is the one place that was
        // dropping half of it.
        const after = call.thenSubmit ? { name: "pageSubmit", args: { selector: call.args.selector } } : null;
        const result = await runVerified(route.global, { name: call.name, args: call.args });
        const follow = after && result.ok !== false
          ? await runVerified(route.global, after).catch((e) => ({ ok: false, error: String(e.message || e) }))
          : null;

        // A raw postMessage payload is not an answer. Every other path
        // renders a card; a chosen option rendered {"element":"input"}.
        const changed = (result.verified && result.verified.changed)
          || (follow && follow.verified && follow.verified.changed);
        const what = friendlyToolName(call.name);

        // An action that navigates can land somewhere worse than where it
        // started. Submitting CDEC's search produced "Not Found" - the page
        // someone was reading, replaced by a 404 they did not ask for. The
        // least this can do is notice and offer the way back.
        let landedBadly = null;
        // Only when the page actually went somewhere. Reading the page again
        // after every submit costs a round trip for nothing in the common
        // case, and asks a document that may have just been torn down.
        const navigated = follow && follow.verified && follow.verified.navigated;
        if (navigated) {
          const now = await invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
          if (now.ok) {
            const headline = `${now.result.title || ""} ${(now.result.headings || [])[0] || ""}`.toLowerCase();
            if (/\b(not found|404|page can.?t be found|error)\b/.test(headline)) {
              landedBadly = (now.result.title || "an error page").slice(0, 60);
            }
          }
        }
        if (landedBadly) {
          finish({
            ok: false, toolCall: msg.toolCall, landedOn: landedBadly,
            error: `That left the page on "${landedBadly}".`,
            display: {
              title: "That went somewhere wrong",
              subtitle: `submitting it landed on "${landedBadly}" - this site's search is driven by its own script, not by the form`,
              stats: [], rows: [],
              choices: [{ label: "Go back", hint: "return to the page you were on",
                call: { name: "pageBack", args: {} } }],
              source: "this page",
            },
          });
          return;
        }
        finish({
          ...result, plannedBy: "hand-written", toolCall: msg.toolCall, follow: follow || undefined,
          display: {
            title: msg.label || what,
            subtitle: follow
              ? (follow.ok === false ? `${what}, but submitting failed: ${String(follow.error || "").slice(0, 60)}`
                : changed ? "done - the page responded" : "done, but nothing on the page changed")
              : changed ? "done - the page responded" : "done, but nothing on the page changed",
            stats: [],
            rows: Object.entries(call.args || {})
              .filter(([k]) => k !== "selector")
              .map(([k, v]) => ({ name: k, value: String(v).slice(0, 40), meta: "" })),
            caveat: changed ? undefined : "if the page needed a moment, ask again",
            source: "this page",
          },
        });
      } catch (err) {
        finish({ ok: false, error: String((err && err.message) || err), toolCall: msg.toolCall });
      }
    })();
    return true;
  }

  // Debug: return exactly what a model would be handed for the current page -
  // which tools it can pick from, plus the context string (env-vocab, and on
  // GENERIC routes the live inventory). Makes "did it even see this page's
  // controls" checkable without waiting on inference.
  // "What can I do here?" - nobody can use what they cannot find. There are
  // dozens of verified tools per route plus whatever inventory() turns up,
  // and until now the only way to learn any of them was to guess.
  if (msg.type === "capabilities") {
    (async () => {
      try {
        sendResponse(await buildCapabilities());
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  if (msg.type === "askHistory") {
    (async () => { sendResponse({ ok: true, history: await readHistory() }); })();
    return true;
  }

  if (msg.type === "clearHistory") {
    (async () => {
      await chrome.storage.local.set({ [HISTORY_KEY]: [] });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === "showContext") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);
        const context = await buildContext(route.global);
        sendResponse({
          ok: true,
          calledOn: route.global,
          tools: toolsFor(route.global).map((d) => d.name),
          context,
        });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // The actual intended default experience: instant where possible, honest
  // about waiting where it isn't, never silently blocked. Tries the
  // zero-download stub matcher first (planTool, USGS route only, same as
  // it's always been) - if that hits, done, no model involved at all, no
  // wait. Only reaches for WebLLM if the fast path didn't match, and even
  // then checks it's actually finished loading first rather than kicking
  // off a multi-minute wait a user didn't ask for. Never touches Gemini:
  // that stays an explicit, separate choice (needs a key), not a fallback.
  if (msg.type === "smartAsk") {
    (async () => {
      // A popup is torn down the instant it loses focus, and unlike the
      // fast path (synchronous, always returns before that can happen) the
      // WebLLM branch below can take long enough - an llmStatus round trip,
      // maybe a real inference call - that the popup is gone before
      // sendResponse ever fires, silently swallowing the result on the
      // popup.js end. Logging every outcome here too means "did it actually
      // answer" is always recoverable from this service worker's own
      // console (chrome://extensions -> Inspect views: service worker),
      // independent of whether any popup was still open to receive it.
      // Recorded before the work starts, so a popup opened mid-ask sees it
      // running rather than seeing nothing.
      const askId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      recordAsk(askId, msg.instruction, { status: "running" });

      // Every answer carries a card. "Enable snow depth" came back as the
      // bare word "done" and nothing else - no title, no rows, no reason -
      // which is the least useful thing this can say and indistinguishable
      // from a success. Several paths answer without building a display, and
      // rather than find each one, none of them are allowed to.
      const cardFor = (res) => {
        const inner = res.display || (res.result && res.result.display);
        if (inner) return inner;
        const r = res.result || {};
        let title = "Done";
        try {
          title = res.error ? "That did not work"
            : friendlyToolName((res.toolCall && res.toolCall.name) || res.plannedBy || "Done");
        } catch (e) { /* a card is not worth a crash */ }
        return {
          title: String(title).slice(0, 60),
          subtitle: res.error ? String(res.error).slice(0, 140)
            : res.modelReply ? String(res.modelReply).slice(0, 140)
            : typeof r.itChanged === "boolean"
              ? `${r.control}: ${r.was} \u2192 ${r.now}`
              : "it ran, but nothing here says what changed",
          stats: [], rows: [],
          note: res.plannedBy ? `answered by ${res.plannedBy}` : "",
          // Some paths answer before the route has been worked out, and a
          // card is not worth a crash.
          source: (() => { try { return (route && route.global) || "this page"; }
            catch (e) { return "this page"; } })(),
        };
      };
      const respond = (res) => {
        const display = cardFor(res);
        debugLog(`[smartAsk] "${msg.instruction}" ->`, res);
        recordAsk(askId, msg.instruction, {
          status: res.ok === false ? "error" : "done",
          plannedBy: res.plannedBy,
          display,
          error: res.error,
          hint: res.hint,
        });
        sendResponse({ ...res, display });
      };
      const stopKeepAlive = keepAlive();
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);

        // Data questions come first, and on every route - "what's the gage
        // height in Alaska" is answerable from anywhere, and shouldn't be
        // hijacked by a control rule just because the USGS page is open.
        // "model: <instruction>" skips every cheap path and puts the question
        // to the model with the page's own tools. Without it the model is
        // only ever reached when everything else has failed, so there is no
        // way to see whether it would have got something right.
        const forceModel = /^\s*model:\s*/i.test(msg.instruction || "");
        const wanted = String(msg.instruction || "").replace(/^\s*model:\s*/i, "");

        const dataCall = forceModel ? null : planDataTool(wanted, route);

        // Control is the primary job, so an instruction phrased as an action
        // is not diverted into answering about the page. "set the parameter
        // to gage height" acts; "gage height in Alaska" answers. Only a
        // question reaches the data paths first - a command falls through to
        // them below if nothing on the page turned out to match.
        // "What can I do here" is neither a command nor a data question, and
        // would otherwise be matched against control labels word by word.
        if (/\bwhat can (i|you)\b|\bwhat( is|'s)? (possible|available|supported)\b|\bhelp\b|\bwhat do you do\b|\bcapabilities\b/i.test(wanted)) {
          respond(await buildCapabilities());
          return;
        }

        const commandLike = !forceModel && isCommand(wanted);

        // Real tasks are sequences - "switch to Alaska then show discharge".
        // Split only where both halves independently plan to something, so an
        // instruction that merely contains "and" is left alone.
        if (commandLike) {
          const parts = String(msg.instruction).split(/\s*(?:,\s*then\s+|\s+then\s+|\s+and then\s+)\s*/i)
            .map((t) => t.trim()).filter(Boolean);
          // Eight, not four. A five-part instruction fell out of the sequence
          // and was handled as one command, which on the page tested pressed
          // Reset - a step from the middle of the sentence, chosen alone.
          // Falling through to "do part of it" is worse than the length.
          if (parts.length > 1 && parts.length <= 8) {
            const plans = parts.map((part) => ({
              part,
              call: planManifestTool(part, route.global) || (route.global === "USGS" ? planTool(part) : null),
            }));
            // Every part used to need a hand-written tool before any of them
            // ran, so "click the monitoring location and then click 30 day"
            // did the first half and stopped - not because the second half
            // was impossible, but because nobody had written a manifest for
            // this site. Sequencing worked only where per-site code existed,
            // which is the one place it is least needed.
            //
            // A part with no manifest tool is pursued instead, which is the
            // same machinery a single instruction gets, multi-step and all.
            if (plans.length > 1) {
              const steps = [];
              for (const { part, call } of plans) {
                let result;
                // The page's own controls first, as everywhere else. This
                // path asked the manifest first, so "search station for smith
                // river" became noaaSearch - which on the page tested reached
                // for the Layers button - while the generic planner had the
                // right answer, a fill of the search box, all along. The main
                // route has preferred the page since the one-list picker
                // landed; the sequence never did.
                const own = await pursueGoal(route.global, part).catch(() => null);
                const ownActed = ((own && own.steps) || [])
                  .filter((st) => st.did !== "opened" && st.ok);
                // Confirmed, or merely done-but-unverifiable: either way the
                // page's own control has already acted, and letting the
                // hand-written tool take a second turn is how a filled search
                // box was followed by a press of the Layers button. The
                // manifest only gets a turn when the page offered nothing.
                if (own && own.done) {
                  result = { ok: true, verified: { changed: true } };
                } else if (ownActed.length) {
                  result = { ok: true, unconfirmed: true };
                } else if (call) {
                  // A manifest tool call and a planTool result have different
                  // shapes; both end up at the same executor.
                  result = call.name
                    ? await runVerified(route.global, call)
                    : await invokeOnActiveTab(call.fn, call.args);
                  // A hand-written tool that fails must not end the sequence.
                  // "Click layers and then enable flood inundation" stopped
                  // dead because noaaToggleFloodCategory threw, while the
                  // same sentence ending in "enable snow depth" - which no
                  // manifest covers - went through the generic path and
                  // worked. Having a hand-written tool made the site worse.
                }
                if (!result) {
                  const chased = own;
                  const ran = ((chased && chased.steps) || [])
                    .filter((st) => st.did !== "opened" && st.ok);
                  // Three outcomes, not two. A step that ran and was
                  // confirmed is done; one that ran and could not be
                  // confirmed is not a failure - "click 30 day" pressed the
                  // right button on a page whose response this cannot see,
                  // and calling that failed is as wrong as calling it done.
                  // Only finding nothing to press is a failure.
                  result = chased && chased.done ? { ok: true, verified: { changed: true } }
                    : ran.length ? { ok: true, unconfirmed: true }
                    : { ok: false, error: `nothing on this page matched "${part}"` };
                }
                const changed = result.verified ? result.verified.changed : undefined;
                steps.push({ part, ok: result.ok !== false, changed,
                  unconfirmed: !!result.unconfirmed, error: result.error });
                if (result.ok === false) break;
              }
              const failed = steps.find((st) => !st.ok);
              respond({
                ok: !failed, plannedBy: "sequence", steps,
                error: failed ? `"${failed.part}" failed: ${failed.error}` : undefined,
                display: {
                  title: `${steps.length} step${steps.length === 1 ? "" : "s"}`,
                  subtitle: failed
                    ? `stopped: ${String(failed.error || "the first step failed").slice(0, 80)}`
                    : "done in order",
                  stats: [],
                  // A bare "failed" tells you nothing about what to do next.
                  // The page's own error usually says exactly what is wrong -
                  // a button not found, a panel not open.
                  rows: steps.map((st) => ({
                    name: st.part.slice(0, 44),
                    value: !st.ok ? "failed"
                      : st.unconfirmed ? "ran"
                      : st.changed === false ? "no change" : "done",
                    meta: !st.ok ? String(st.error || "no reason given").slice(0, 70)
                      : st.unconfirmed ? "could not check whether the page changed"
                      : st.changed === false ? "ran, but nothing on the page changed" : "",
                    tone: !st.ok ? "alert" : (st.unconfirmed || st.changed === false) ? "warn" : "ok",
                  })),
                  source: route.global,
                },
              });
              return;
            }
          }
        }

        // Above every form of reading the page, below the hand-written
        // manifests. A declared tool is the site's own statement of what it
        // can do; scraping is our reconstruction of it. This block sat below
        // both the page reader and the data lookups, so a page that declared
        // its tools was scraped anyway and the rung did nothing.
        // Once per page, not once per ask. Publishing registers forty-odd
        // tools through the page bridge, which has an eight second timeout;
        // doing it again before every question spent that budget on work
        // already done, and the inventory call behind it was the one that
        // then came back empty - reported as "could not read this page's
        // controls" on a page whose controls had been read moments earlier.
        publishOnce(sender && sender.tab && sender.tab.id, route.global).catch(() => {});

        const mcp = await invokeOnActiveTab("mcpTools", []).catch(() => ({ ok: false }));

        // The self-test, before anything that could fail on its own.
        if (/^\s*(diagnose|diagnostics?|debug|self ?test|why (is it |isn.t it )?(not )?working)\b/i.test(wanted)) {
          respond(await runDiagnostics());
          return;
        }

        // What this page offers for a given instruction, and why one control
        // won. Every failure so far has been diagnosed from the wording of a
        // card - which says what was decided and nothing about the page it
        // was decided on - so each fix was aimed at a guess. This prints the
        // evidence instead: the words, the candidates with their scores, and
        // what the runner would actually do.
        // The data the site fetched for itself. Clicking is one way to reach
        // what a page knows and the least reliable: every layer, chart and
        // gauge on these sites is drawn from a JSON call the page already
        // made, and those calls are captured at document_start whether or
        // not any control was ever found. Reading them asks nothing of the
        // DOM, so it works on the pages where the controls defeat us.
        if (/^\s*(data|feeds?|what did (this|the) (page|site) (fetch|load|request))\b/i.test(wanted)) {
          const [feeds, series] = await Promise.all([
            invokeOnActiveTab("capturedFeeds", []).catch(() => ({ ok: false })),
            invokeOnActiveTab("capturedSeries", [{}]).catch(() => ({ ok: false })),
          ]);
          const got = (feeds.ok && feeds.result && feeds.result.feeds) || [];
          const nums = (series.ok && series.result && series.result.series) || [];
          respond({
            ok: true, plannedBy: "feeds", feeds: got, series: nums,
            display: {
              title: "what this page fetched for itself",
              subtitle: got.length
                ? `${got.length} data request${got.length === 1 ? "" : "s"} captured`
                  + (nums.length ? `, ${nums.length} with numbers in them` : "")
                : "nothing captured yet - feeds are recorded from a page's next load, so reload and ask again",
              stats: [
                { label: "requests", value: String(got.length) },
                { label: "with series", value: String(nums.length) },
              ],
              rows: got.slice(0, 20).map((f) => ({
                name: String(f.url || "").replace(/^https?:\/\//, "").slice(0, 62),
                value: f.count > 1 ? `x${f.count}` : "",
                meta: [f.method, f.status, f.type].filter(Boolean).join(" ").slice(0, 28),
                tone: "ok",
              })),
              note: nums.length
                ? `series available: ${nums.slice(0, 6).map((n) => n.label || n.key || "unnamed").join(", ")}`
                : "",
              source: route.global,
            },
          });
          return;
        }

        const explainMatch = wanted.match(/^\s*(?:explain|match|why did|what matches)\s+(.+)$/i);
        if (explainMatch) {
          const q = explainMatch[1].trim();
          const words = meaningfulWords(q);
          const inv = await invokeOnActiveTab("inventory", [{ includeHidden: true }]);
          if (!inv.ok) {
            respond({ ok: false, error: `could not read this page's controls: ${inv.error || "no reason given"}` });
            return;
          }
          const controls = (inv.result && inv.result.controls) || [];
          const phrase = words.join(" ");
          const ranked = controls
            .map((c) => ({ c, score: scoreControl(c, words, phrase) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);
          const generic = planGenericTool(q, inv.result || { controls });
          const manifest = planManifestTool(q, route.global);
          respond({
            ok: true,
            display: {
              title: `what "${q}" matches here`,
              subtitle: [
                `words: ${words.join(", ") || "(none)"}`,
                `${controls.length} controls on the page, ${ranked.length} scored above zero`,
              ].join(" \u00b7 "),
              stats: [
                { label: "would run", value: generic && generic.calls
                  ? generic.calls.map((x) => x.name).join(" + ") : "nothing" },
                { label: "hand-written tool", value: manifest ? manifest.name : "none" },
              ],
              rows: ranked.length ? ranked.map(({ c, score }) => ({
                name: `${c.label || "(no label)"}`,
                value: String(score),
                meta: `${c.kind || "?"}${c.type ? ":" + c.type : ""} ${c.selector || ""}`.slice(0, 70),
                tone: "ok",
              })) : [{ name: "nothing on this page scored above zero", value: "", meta: "", tone: "warn" }],
              note: generic && generic.unmatchedWords && generic.unmatchedWords.length
                ? `unaccounted for: ${generic.unmatchedWords.join(", ")}` : "",
              source: route.global,
            },
          });
          return;
        }

        // Asking about it directly. Without this, the only way to observe
        // WebMCP on the site you are actually on was to read the service
        // worker's console - so testing it meant opening a page written to
        // demonstrate it, which proves nothing about this site.
        if (/\bweb ?mcp\b|\bmodel ?context\b|\b(declared|published) tools\b/i.test(wanted)) {
          const tools = (mcp.ok && mcp.result && mcp.result.tools) || [];
          const mine = tools.filter((t) => t.declaredBy === "extension");
          const theirs = tools.filter((t) => t.declaredBy === "page");
          const unavailable = mcp.ok && mcp.result && !mcp.result.available;
          // What an agent would be offered here regardless of whether this
          // browser can register anything. Registration needs an API most
          // browsers lack; the tools are derived either way, and without
          // showing them the layer that makes this work on an unmapped site
          // is invisible - there was no way to check it at all.
          const derived = await invokeOnActiveTab("pageTools", [{}]).catch(() => ({ ok: false }));
          const offered = (derived.ok && derived.result && derived.result.tools) || [];
          respond({
            ok: true, plannedBy: "webmcp-status",
            webmcp: { published: mine.length, declaredByPage: theirs.length, readFrom: (mcp.result || {}).readFrom },
            tools: tools.map((t) => ({ name: t.name, declaredBy: t.declaredBy, description: t.description })),
            display: {
              title: "WebMCP on this page",
              subtitle: `${offered.length} tool${offered.length === 1 ? "" : "s"} derived from this page` +
                (unavailable
                  ? " · this browser cannot publish them (no modelContext API), but they are what a model is offered"
                  : ` · ${tools.length} registered${(mcp.result || {}).readFrom ? `, read from ${mcp.result.readFrom}` : ""}`),
              stats: [
                { label: "derived here", value: String(offered.length) },
                { label: "by this site", value: String(theirs.length) },
                { label: "published", value: String(mine.length) },
              ],
              rows: [
                ...theirs.map((t) => ({ name: t.name.slice(0, 40), value: "site", meta: String(t.description || "").slice(0, 70) })),
                ...offered.slice(0, 14).map((t) => ({
                  name: t.name.slice(0, 40),
                  value: mine.some((m) => m.name === t.name) ? "published" : "derived",
                  meta: String(t.description || "").slice(0, 70),
                })),
              ].slice(0, 16),
              caveat: theirs.length
                ? "this site declares its own tools, so they are used instead of reading the page"
                : "this site declares none of its own - these were derived from its controls, with no code written for this site",
              source: "WebMCP",
            },
          });
          return;
        }
        // Only the page's own tools count here. This extension publishes its
        // verified controls as WebMCP tools so other agents can use the site,
        // and those come back indistinguishable from the page's - routing our
        // own tools back through WebMCP would be a detour through a longer
        // pipe to the same function, and would hide the hand-written path
        // behind a layer that adds nothing.
        const pageDeclared = (mcp.ok && mcp.result && mcp.result.tools || [])
          .filter((t) => t.declaredBy === "page");
        if (pageDeclared.length) {
          const pick = planDeclaredTool(wanted, pageDeclared);
          if (pick) {
            const ran = await runVerified(route.global, {
              name: "pageMcpCall", args: { name: pick.tool.name, args: pick.args },
            });
            respond({
              ...ran, plannedBy: "declared-by-page", toolCall: pick.tool.name,
              display: {
                title: friendlyToolName(pick.tool.name),
                subtitle: `${pick.tool.description || "declared by this page"}`.slice(0, 90),
                stats: [],
                rows: Object.entries(pick.args || {}).map(([k, v]) => ({ name: k, value: String(v).slice(0, 30), meta: "" })),
                caveat: `this page declares its own tools (${mcp.result.readFrom}) - used instead of reading its markup`,
                source: "WebMCP",
              },
            });
            return;
          }
        }

        // One list, one picker - ahead of everything hand-written. It stands
        // aside unless it has a clear winner, so the older cascade still
        // catches what it cannot decide, and nothing that worked stops
        // working while this earns its place.
        if (!forceModel) {
          const one = confidentPick(
            await unifiedTools(route.global, wanted, { acting: commandLike }), wanted);
          if (one) {
            let ran = await runVerified(route.global, { name: one.tool.name, args: one.args });

            // A click that landed and changed nothing is usually a door.
            // water.noaa.gov names each accordion after its own subject -
            // "Flood Inundation", "National Snow Analysis" - so the header
            // outscores every real control and gets pressed as though it
            // were the layer. Pressing it is not wrong, it is unfinished:
            // the control is inside, and it does not exist until the panel
            // is open. The retry below only ever ran when nothing matched at
            // all, which is exactly the case this is not.
            const rr = ran.result || {};
            // Nothing moved. The general loop knows how to open its way in
            // and try the next candidate; this path used to re-plan once and
            // give up, which on a page whose navbar repeats its layer names
            // means clicking the link and reporting that the page did not
            // respond. Only adopted when the loop actually finishes the job.
            // Opening a panel changes the page, so "the page responded" was
            // true and the goal was untouched: "select flood inundation"
            // pressed the accordion named after the layer, the panel opened,
            // and that counted as done while nothing was switched on.
            // "Enable flood inundation" reached the layer on the same page,
            // because the hand-written tool failed first and let the loop
            // run - the phrasing decided whether it worked.
            //
            // Asked to switch something on, a click that reports no state of
            // its own has not shown that anything was switched on. Only the
            // named control's own before and after can say so, and where
            // there is none the job is not yet proven done.
            const stateCommand = /\b(enable|disable|select|check|uncheck|tick|turn\s+(on|off)|switch\s+(on|off))\b/i
              .test(wanted);
            const deadEnd = (rr.itChanged === false)
              || !!(ran.verified && ran.verified.changed === false)
              || (stateCommand && typeof rr.itChanged !== "boolean");
            // Only where an end state was asked for. "Enable flood inundation"
            // wants the layer on, so opening a panel and ticking what is
            // inside is help. "Click 30 day" is one instruction about one
            // control: if it did nothing, pressing whatever else the page
            // offers is not help, it is a second action nobody asked for -
            // and excluding the control just tried is exactly what makes the
            // loop reach for the next one.
            if (deadEnd && stateCommand && commandLike && !forceModel) {
              const chased = await pursueGoal(route.global, wanted,
                { avoid: [rr.at] }).catch(() => null);
              if (chased && chased.done) {
                const acted = chased.steps.filter((st) => st.did !== "opened");
                const last = acted[acted.length - 1] || {};
                respond({
                  ok: true, plannedBy: "pursued", steps: chased.steps,
                  display: {
                    title: String(last.label || "Done").slice(0, 60),
                    subtitle: [
                      chased.opened.length
                        ? `opened ${chased.opened.map((o) => `"${o}"`).join(", then ")} to reach it`
                        : `${friendlyToolName(one.tool.name)} changed nothing, so it kept going`,
                      typeof last.now === "boolean" ? `${last.label}: ${last.was} \u2192 ${last.now}` : null,
                    ].filter(Boolean).join(" \u00b7 "),
                    stats: [{ label: "steps", value: String(chased.steps.length) }],
                    rows: chased.steps.map((st) => ({
                      name: String(st.label || st.did).slice(0, 50),
                      value: st.did === "opened" ? `revealed ${st.appeared}` : (st.changed ? "changed" : "no change"),
                      meta: st.did, tone: st.did === "opened" || st.changed ? "ok" : "warn",
                    })),
                    source: route.global,
                  },
                });
                return;
              }
            }
            if (rr.how === "click" && rr.itChanged === false) {
              const fresh = await invokeOnActiveTab("inventory", [{ includeHidden: true }])
                .catch(() => ({ ok: false }));
              if (fresh.ok) {
                forgetPageTools();
                // Without the door in the list. Derived tools keep their
                // selector in a closure, so there is nothing to compare call
                // against call - and re-planning with the header still
                // present simply picks the header again, since its label is
                // the phrase that was typed. The label is the handle we have.
                const openedAt = rr.at || "";
                const openedLabel = String(rr.control || "").trim().toLowerCase();
                const within = {
                  ...fresh.result,
                  controls: ((fresh.result && fresh.result.controls) || [])
                    // By selector where we have one. Excluding by label
                    // deleted the very control being looked for, because the
                    // panel and the layer inside it share a name.
                    .filter((c) => (openedAt
                      ? c.selector !== openedAt
                      : String(c.label || "").trim().toLowerCase() !== openedLabel)),
                };
                const inside = planGenericTool(wanted, within);
                const first = inside && inside.calls && inside.calls[0];
                // Only ever a switch, never another click. This retry exists
                // because pressing a panel open is not finishing the job, and
                // what finishes it is a checkbox, radio or dropdown. Letting
                // it pick a second click instead would mean any button that
                // happens to sit in a row with a checkbox - and does nothing
                // measurable, which is most buttons - quietly sets off
                // something else somewhere on the page.
                const next = first && /^page(Check|PickRadio|SelectOption)$/.test(first.name)
                  ? first : null;
                if (next) {
                  const after = await runVerified(route.global, next);
                  const r2 = after.result || {};
                  if (after.ok !== false
                      && (r2.itChanged === true || (after.verified && after.verified.changed))) {
                    ran = { ...after, openedFirst: rr.control };
                  }
                }
              }
            }
            const inner = ran.result && ran.result.display;
            if (ran.ok !== false) {
              respond({
                ...ran, plannedBy: "one-list", toolCall: { name: one.tool.name, args: one.args },
                runnerUp: one.runnerUp,
                display: inner || {
                  title: friendlyToolName(one.tool.name),
                  // Every path that acts has to say whether the page moved.
                  // This one reported the tool's own description and stopped,
                  // so "click flood inundation" read as a success whether the
                  // checkbox ticked or not.
                  // The control's own state where there is one. "The page
                  // responded" was true while the wrong layer switched on;
                  // only the named control can say whether it was the one
                  // that moved.
                  subtitle: (() => {
                    const r = ran.result || {};
                    if (r.wrongOne) {
                      return `asked for "${r.wrongOne}" but the page gave "${r.control}" - not acted on as named`;
                    }
                    if (typeof r.itChanged === "boolean") {
                      if (r.itChanged) return `${r.control}: ${r.was} \u2192 ${r.now}`;
                      // A click that landed and changed nothing is not the
                      // same as a box already in the state you asked for.
                      // Saying "nothing to change" to someone who asked to
                      // turn it on reports the failure as a success.
                      return r.how === "click"
                        ? `${r.control}: clicked, but it is still ${r.now} - the click did not take`
                        : `${r.control} was already ${r.now} - nothing to change`;
                    }
                    return [
                      String(one.tool.description || "").split(/[.\u2013-]/)[0].slice(0, 60),
                      ran.verified
                        ? (ran.verified.changed ? "the page responded" : "but nothing on the page changed")
                        : "could not check whether the page changed",
                    ].filter(Boolean).join(" \u00b7 ");
                  })(),
                  stats: [],
                  rows: Object.entries(one.args || {})
                    .filter(([k]) => k !== "selector")
                    .map(([k, v]) => ({ name: k, value: String(v).slice(0, 40), meta: "" })),
                  source: one.tool.kind === "data" ? "public agency data" : "this page",
                },
              });
              return;
            }
          }
        }

        const wants = commandLike || forceModel ? [] : pageValueWants(wanted);
        // An aggregate is a reason to read the page even when the thing being
        // aggregated is a word this vocabulary has never met. "Total
        // reservoir storage" on a page with a column called "Reservoir
        // Storage (acre-ft)" found no known concept, skipped the page
        // entirely, and ended up clicking two navigation links - a question
        // answered by navigating away from the answer.
        const wantsAgg = commandLike || forceModel ? null : aggregateWanted(wanted);
        // Needed by the page read and again by the walk that follows links,
        // so it lives above both rather than inside the first.
        const askedPlace = dataCall && dataCall.args
          ? (dataCall.args.place || dataCall.args.nameContains || null)
          : (extractPlaceHint(wanted, {}) || null);

        // The vocabulary draws a blank far more often than the page does.
        // Before giving up on reading, match the question's own words
        // against the page's own column names - no vocabulary required,
        // which is what a site nobody has seen needs.
        if (!commandLike && !forceModel && !pageValueWants(wanted).length) {
          const read = await invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
          const hits = read.ok ? findByOwnWords(read.result, wanted, askedPlace) : null;
          if (hits) {
            respond({
              ok: true, plannedBy: "from-page", readFrom: read.result.url, values: hits,
              display: {
                title: (read.result.title || "This page").slice(0, 70),
                subtitle: `read from the page you're on · matched this page's own wording`,
                stats: [],
                rows: hits.map((h) => ({
                  name: String(h.label).split(" · ")[0].slice(0, 40),
                  value: String(h.value).slice(0, 20),
                  meta: String(h.label).split(" · ").slice(1).join(" · "),
                })),
                source: "this page",
              },
            });
            return;
          }
        }

        if (wants.length || wantsAgg) {

          const read = await invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
          if (read.ok) {
            // A calculation comes first: picking one cell out of a row that
            // was asked about as a whole answers a different question, and
            // the single-value path below cannot tell that it has done so.
            const agg = wantsAgg;
            // With no known concept to match on, the page's own wording is
            // the only guide: the words left after the aggregate verb are
            // matched against the labels the page uses.
            const subjectWords = agg && !wants.length
              ? meaningfulWords(wanted).filter((word) => !AGGREGATE_WORDS.has(word))
              : [];
            // The same typo tolerance everything else here has. A plain
            // substring test meant "total resevoir storage" - the way it was
            // actually typed - matched no column, while the correctly spelled
            // version worked. Fixing only what I typed myself is how a fix
            // passes its own test and fails the person who reported it.
            const match = subjectWords.length
              ? (label) => subjectWords.every((word) => wordMatchesText(word, label))
              : null;
            const computed = agg && aggregateOnPage(read.result, { wants, place: askedPlace, agg, match });
            if (computed) {
              respond({
                ok: true, plannedBy: "calculated-from-page", readFrom: read.result.url,
                statistic: agg.fn, value: computed.value, over: computed.over, points: computed.points,
                display: computedDisplay(computed, read.result.title),
              });
              return;
            }
            // "high:tuesday" carries the day, which decides the column.
            // The day was only read off the data call, and a question about
            // the table in front of you names no place, so there is no data
            // call and the day was thrown away. "Max temp on saturday" then
            // fell back to today's column and answered for Friday - the
            // right row, the wrong day, stated with complete confidence.
            const askedDay = (dataCall && dataCall.args && typeof dataCall.args.when === "string"
              && dataCall.args.when.includes(":")
              ? dataCall.args.when.split(":")[1]
              : null) || findDayInText(wanted) || null;
            const hits = findOnPage(read.result, { wants, place: askedPlace, day: askedDay });
            if (hits) {
              respond({
                ok: true, plannedBy: "from-page", readFrom: read.result.url, values: hits,
                display: {
                  title: (read.result.title || "This page").slice(0, 70),
                  subtitle: `read from the page you're on · ${wants.join(" + ")}`,
                  stats: [],
                  // A table hit already carries its own value; an inline
                  // run ("High: 83 °F") is all one string, so it reads as
                  // the label with nothing to put beside it.
                  rows: hits.map((h) => (h.fromTable
                    ? { name: String(h.label).split(" · ")[0].slice(0, 40), value: String(h.value).slice(0, 20),
                        meta: String(h.label).split(" · ").slice(1).join(" · ").replace(/:.*$/, "") }
                    : { name: String(h.label).slice(0, 60), value: "", meta: "" })),
                  note: hits.some((h) => h.fromTable)
                    ? "read from this page's table"
                    : "these are the page's own figures - name a place to fetch from the agency instead",
                  source: "this page",
                },
              });
              return;
            }
          }
        }
        // Well-formed but missing the one thing these APIs require.
        if (dataCall && dataCall.needsState) {
          respond({
            ok: false,
            needsState: true,
            error: `Which state is "${dataCall.place}" in? USGS data is looked up per state, and there's no national search by name.`,
            hint: `try "${dataCall.parameter} in <state> at ${dataCall.place}"`,
          });
          return;
        }
        // The site gets a turn before a national API does. Driving the page
        // in front of you is the point of this extension; answering from an
        // agency is the bonus. "Smith river discharge" on a California water
        // portal was answered with nine rivers in nine states, when the site
        // being looked at had the one that was meant, two links away.
        if ((wants.length || wantsAgg) && !commandLike) {
          const followed = await followToAnswer(wanted, {
            wants, agg: wantsAgg, place: askedPlace,
          }).catch(() => null);
          if (followed) {
            const where = `${followed.from.label}`.slice(0, 60);
            const display = followed.kind === "calculated"
              ? computedDisplay(followed.computed, where)
              : {
                  title: where || "Found on this site",
                  subtitle: `${followed.hits.length} value${followed.hits.length === 1 ? "" : "s"} · followed ${followed.trail.length} link${followed.trail.length === 1 ? "" : "s"} from this page`,
                  stats: [],
                  rows: followed.hits.slice(0, 8).map((h) => ({
                    name: String(h.label).slice(0, 44),
                    value: String(h.value).slice(0, 20), meta: "",
                  })),
                  source: "followed from this site",
                };
            display.caveat = `read from ${followed.from.url}`;
            respond({
              ok: true, plannedBy: "followed-the-site",
              followed: followed.trail, readFrom: followed.from.url, display,
            });
            return;
          }
        }

        // The page's own downloads, before anybody else's. A chart is a
        // picture of a series the site already fetched; asked for humidity
        // on a page plotting humidity, this answered from a station eleven
        // miles away, because readPage sees tables and text and a canvas is
        // neither. The numbers were already in the browser.
        if (!commandLike && !forceModel && (wants.length || wantsAgg)) {
          const feeds = await invokeOnActiveTab("capturedSeries", [{}]).catch(() => ({ ok: false }));
          const series = (feeds.ok && feeds.result && feeds.result.series) || [];
          if (series.length) {
            const subject = meaningfulWords(wanted).filter((w) => !AGGREGATE_WORDS.has(w) && w.length > 2);
            const named = series.find((sr) => subject.some((w) => wordMatchesText(w, sr.name.toLowerCase())));
            if (named) {
              const stat = wantsAgg ? wantsAgg.fn : null;
              const value = stat === "mean" ? named.mean : stat === "max" ? named.max
                : stat === "min" ? named.min : stat === "sum" ? named.values.reduce((a, b) => a + b, 0)
                : stat === "count" ? named.count : named.last;
              respond({
                ok: true, plannedBy: "page-data", series: named.name, from: named.from,
                display: {
                  title: `${wantsAgg ? wantsAgg.word + " " : ""}${named.name.split(".").pop()}`.trim(),
                  subtitle: `${value} · ${wantsAgg ? `over ${named.count} points` : `latest of ${named.count} points`} the page itself downloaded`,
                  stats: [
                    { label: "latest", value: String(named.last) },
                    { label: "low", value: String(named.min) },
                    { label: "high", value: String(named.max) },
                    { label: "mean", value: String(named.mean) },
                  ],
                  rows: [],
                  caveat: `read from the page's own request to ${named.from || "this site"}, not from an agency`,
                  source: "this page's data",
                },
              });
              return;
            }
          }
        }

        if (dataCall && !commandLike) {
          // A site that says which state it is about should be believed,
          // when the question did not say. Narrowing only, and said out
          // loud, because a hint that quietly answers about the wrong place
          // is worse than no hint.
          let usedHint = null;
          const call = { ...dataCall, args: { ...dataCall.args } };
          if (!call.args.state) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [null]);
            const hint = tab && tab.url ? stateFromSite(tab.url, tab.title) : null;
            const def = findToolDef(route.global, call.name);
            const takesState = !!((def && def.parameters && def.parameters.properties) || {}).state;
            if (hint && takesState) {
              call.args.state = hint.code;
              usedHint = hint;
            }
          }
          let result = await executeToolCall(route.global, call);
          // If the hint found nothing, it was the wrong guess - ask again
          // without it rather than report an empty answer.
          if (usedHint && result.result && result.result.found === 0) {
            result = await executeToolCall(route.global, dataCall);
            usedHint = null;
          }
          if (usedHint && result.result && result.result.display) {
            result.result.display.note = `narrowed to ${usedHint.code.toUpperCase()}, from this site (${usedHint.from})`;
          }
          respond({ ...result, plannedBy: "fast-path", toolCall: usedHint ? call : dataCall,
            narrowedBy: usedHint || undefined });
          return;
        }

        if (route.global === "USGS") {
          const fast = forceModel ? null : planTool(wanted);
          if (fast) {
            const result = await invokeOnActiveTab(fast.fn, fast.args);
            respond({ ...result, plannedBy: "fast-path", plannedCall: fast });
            return;
          }
        }

        // Then the route's own verified tools. This is what makes SITE, NOAA
        // and FCP usable at all without the model - 46 tools that previously
        // only it could reach. A hand-written manifest beats GENERIC's
        // selector guessing below, having been checked against the real site.
        let manifestCall = forceModel ? null : planManifestTool(wanted, route.global);
        let cameFromPage = false;
        if (manifestCall) {
          // A hand-written tool is preferred above for having been checked
          // against the real site - but only while it is actually the thing
          // being asked for. When the page's own control names more of the
          // request than the manifest tool does, the page wins. This has to
          // be settled before either one runs: running the loser is precisely
          // what switched on the wrong layer and then reported success.
          const askWords = meaningfulWords(wanted);
          const pageOwn = confidentPick(
            await unifiedTools(route.global, wanted, { acting: true }), wanted);
          if (pageOwn && pageOwn.tool.name !== manifestCall.name
              && namedCoverage(`${pageOwn.tool.name} ${pageOwn.tool.label || ""}`, askWords)
                 > namedCoverage(manifestCall.name, askWords)) {
            manifestCall = { name: pageOwn.tool.name, args: pageOwn.args };
            cameFromPage = true;
          }
        }
        if (manifestCall) {
          // An action that cannot simply be undone is worth a question first.
          // Verification makes most things reversible; a download that has
          // started and a page that has navigated away are not among them.
          const def = findToolDef(route.global, manifestCall.name);
          if (def && def.destructive && !msg.confirmed) {
            respond({
              ok: false, needsConfirm: true, toolCall: manifestCall,
              error: `That ${def.destructive}.`,
              display: {
                title: "Confirm first",
                subtitle: `${friendlyToolName(manifestCall.name)} ${def.destructive}`,
                stats: [], rows: [],
                choices: [{ label: `Yes, ${friendlyToolName(manifestCall.name)}`, hint: "", call: manifestCall, confirmed: true }],
                note: "ask again to change your mind - nothing has happened yet",
                source: route.global,
              },
            });
            return;
          }
          let result = await runVerified(route.global, manifestCall);
          let usedInstead = null;

          // A verified tool that changed nothing is not a success, and the
          // page usually has another way. "Enable flood inundation" picked
          // noaaToggleFloodCategory - a hand-written tool, preferred because
          // it was verified against the real site - which ran, changed
          // nothing, and reported done. The derived toggleFloodInundation
          // would have worked, because it opens the Layers panel first.
          //
          // So: if the chosen tool moved nothing, try what the page itself
          // offers before claiming anything.
          // Not only when it is known to have changed nothing: an action
          // that could not be checked is equally unproven, and "ran - could
          // not check whether the page changed" is not a result worth
          // stopping on when the page offers another way.
          // A tool that threw is the clearest case of all, and it was the
          // one this did not cover. noaaToggleFloodCategory threw
          // `"inundation" not found`, the error travelled all the way to the
          // panel inside the payload, and the card said "ran - could not
          // check whether the page changed". It did not run. An outright
          // failure reported as an unverifiable success is worse than either.
          if (result.ok === false || !result.verified || result.verified.changed === false) {
            const second = confidentPick(
              await unifiedTools(route.global, wanted, { acting: true }), wanted);
            if (second && second.tool.name !== manifestCall.name) {
              const retry = await runVerified(route.global, { name: second.tool.name, args: second.args });
              if (retry.ok !== false && retry.verified && retry.verified.changed) {
                result = retry;
                usedInstead = second.tool.name;
              }
            }
          }

          // Still nothing. The hand-written tool is a single step by
          // construction - it looks for a checkbox that is not in the
          // document yet - and one more single step will not find it either.
          // The page's own control is three levels down, which is what the
          // loop is for. This path never reached it: it was wired into the
          // one-list route and the nothing-matched fallback, and a manifest
          // route that failed simply reported its failure.
          let chased = null;
          if ((result.ok === false || !result.verified || result.verified.changed === false)
              && !usedInstead && commandLike && !forceModel) {
            chased = await pursueGoal(route.global, wanted).catch(() => null);
            if (chased && chased.done) {
              const acted = chased.steps.filter((st) => st.did !== "opened");
              const last = acted[acted.length - 1] || {};
              respond({
                ok: true, plannedBy: "pursued", steps: chased.steps,
                display: {
                  title: String(last.label || "Done").slice(0, 60),
                  subtitle: [
                    `${friendlyToolName(manifestCall.name)} could not do it, so this page's own controls were used`,
                    chased.opened.length
                      ? `opened ${chased.opened.map((o) => `"${o}"`).join(", then ")}` : null,
                    typeof last.now === "boolean" ? `${last.label}: ${last.was} \u2192 ${last.now}` : null,
                  ].filter(Boolean).join(" \u00b7 "),
                  stats: [{ label: "steps", value: String(chased.steps.length) }],
                  rows: chased.steps.map((st) => ({
                    name: String(st.label || st.did).slice(0, 50),
                    value: st.did === "opened" ? `revealed ${st.appeared}` : (st.changed ? "changed" : "no change"),
                    meta: st.did, tone: st.did === "opened" || st.changed ? "ok" : "warn",
                  })),
                  source: route.global,
                },
              });
              return;
            }
          }

          const note = describeVerification(result.verified, manifestCall);
          // Anything the tool could not account for is said out loud - a
          // dropped word is how an action ends up answering a different
          // question than the one asked.
          const ignored = manifestCall.unmatchedWords;
          respond({
            ...result, ok: result.ok !== false,
            plannedBy: cameFromPage ? "page" : "manifest", toolCall: manifestCall,
            display: {
              title: friendlyToolName(usedInstead || manifestCall.name),
              // A substitution has to be stated, but never at the cost of
              // the verification result - saying "went there by searching"
              // while hiding that nothing moved is worse than either alone.
              subtitle: [
                usedInstead ? `${friendlyToolName(manifestCall.name)} changed nothing, so this page's own control was used`
                  : manifestCall.movedTo ? `moved the map to ${manifestCall.movedTo}`
                  : manifestCall.insteadOf ? `searched instead of ${manifestCall.insteadOf}` : null,
                // Never "done" as a fallback. That was the most confident
                // wording available standing in for the least information -
                // no verification at all reads exactly like a success.
                // The control's own before/after wherever the runner
                // reports it. "Ran - could not check whether the page
                // changed" was the honest answer to the wrong question:
                // what matters is whether *this* control moved.
                (() => {
                  const r = (result && result.result) || {};
                  if (r.wrongOne) {
                    return `asked for "${r.wrongOne}" but the page gave "${r.control}" - not acted on as named`;
                  }
                  if (typeof r.itChanged === "boolean") {
                    if (r.itChanged) return `${r.control}: ${r.was} \u2192 ${r.now}`;
                    return r.how === "click"
                      ? `${r.control}: clicked, but it is still ${r.now} - the click did not take`
                      : `${r.control} was already ${r.now} - nothing to change`;
                  }
                  // It did not run. The error was in the payload the whole
                  // time - `"inundation" not found` - while the card said
                  // "ran - could not check whether the page changed". The
                  // one thing that was certain got reported as the one thing
                  // that was unknown.
                  if (result.ok === false) {
                    return `did not run: ${String(result.error || "no reason given").slice(0, 90)}`;
                  }
                  return note ? note.text
                    : result.verified ? "ran, but nothing on the page changed"
                      : "ran - could not check whether the page changed";
                })(),
                ignored ? `ignored: ${ignored.join(", ")}` : null,
              ].filter(Boolean).join(" · "),
              stats: chased ? [{ label: "steps tried", value: String(chased.steps.length) }] : [],
              // What the loop tried, when it tried and failed. Reporting only
              // the hand-written tool's error threw away the entire attempt -
              // four rounds of reports came back saying nothing but "it did
              // not work", because the card had nothing else to say.
              rows: (chased && chased.steps.length ? chased.steps.map((st) => ({
                name: String(st.label || st.did).slice(0, 50),
                value: st.did === "opened"
                  ? `revealed ${st.appeared}`
                  : (st.changed ? "changed" : "no change"),
                meta: st.did,
                tone: st.did === "opened" || st.changed ? "ok" : "warn",
              })) : rankedChanges(result.verified).map((c) => ({
                name: nameOfChange(c),
                value: c.now === undefined ? "" : String(c.now).slice(0, 24),
                meta: c.was === undefined ? "" : `was ${String(c.was).slice(0, 24)}`,
                tone: "ok",
              }))).concat(chased && chased.unaccounted && chased.unaccounted.length
                ? [{ name: `never accounted for: ${chased.unaccounted.join(", ")}`,
                     value: "", meta: "", tone: "warn" }]
                : []),
              caveat: note && note.tone === "alert" ? note.text : undefined,
              source: route.global,
            },
          });
          return;
        }

        // Any site, no model: match the instruction against the page's own
        // controls. This is the only fast path an unmapped page has, and
        // without it every instruction there fell to the slow tier.
        // "What does this page say" is a different request from "click
        // something on it", and the control matcher would only ever find a
        // button whose label happened to share a word.
        if (/\bread\b.*\b(page|this|site)\b|\bwhat('?s| is| does)\b.*\b(page|shown|displayed|say)\b|\bon (this|the) (page|screen)\b|\bsummari[sz]e\b/i.test(wanted)) {
          const read = await invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
          if (read.ok) {
            const d = read.result;
            const rows = [];
            for (const p of (d.pairs || []).slice(0, 8)) rows.push({ name: p.label, value: p.value, meta: "" });
            for (const r of (d.readouts || []).slice(0, Math.max(0, 8 - rows.length))) {
              rows.push({ name: r.label || r.text, value: r.unit ? `${r.value} ${r.unit}` : r.text, meta: "" });
            }
            const counts = [
              d.tables && d.tables.length ? `${d.tables.length} table${d.tables.length === 1 ? "" : "s"}` : null,
              d.pairs && d.pairs.length ? `${d.pairs.length} labelled values` : null,
              d.readouts && d.readouts.length ? `${d.readouts.length} readouts` : null,
              d.chart && d.chart.svgCharts.length ? `${d.chart.svgCharts.length} SVG chart${d.chart.svgCharts.length === 1 ? "" : "s"}` : null,
              d.chart && d.chart.canvasCount ? `${d.chart.canvasCount} canvas (unreadable)` : null,
            ].filter(Boolean);
            // Nothing readable and a canvas present means the data is
            // pixels - but the page fetched it before drawing, so the
            // captured feeds are the real answer rather than a shrug.
            let feeds = null;
            if (!rows.length && d.chart && d.chart.canvasCount) {
              const cap = await invokeOnActiveTab("capturedFeeds", []).catch(() => ({ ok: false }));
              if (cap.ok) feeds = cap.result;
            }
            if (feeds && feeds.count) {
              for (const f of feeds.feeds.slice(0, 8)) {
                rows.push({
                  name: f.url.replace(/^https?:\/\//, "").slice(0, 70),
                  value: `${f.status}`,
                  meta: [f.keys ? f.keys.join(", ") : null, f.bytes ? `${Math.round(f.bytes / 1024)}kB` : null].filter(Boolean).join(" · "),
                });
              }
            }
            respond({
              ok: true, plannedBy: "page-read", result: d, feeds: feeds || undefined,
              display: {
                title: d.title ? d.title.slice(0, 70) : "This page",
                subtitle: feeds && feeds.count
                  ? `chart is canvas - showing the ${feeds.count} data request${feeds.count === 1 ? "" : "s"} behind it`
                  : counts.length ? counts.join(" · ") : "no readable data found",
                stats: [], rows,
                caveat: feeds && !feeds.count ? feeds.note : d.note,
                note: d.headings && d.headings.length ? d.headings[0].slice(0, 60) : undefined,
                source: feeds && feeds.count ? "captured requests" : "live DOM",
              },
            });
            return;
          }
        }

        // A page that declares its own WebMCP tools has said what it can do,
        // in its own words, with real schemas. Everything below this line is
        // a reconstruction from markup - so when the page has stated the
        // answer, the guessing never runs.
        // Every route now carries GENERIC alongside its named manifest, so
        // page controls can be matched anywhere - including the ones a
        // hand-written manifest never covered.
        // Keep the reason. This catch threw the error away, so the failure
        // card said "could not read this page's controls" and stopped there -
        // and the fix that was supposed to append the reason had nothing to
        // append. On a page whose controls the badge had just counted, that
        // message reads as nonsense with no way to act on it.
        // Hidden included: a control behind a closed panel is usable now, so
        // it should be plannable and, failing that, at least mentionable.
        // The failure card could not name what was in the Layers panel
        // because the inventory it was given had never looked inside it.
        const inv = await invokeOnActiveTab("inventory", [{ includeHidden: true }])
          .catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
        if (inv.ok) {
          const guess = forceModel ? null : planGenericTool(wanted, inv.result);

          // A question must not press anything, and must not offer to
          // either. "How full is lake conroe" produced a menu of two
          // controls - a link called Lake Evaporation/Rainfall and a row
          // called Conroe - both of which did nothing when pressed, because
          // a table row is not a button.
          //
          // A menu of guesses that change the page is not an answer to a
          // question. If the page cannot answer, say so; the failure card
          // already lists what is here and what was understood, which is
          // more use than two things to try at random.
          if (guess && guess.calls && !commandLike) {
            const why = explainFailure(wanted, route, inv, { modelOff: true });
            why.hint = "this page has controls with related names, but pressing one would change the page rather than answer - name the control if that is what you want";
            respond(why);
            return;
          }

          if (guess && guess.calls) {
            // Run them in order and stop at the first failure - a later step
            // usually depends on an earlier one having opened or switched
            // something, so continuing past a failure just piles on damage.
            const steps = [];
            for (const call of guess.calls) {
              const result = await runVerified(route.global, call);
              steps.push({
                call, ok: result.ok !== false, result: result.result, error: result.error,
                // A step that ran without changing anything is reported, not
                // hidden: in a sequence it usually means a later step is
                // about to act on a state that was never reached.
                changed: result.verified ? result.verified.changed : undefined,
              });
              if (result.ok === false) break;
            }
            const failed = steps.find((st) => !st.ok);
            respond({
              ok: !failed,
              plannedBy: "page-match",
              steps,
              error: failed ? `"${failed.call.args.selector}" failed: ${failed.error}` : undefined,
              unmatchedWords: guess.unmatchedWords.length ? guess.unmatchedWords : undefined,
              display: {
                title: failed ? "Partly applied" : (steps.length > 1 ? `Applied ${steps.length} controls` : "Applied"),
                subtitle: guess.unmatchedWords.length
                  ? `nothing on this page matched: ${guess.unmatchedWords.join(", ")}`
                  : guess.phrase,
                stats: [],
                rows: guess.matched.slice(0, steps.length).map((m, i) => {
                  const st = steps[i];
                  const noop = st && st.ok && st.changed === false;
                  return {
                    name: m.label || m.selector,
                    value: !st || !st.ok ? "failed" : noop ? "no change" : "done",
                    meta: st && !st.ok ? String(st.error || "no reason given").slice(0, 70) : m.covered.join(" "),
                    tone: !st || !st.ok ? "alert" : noop ? "warn" : "ok",
                  };
                }),
                source: "this page",
              },
            });
            return;
          }
          if (guess && guess.ambiguous) {
            // Two controls sharing a name are not always a real choice. NWPS
            // carries "Flood Inundation Mapping" in its navbar and again as
            // the layer itself, so the page looks ambiguous while only one
            // of the two does anything - and asking which was meant puts the
            // work back on the person who already said what they wanted.
            //
            // Acting and checking settles it better than guessing: the loop
            // tries, verifies, and moves on when nothing happened. Only its
            // finished result is taken; anything less and the question is
            // still the honest answer.
            //
            // This was the last thing standing between the generic path and
            // the hand-written one. With the site code removed, "enable
            // flood inundation" stopped here - and the loop, called directly
            // on the same page, reached the layer. The success was borrowed
            // from a prebuilt tool failing in the right way.
            if (commandLike && !forceModel) {
              const chased = await pursueGoal(route.global, wanted).catch(() => null);
              if (chased && chased.done) {
                const acted = chased.steps.filter((st) => st.did !== "opened");
                const last = acted[acted.length - 1] || {};
                respond({
                  ok: true, plannedBy: "pursued", steps: chased.steps,
                  display: {
                    title: String(last.label || "Done").slice(0, 60),
                    subtitle: [
                      chased.opened.length
                        ? `opened ${chased.opened.map((o) => `"${o}"`).join(", then ")} to reach it`
                        : "more than one control shared that name, so each was tried",
                      typeof last.now === "boolean" ? `${last.label}: ${last.was} \u2192 ${last.now}` : null,
                    ].filter(Boolean).join(" \u00b7 "),
                    stats: [{ label: "steps", value: String(chased.steps.length) }],
                    rows: chased.steps.map((st) => ({
                      name: String(st.label || st.did).slice(0, 50),
                      value: st.did === "opened" ? `revealed ${st.appeared}` : (st.changed ? "changed" : "no change"),
                      meta: st.did, tone: st.did === "opened" || st.changed ? "ok" : "warn",
                    })),
                    source: route.global,
                  },
                });
                return;
              }
            }
            respond({
              ok: false,
              needsChoice: true,
              error: "Several controls on this page could match that.",
              candidates: guess.ambiguous,
              display: {
                title: "Which one did you mean?",
                subtitle: `${guess.ambiguous.length} controls match - pick one`,
                stats: [], rows: [],
                // Buttons rather than rows: a selector is unreadable, and a
                // question with no way to answer it is barely a question.
                choices: guess.ambiguous.map((c) => ({
                  label: c.label || "(unlabelled)",
                  hint: c.kind || "",
                  call: c.call,
                })),
                source: "this page",
              },
            });
            return;
          }
        }

        // A command that matched no control, but asked about something these
        // sources know: better to answer than to fail. "show the discharge in
        // Idaho" on a page with no such control is still a fair question.
        if (commandLike && dataCall && !dataCall.needsState) {
          const result = await executeToolCall(route.global, dataCall);
          respond({ ...result, plannedBy: "fast-path", toolCall: dataCall, note: "no control matched, so this was answered from data" });
          return;
        }
        if (commandLike) {
          const pageWants = pageValueWants(wanted);
          if (pageWants.length && inv.ok) {
            const readForValues = await invokeOnActiveTab("readPage", []).catch(() => ({ ok: false }));
            if (readForValues.ok) {
              const hits = findOnPage(readForValues.result, { wants: pageWants, place: null, day: null });
              if (hits) {
                respond({
                  ok: true, plannedBy: "from-page", values: hits,
                  display: {
                    title: (readForValues.result.title || "This page").slice(0, 70),
                    subtitle: "no control matched, so this was read from the page",
                    stats: [], rows: hits.map((h) => ({ name: String(h.label).slice(0, 60), value: "", meta: "" })),
                    source: "this page",
                  },
                });
                return;
              }
            }
          }
        }

        if (forceModel && !(await isLocalModelEnabled())) {
          // Asked for the model by name, so say the model is off rather than
          // reporting that nothing matched - nothing was tried.
          respond({
            ok: false,
            error: 'The local model is off. Turn on "local model" in Debug tools, wait for it to finish loading, then ask again.',
            display: {
              title: "The model is switched off",
              subtitle: 'you asked for it by name with "model:", so nothing else was tried',
              stats: [], rows: [],
              note: "it is several gigabytes on first load and needs WebGPU",
              source: "model",
            },
          });
          return;
        }

        // A key is an upgrade, never a requirement. Nothing above this line
        // needs one, and nothing ever will: the extension has to work the
        // moment it is installed, on any machine, with no account and no
        // setup. But once everything keyless has genuinely failed, a capable
        // model is the difference between an answer and a shrug - and the
        // bugs that reach this point are interpretation problems, which is
        // exactly what such a model is good at.
        //
        // It was reachable only from Debug tools, so in practice it never
        // ran: the one model in here able to judge was sitting behind a
        // button nobody presses.
        const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
        if (geminiApiKey) {
          const known = await agentTools(route.global, wanted, { max: 24 });
          const context = known.page.length ? null : await buildContext(route.global);
          const plan = await askGemini(wanted, known.all, context).catch((e) => ({ ok: false, error: String(e.message || e) }));
          if (plan.ok && plan.toolCall) {
            const result = await runVerified(route.global, plan.toolCall);
            const inner = result.result && result.result.display;
            respond({
              ...result, plannedBy: "gemini", toolCall: plan.toolCall,
              display: inner || {
                title: friendlyToolName(plan.toolCall.name),
                subtitle: "chosen by the model you supplied a key for",
                stats: [],
                rows: Object.entries(plan.toolCall.args || {})
                  .filter(([k]) => k !== "selector")
                  .map(([k, v]) => ({ name: k, value: String(v).slice(0, 40), meta: "" })),
                source: "Gemini",
              },
            });
            return;
          }
          if (plan.ok && plan.text) {
            respond({ ok: true, plannedBy: "gemini", modelReply: plan.text,
              display: { title: "The model's answer", subtitle: String(plan.text).slice(0, 140),
                stats: [], rows: [], source: "Gemini" } });
            return;
          }
        }

        // Nothing single-step matched. Before the one-door-then-act fallback
        // below, try the general form: pursue the goal for as many steps as
        // it takes. That block only ever opens one thing and then acts, which
        // reaches two levels; water.noaa.gov puts its layers three down -
        // press Layers, expand the accordion named after the layer, tick the
        // box inside - and no amount of one-door retrying arrives there.
        //
        // Only where the loop actually finished the job. A partial run is
        // left to the paths below rather than reported as progress, because
        // "I pressed two things and got nowhere" is not an answer.
        if (commandLike && !forceModel) {
          const chased = await pursueGoal(route.global, wanted).catch(() => null);
          if (chased && chased.done) {
            const acted = chased.steps.filter((st) => st.did !== "opened");
            const last = acted[acted.length - 1] || {};
            respond({
              ok: true, plannedBy: "pursued", steps: chased.steps,
              display: {
                title: String(last.label || "Done").slice(0, 60),
                subtitle: [
                  chased.opened.length
                    ? `opened ${chased.opened.map((o) => `"${o}"`).join(", then ")} to reach it`
                    : null,
                  typeof last.was === "boolean" || typeof last.now === "boolean"
                    ? `${last.label}: ${last.was} \u2192 ${last.now}`
                    : "the page responded",
                ].filter(Boolean).join(" \u00b7 "),
                stats: [{ label: "steps", value: String(chased.steps.length) }],
                rows: chased.steps.map((st) => ({
                  name: String(st.label || st.did).slice(0, 50),
                  value: st.did === "opened" ? `revealed ${st.appeared}` : (st.changed ? "changed" : "no change"),
                  meta: st.did,
                  tone: st.did === "opened" || st.changed ? "ok" : "warn",
                })),
                source: route.global,
              },
            });
            return;
          }
        }

        // Nothing on the page matched. Before saying so, open the things
        // that look like they open something and look again.
        //
        // A panel built with {#if open} does not exist until it is pressed -
        // Svelte, React and the rest remove it from the document - so its
        // contents were never in any inventory, at any visibility. That is
        // why "enable snow water equivalent" matched five nav links on the
        // word "water": the control it named had not been rendered yet.
        // A hand-written noaaOpenLayers existed for exactly this, and this is
        // the general form of it.
        if (!commandLike || forceModel) { /* only for instructions */ } else {
          const found = await invokeOnActiveTab("disclosures", [{ match: wanted }])
            .catch(() => ({ ok: false }));
          const candidates = (found.ok && found.result && found.result.disclosures) || [];
          for (const d of candidates.slice(0, 3)) {
            const opened = await invokeOnActiveTab("openDisclosure", [d.selector]).catch(() => null);
            if (!opened || !opened.ok || !opened.result.appeared) continue;

            const fresh = await invokeOnActiveTab("inventory", [{ includeHidden: true }]).catch(() => ({ ok: false }));
            if (!fresh.ok) continue;
            forgetPageTools();
            const retry = planGenericTool(wanted, fresh.result);
            if (!retry || !retry.calls) continue;

            const steps = [];
            for (const call of retry.calls) {
              const out = await runVerified(route.global, call);
              steps.push({ call, ok: out.ok !== false, changed: out.verified ? out.verified.changed : undefined });
              if (out.ok === false) break;
            }
            const failed = steps.find((st) => !st.ok);
            respond({
              ok: !failed, plannedBy: "opened-then-acted", openedFirst: opened.result.opened, steps,
              display: {
                title: retry.matched.map((m) => m.label).join(" + ").slice(0, 60) || "Done",
                subtitle: `opened "${opened.result.opened}" first - ${opened.result.appeared} more controls appeared`,
                stats: [],
                rows: retry.matched.slice(0, steps.length).map((m, i) => ({
                  name: m.label || m.selector, value: steps[i] && steps[i].ok
                    ? (steps[i].changed === false ? "no change" : "done") : "failed",
                  meta: (m.covered || []).join(" "),
                  tone: steps[i] && steps[i].ok ? (steps[i].changed === false ? "warn" : "ok") : "alert",
                })),
                source: "this page",
              },
            });
            return;
          }
        }

        if (!(await isLocalModelEnabled())) {
          // Everything cheap has genuinely been tried by this point: data
          // tools, the route's own keyword path, and a scored scan of every
          // control on the page. Report what was understood and what was
          // searched rather than a bare failure.
          const why = explainFailure(msg.instruction || "", route, inv, { modelOff: true });
          why.hint = "name a measurement and a place (\"gage height in Wyoming\"), or use a control's own wording from the list above"
            + (geminiApiKey ? "" : " - a Gemini key in Debug tools would let a model try the ones it cannot work out, though nothing here needs one");
          respond(why);
          return;
        }

        await ensureOffscreenDocument();
        const status = await chrome.runtime.sendMessage({ target: "offscreen", type: "llmStatus" });
        if (!status.ready) {
          respond({
            ok: false,
            stillLoading: true,
            error: status.hasGpu
              ? "No quick match for that, and the local model is still loading in the background. Try a simpler instruction, or wait and ask again."
              : "No quick match for that, and this browser/machine has no WebGPU, so the local model can't load at all here.",
          });
          return;
        }

        // The page's own tools, ranked - not the static selector primitives.
        // This wiring existed but only in the debug handler, so the path
        // anyone actually reaches was still offering the model
        // pageClick{selector} and a wall of CSS.
        // Routing, not answering. The model's whole job is to name one tool,
        // so the prompt should contain the tools and almost nothing else.
        //
        // It was being sent 3,136 tokens for that decision - 2,071 of them
        // the old context block: an env-vocab synonym table and forty rows of
        // inventory prose, both written when the model had to read CSS and
        // build a selector. The tools describe the page now, so the context
        // restates what the tool list already says, and prefill on a small
        // model is where the time goes.
        const known = await agentTools(route.global, wanted, { max: 12 });
        // Kept only where there are no page tools to describe it.
        const context = known.page.length ? null : await buildContext(route.global);
        // The model picks; it does not write. Asking it to generate a tool
        // name and every argument spends around thirty decode tokens on a
        // decision worth about four bits, and decode is most of the wait.
        // A numbered list costs one token, and the arguments are then filled
        // by argsForTool - the same code that fills them on every other path,
        // which cannot invent a value the page does not offer.
        const shortlist = known.all.map((t) => ({
          name: t.name,
          gist: String(t.description || "").split(/[.\u2013-]/)[0].trim().slice(0, 60),
        }));
        const picked = await chrome.runtime.sendMessage({
          target: "offscreen", type: "llmPick",
          instruction: wanted, tools: shortlist,
        });

        // What the deterministic path would have chosen, for comparison. The
        // shortlist is already ranked by it, so its answer is entry one -
        // free to report, and the only way to tell a model that helped from
        // one that just cost three seconds.
        const scorerPick = known.all[0] ? known.all[0].name : null;

        let plan = null;
        if (picked && picked.ok && picked.index !== null && known.all[picked.index]) {
          const def = known.all[picked.index];
          const args = argsForTool(def, wanted, meaningfulWords(wanted)) || {};
          plan = { ok: true, toolCall: { name: def.name, args }, pickedIn: picked.ms,
            agreed: def.name === scorerPick, scorerPick };
        } else if (picked && picked.ok) {
          // The model said none of them fit, which is an answer.
          plan = { ok: true, toolCall: null, text: "none of this page's tools fit that" };
        } else {
          // Picking failed outright - fall back to the older path, which can
          // still answer where a bare number could not.
          plan = await chrome.runtime.sendMessage({
            target: "offscreen", type: "llmPlanJson",
            instruction: wanted, tools: known.all, context,
          });
        }
        if (!plan.ok) { respond(plan); return; }
        if (!plan.toolCall) {
          respond({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        // A prompted model can name a tool that does not exist, which the
        // native API could not. Page tools are not in TOOL_DEFS and are
        // resolved by executeToolCall, so only a name in neither is wrong.
        const isKnown = findToolDef(route.global, plan.toolCall.name)
          || known.page.some((t) => t.name === plan.toolCall.name);
        if (!isKnown) {
          respond({
            ok: false,
            error: `the model asked for "${plan.toolCall.name}", which isn't a tool here`,
            available: toolsFor(route.global).map((t) => t.name),
            modelOutput: plan.raw,
          });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        // The model's choice, what the scorer would have chosen, and how long
        // the difference cost. Without this "the model is wrong" cannot be
        // told from "the model is slow".
        const chose = plan.toolCall ? plan.toolCall.name : "(none)";
        const note = plan.scorerPick === undefined ? undefined
          : plan.agreed
            ? `model and scorer both chose ${chose}${plan.pickedIn ? ` · ${plan.pickedIn}ms` : ""}`
            : `model chose ${chose}; without it, ${plan.scorerPick}${plan.pickedIn ? ` · ${plan.pickedIn}ms` : ""}`;
        const display = result.result && result.result.display
          ? { ...result.result.display, caveat: note || result.result.display.caveat }
          : result.display;
        respond({ ...result, plannedBy: plan.pickedIn ? "webllm-pick" : "webllm-json",
          toolCall: plan.toolCall, modelMs: plan.pickedIn,
          modelChose: chose, scorerWouldChoose: plan.scorerPick, agreed: plan.agreed,
          display });
      } catch (err) {
        respond({ ok: false, error: String((err && err.message) || err) });
      } finally {
        stopKeepAlive();
      }
    })();
    return true;
  }
});
