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

## Maps

`map-probe.js` reports what's possible on a given map.

Leaflet maps (USGS National Water Dashboard, NOAA Tides & Currents) put each
marker in the DOM, so `WC` clicks them like any other element.

MapLibre GL, Mapbox GL, OpenLayers and Esri maps (water.noaa.gov,
weather.gov/forecastpoints, EPA, Drought.gov) draw to a canvas. Nothing to
click, but the map object has pan, zoom and query methods. If the page keeps
that object somewhere reachable, `map-probe.js` finds it and you can call it.
If it's closed over, there's no way in.
