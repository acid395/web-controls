# web-controls mini browser

The third way to run the agent: a page with an address bar. Type a site, it opens in a frame, and the panel beside it works on it, across every page it leads to. Nothing to install in Chrome and nothing for the site to add.

```sh
node widget/scripts/build.js      # once, for widget/dist
node browser/server.js            # http://localhost:8787
node browser/server.js --allow www.drought.gov,www.weather.gov --port 9000
```

Open http://localhost:8787/__app/ and enter a site, or go straight to `http://localhost:8787/__app/?site=www.drought.gov`.

## How it works

A page can only read and operate a frame from its own origin, and most of the sites we work with send `X-Frame-Options`, which keeps a frame on any other origin from showing them at all. So the server is a proxy. The site that is open is served at the server's root: `/path` fetches `https://<open site>/path`, so the page's own address is the one its scripts expect and an app that routes on `location.pathname` works. Anything from another host goes under `/__x/<host>/<path>`. On the way out the server drops the frame and CSP headers, decodes the page as the site says and sends it as UTF-8, rewrites the absolute addresses it can see in HTML, CSS and script text so they come back through it, drops `integrity` hashes the rewrite would break, and puts in two script tags: `app/proxy-shim.js` first thing in `<head>`, and `web-controls-page.js` (the page's manifests and a bridge) before `</body>`.

The shim is the proxy continued inside the page, for the addresses a script builds as it runs, which the server never sees: it patches `fetch`, `XMLHttpRequest`, `sendBeacon`, `EventSource`, `Worker`, `pushState`/`replaceState`, `window.open` (kept in the frame), the `src`/`href`/`action`/`srcset` setters, `setAttribute`, `innerHTML` and `document.write`, refuses service workers, and turns a click on a link to another site into opening that site at the root. That is what makes the server general rather than tuned to the sites it was first tried on.

One site is open at a time (`/__open?site=<host>/<path>`); the server is for one person's browser, not a shared host. What no proxy can change is the host name: an app that compares `location.hostname` with its own still sees `localhost`.

The agent, the model and the panel are in the address-bar page, mounted on the frame (`WebControls.mount({ frame })`), the way the extension's agent is in its service worker and reaches a tab through a content bridge. So a press that leaves the page does not end the ask: the frame loads the next page, the agent waits for it as it waits for a tab, and carries on. The history is one, across every site, as the extension's is.

`--allow` limits the server to the listed hosts (and their subdomains). Without it, the server is an open proxy for whoever can reach it, so use it when the server is on anything but your own machine.

## What this costs, measured

Run on 2026-11-21 in headless Chrome, with the model off: each site opened through the server, then "read this page" asked, which is the explain path without the model's part. Text is what the agent reads off the page, controls what it can press.

| Site | Text | Controls | Result |
|---|---|---|---|
| drought.gov, weather.gov | | | Work: the sites the project started on. "open current conditions" then "go back a page" both complete. |
| water.noaa.gov | 673 | 60 | Works. |
| USGS National Water Dashboard | 2152 | 72 | Works (was an "Invalid Link" dialog before the open site moved to the root). |
| earthquake.usgs.gov map | 4313 | 276 | Works. |
| epa.gov | 3016 | 62 | Works. |
| ncei.noaa.gov | 2020 | 57 | Works (its Turnstile bot check loads from its own origin, left unproxied). |
| nps.gov | 2329 | 73 | Works (a script served as UTF-16 with a byte-order mark is now decoded as a browser would). |
| cdc.gov FluView | 1289 | 65 | Works. |
| data.census.gov | 1374 | 89 | Works (was "Page Not Found" before the root move). |
| recreation.gov | 17852 | 613 | Works. |
| en.wikipedia.org (Colorado River) | 158407 | 4139 | Works; a model-off ask takes 37 s on a page this big. |
| How's My Waterway (EPA) | 956 | 37 | Shell only: the app sees `localhost` as its host and asks a dev server on port 3002 for its data. |
| usgs.gov, bls.gov, waterdata.usgs.gov (NWIS) | | | 403 from the sites' bot protection. The server forwards the browser's own headers, and headless Chrome announces itself as headless; try these from a normal Chrome before counting them out. |

Rules of thumb from that:

- Sites that are pages or apps work, including ones that route on `location`. What is left is bot protection, which answers the proxy's request and not the browser's, and apps that compare their host name with their own.
- Every request the page makes passes through the server, including anything typed into the site. Running the server on the visitor's own machine keeps that local; a hosted server sees it all, which is the opposite of the extension and widget, where nothing leaves the browser.
- The model is held by the address-bar page, so it is loaded once and every page opened afterwards uses it. The first load downloads the weights (3.4 GB for the default) and Chrome keeps them for this origin; after that a load is the time it takes to move them into the GPU. The panel's Load model button works before any site is open.
- Sign-ins mostly break: cookies are rewritten onto this origin, but anything checking the host, and any OAuth redirect, won't match.

## Files

- `server.js`: the proxy, the widget's files at `/__wc/`, the app at `/`.
- `app/index.html`: the address bar, the frame, and the widget mounted on it.
- `app/proxy-shim.js`: the proxy continued inside every served page.
- `test/server-test.js`: the rewrite, the tag and the server's own routes, with no network (`node browser/test/server-test.js`).
