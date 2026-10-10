# web-controls

Ask a water or weather site a question in plain English.

Type *"max temperature in Hermantown MN on Wednesday"* and it reads the answer
off the page you're looking at. Type *"gage height in Alaska"* and it fetches
that from USGS, whatever page you happen to be on. Type *"select Alaska"* and
it operates the page's own controls for you.

Two parts are here:

- **`extension/`** — a Chrome extension. This is the thing you install and
  use. Start here.
- **everything else** — which are primarily per site examples.

**Trying it out and reporting back?** [FEEDBACK.md](FEEDBACK.md) says what to
install, what to type, what is already known to be broken, and what makes a
report useful.

## Try it in five minutes

```
git clone <this repo> && cd web-controls
```

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked**, choose the `extension/` folder.
3. Visit `weather.gov/forecastpoints` or `waterdata.usgs.gov/state/Idaho/`.
4. Click the extension's icon. On a site it hasn't seen, click **Enable on
   this site** once and accept Chrome's prompt.
5. Type a question and press **Ask**.

Example prompts.

| Ask | What happens |
|---|---|
| `gage height in Alaska` | Fetches from USGS. Works from any page. |
| `max temperature in Hermantown MN on Wednesday` | Reads the table on the page. |
| `is there flooding in Idaho` | Fetches NOAA flood forecasts. |
| `read this page` | Extracts the page's tables, values and charts. |
| `select Alaska` | Operates the page's own controls. |

sent to the public NWS APIs.

## Run the tests

```
node extension/test/run-tests.js          # 1216 tests, no network needed
node extension/test/run-tests.js --live   # also calls the real agency APIs
```

The offline tests need no setup. For the browser-DOM ones,
`cd extension/test && npm install` pulls in jsdom.


## How it works, briefly

A question takes the cheapest route that can answer it:

1. **The page you're on.** If it already shows the answer, that's the answer —
   fetching a second opinion from an agency would be both slower and a
   *different number*.
2. **A public agency API.** USGS for water, NWS and NOAA for weather and
   floods. This is what lets it answer about Alaska while you're reading about
   Idaho.
3. **The page's own controls.** "Select Alaska" finds and clicks the right
   control, using hand-written knowledge of four water sites and a generic
   fallback that works on any page.
4. **A local AI model**, off by default. Everything above is plain pattern
   matching — instant, and it runs on any machine. The model is there for
   phrasings the patterns don't cover, but it downloads ~2GB and is slow, so
   it's opt-in rather than assumed.

When it can't answer, it says what it understood, what it searched, and what
the page can actually do.

`extension/README.md` goes into the engineering detail, including the
limitations(a chart drawn to a canvas has no
numbers to read; maps mostly can't be clicked).

---

## The console scripts

The original tools, still useful on their own: paste one into DevTools and
drive the page from the console instead of clicking through it.

Built for USGS and NOAA water data sites. The generic layer works anywhere.

## Files

| File | What it does |
|---|---|
| `inventory-controls.js` | Lists every interactive control on a page. Use it to map a new site. |
| `map-probe.js` | Checks whether a page's map can be driven by script. |
| `generic-controls.js` | Works on any page with no site-specific code. See "Any site" below. |
| `web-controls.js` | Tools for `waterdata.usgs.gov/state/<state>/`. |
| `site-controls.js` | Tools for `waterdata.usgs.gov/monitoring-location/USGS-<id>/`. |
| `noaa-controls.js` | Tools for `water.noaa.gov/`. Partial. |
| `forecastpoints-controls.js` | Tools for `weather.gov/forecastpoints`. |
| `verify-usgs.js` | Self-test for `web-controls.js`. 17/17 passing. |

## Use

1. Open the page.
2. Open DevTools, Console tab (F12). Type `allow pasting` if asked.
3. Paste the matching file, hit Enter.
4. Call whatever it prints:

```js
// on state/idaho/
USGS.setParameter('gage height');
await USGS.setRecency('all');

// on monitoring-location/USGS-13206000/
SITE.graphParameter('discharge');
await SITE.downloadData(['data']);
```

Reloading the page clears everything, so re-paste each time.

## How it works

Each file is a `WC` object plus a manifest.

`WC` is generic: `clickByText`, `pickRadio`, `setSelect`, `fill`, `realClick`,
and so on. Same block in every file.

The manifest (`USGS`, `SITE`, `NOAA`, `FCP`) maps one page's controls to named
functions. It has two parts: `DISCOVERED` for things read off the page (element
ids, option values) and `SUPPLIED` for things that aren't on the page, like the
fact that USGS parameter `00060` is discharge.

## Adding a site

Paste `inventory-controls.js` to list the controls, copy the `WC` block from
any file, and write a manifest:

```js
const MYSITE = {
  search(q) { return WC.fill('#search-box', q); },
  run()     { return WC.clickByText('Generate report'); },
};
window.MYSITE = MYSITE;
```

## Any site

The four manifests above (`USGS`, `SITE`, `NOAA`, `FCP`) are hand-written for
one specific page each. `generic-controls.js` needs none of that: paste it on
any page and it works immediately, by trading named functions for selectors.

```js
GENERIC.inventory();                              // every control, deduplicated, with selectors
GENERIC.selectOption('#basemap-select', 'satellite');
GENERIC.clickText('Download');
```

`GENERIC.inventory()` is the same page-reading logic as `inventory-controls.js`,
returned as data instead of printed as a table, with a CSS selector on every
row so a caller (a person, or eventually an LLM) can act on whatever it just
found. This is the piece that lets the toolkit reach a site not accessed before.

## Maps

`map-probe.js` / `GENERIC.mapInfo()` report what's possible on a given map.

Leaflet *can* put each marker in the DOM, so `WC` clicks them like any other
element, but it's a choice each app makes, not a guarantee. Leaflet also
supports rendering to a canvas, and it's the faster option once there are a
lot of points. 

MapLibre GL, Mapbox GL, OpenLayers and Esri maps (water.noaa.gov,
weather.gov/forecastpoints, EPA, Drought.gov) draw to a canvas by default.
Nothing to click, but the map object has pan, zoom and query methods,
reachable only if the page happens to expose it somewhere off `window`.
