# extension (proof of concept)

Not the real extension yet. This only proves one thing: a popup button can
call a `USGS.*` function on a live page and get the real result back, through
an actual Chrome extension instead of a pasted console script.

No LLM here. That comes after this plumbing is confirmed to work.

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
5. Function defaults to `getState`, arguments to `[]`. Click Call.

Expect the same object `USGS.getState()` would return in DevTools. Try
`setParameter` with arguments `["gage height"]` and watch the page's radio
button actually change.

## Known rough edges

- Only wired to the USGS state-page manifest. The other three manifests
  (`SITE`, `NOAA`, `FCP`) aren't plugged into this yet, same idea though:
  a `page/*-bundle.js` per manifest, and the URL check in `background.js`
  extended to route to the right one.
- Re-injects both scripts on every call rather than checking first. Simple,
  a bit wasteful, harmless.
- Not tested against a real browser yet. Written and checked for syntax
  errors, nothing more.
