# web-controls

Console scripts that turn a web page's buttons, dropdowns and checkboxes into
callable functions. Paste one into DevTools and drive the page from the
console instead of clicking through it.

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
found. This is the piece that lets the toolkit reach a site nobody has looked
at yet: no manifest to write first, just read the page and act on it.

The trade is reliability. A hand-written manifest like `USGS` was checked
against a real page and given proper names; `GENERIC` is guessing at intent
from raw selectors every time. The plan is to use `GENERIC` to bootstrap new
manifests automatically instead of by hand, and cache the result, rather than
staying at "guess from raw selectors" forever.

Confirmed live on EPA's How's My Waterway (`mywaterway.epa.gov`), a codebase
with nothing in common with any of the four hand-written manifests (a
different React setup, different CSS approach, different everything below
the surface): `GENERIC.inventory()` found the real search box, buttons and
mode tabs with no EPA-specific code at all. That's the actual generalization
claim, and it held up on the first site it was pointed at that nobody had
looked at before.

## Maps

`map-probe.js` / `GENERIC.mapInfo()` report what's possible on a given map.

Leaflet *can* put each marker in the DOM, so `WC` clicks them like any other
element, but it's a choice each app makes, not a guarantee. Leaflet also
supports rendering to a canvas, and it's the faster option once there are a
lot of points. Confirmed live: the USGS National Water Dashboard, which plots
stations nationwide, does exactly that, a canvas sits inside its Leaflet
container and the marker panes are nearly empty. So "it's Leaflet" alone
doesn't tell you which case you're in, `mapInfo()`'s `domMarkerCount` does.

MapLibre GL, Mapbox GL, OpenLayers and Esri maps (water.noaa.gov,
weather.gov/forecastpoints, EPA, Drought.gov) draw to a canvas by default.
Nothing to click, but the map object has pan, zoom and query methods,
reachable only if the page happens to expose it somewhere off `window`.

That's a real limit, not a per-site bug to keep fixing. Confirmed on EPA's
Esri map: the library is detected correctly, but its view object isn't
reachable at all, even scanning six levels deep off `window`. Production apps
generally don't leak internals onto `window` on purpose, so this isn't
specific to EPA, it's the expected outcome on most production sites. Where a
site's own map object happens to be reachable (seen so far mostly on smaller,
less bundled pages), `mapInfo()`/`map-probe.js` finds it and it's drivable.
Where it isn't, there is no way in from outside the page.
