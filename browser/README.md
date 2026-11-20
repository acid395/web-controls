# web-controls mini browser

The third way to run the agent: a page with an address bar. Type a site, it opens in a frame, and the widget is in it. Nothing to install in Chrome and nothing for the site to add.

```sh
node widget/scripts/build.js      # once, for widget/dist
node browser/server.js            # http://localhost:8787
node browser/server.js --allow www.drought.gov,www.weather.gov --port 9000
```

Open http://localhost:8787 and enter a site, or go straight to `http://localhost:8787/?site=www.drought.gov`.

## How it works

A page can only read and operate a frame from its own origin, and most of the sites we work with send `X-Frame-Options`, which keeps a frame on any other origin from showing them at all. So the server is a proxy: `/www.drought.gov/path` fetches `https://www.drought.gov/path`, drops the frame and CSP headers, rewrites the page's links and script URLs so its own requests come back through the server, and appends the widget's script tag before `</body>`. The frame is then same-origin with the address bar's page, and the widget runs inside the site exactly as it does on a site that added it, with `data-page-url` telling it the site's real address so site routes and manifests match.

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
- The model is held by the address-bar page, not the framed page, so it is loaded once and every page opened afterwards uses it (`modelHost: "parent"` in the widget, `WebControls.serveModelHost()` here). The first load downloads the weights (3.4 GB for the default) and Chrome keeps them for this origin; after that a load is the time it takes to move them into the GPU. The bar shows the model's state and has its own Load button, so the model can be loading while a site is still being typed.
- Sign-ins mostly break: cookies are rewritten onto this origin, but anything checking the host, and any OAuth redirect, won't match.

## Files

- `server.js`: the proxy, the widget's files at `/__wc/`, the app at `/`.
- `app/index.html`: the address bar, the frame, and the model host every framed page's widget talks to.
