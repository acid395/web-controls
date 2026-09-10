# web-controls

Turns a web page's interactive controls into functions you can call from the
browser console.

Not scraping. Instead of pulling data out of a page, this drives the page the
way a person would: pick a parameter, choose a site, change a date range,
download a report. Each of those becomes a function.

## How it's built

Two layers.

**`WC` (generic).** Plain DOM functions that work on any site: `deepQueryAll`
(also searches inside shadow DOM), `rawLabelOf`/`labelOf` (read a control's
label the same way everywhere), `setSelect`, `pickRadio`, `setChecked`,
`fill`, `clickByText`, `clickExact` (matches exact text, for two controls
whose squashed text would otherwise collide), `realClick` (fires a full
pointer + click sequence so React etc. picks it up), `waitFor`. This block is
identical, byte for byte, in all four site files below. If you improve one,
copy it into the rest.

**A manifest per site.** A short object mapping that page's actual controls
to named functions. Someone has to look at the page and decide "this radio
group is the parameter picker." That part isn't automatic. Each manifest
splits into two objects:

- `DISCOVERED`: facts read straight off the page. Group names, ids, the
  option values that actually appear in the HTML. You can re-find all of this
  any time by running `inventory-controls.js` on the page.
- `SUPPLIED`: things typed in by hand because the page doesn't say them.
  USGS represents "discharge" as the code `00060` and nothing on the page
  explains that. That mapping had to be typed in. If a site already uses
  plain words for its options, this object is small or empty.

`inventory-controls.js` is the discovery tool. Paste it on any page and it
lists every interactive control it can find, deduplicated. Use its output to
write a manifest for a new site.

## Files

| File | What it is |
|---|---|
| `inventory-controls.js` | Paste on any page. Prints every interactive control and copies it as JSON. Use it to map a new site. |
| `web-controls.js` | `WC` + `USGS` manifest for `waterdata.usgs.gov/state/<state>/`. Parameter, grouping, sorting, map toggle, date filters, state/county pick. |
| `site-controls.js` | `WC` + `SITE` manifest for `waterdata.usgs.gov/monitoring-location/USGS-<id>/`. Graph parameter, time span, custom date range, scale, download. |
| `noaa-controls.js` | `WC` + `NOAA` manifest for `water.noaa.gov/`. Basemap, layer sections, gauge product picker, flood filters. Partially confirmed, see below. |
| `forecastpoints-controls.js` | `WC` + `FCP` manifest for `weather.gov/forecastpoints`. Basemap, zoom, range rings, plot config. Fully confirmed. |
| `verify-usgs.js` | Self-test for `web-controls.js`. Runs every tool, checks the page actually changed, prints pass/fail. 17 of 17 passing. |

## How to use it

1. Open the page.
2. DevTools, Console tab (F12). If it asks, type `allow pasting`.
3. Paste the matching file and press Enter. A green line lists the available functions.
4. Call them:

```js
// on state/idaho/
USGS.setParameter('gage height');
USGS.groupBy('huc8');
await USGS.setRecency('all');
USGS.getState();

// on monitoring-location/USGS-13206000/
SITE.graphParameter('discharge');
await SITE.setDateRange('2024-01-01', '2024-06-30');
await SITE.downloadData(['data']);
```

Reloading the page wipes everything you pasted. Paste it again after every reload.

## Mapping a new site

1. Paste `inventory-controls.js` on the page and read the printed table.
2. Copy the `WC` block from any of the four site files.
3. Write a small object mapping the controls you care about:

```js
const MYSITE = {
  setThing(v) { return WC.pickRadio('thing-radio-group', v); },
  search(q)   { return WC.fill('#search-box', q); },
  run()       { return WC.clickByText('Generate report'); },
};
window.MYSITE = MYSITE;
```

## Notes

- USGS's site is a React app. Controls are real `<input>`/`<button>`
  elements, no native `<select>` on these pages, though `WC.setSelect` is
  there for pages that do use one.
- `realClick` fires `pointerdown`, `mousedown`, `pointerup`, `mouseup`, then
  a real `.click()`. React derives its own `change` event from that click.
- `clickByText` strips all whitespace before comparing text, because some
  sites split a label across multiple `<span>` tags with no space between
  them, so it renders as `"Customizefilters"` with the words run together.

## Tested on other sites

Tried this live on `water.noaa.gov` and `weather.gov/forecastpoints`, not
just by reading the page's source. Two separate questions matter here: can
it drive the page's form controls, and can it drive the map.

| Site | Map | Form controls |
|---|---|---|
| `water.noaa.gov` | MapLibre GL, drawn to a canvas | Svelte app. Real controls once it renders: basemap dropdown, 7 collapsible sections, a product picker, flood checkboxes. Confirmed live, manifest is `noaa-controls.js` (partial, see below). |
| `weather.gov/forecastpoints` | OpenLayers, also a canvas | Plain server-rendered HTML with jQuery. A basemap `<select>`, zoom buttons, a range-ring panel with a number input and a color input. No framework quirks at all, the simplest of the four sites here. Manifest is `forecastpoints-controls.js`. |

(An earlier version of this note guessed Esri/ArcGIS for both maps, going
only off script filenames. Live testing showed Esri is just a basemap tile
credit, not the renderer. Corrected above.)

**Neither map can be driven the way `WC` drives everything else.** Both
libraries draw pins onto a canvas. There's no `<button>` or `<div>` per
station marker for `deepQueryAll` to find or `realClick` to press. Clicking
one specific station would need something else entirely: calling the map
library's own JS API directly if the page happens to expose its map object
on `window`, or working out the marker's on-screen pixel position from its
latitude/longitude and firing a synthetic click there. Both are far more
fragile and specific to one site than anything else in this project. Noting
it as a real limit instead of pretending to solve it.

Two useful things came out of testing the surrounding, non-map controls:

- Radios don't always share a `name` attribute. water.noaa.gov's gauge
  product picker is three `<input type=radio>` with no `name` at all,
  confirmed by dumping their HTML directly. `pickRadio` used to require a
  shared name to find a group. Fixed in `WC`, in all four files: if the named
  group is empty, it now also checks every radio on the page that has no
  name. The named-group check still runs first, so USGS is unaffected.
- `SUPPLIED` gets smaller when a site's own labels are already plain words.
  water.noaa.gov and weather.gov use real words for their options
  ("satellite", "terrain") instead of USGS's numeric codes, so
  `pickRadio`/`clickByText` can already match most of what's typed in
  without a lookup table. `forecastpoints-controls.js`'s `SUPPLIED` object
  is empty because of this.

Two things stayed unconfirmed after repeated live tries, and are marked as
such in `noaa-controls.js` rather than guessed at: what actually happens
after typing into water.noaa.gov's search box (no separate list of results
ever appeared, so it likely searches or moves the map on its own rather than
giving you something to click), and the purpose of a second, unnamed radio
group on that page whose panel was never opened during testing.
