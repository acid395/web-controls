# web-controls

Turns a web page's interactive controls (buttons, dropdowns, checkboxes) into
functions you can call from the browser console. Not scraping. It drives the
page the way a person would: pick a parameter, change a date range, download
a report.

## Files

| File | What it does |
|---|---|
| `inventory-controls.js` | Paste on any page. Lists every interactive control it finds. Use this to map a new site. |
| `web-controls.js` | Tools for `waterdata.usgs.gov/state/<state>/`. |
| `site-controls.js` | Tools for `waterdata.usgs.gov/monitoring-location/USGS-<id>/`. |
| `noaa-controls.js` | Tools for `water.noaa.gov/`. Partial, see below. |
| `forecastpoints-controls.js` | Tools for `weather.gov/forecastpoints`. |
| `verify-usgs.js` | Self-test for `web-controls.js`. 17/17 passing. |

## Use

1. Open the page.
2. DevTools, Console tab (F12). Type `allow pasting` if it asks.
3. Paste the matching file, press Enter.
4. Call the functions it prints:

```js
// on state/idaho/
USGS.setParameter('gage height');
await USGS.setRecency('all');

// on monitoring-location/USGS-13206000/
SITE.graphParameter('discharge');
await SITE.downloadData(['data']);
```

Reloading the page clears everything. Paste it again after each reload.

## How it works

Every file has two parts:

- **`WC`**: generic functions that work on any site (click a button, pick a
  radio, fill a field). Same in every file here.
- **A manifest** (`USGS`, `SITE`, `NOAA`, `FCP`): the specific buttons/fields
  on that one page, mapped to named functions.

Each manifest splits what it knows into two groups: `DISCOVERED` (read
straight off the page, like a button's id) and `SUPPLIED` (typed in by hand,
like knowing USGS code `00060` means "discharge").

## Adding a new site

1. Paste `inventory-controls.js` on the page, read what it prints.
2. Copy the `WC` block from any file here.
3. Write a small object for the controls you care about:

```js
const MYSITE = {
  search(q) { return WC.fill('#search-box', q); },
  run()     { return WC.clickByText('Generate report'); },
};
window.MYSITE = MYSITE;
```


