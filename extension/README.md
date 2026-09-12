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
                                                  content/bridge.js   (isolated world, has chrome.*)
                                                  page/usgs-bundle.js (MAIN world, has window.USGS)

bridge.js <--postMessage--> usgs-bundle.js
```

`page/usgs-bundle.js` is `web-controls.js` with one thing appended: a listener
that waits for a postMessage, calls the named `USGS` function, and posts the
result back. `content/bridge.js` relays between that and the background
script. `background.js` just injects both and forwards one call.

## Load it

1. `chrome://extensions`, turn on Developer mode.
2. Load unpacked, pick this `extension/` folder.
3. Open a USGS state page, e.g. `https://waterdata.usgs.gov/state/Idaho/`.
4. Click the extension icon.

Two ways to use it:

- **Call a function directly.** Function defaults to `getState`, arguments to
  `[]`. Click Call. Expect the same object `USGS.getState()` would return in
  DevTools. Try `setParameter` with arguments `["gage height"]` and watch the
  page's radio button actually change.
- **Ask.** Type something like "set gage height", "group by huc8", or "hide
  the map" and click Ask. The stub planner matches it against a short fixed
  list of phrases (see `PLANNER_RULES` in `background.js`) and runs whatever
  it picks. Type something it doesn't recognize (most things) and it says so
  rather than guessing.

## Known rough edges

- Only wired to the USGS state-page manifest. The other three manifests
  (`SITE`, `NOAA`, `FCP`) aren't plugged into this yet, same idea though:
  a `page/*-bundle.js` per manifest, and the URL check in `background.js`
  extended to route to the right one.
- Re-injects both scripts on every call rather than checking first. Simple,
  a bit wasteful, harmless.
- The stub planner understands a handful of fixed phrases, nothing more.
  It's there to prove the loop shape, not to be a real assistant.
- Confirmed live: `getState()` and `setParameter()` both round-trip through
  the whole chain (popup, background, content-script bridge, page's own JS
  world) and return real results / cause a real DOM change. The Ask flow
  reuses that exact same path, so it should work the same way, but hasn't
  been clicked in a real browser yet.
