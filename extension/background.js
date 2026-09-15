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

const NAMED_MANIFESTS = [
  { test: /^https:\/\/waterdata\.usgs\.gov\/state\//, bundle: "page/usgs-bundle.js", global: "USGS" },
  { test: /^https:\/\/waterdata\.usgs\.gov\/monitoring-location\//, bundle: "page/site-bundle.js", global: "SITE" },
  { test: /^https:\/\/water\.noaa\.gov\//, bundle: "page/noaa-bundle.js", global: "NOAA" },
  { test: /^https:\/\/(www\.)?weather\.gov\/forecastpoints/, bundle: "page/forecastpoints-bundle.js", global: "FCP" },
];

const GENERIC_BUNDLE = "page/generic-bundle.js";

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
  const files = bundle === GENERIC_BUNDLE ? [bundle] : [bundle, GENERIC_BUNDLE];
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files,
  });
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
  "week", "month", "year", "day", "night", "tonight", "tomorrow",
  "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "weekend", "next", "this", "last", "past", "coming",
]);

// Pulls the place out of an instruction by elimination: strip the parts we
// positively identified (the state, the measurement) and the filler, and
// whatever meaningful words remain are the river or town being asked about.
// "gage height in wyoming at big sandy river" -> "big sandy river", which is
// exactly what USGS's gauge names contain, so it works as a name filter.
function extractPlaceHint(instruction, { stateMatched, parameterMatched, cityMatched } = {}) {
  let t = (instruction || "").toLowerCase();
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
  const tail = t.match(/\b(?:at|in|on|near|along|around|for|of)\s+(.+)$/);
  if (!tail) return null;
  const words = tail[1].split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !PLACE_FILLER.has(w));
  return words.length ? words.join(" ") : null;
}

// Which kind of measurement a bare word like "temperature" means depends on
// the page you're asking from: on weather.gov it's the air, on a USGS gauge
// page it's the water. env-vocab lists "temperature" and "temp" as water
// synonyms because it was written for USGS, which is right there and wrong on
// a forecast site - so the route settles it rather than the word alone.
const WATER_ROUTES = new Set(["USGS", "SITE", "NOAA"]);

