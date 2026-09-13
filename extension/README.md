# extension (proof of concept)

Not the real extension yet. Proves three things: a popup button can call a
function on a live page and get the real result back through an actual
Chrome extension instead of a pasted console script; a typed instruction can
pick which function to call, run it, and return the result; and a brand new
site can be turned on with one click, no code change, no reload.

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

Three ways to use it:

- **Enable on this site.** Only needed once per site beyond the four already
  granted in `manifest.json`. Click it, accept Chrome's permission prompt,
  done.
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
