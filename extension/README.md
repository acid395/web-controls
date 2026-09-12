# extension (proof of concept)

Not the real extension yet. Proves two things: a popup button can call a
`USGS.*` function on a live page and get the real result back through an
actual Chrome extension instead of a pasted console script, and a typed
instruction can pick which function to call, run it, and return the result.

No real LLM here yet. The "Ask" box is answered by a stub: plain keyword
matching in `background.js`'s `planTool()`, not a model. It exists to prove
the shape of the loop (instruction in, tool call picked, it actually runs,
result comes back) before spending anything on a real one. Swapping
`planTool()` for a real model call is the whole upgrade later.

## Why this exists

`web-controls.js` was built to be pasted into DevTools, which runs it in the
page's own JS world. A content script does not share that world by default,
so code like `WC`/`USGS` needs to be injected into the page's "MAIN world" on
purpose, and talking to it from the rest of the extension needs a small relay,
since MAIN-world code has no access to `chrome.*` APIs. This is that relay,
built as small and testable as possible:

```
popup.js  --chrome.runtime-->  background.js  --chrome.scripting-->  injects both:
                                                  content/bridge.js     (isolated world, has chrome.*)
                                                  page/<route>-bundle.js (MAIN world, has window.USGS or window.GENERIC)

bridge.js <--postMessage--> page bundle
```

`background.js` picks which page bundle to inject based on a small `ROUTES`
table keyed by URL: USGS's state page gets `page/usgs-bundle.js`
(`web-controls.js` plus a listener appended that waits for a postMessage,
calls the named `USGS` function, and posts the result back). Every other
routed site gets `page/generic-bundle.js` (`generic-controls.js` plus the
same kind of listener, targeting `window.GENERIC` instead), the
zero-manifest fallback, so the extension can reach a site nobody wrote a
manifest for, not just USGS. `content/bridge.js` relays between whichever
bundle is active and the background script either way; it doesn't need to
know which one it's talking to.

## Load it

1. `chrome://extensions`, turn on Developer mode.
2. Load unpacked, pick this `extension/` folder.
3. Open one of the routed pages (see `ROUTES` in `background.js`):
   `waterdata.usgs.gov/state/Idaho/` (USGS manifest), or
   `dashboard.waterdata.usgs.gov/`, `mywaterway.epa.gov/`, `www.drought.gov/`
   (all three use the GENERIC fallback).
4. Click the extension icon.

Two ways to use it:

- **Call a function directly.** On the USGS route: function defaults to
  `getState`, arguments to `[]`. Click Call. Expect the same object
  `USGS.getState()` would return in DevTools. Try `setParameter` with
  arguments `["gage height"]` and watch the page's radio button actually
  change. On a GENERIC route: try function `inventory` with arguments `[]`,
  or `mapInfo`, or `selectOption` with arguments like
  `["#some-selector", "some value"]` using a real selector from that page's
  `inventory()` output.
- **Ask.** USGS route only right now. Type something like "set gage height,"
  "group by huc8," or "hide the map" and click Ask. The stub planner matches
  it against a short fixed list of phrases (see `PLANNER_RULES` in
  `background.js`) and runs whatever it picks. Type something it doesn't
  recognize (most things) and it says so rather than guessing.

## Known rough edges

- `SITE` and `NOAA` still aren't wired into `ROUTES`. Same idea as USGS
  though: a `page/*-bundle.js` and a route entry each.
- The Ask box only plans against the USGS manifest. Extending it to the
  GENERIC routes means the stub planner would need to work off whatever
  `inventory()` finds live, not a fixed rule list, which starts to look a
  lot like what a real model would actually be doing there.
- Re-injects scripts on every call rather than checking first. Simple, a bit
  wasteful, harmless.
- Confirmed live, on the USGS route: `getState()` and `setParameter()` both
  round-trip through the whole chain and return real results / cause a real
  DOM change. The GENERIC route through this same extension mechanism
  (rather than a console paste, which is exempt from a page's CSP in a way
  this injection isn't) hasn't been confirmed yet. That's the current test.
