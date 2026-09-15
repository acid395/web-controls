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
   has no WebGPU access, so it can't run there). Off by default and opt-in,
   because the first version of this tier was unusable: WebLLM's native
   tool-calling API only accepts 7-8B models, and that model needed ~5GB of
   VRAM, exceeded a 120-second ceiling per answer on ordinary hardware, and
   saturated the GPU while doing it - felt as the whole machine slowing down.
   The restriction is on the API, not the models, so `Ask` prompts for JSON
   and parses it here instead, which frees the choice of model. A 3B model
   (~2GB) is enough for the actual task: pick one tool from a short list and
   fill two arguments. A small model obeys "JSON only" loosely, so the first
   balanced object is taken from the reply rather than parsing the whole of
   it, and a tool name it invents is rejected by name rather than failing
   obscurely.
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

Each kind of control needs its own action, and assuming one action fits all
fails quietly. The matcher could originally only click or choose an option, so
a search box got a *click* - which does nothing visible. The control matched,
the action ran, and nothing happened: harder to notice than no match at all.
Now a text or search field is filled, a checkbox is ticked or unticked
according to the verb ("turn on" against "hide"), a radio is picked through
its group, a dropdown takes the option named, and a button is clicked.

What to type is read from the instruction: a quoted string verbatim, else
whatever follows a search cue ("search for Boise" means Boise, not "search for
Boise"), else the words left over once the control's own label is accounted
for. And when nothing matches at all but the instruction plainly asks to
search, the page's search box is used anyway - "look up 13206000" names no
control, since a site number shares no word with "Search station", but the
intent is not in doubt.

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

## Reading the page, not just driving it

`inventory()` answers "what can I click here"; `readPage()` answers "what does
this page say". Both read the live DOM at the moment they're called. It pulls
four things, in descending order of how reliably they carry meaning: tables
(already structured, so they survive extraction intact), labelled pairs
(`dl`/`dt`/`dd`, two-cell rows), numeric readouts, and an SVG chart's text and
aria-labels.

A canvas chart yields nothing, by construction - it is painted pixels with no
elements to read, the same wall `mapInfo()` hits with maps. Rather than return
an empty result that reads as "this page has no data", it says so: *"no
readable data in the DOM - this page draws to 2 canvas element(s), whose
contents are pixels, not elements"*. For those the real answer is the data the
page itself fetched, not the picture it drew.

## The page first, the agency second

A data tool calls the agency directly, which is exactly what lets it answer
about Alaska from an Idaho page. It is the wrong instinct when the page
already shows the answer: asked for a maximum on a forecast page, fetching a
separate figure from NWS is both surprising and a *different number*, since a
station observation is not a grid-square forecast.

So data questions read the page first and fall back to the agency.

Forecast tables come in both orientations, and assuming one silently answers
from the wrong cell:

```
A. rows are places                  B. rows are measurements
   Location   | High  | Low            Weekly Summary | Mon Sep 14 | Tue Sep 15
   Hermantown | 71 °F | 46 °F          Max Temp, °F   |     56     |     64
```

B is what weather.gov's point forecast actually uses, and missing it meant a
page displaying exactly the number asked for fell through to the agency, which
answered from the centre of the state. In B the place is not in the table at
all - it is stated in prose ("0 miles N of Hermantown, MN") - so the page's own
text is sampled to confirm the subject, the row label picks the measurement,
and the day picks the column. With no day named it takes *today's* column
rather than the first, since these tables often begin with yesterday.

Header detection cannot require `<th>`. The real page marks its header row
with `<td>` and splits the day from the date with a `<br>`, so insisting on
the tag left the columns unnamed - and an unnamed column means a day has
nothing to match, so every day quietly reads the same cell. That is a wrong
answer to the right question, and it looks entirely correct. A first row that
is mostly words above rows that are mostly numbers is treated as a header
whatever tag it uses. Days are matched by abbreviation too, since both people
and tables write "Wed" - with word boundaries, so "sunny" is not Sunday and
"saturated" is not Saturday.

A is searched too, because a place is often not what the page is about - a
regional forecast lists dozens of towns, and the answer for the one asked
about is in its row. Judging relevance by title and
headings alone missed that entirely: asked for Hermantown's high on a page
whose table had exactly that, it fetched instead and answered from the centre
of Minnesota. The column whose header matches the question picks the cell, so
a maximum and a minimum read different columns of the same row, and the wind
column answers neither.

A date in the question used to become part of the place - "max temperature of
hermantown mn on tuesday sep 15" searched for a row containing "hermantown sep
15", matched nothing, and fetched from the state centre while the town's row
sat on screen. Month names and bare numbers are filler now, and a named day is
kept as part of *when* rather than *where*, so that question returns Tuesday's
high from the table.

For everything else the page must plausibly concern the place asked about -
title and headings, not body text, since a forecast page names dozens of towns
in its navigation - so "max temperature in Milwaukee" asked on a Chicago page
still fetches rather than quietly reading Chicago's numbers. And
a unit stands in for the noun, because pages write "High: 83 °F" and never
"High temperature: 83"; requiring the word made every forecast page look as
though it displayed nothing. Those single text runs are also invisible to the
pair and readout extractors, which need two elements or a class to recognise,
so they get their own pass.

When the answer does come from the agency, the card names the station or gauge
it came from, so a difference from the screen is checkable rather than
mysterious.

Three things made "max temperature of Chicago" disagree with weather.gov, and
two of them were bugs:

- **A maximum is not a current reading.** It was being answered with whatever
  the thermometer said at that moment. `max`/`high` and `min`/`low` now route
  to the forecast's daytime and night periods, labelled *"forecast, not the
  current reading"*.
- **It found the wrong Chicago.** The town match allowed anything between "at"
  and the name, so "PETTIBONE CREEK AT NORTH CHICAGO" matched, putting the
  station 40 miles away in Waukegan. The name must now begin the segment.
- **Observations and forecasts are different things**, and legitimately
  differ. weather.gov shows a forecast for a grid square; a current reading
  comes from one station, now labelled *"observed at ..."*. Even the forecast
  can differ by a degree or two, because the grid square is chosen from the
  derived coordinate - a lakefront gauge is not downtown.

## Charts, maps, and other pages

Four more ways to get at data, each for a case the others cannot reach.

**`hoverSeries()`** moves a synthetic pointer across a chart and collects the
tooltips, recovering values that exist nowhere in the DOM until hovered - the
usual state of a canvas chart. It samples rather than enumerates, so points
between samples are missed, and it says so. A library that draws its tooltip
*into* the canvas stays unreadable, which it also says. Feed capture is better
whenever the underlying request was seen: that is the real series rather than
a reading of the picture.

**`mapFeatures()`** asks the map library's own instance for what it drew -
Leaflet's layers, OpenLayers' sources, Mapbox and MapLibre's rendered features
- which is exact where hovering would be guesswork. Hovering a map is in fact
worse than useless: a stray pointer pans it. When no instance is reachable the
answer is that the features are pixels, and the page's own data request is the
only route to them.

**`readUrl(url)`** reads another page of the same site without navigating -
"I'm on Idaho and want Alaska" - running the same extraction over the fetched
HTML. The limit is worth stating plainly: it reads what the server sends, so a
page that builds its content in JavaScript arrives nearly empty, and it says
which of those happened rather than reporting no data. Same-origin only.
**`pageLinks()`** finds the URL to hand it.

## Reading a chart that cannot be read

`readPage()` handles an SVG chart, whose labels are real elements. A canvas
chart defeats it completely - painted pixels, nothing to extract - and so does
every canvas map, which `mapInfo()` has reported across five sites.

The data is not gone though: the page fetched it, drew it, and discarded the
elements. `page/feed-capture.js` patches `fetch` and `XMLHttpRequest` to keep
it, and `pageFeeds()` / `pageFeed(match)` read it back, parsed.

Timing is the entire difficulty. A chart requests its series during page load,
so an interceptor injected when someone finally types a question has already
missed it. Capture is therefore registered as a **document_start** content
script for each enabled site, so a normal page load is recorded without the
popup ever being open; it is also injected alongside the bundles, which covers
anything fetched after an ask. Responses are cloned before reading - consuming
the stream would break the page's own code - filtered to data-looking URLs,
capped per body, and held in a 40-request ring buffer.

Asking "read this page" on a canvas page now falls through automatically:
nothing readable plus a canvas present means the answer is the requests behind
it, not a shrug. Three states are distinguished, because they need different
advice - capture not installed (enable the site), installed but empty (reload
the page, its data loaded before capture did), and captured.

## Typos, on both sides

Typo tolerance existed only for data - states, cities, measurements - while
every control matcher compared exactly. So "gage hiehgt in wyoming" was
forgiven and "selct thudnerstorms" was not: the same slip, fatal only when
operating the page, which is the wrong way round given driving the site is the
primary job. Labels, dropdown options, checkbox names, tool names and
enumerated values now all tolerate it.

The two sides keep different budgets, deliberately. Data matches against a
global vocabulary where "stage" and "state" are one edit apart and mean
entirely different things, so anything under six characters must be exact.
Control matches against the labels of one specific page, where a four-letter
collision is far less likely and the cost of refusing "zom in" is an action
that simply never happens - so four letters is enough there.

Exact matches are tried across every candidate before any fuzzy one, so a
correctly spelled option can never lose to a near-miss on a different one, and
a fuzzy hit always scores below an exact one. Multi-word values need a sliding
window rather than token comparison, since "30 days" matches no single token -
which is why "30 dys" found nothing until it did.

## Did the action actually do anything?

Every control path returned whatever the page function returned, and none
checked the page had changed. A click that silently did nothing was
indistinguishable from one that worked - both come back without error. That is
the same failure shape as every other bug in this file: plausible, and wrong.
It had already bitten: `noaaSetBasemap` only works once the layers panel is
open, and called cold it fails invisibly.

`verify-usgs.js` has done this for one manifest all along - call, read the DOM
back, assert it changed. `runVerified()` generalises it: snapshot every
control's state, act, wait, snapshot again, report what moved. A no-op is now
said out loud, with the likeliest reason.

Timing is half of it. These actions are asynchronous far more often than not -
a click starts a fetch or a re-render - so comparing immediately reports a
working action as a no-op. `settle()` waits for the DOM to stop mutating,
with a ceiling so a page carrying a clock or a ticker cannot hang the caller.
The snapshot records values only, never positions or text, since those move
for reasons unrelated to the action.

Verification never fails an action: if snapshotting is unavailable the result
passes through untouched. Knowing less about a successful action beats
refusing to perform it.

Three smaller things came with it. **Sequences** - "switch to Alaska then show
discharge" - run in order and stop at the first failure, splitting only where
both halves independently plan to something so an instruction merely
containing "and" is left alone. **"What can I do here?"** lists the route's
verified tools, the page's own controls and the available questions, because
nobody can use what they cannot find. And agency responses are **memoised for
two minutes**, since NWPS is rate-limited by its own documentation and every
ask re-fetched it - brief deliberately, these being current conditions.

## Driving the site is the primary job

Answering questions about a site is a bonus; operating it is the point. Two
things had drifted away from that.

Only USGS had a keyword path, so the 46 verified tools across SITE, NOAA and
FCP could be reached *only* through the model - which is off by default
because it is slow and large. On a NOAA page almost nothing worked, despite
seventeen tested tools sitting right there. `planManifestTool()` scores an
instruction against each tool's name, description and enumerated values, and
fills arguments from the schema: an enum match by name, a boolean from the
verb, a number lifted from the text. All 59 named control tools are now
reachable with no model, and a hand-written manifest is preferred over
GENERIC's selector guessing, having been verified against the real site.

And the order now follows what was asked. Ordering alone cannot decide it:
control-first everywhere sends "gage height in Alaska" to `usgsSetParameter`,
changing the page instead of answering, because the words overlap a control's
name; data-first everywhere buries the main purpose. The verb settles it -
"set the parameter to gage height" acts, "gage height in Alaska" answers. A
command that matches no control still falls through to the data paths rather
than failing, since "show the discharge in Idaho" is a fair question on a page
that cannot show it.

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
| `weatherForecast(when, state?, place?)` | NWS forecast | "Milwaukee temperature on Friday" | ~1s |

A question about Friday, or about a week, is not a question about now, so a
time cue routes to the forecast. Answering "Milwaukee temperature at Friday"
with current conditions looked answered while being wrong, which is the same
failure mode as setting one of three controls and leaving a chart looking
correct. History is refused outright rather than quietly forecast - NWS offers
forecasts and current observations, not the past - and a week's "average" is
labelled as the coming week's forecast, not an average of past readings.

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

## Tests

```
node extension/test/run-tests.js          # logic only, no network
node extension/test/run-tests.js --live   # also calls the real agency APIs
```

48 offline, 10 live. Nearly every case exists because it once produced a
*confidently wrong answer* rather than an error - a statewide average over
incompatible datums, Snake Creek returned for the Snake River, Kansas City
resolving to the state of Kansas, a 2012 reading served as current, Friday
answered with today's weather. None of those crash, none would be caught by
type checking, and each one looked correct in the popup. They are pinned here
by name so they cannot come back quietly.

The suite earned its place the moment it was written: it immediately caught
that "set the parameter to gage height" had started searching the country for
a river called "parameter", because leftover instruction words were being
read as a place name. `extension/test/harness.js` runs `background.js` in a vm
with `chrome.*` stubbed, so the file under test ships byte-identical, and
loads the GENERIC bundle into jsdom for DOM tests.

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
