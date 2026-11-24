# web-controls viewer

The third way to use web-controls. Type a website's address, the site loads in
an iframe, and a floating **Ask** button opens an agent that operates it:
*"select Alaska"*, *"click Download"*, *"search for Boise River"*.

| | Extension | Widget | Viewer |
|---|---|---|---|
| Who installs it | Each user | Each site | Nobody: run one local server |
| Works on | Sites the user enables | Sites that installed it | Any address typed in |
| How it reaches the page | Chrome's scripting APIs | It is in the page | A local proxy injects it |

The viewer is its own app. It shares no code with `extension/` or `widget/`;
its executor follows the same ideas (find a control by what a person calls
it, then operate it the way a person would).

## Run it

```
node viewer/server.js        # then open http://localhost:5280
node viewer/test/viewer-test.js
```

Node 18.17 or later. No dependencies.

## How it works

```
http://localhost:5280                      the viewer: address bar, iframe, agent widget
   │  postMessage                          public/app.js, public/commands.js
   ▼
http://waterdata--usgs--gov.localhost:5280/state/Idaho/
   │  the site, through the proxy          server.js
   │  + frame/agent.js injected first in <head>
   ▼
https://waterdata.usgs.gov/state/Idaho/
```

**Why a proxy.** A page cannot reach into an iframe showing another site
(same-origin policy), and many sites refuse to be framed (`X-Frame-Options`,
CSP `frame-ancestors`). The proxy removes those headers and adds one script to
every HTML page.

**Why subdomains.** Each site is served from its own `*.localhost` subdomain
with its real path (`public/proxy-url.js`). Root-relative links, the site's
router and `pushState` all keep working. Sites keep separate cookies and
storage, and none of them can touch the viewer. Browsers resolve
`*.localhost` to this machine, so nothing needs configuring.

**`frame/agent.js`**, inside the page:
- routes the site's `fetch`/XHR, links, forms, `window.open` and `_blank`
  links back through the proxy, so it doesn't break on CORS or escape the
  frame
- reports the real URL and every navigation to the viewer
- carries out commands: `click`, `select` (native dropdowns, radios, ARIA
  listboxes, custom and type-ahead pickers), `type`, `check`, `set`,
  `scroll`, `find`, `read`, `inventory`, `back`, `reload`

**`public/commands.js`** turns plain English into those commands, with pattern
matching and no model. Steps split on "then" and ";". Anything unrecognised
goes to the page as a best guess.

Because the viewer outlives every page load in the frame, a multi-step command
continues across navigations: each step waits for the new page to report in.

## Commands

| Say | Does |
|---|---|
| `select Alaska` / `select Discharge in Parameter` | picks an option |
| `set State to Idaho` | dropdown, text field or checkbox, found by its label |
| `click Download` / `open the resources menu` | buttons, links, tabs, menus |
| `type 13206000 into site number` / `search for Boise River` | fills a field (and submits) |
| `check Show map` / `turn off streams layer` | checkboxes and switches |
| `scroll down` / `scroll to top` / `find Flood stage` | moves around |
| `read this page` / `list controls` | what's there; click an item in the list to fill in a command for it |
| `back` / `reload` / `open water.noaa.gov` | navigation |

## Known limits

- **Local use only.** The server is an open proxy. It listens only on
  loopback and refuses private-network addresses. Don't sign in to accounts
  through it.
- Map APIs whose keys are tied to the site's address (Google Maps) refuse
  `localhost`. Their scripts go through the proxy, which reports the real
  site in the `Referer` header and in the page address the script sends back
  (in a query string in older Maps versions, in a JSON request body in
  newer ones).
  Hosts treated this way are listed in `REFERRER_CHECKED` in
  `public/proxy-url.js`.
- WebSockets aren't proxied. Hosts containing `--` (punycode) can't be
  encoded.
- A site script that checks `location.hostname`, or that blocks framing in
  JavaScript (not just headers), may misbehave. The sandbox stops it from
  replacing the viewer.
- Some sites block automated browsers by user agent. USGS rejects
  `HeadlessChrome`, but a normal browser is fine.
- No model yet. Natural phrasings that the patterns don't cover fall through
  to the best-guess `auto` command. A model can slot in as a parser that
  outputs the same command objects, since `frame/agent.js` takes plain data.
