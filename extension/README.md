# extension (proof of concept)

Not the real extension yet, but the real shape of it. Proves: a popup button
can call a function on a live page and get the result back through an actual
Chrome extension, not a pasted console script; a brand new site turns on
with one click, no code change, no reload; and a typed instruction can pick
the right function to call on its own.

## Why three ways to answer "Ask," not one

The actual goal is a wrapper that runs fully locally, for free, with no
account - and also feels instant from the first click. Those two things are
in real tension: a model capable enough to reliably pick the right tool has
to be several gigabytes, and that has to download once, over whatever
network the user has. There's no way to make that instant. So `Ask` doesn't
wait on one model - it tries three things in order, cheapest first:

1. **`planTool()`**, a zero-download keyword matcher (USGS route only right
   now). Instant, free, no model involved, whenever it recognizes the phrasing.
2. **WebLLM**, a real local model in an offscreen document (a service worker
   has no WebGPU access, so it can't run there). Fully local and free, but
   the first time ever needs a real, multi-gigabyte download - `Ask` checks
   it has actually finished before relying on it, rather than blocking on it.
3. **Gemini's free tier** exists too, but on purpose isn't part of `Ask`'s
   fallback chain - it needs a personal API key, which contradicts "easy to
   use," so it stays a separate, explicit choice in the debug tools, not
   something the default path reaches for on its own.

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

`background.js` picks which page bundle to inject based on `NAMED_MANIFESTS`:
USGS's state page gets `page/usgs-bundle.js` (`web-controls.js` plus a
listener appended that waits for a postMessage, calls the named `USGS`
function, and posts the result back). Anything not in that list gets
`page/generic-bundle.js` (`generic-controls.js` plus the same kind of
listener, targeting `window.GENERIC` instead), the zero-manifest fallback -
automatically, with no per-site entry required. `content/bridge.js` relays
between whichever bundle is active and the background script either way; it
doesn't need to know which one it's talking to.

Reaching a new site no longer means editing this repo. `manifest.json`
declares a fixed set of `host_permissions` (the sites already tested) plus
`optional_host_permissions: ["https://*/*", "http://*/*"]`. The popup's
"Enable on this site" button calls `chrome.permissions.request()` for
whatever origin the active tab is on; Chrome shows its own native prompt,
and once granted, that site works immediately - no code change, no reload.
`chrome.permissions.request()` has to run inside the click handler itself to
count as a real user gesture, so that one call lives directly in `popup.js`,
not relayed through `background.js` like everything else.

## Load it

1. `chrome://extensions`, turn on Developer mode.
2. Load unpacked, pick this `extension/` folder.
3. Open any page. `waterdata.usgs.gov/state/Idaho/` uses the real USGS
   manifest; anything else uses GENERIC once enabled (next step).
4. Click the extension icon. If this is a new site, click "Enable on this
   site" first and accept Chrome's permission prompt.

- **Enable on this site.** Only needed once per site beyond the four already
  granted in `manifest.json`. Click it, accept Chrome's permission prompt,
  done.
- **Ask.** The real, intended thing (`smartAsk` in `background.js`). Type an
  instruction, click Ask. Tries `planTool()` first (USGS route only so far,
  see "Known rough edges"), falls back to WebLLM only if that missed and the
  model has actually finished loading, otherwise says so plainly instead of
  hanging. Untested live.
- **Debug tools**, behind the collapsed section: call a function directly by
  name and raw arguments, test WebLLM or Gemini without going through the
  fast path first, or run the old stub-only Ask. All the same building
  blocks `smartAsk` uses, exposed individually for testing each piece on its
  own.

## Known rough edges

- `SITE` and `NOAA` still aren't wired into `NAMED_MANIFESTS`. Same idea as
  USGS though: a `page/*-bundle.js` and an entry each.
- The Ask box only plans against the USGS manifest. Extending it to GENERIC
  sites means the stub planner would need to work off whatever `inventory()`
  finds live, not a fixed rule list, which starts to look a lot like what a
  real model would actually be doing there.
- Re-injects scripts on every call rather than checking first. Simple, a bit
  wasteful, harmless.
- Confirmed live: `getState()`/`setParameter()` on the USGS route, and
  `inventory()`/`selectOption()`/`fill()` on the GENERIC route across four
  separate sites (EPA, Drought.gov, the National Water Dashboard, and
  StreamStats, granted at runtime via "Enable on this site" with no code
  change), all through this actual extension mechanism, not a console
  paste. The first version of the permission-request handler silently
  failed with no dialog shown, because an `await` before
  `chrome.permissions.request()` broke Chrome's user-gesture check. Fixed by
  precomputing the tab's origin when the popup opens, so the click handler
  calls `chrome.permissions.request()` as its first and only step.
- WebLLM confirmed working end to end: offscreen document, WebGPU, model
  download, real inference, a real response back through the popup. Real
  bugs surfaced and got fixed along the way: extension pages' default CSP
  blocks WebAssembly outright (fixed with `'wasm-unsafe-eval'` in
  `content_security_policy.extension_pages`); the model reloaded from
  scratch on every ask until a warm-load on browser startup/extension
  install was added; the first model picked (a small 3B one, chosen to
  validate loading cheaply) turned out not to support tool-calling at all in
  WebLLM 0.2.85, confirmed by its own error message naming which models do
  (all Hermes-2-Pro/Hermes-3 at 7-8B).
- Gemini and `smartAsk` (the fast-path-first, WebLLM-if-ready orchestration)
  are both new and untested live.