function planDataTool(instruction, route) {
  const text = instruction || "";
  const routeGlobal = (route && route.global) || "GENERIC";
  const bareTemperature = /\btemp(erature)?\b/i.test(text) && !/\bwater\s+temp/i.test(text) && !/\bair\s+temp/i.test(text);
  const wantsWeather = /\bhumidity\b|\bdew ?point\b|\bwind\b|\bbarometric\b|\bpressure\b|\bweather\b|\bair temp\w*\b|\bhow (?:hot|cold|windy|humid)\b/i.test(text)
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
    // A weather question about an unrecognized place stays a weather
    // question - weatherConditions resolves the state from the place itself
    // rather than falling back to water data for want of a state.
    if (wantsWeather) return { name: "weatherConditions", args: { place } };
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
  // A named river beats a city: "gage height in wyoming at big sandy river"
  // is asking about that river, not about Wyoming generally. Falls back to
  // statewide if the name matches no gauge.
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
      name: "usgsOpenSite", fn: "openSite", argOrder: ["siteId"],
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
      name: "siteDownloadData", fn: "downloadData", argOrder: ["sets"],
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
      parameters: { type: "object", properties: { product: { type: "string", description: "obsFcst, HEFS, or LRO" } }, required: ["product"] },
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
      parameters: { type: "object", properties: { hex: { type: "string", description: "e.g. #ff0000" } }, required: ["hex"] },
    },
    {
      name: "fcpAddRing", fn: "addRing", argOrder: [],
      description: "Add a range ring at the last clicked/searched location. Opens the ring config panel itself.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpRemoveLastRing", fn: "removeLastRing", argOrder: [],
      description: "Remove the most recently added range ring.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "fcpClearRings", fn: "clearRings", argOrder: [],
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
      name: "pageFill", fn: "fill", argOrder: ["selector", "text"],
      description: "Type text into an input or textarea on the page by CSS selector.",
      parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] },
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS Water Services returned ${res.status}`);
  const data = await res.json();

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
        { label: "low", value: `${Math.min(...values)} ${unit}` },
        { label: "median", value: `${median(values)} ${unit}` },
        { label: "high", value: `${Math.max(...values)} ${unit}` },
      ] : [],
      caveat: notComparable || undefined,
      rows: readings.slice(0, 5).map((r) => ({
        name: r.name,
        value: `${r.value} ${r.unit}`,
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NOAA NWPS returned ${res.status}`);
  const data = await res.json();

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

  const res = await fetch(`https://api.weather.gov/alerts/active?area=${stateCode.toUpperCase()}`, {
    headers: { Accept: "application/geo+json" },
  });
  if (!res.ok) throw new Error(`NWS alerts API returned ${res.status}`);
  const data = await res.json();

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
async function usgsFindGauges({ place, parameter }) {
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
  const generic = (place || "").toLowerCase().split(/[^a-z0-9]+/).find((w) => WATERBODY_GENERICS.has(w) && w.length > 2);
  const stem = tokens.join(" ").toUpperCase();
  const patterns = generic
    ? [`%${stem} ${generic[0].toUpperCase()}%`, `%${generic.toUpperCase()} ${stem}%`]
    : [`%${tokens.join("%").toUpperCase()}%`];

  // Only letters, digits and spaces survive tokenizing, so nothing can break
  // out of the quoted CQL strings below.
  const cql = patterns.map((p) => `monitoring_location_name LIKE '${p}'`).join(" OR ");
  const url = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items" +
    `?filter=${encodeURIComponent(cql)}&limit=200&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS monitoring-location search returned ${res.status}`);
  const data = await res.json();

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
  const gauges = leading.length ? leading : wholeWord;

  const states = [...new Set(gauges.map((g) => g.state).filter(Boolean))];
  if (!gauges.length) {
    return {
      place, found: 0,
      display: {
        title: `No gauge named "${place}"`,
        subtitle: "USGS has no monitoring location with that name",
        stats: [], rows: [],
        note: "try a different spelling, or the river's full name",
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

  return {
    place, parameter: known.canonical, parameterCode: known.code,
    found: gauges.length, states,
    reporting: readings.length,
    range: values.length && canAggregate
      ? { min: Math.min(...values), median: median(values), max: Math.max(...values) } : null,
    readings: readings.slice(0, 10),
    source: "USGS monitoring locations + Water Services, no API key required",
    display: {
      title: `${known.canonical} · ${place}`,
      // A gauge existing and a gauge measuring this are different things, and
      // conflating them would read as "no such river".
      subtitle: readings.length
        ? `${readings.length} of ${gauges.length} gauges reporting · ${states.join(", ")}`
        : `${gauges.length} gauge${gauges.length === 1 ? "" : "s"} found in ${states.join(", ")}, but none report ${known.canonical}`,
      stats: values.length && canAggregate ? [
        { label: "low", value: `${Math.min(...values)} ${unit}` },
        { label: "median", value: `${median(values)} ${unit}` },
        { label: "high", value: `${Math.max(...values)} ${unit}` },
      ] : [],
      caveat: canAggregate ? undefined
        : "gage height is measured from each gauge's own datum, so readings are not comparable between gauges",
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
          const town = new RegExp(`(?:\\bat\\s+|,\\s*)[^,]*\\b${tokens[tokens.length - 1]}\\b`, "i");
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

function forecastWhen(text) {
  const t = (text || "").toLowerCase();
  if (/\b(this |next |coming )?week\b|\bweekly\b|\b7[- ]day\b|\bseven[- ]day\b/.test(t)) return "week";
  if (/\btomorrow\b/.test(t)) return "tomorrow";
  if (/\btonight\b/.test(t)) return "tonight";
  if (/\bweekend\b/.test(t)) return "weekend";
  const day = FORECAST_DAYS.find((d) => new RegExp(`\\b${d}\\b`).test(t));
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

  const label = place || located.stateCode.toUpperCase();
  const dayLike = (p) => p.name.toLowerCase();

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
      title: `Weather · ${place || stateCode.toUpperCase()}`,
      subtitle: `${station.name || station.id} · ${relativeAge(obs.timestamp)}`,
      stats, rows,
      note: point.basis,
      source: "NWS",
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
    name: "waterFindGauges",
    run: usgsFindGauges,
    description: "Find USGS gauges anywhere in the country by the name of a river, creek, lake or landmark, and optionally report a measurement at them. Use when a place is named but no state is - e.g. 'water temperature of the Bighorn River'.",
    parameters: {
      type: "object",
      properties: {
        place: { type: "string", description: "river, creek, lake or landmark name, e.g. Bighorn River" },
        parameter: { type: "string", description: "optional measurement: discharge, gage height, water temperature, ..." },
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

function meaningfulWords(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// How well one control's label answers the instruction. Whole-phrase hits
// score far above scattered word hits, so "year to date" prefers a control
// actually labelled "Year to date" over one merely containing "date".
function scoreControl(control, words, phrase) {
  const label = (control.label || "").toLowerCase();
  if (!label) return 0;
  let score = 0;
  if (phrase && label.includes(phrase)) score += 10 + phrase.length / 10;
  for (const w of words) if (new RegExp(`\\b${w}`).test(label)) score += 2;
  if (label === phrase) score += 10;
  // A dropdown's label is often a category ("Variable") while the thing the
  // user actually named is one of its options ("Precipitation"), so options
  // count too - scored below a label hit, since naming the option is a
  // slightly weaker signal about which control was meant.
  for (const o of control.options || []) {
    const text = String(o.text || o.value || "").toLowerCase();
    if (!text) continue;
    if (text === phrase) score += 8;
    else if (words.some((w) => new RegExp(`\\b${w}`).test(text))) score += 3;
  }
  // A low-confidence row is a cursor:pointer guess, not a known control.
  if (control.confidence === "low") score -= 1.5;
  return score;
}

// Which instruction words a control's label or options actually account for.
// Used to let several controls divide one instruction between them.
function wordsCoveredBy(control, words) {
  const label = (control.label || "").toLowerCase();
  const optionText = (control.options || [])
    .map((o) => String(o.text || o.value || "").toLowerCase()).join(" ");
  const hay = `${label} ${optionText}`;
  return words.filter((w) => new RegExp(`\\b${w}`).test(hay));
}

// Picks the option inside a <select> that the instruction named.
function matchOption(control, words) {
  return (control.options || []).find((o) => {
    const text = String(o.text || o.value || "").toLowerCase();
    return words.some((w) => new RegExp(`\\b${w}`).test(text));
  });
}

function toolCallFor(control, words) {
  if (control.kind === "select" || (control.options && control.options.length)) {
    const option = matchOption(control, words);
    if (!option) return null;
    return { name: "pageSelectOption", args: { selector: control.selector, value: option.value || option.text } };
  }
  return { name: "pageClick", args: { selector: control.selector } };
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
function planGenericTool(instruction, inventory) {
  const controls = (inventory && inventory.controls) || [];
  if (!controls.length) return null;

  const allWords = meaningfulWords(instruction);
  if (!allWords.length) return null;
  const phrase = allWords.join(" ");

  const calls = [];
  const matched = [];
  const used = new Set();
  let remaining = [...allWords];

  while (remaining.length) {
    const scored = controls
      .filter((c) => !used.has(c.selector))
      .map((c) => ({ control: c, score: scoreControl(c, remaining, remaining.join(" ")) }))
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
    const rivals = runnerUp && best.score - runnerUp.score < 2 && sameWords(best.control, runnerUp.control);
    if (rivals) {
      if (!calls.length) {
        return {
          ambiguous: scored
            .filter((x) => sameWords(x.control, best.control))
            .slice(0, 5)
            .map((x) => ({ label: x.control.label, selector: x.control.selector, kind: x.control.kind })),
        };
      }
      break; // some controls already settled; don't guess at the leftovers
    }

    const call = toolCallFor(best.control, remaining);
    if (!call) break;

    const covered = wordsCoveredBy(best.control, remaining);
    if (!covered.length) break;
    calls.push(call);
    matched.push({ label: best.control.label, selector: best.control.selector, covered });
    used.add(best.control.selector);
    remaining = remaining.filter((w) => !covered.includes(w));
  }

  if (!calls.length) return null;
  return { calls, matched, unmatchedWords: remaining, phrase };
}

// Controls that scored something but not enough to act on. A failure that
// names the three closest things on the page is far more useful than one
// that lists the first twelve in DOM order - it tells you whether your
// wording was close, or whether the control simply isn't there.
function nearMissControls(instruction, inventory, limit = 5) {
  const controls = (inventory && inventory.controls) || [];
  const words = meaningfulWords(instruction);
  if (!words.length || !controls.length) return [];
  const phrase = words.join(" ");
  return controls
    .map((c) => ({ control: c, score: scoreControl(c, words, phrase) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ label: x.control.label, selector: x.control.selector, kind: x.control.kind }));
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
    pageReadable ? `${controls.length} controls on this page` : "could not read this page's controls",
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
      note: missing.length ? missing[0] : (near.length ? "closest things on this page" : undefined),
      source: pageReadable ? `${controls.length} controls scanned` : "page not readable",
      checked,
    },
  };
}

// Control tools depend on which site is open; data tools never do.
function toolsFor(routeGlobal) {
  return [...(TOOL_DEFS[routeGlobal] || []), ...DATA_TOOLS];
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
  if (!def) throw new Error(`model picked an unknown tool "${toolCall.name}"`);
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
        const context = await buildContext(route.global);
        await ensureOffscreenDocument();
        const plan = await chrome.runtime.sendMessage({
          target: "offscreen", type: "llmPlan",
          instruction: msg.instruction, tools: toOpenAITools(defs), context,
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
        const defs = toolsFor(route.global);
        const context = await buildContext(route.global);
        const plan = await askGemini(msg.instruction, defs, context);
        if (!plan.toolCall) {
          sendResponse({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        sendResponse({ ...result, plannedBy: "gemini", toolCall: plan.toolCall });
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
      const finish = (res) => {
        console.log("[runToolCall]", msg.toolCall, "->", res);
        sendResponse(res);
      };
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);
        const result = await executeToolCall(route.global, msg.toolCall);
        finish({ ...result, plannedBy: "hand-written", toolCall: msg.toolCall });
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
      const respond = (res) => {
        console.log(`[smartAsk] "${msg.instruction}" ->`, res);
        sendResponse(res);
      };
      const stopKeepAlive = keepAlive();
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);

        // Data questions come first, and on every route - "what's the gage
        // height in Alaska" is answerable from anywhere, and shouldn't be
        // hijacked by a control rule just because the USGS page is open.
        const dataCall = planDataTool(msg.instruction || "", route);
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
        if (dataCall) {
          const result = await executeToolCall(route.global, dataCall);
          respond({ ...result, plannedBy: "fast-path", toolCall: dataCall });
          return;
        }

        if (route.global === "USGS") {
          const fast = planTool(msg.instruction || "");
          if (fast) {
            const result = await invokeOnActiveTab(fast.fn, fast.args);
            respond({ ...result, plannedBy: "fast-path", plannedCall: fast });
            return;
          }
        }

        // Any site, no model: match the instruction against the page's own
        // controls. This is the only fast path an unmapped page has, and
        // without it every instruction there fell to the slow tier.
        // "What does this page say" is a different request from "click
        // something on it", and the control matcher would only ever find a
        // button whose label happened to share a word.
        if (/\bread\b.*\b(page|this|site)\b|\bwhat('?s| is| does)\b.*\b(page|shown|displayed|say)\b|\bon (this|the) (page|screen)\b|\bsummari[sz]e\b/i.test(msg.instruction || "")) {
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
            respond({
              ok: true, plannedBy: "page-read", result: d,
              display: {
                title: d.title ? d.title.slice(0, 70) : "This page",
                subtitle: counts.length ? counts.join(" · ") : "no readable data found",
                stats: [], rows,
                caveat: d.note,
                note: d.headings && d.headings.length ? d.headings[0].slice(0, 60) : undefined,
                source: "live DOM",
              },
            });
            return;
          }
        }

        // Every route now carries GENERIC alongside its named manifest, so
        // page controls can be matched anywhere - including the ones a
        // hand-written manifest never covered.
        const inv = await invokeOnActiveTab("inventory", []).catch(() => ({ ok: false }));
        if (inv.ok) {
          const guess = planGenericTool(msg.instruction || "", inv.result);
          if (guess && guess.calls) {
            // Run them in order and stop at the first failure - a later step
            // usually depends on an earlier one having opened or switched
            // something, so continuing past a failure just piles on damage.
            const steps = [];
            for (const call of guess.calls) {
              const result = await executeToolCall(route.global, call);
              steps.push({ call, ok: result.ok !== false, result: result.result, error: result.error });
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
                rows: guess.matched.slice(0, steps.length).map((m, i) => ({
                  name: m.label || m.selector,
                  value: steps[i] && steps[i].ok ? "done" : "failed",
                  meta: m.covered.join(" "),
                  tone: steps[i] && steps[i].ok ? "ok" : "alert",
                })),
                source: "this page",
              },
            });
            return;
          }
          if (guess && guess.ambiguous) {
            respond({
              ok: false,
              needsChoice: true,
              error: `Several controls on this page could match that. Say which, or use the exact label.`,
              candidates: guess.ambiguous,
              display: {
                title: "Which one did you mean?",
                subtitle: `${guess.ambiguous.length} controls on this page match`,
                stats: [],
                rows: guess.ambiguous.map((c) => ({ name: c.label || "(no label)", value: c.kind || "", meta: c.selector })),
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
          why.hint = "name a measurement and a place (\"gage height in Wyoming\"), or use a control's own wording from the list above";
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

        const defs = toolsFor(route.global);
        const context = await buildContext(route.global);
        const plan = await chrome.runtime.sendMessage({
          target: "offscreen", type: "llmPlan",
          instruction: msg.instruction, tools: toOpenAITools(defs), context,
        });
        if (!plan.ok) { respond(plan); return; }
        if (!plan.toolCall) {
          respond({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        respond({ ...result, plannedBy: "webllm", toolCall: plan.toolCall });
      } catch (err) {
        respond({ ok: false, error: String((err && err.message) || err) });
      } finally {
        stopKeepAlive();
      }
    })();
    return true;
  }
});
