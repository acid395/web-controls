# extension (proof of concept)

Not the real extension yet, but the real shape of it. Proves: a popup button
can call a function on a live page and get the result back through an actual
Chrome extension, not a pasted console script; a brand new site turns on
with one click, no code change, no reload; and a typed instruction can pick
the right function to call on its own.

## Why three ways to answer "Ask," not one

The actual goal is a wrapper that runs fully locally, for free, with no
account - and also feels instant from the first click. Those two things are
in real tension: a model capable enough to reliably pick the right tool has
to be several gigabytes, and that has to download once, over whatever
network the user has. There's no way to make that instant. So `Ask` doesn't
wait on one model - it tries three things in order, cheapest first:

1. **`planTool()`**, a zero-download keyword matcher (USGS route only right
   now). Instant, free, no model involved, whenever it recognizes the phrasing.
2. **WebLLM**, a real local model in an offscreen document (a service worker
   has no WebGPU access, so it can't run there). Fully local and free, but
   the first time ever needs a real, multi-gigabyte download - `Ask` checks
   it has actually finished before relying on it, rather than blocking on it.
3. **Gemini's free tier** exists too, but on purpose isn't part of `Ask`'s
   fallback chain - it needs a personal API key, which contradicts "easy to
   use," so it stays a separate, explicit choice in the debug tools, not
   something the default path reaches for on its own.

## Working on a site nobody mapped

The named manifests each have a hand-written keyword fast path, but an
arbitrary site had none - every instruction on an unmapped page fell straight
through to the model, i.e. the slowest and least reliable tier, for even the
most literal request. `planGenericTool()` closes that: `inventory()` already
returns every control with a human label and a real selector, so "click year
to date" is matched against those labels directly, no model involved.

Whole-phrase matches outrank scattered word matches, and a dropdown's options
are scored too, since its label is often a category ("Variable") while the
user names an option ("Precipitation"). Low-confidence rows - the
cursor:pointer guesses - are penalised.

One instruction often means several controls. "weekly average temperature" on
a station page is a period, a statistic and a variable - three separate
widgets - so the planner assigns them greedily: take the strongest match,
strike the words it accounts for, repeat while the remaining words still
describe something. Matching only the single best control would set one of the
three and silently ignore the rest, which is worse than failing, because the
chart then looks answered while showing the wrong thing. Words nothing
matched are reported back rather than dropped.

Ambiguity is judged on *overlapping words*, not on score. Two controls that
score similarly while covering different words aren't rivals, they're the
separate halves of one instruction - an earlier version compared scores alone
and rejected "weekly average temperature" as ambiguous, which is precisely the
case the multi-control pass exists for. Genuine rivals still stop it: "show me
the date" with both *Year to date* and *Date range* returns both and asks,
since on an unfamiliar page a wrong click is a real action and being asked is
cheaper than being surprised.

GENERIC is injected **alongside** every named manifest, never instead of it,
so this works on USGS and NOAA pages too - a hand-written manifest only covers
the controls someone thought to map, and `inventory()` covers the rest. The
shared page bridge resolves each call against whichever global owns the
function, named manifests first, so a verified implementation always beats
GENERIC's selector-driven fallback.

## Two kinds of tool: control the page, or answer a question

Everything above is about *controlling* a page - inject a manifest, call a
function, change what's displayed. That can't answer "what's the gage height
in Alaska" while you're sitting on the Idaho page, because the answer isn't on
screen and getting there would mean navigating first.

So there's a second family, `DATA_TOOLS` in `background.js`. A data tool is a
plain `fetch()` from the service worker to a public agency API - no injection,
no page bridge, no DOM - which means it works regardless of which site is
open, and needs no API key. Three so far, all measured live:

| tool | source | answers | typical |
|---|---|---|---|
| `waterCurrentConditions(state, parameter, nameContains?)` | USGS Water Services | "what's the gage height in Alaska" | ~1.2s, 120 gauges |
| `waterFloodStatus(state)` | NOAA NWPS | "which gauges are near flood stage in Idaho" | ~3s, 224 gauges |
| `waterAlerts(state, floodOnly?)` | NWS | "any flood warnings in Alaska" | ~0.5s |
| `waterFindGauges(place, parameter?)` | USGS OGC API | "discharge of the Bighorn River" | ~1s, no state needed |
| `weatherConditions(state, place?)` | NWS observations | "temperature and humidity in Kansas City" | ~1.5s |

`weatherConditions` exists because USGS measures water, not air - humidity,
dew point, wind and pressure have no USGS equivalent, and "air temperature"
and "water temperature" share a word, so weather cues are matched before water
parameters or they would silently resolve to the wrong one.

What an ambiguous word means depends on the page it was typed on. `env-vocab`
lists bare "temperature" and "temp" as *water* synonyms, which is right on a
USGS gauge page and wrong on weather.gov - so `WATER_ROUTES` settles it: the
same question returns water temperature on a USGS page and air temperature on
a forecast page or an unmapped site, where the everyday meaning applies.
Qualifying it ("water temperature", "air temperature") overrides the route
everywhere.

Weather intent also survives an unrecognized place. The city table holds only
~200 places, so "temperature in Vancouver" has no state to work from; rather
than fall back to water data for want of one, `weatherConditions` asks USGS
where anything by that name is and takes the state from there.

NWS is location-based (its `?state=` station listing is alphabetically capped
before reaching the reporting stations), so it needs a coordinate. Rather than
ship a fabricated city-coordinate table, one is derived: a USGS gauge named
after the place *within the already-resolved state*, falling back to the
state's own bounding-box centre. The state constraint is what makes it safe -
an unconstrained search for "OMAHA" returns an Omaha Lake in Arkansas. Within
a state, a gauge whose name mentions the town *last* is preferred, since USGS
writes the waterbody first and the settlement last: "SOUTH OMAHA CREEK" is 70
miles from Omaha and was picking a Sioux City station, while "MISSOURI RIVER
... AT OMAHA, NEBR" is the town itself. The reporting station is always named,
so a poor fix is visible rather than silent.

Results are summarized rather than dumped whole, because a statewide question
has no single answer - a count, a range, and a handful of named examples, with
`nameContains` to narrow to one river.

Matching tolerates typos, because exact matching failed silently in a way
that looked like the tool ignoring you: "gage hiehgt in wyoming" found no
parameter, so the whole data path was skipped and the question fell to the
disabled model. Fuzzy matching runs only after every exact match has failed,
so correct spelling can never lose to a fuzzy hit elsewhere. It uses optimal
string alignment rather than plain Levenshtein, since real typos are mostly
transpositions - "hiehgt" is 4 substitutions from "height" but only 2
transpositions. Phrases under 6 characters get no slack at all: "stage" and
"state" are one edit apart and mean completely different things here.

City names get the same tolerance, and need it most - they're long and easy to
misspell, and losing the city loses the state with it, which sinks the whole
question ("tallahasee", "clevland", "san fransisco" all resolve). The filter
passed downstream is always the *correct* spelling, because the instruction's
city text is stripped as typed: a typo that reached the gauge-name filter
would match nothing and quietly fall back to statewide.

People ask about cities, but every one of these APIs is state-scoped, so
`US_CITIES` maps a city to its state - that alone makes "precipitation in
Cleveland" answerable, where before it had no state and fell through to a
120-second model timeout. The city name then doubles as a gauge-name filter,
which works better than it sounds because USGS names gauges after the town
they sit in: "Cleveland" finds *Rain gage at Cleveland OH*, "Omaha" narrows 31
Nebraska gauges to the 9 actually in Omaha. When no gauge name matches (New
York City has none), it falls back to the whole state and says so, rather than
returning an empty answer - "no gauge is named that" is not "there is no data".

A named river is pulled out the same way, by elimination: strip the parts
positively identified (the state, the measurement) plus filler words, and what
survives is the place being asked about. "gage height in wyoming at big sandy
river" leaves "big sandy river", which is exactly the form USGS gauge names
take, narrowing 109 Wyoming gauges to the 2 on that river. A recognized city
inside the leftovers wins over the leftovers themselves, so stray words can't
narrow the filter to nothing.

A named river, creek or lake needs no state at all: `waterFindGauges` asks
USGS where its own gauges are, via the OGC API's CQL name search. That beats
any hand-kept table of place names, which would be endless to maintain and
wrong at the edges - and it answers for landmarks and lakes too, not just
rivers.

Matching it precisely took three passes, each fixing a confidently wrong
answer. The generic word ("river") is dropped from the search tokens, since
USGS abbreviates it unpredictably - "BIGHORN RIVER AT THERMOPOLIS" sits beside
"BIGHORN R BEL BLACK WILLOW DRAW". But dropping it entirely was too broad:
"snake river" then matched so many gauges containing SNAKE that the real Snake
River fell outside the result window and the answer came back as Snake Creek,
Georgia. Keeping just the generic's first letter fixes both - `%SNAKE R%`
matches "SNAKE RIVER" and "SNAKE R AT" while excluding SNAKE CREEK. Results
are then filtered on whole-word boundaries (`%SNAKE%` otherwise returns
SNAKEDEN BRANCH) and preferred when the name *starts* with the term, since
USGS names a gauge after its waterbody first - a later mention is usually a
landmark it passes, which is how Bighorn Park in Colorado was being returned
for the Bighorn River.

Several unrelated rivers can share a name, so a spread of states is reported
as such rather than left to look like a matching bug.

The table is city->state only, no coordinates, on purpose: a wrong state is
obvious and correctable, while plausible-looking wrong coordinates would
silently return the wrong gauges. Genuine distance-based search wants a real
geocoder or gazetteer - the keyless Census endpoint only geocodes street
addresses, not bare place names.

`waterCurrentConditions` drops readings older than 24 hours before computing
anything. USGS's `siteStatus=active` list still serves gauges whose newest
reading is years old - found live, a California precipitation gauge last
reporting in 2012 - and letting one into a "current conditions" answer
silently corrupts the range. Excluded gauges are counted in the footer rather
than hidden.

Cross-gauge statistics are only computed for parameters where they mean
something (`AGGREGATABLE_PARAMS`). Gage height is excluded: stage is measured
against each gauge's own datum, so some read from a local streambed and others
from sea level. Alaska simultaneously reports 0.46 ft and 2004.62 ft of "gage
height" and both are correct - a min/median/max over them is arithmetic on
incompatible references, however tidy it looks. The card shows the per-gauge
readings and a note explaining the omission; `range` is left `null` rather
than computed-and-flagged, so nothing downstream can lift the number out and
present it as a real statewide figure. Discharge, temperature and the rest are
absolute scales and aggregate normally.

`waterFloodStatus` counts a gauge as at risk if *either* its observed or its
forecast category is at action stage or worse, since a forecast of flooding is
the point of asking. Each row says which of the two put it on the list -
without that, a forecast-driven row renders as a flat self-contradiction ("No
flooding", under a heading about gauges at or above action stage).

URL patterns and response parsing follow `hydro-harvester`'s already-proven
adapters. `env-vocab.js` supplies the last hop USGS needs ("gage height" ->
`00065`). NWPS has no working state filter - a `state.abbreviation` query hangs
past 40s - so it's queried by bounding box (`STATE_BBOX`) and filtered by state
afterward, which is the same conclusion hydro-harvester reached.

Each data tool returns a `display` block alongside its raw data - a title,
stats, and rows it chose itself - and `popup.js` renders that generically into
a card, with the raw JSON one click away. Presentation lives with the tool
because the tool is what knows whether a number is a stage, a flow, or a flood
category. The renderer builds everything with `textContent`, never
`innerHTML`: gauge names and alert headlines come from external APIs.

Both families share one path. Data tools appear in every route's tool list
(`toolsFor()`), the model picks between them like any other tool, and
`executeToolCall()` sends control tools through `invokeOnActiveTab` and data
tools through their `run()` function. `planDataTool()` also recognizes the
common case - an instruction naming both a state and a measurement - with no
model at all, which matters because that tier works on any machine regardless
of GPU or download.

## Why this exists

`web-controls.js` was built to be pasted into DevTools, which runs it in the
page's own JS world. A content script does not share that world by default,
so code like `WC`/`USGS` needs to be injected into the page's "MAIN world" on
purpose, and talking to it from the rest of the extension needs a small relay,
since MAIN-world code has no access to `chrome.*` APIs. This is that relay,
built as small and testable as possible:

```
popup.js  --chrome.runtime-->  background.js  --chrome.scripting-->  injects both:
                                                  content/bridge.js     (isolated world, has chrome.*)
                                                  page/<route>-bundle.js (MAIN world, has window.USGS or window.GENERIC)

bridge.js <--postMessage--> page bundle
```

`background.js` picks which page bundle to inject based on `NAMED_MANIFESTS`:
USGS's state page (`USGS`), USGS's monitoring-location page (`SITE`),
water.noaa.gov (`NOAA`), and weather.gov/forecastpoints (`FCP`) each get
their own `page/*-bundle.js` (the source manifest plus a listener appended
that waits for a postMessage, calls the named global's function, and posts
the result back). These bundles are generated, not hand-edited - run
`node extension/scripts/build-bundles.js` after changing any source manifest
(`web-controls.js`, `site-controls.js`, `noaa-controls.js`,
`forecastpoints-controls.js`, `generic-controls.js`) or `env-vocab.js`.
Anything not in `NAMED_MANIFESTS` gets `page/generic-bundle.js`
(`generic-controls.js`, `window.GENERIC`), the zero-manifest fallback -
automatically, with no per-site entry required. `content/bridge.js` relays
between whichever bundle is active and the background script either way; it
doesn't need to know which one it's talking to.

Reaching a new site no longer means editing this repo. `manifest.json`
declares a fixed set of `host_permissions` (the sites already tested) plus
`optional_host_permissions: ["https://*/*", "http://*/*"]`. The popup's
"Enable on this site" button calls `chrome.permissions.request()` for
whatever origin the active tab is on; Chrome shows its own native prompt,
and once granted, that site works immediately - no code change, no reload.
`chrome.permissions.request()` has to run inside the click handler itself to
count as a real user gesture, so that one call lives directly in `popup.js`,
not relayed through `background.js` like everything else.

## Load it

1. `chrome://extensions`, turn on Developer mode.
2. Load unpacked, pick this `extension/` folder.
3. Open any page. `waterdata.usgs.gov/state/Idaho/` (USGS),
   `waterdata.usgs.gov/monitoring-location/USGS-.../` (SITE),
   `water.noaa.gov` (NOAA), and `weather.gov/forecastpoints` (FCP) each use
   their own real manifest; anything else uses GENERIC once enabled (next
   step).
4. Click the extension icon. If this is a new site, click "Enable on this
   site" first and accept Chrome's permission prompt.

- **Enable on this site.** Only needed once per site beyond the four already
  granted in `manifest.json`. Click it, accept Chrome's permission prompt,
  done.
- **Ask.** The real, intended thing (`smartAsk` in `background.js`). Type an
  instruction, click Ask. Tries `planTool()` first (USGS route only so far,
  see "Known rough edges"), falls back to WebLLM only if that missed and the
  model has actually finished loading, otherwise says so plainly instead of
  hanging. Untested live.
- **Debug tools**, behind the collapsed section: call a function directly by
  name and raw arguments, test WebLLM or Gemini without going through the
  fast path first, or run the old stub-only Ask. All the same building
  blocks `smartAsk` uses, exposed individually for testing each piece on its
  own.

## Known rough edges

- `TOOL_DEFS.USGS` used to declare 4 tools while `web-controls.js` exposed 17
  functions. `selectState` was among the missing ones, which is why "select
  Alaska" never worked no matter how the model performed - it wasn't a bad
  choice, the choice didn't exist. Now 13 are declared, and "select Alaska" /
  "switch to Montana" also resolve on the fast path with no model. The lesson
  generalizes: when adding a manifest to `NAMED_MANIFESTS`, check its tool
  defs against what the manifest actually exposes, or the model is quietly
  playing with half a deck.
- `SITE`, `NOAA`, and `FCP` are now wired into `NAMED_MANIFESTS` and
  `TOOL_DEFS`, reachable through `smartAsk`/`llmPlan`/`geminiPlan` the same
  way USGS is - but only the model-driven path plans against them.
  `planTool()`'s keyword fast path is still USGS-only on purpose: writing
  more regex rules doesn't get any closer to "arbitrary site," so new routes
  fall straight through to the model instead.
- GENERIC-route tool calls (`pageClick`/`pageFill`/`pageSelectOption`) used
  to require the model to guess a raw CSS selector blind, since it was never
  shown the page. Fixed: `smartAsk`/`llmPlan`/`geminiPlan` now run
  `GENERIC.inventory()` up front and pass its `controls` list to the model
  as a system message (`buildContext()`/`buildGenericContext()` in
  `background.js`) before the one tool-calling turn - a single well-
  populated turn, not a multi-turn agent loop. Every route also now gets
  `env-vocab.js`'s parameter/duration synonym tables in that same context,
  not just GENERIC.
- Re-injects scripts on every call rather than checking first. Simple, a bit
  wasteful, harmless.
- Confirmed live: `getState()`/`setParameter()` on the USGS route, and
  `inventory()`/`selectOption()`/`fill()` on the GENERIC route across four
  separate sites (EPA, Drought.gov, the National Water Dashboard, and
  StreamStats, granted at runtime via "Enable on this site" with no code
  change), all through this actual extension mechanism, not a console
  paste. The first version of the permission-request handler silently
  failed with no dialog shown, because an `await` before
  `chrome.permissions.request()` broke Chrome's user-gesture check. Fixed by
  precomputing the tab's origin when the popup opens, so the click handler
  calls `chrome.permissions.request()` as its first and only step.
- WebLLM confirmed working end to end: offscreen document, WebGPU, model
  download, real inference, a real response back through the popup. Real
  bugs surfaced and got fixed along the way: extension pages' default CSP
  blocks WebAssembly outright (fixed with `'wasm-unsafe-eval'` in
  `content_security_policy.extension_pages`); the model reloaded from
  scratch on every ask until a warm-load on browser startup/extension
  install was added; the first model picked (a small 3B one, chosen to
  validate loading cheaply) turned out not to support tool-calling at all in
  WebLLM 0.2.85, confirmed by its own error message naming which models do
  (all Hermes-2-Pro/Hermes-3 at 7-8B).
- Gemini and `smartAsk` (the fast-path-first, WebLLM-if-ready orchestration)
  are both new and untested live.
