# web-controls mini browser

The third way to run the agent: a page with an address bar. Type a site, it opens in a frame, and the panel beside it works on it, across every page it leads to. Nothing to install in Chrome and nothing for the site to add.

```sh
node widget/scripts/build.js      # once, for widget/dist
node browser/server.js            # http://localhost:8787
node browser/server.js --allow www.drought.gov,www.weather.gov --port 9000
```

Open http://localhost:8787 and enter a site, or go straight to `http://localhost:8787/?site=www.drought.gov`.

## How it works

A page can only read and operate a frame from its own origin, and most of the sites we work with send `X-Frame-Options`, which keeps a frame on any other origin from showing them at all. So the server is a proxy: `/www.drought.gov/path` fetches `https://www.drought.gov/path`, drops the frame and CSP headers, rewrites the page's links and script URLs so its own requests come back through the server, and appends one script tag before `</body>`: `web-controls-page.js`, the page's manifests and a bridge.

The agent, the model and the panel are in the address-bar page, mounted on the frame (`WebControls.mount({ frame })`), the way the extension's agent is in its service worker and reaches a tab through a content bridge. So a press that leaves the page does not end the ask: the frame loads the next page, the agent waits for it as it waits for a tab, and carries on. The history is one, across every site, as the extension's is.

`--allow` limits the server to the listed hosts (and their subdomains). Without it, the server is an open proxy for whoever can reach it, so use it when the server is on anything but your own machine.

## What this costs, measured

Run on 2026-11-19 against the sites the extension targets:

| Site | Result |
|---|---|
| drought.gov | Works. Page, menus and controls all visible to the agent; the widget mounts inside. |
| weather.gov | Works. |
| USGS National Water Dashboard | Loads with an "Invalid Link" dialog: the app reads its own URL, which is now the proxy's. |
| How's My Waterway (EPA) | Shell only. Its data requests and the ArcGIS map script don't come through the rewrite. |
| waterdata.usgs.gov (NWIS) | Doesn't load. The site's bot protection returns 403 to the server's request; only a real browser gets in. |

Rules of thumb from that:

- Sites that are mostly pages work. Apps that build their own URLs in script, route on `location`, or sit behind bot protection each need their own fix, or can't be reached this way at all.
- Every request the page makes passes through the server, including anything typed into the site. Running the server on the visitor's own machine keeps that local; a hosted server sees it all, which is the opposite of the extension and widget, where nothing leaves the browser.
- The model is held by the address-bar page, so it is loaded once and every page opened afterwards uses it. The first load downloads the weights (3.4 GB for the default) and Chrome keeps them for this origin; after that a load is the time it takes to move them into the GPU. The panel's Load model button works before any site is open.
- Sign-ins mostly break: cookies are rewritten onto this origin, but anything checking the host, and any OAuth redirect, won't match.

## Files

- `server.js`: the proxy, the widget's files at `/__wc/`, the app at `/`.
- `app/index.html`: the address bar, the frame, and the widget mounted on it.
- `test/server-test.js`: the rewrite, the tag and the server's own routes, with no network (`node browser/test/server-test.js`).
