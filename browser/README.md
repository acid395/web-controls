# web-controls mini browser

The third way to run the agent: a page with an address bar. Type a site, it opens in a frame, and the panel beside it works on it, across every page it leads to. Nothing to install in Chrome and nothing for the site to add.

```sh
node browser/server.js            # http://localhost:8787
node browser/server.js --allow www.drought.gov,www.weather.gov --port 9000
```

Node 20 or newer, nothing to install. The server builds the widget's files (`widget/dist`) itself the first time, and again whenever their sources have changed since; `node widget/scripts/build.js` does the same by hand.

Open http://localhost:8787/ and enter a site, or go straight to `http://localhost:8787/?site=www.drought.gov`. The address keeps up with the page in the frame, so reloading or bookmarking the mini browser brings that page back. It has to be `localhost`, not `127.0.0.1`: the sites live on subdomains of it.

## How it works

A page cannot reach into a frame showing another site, and most of the sites we work with send `X-Frame-Options`, which keeps a frame from showing them at all. So the server is a proxy. Each site is served from its own subdomain of the server, with its path unchanged, the addressing of `viewer/` (Samrat Shrestha's prototype), which this shares:

```
https://waterdata.usgs.gov/state/Idaho/?x=1
http://waterdata--usgs--gov.localhost:8787/state/Idaho/?x=1
```

Browsers resolve every `*.localhost` name to this machine, so there is nothing to configure. Because only the origin differs, a site's root-relative links, its router and its `pushState` work untouched; its cookies and storage are its own; any number of sites can be open; and nothing in a script has to be rewritten. Its stylesheets, images and scripts from elsewhere load from where they are. The server drops the headers that forbid framing, decodes a page as the site says (a byte-order mark first, as a browser does), points the site's absolute links to itself at its proxied origin in HTML and CSS, and puts two script tags in every page: `app/proxy-shim.js` first thing in `<head>`, and `web-controls-page.js` (the page's manifests and a bridge) before `</body>`. Everything else is streamed through as the site sent it.

The shim is the proxy continued inside the page. Its requests to other sites (`fetch`, `XMLHttpRequest`, beacons, event streams) are pointed at those sites' proxied addresses, so they neither fail on CORS nor go round the server; a link to another site, a `_blank` link, `window.open` and a form posting elsewhere stay in the frame. A script from a service that checks which site is asking (Google Maps) goes through the proxy, which tells it the real site in the `Referer` and in the page address the script sends back. Service workers are refused. And because the frame is another origin, the address-bar page can read nothing in it: the shim reports the page's real address, title and state at the start of every document, when it is ready, and on every route change, and carries out the bar's Back, Forward and Reload.

The agent, the model and the panel are in the address-bar page, mounted on the frame (`WebControls.mount({ frame })`), the way the extension's agent is in its service worker and reaches a tab through a content bridge. So a press that leaves the page does not end the ask: the frame loads the next page, the agent waits for it as it waits for a tab, and carries on. The history is one, across every site, as the extension's is.

The server is a proxy to anywhere, so it listens on the loopback interface alone and refuses addresses on this machine and the local network. `--allow` limits it to the listed hosts and their subdomains.

## What this costs, measured

Run on 2026-11-24 in headless Chrome, with the model off: each site opened through the server, then "read this page" asked, which is the explain path without the model's part. Controls is what the agent can press; failed is requests the page made that did not succeed, and errors is what its scripts threw. Eleven of fourteen had none of either.

| Site | Controls | Result |
|---|---|---|
| drought.gov, weather.gov | 241 | Work: the sites the project started on. "open current conditions" then "go back a page" both complete. |
| water.noaa.gov | 60 | Works. |
| How's My Waterway (EPA) | 51 | Works (was a shell when the site sat on plain `localhost`, which it takes for a dev machine). |
| USGS National Water Dashboard | 72 | Works. |
| earthquake.usgs.gov map | 251 | Works. |
| epa.gov | 62 | Works. |
| ncei.noaa.gov | 57 | Works. |
| nps.gov | 73 | Works. |
| cdc.gov FluView | 65 | Works. |
| data.census.gov | 89 | Works. |
| recreation.gov | 613 | Works. |
| en.wikipedia.org (Colorado River) | 4139 | Works; a model-off ask takes 30 s on a page this big. |
| usgs.gov, bls.gov, waterdata.usgs.gov (NWIS) | | 403 from the sites' bot protection. The server forwards the browser's own headers, and headless Chrome announces itself as headless; try these from a normal Chrome before counting them out. |
| hydroinformatics.tulane.edu | | Cloudflare's managed challenge: the site answers the server's request with a browser check that only runs at the site itself, in a real tab. The frame says so and links to the site in a new tab; the extension works there. For a site of your own, a Cloudflare WAF rule that skips the challenge lets the mini browser in. |

Rules of thumb from that:

- Sites that are pages or apps work, including ones that route on `location`. What is left is bot protection, which answers the proxy's request and not the browser's: a plain 403, or a browser check (Cloudflare's) that cannot run anywhere but the real site. No proxy gets past that; the extension, which is the real browser, does.
- Every request the page makes passes through the server, including anything typed into the site. Running the server on your own machine keeps that local; a hosted server sees it all, which is the opposite of the extension and widget, where nothing leaves the browser.
- The model is held by the address-bar page, so it is loaded once and every page opened afterwards uses it. The first load downloads the weights (3.4 GB for the default) and Chrome keeps them for this origin; after that a load is the time it takes to move them into the GPU. The panel's Load model button works before any site is open.
- Sign-ins mostly break: cookies stay on the proxied origin, but anything checking the host, and any OAuth redirect, won't match. Don't sign in to accounts through it.
- WebSockets are not proxied, and a host containing `--` (punycode) cannot be addressed.

## Files

- `server.js`: the proxy, the address-bar page at `/`, the widget's files at `/__wc/` on every host.
- `app/index.html`: the address bar, the frame, and the widget mounted on it.
- `app/proxy-shim.js`: the proxy continued inside every served page.
- `app/proxy-url.js`: a site's address and its proxied one, both ways; shared with the server.
- `test/server-test.js`: the addresses, what a page gets, the shim in a page, and the routes against a stand-in for the sites, with no network (`node browser/test/server-test.js`).
