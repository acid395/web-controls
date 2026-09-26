const logEl = () => document.getElementById("log");

// A handler bound to a control that no longer exists throws at load and takes
// the whole panel down with it - a removed debug field should never be able
// to break Ask.
function on(id, event, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, fn);
}

function append(node) {
  const box = logEl();
  box.appendChild(node);
  box.scrollTop = box.scrollHeight;
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  // textContent throughout, deliberately: gauge names, alert headlines and
  // page labels all come from external sources and must never be parsed as
  // markup.
  if (text !== undefined && text !== null && text !== "") n.textContent = String(text);
  return n;
}

function log(s) {
  append(el("pre", null, s));
}

// Echoes what was asked, in a lighter style than the result itself.
function logEcho(s) {
  append(el("div", "echo", s));
}

// Renders a data tool's own `display` block (see DATA_TOOLS in background.js).
// The renderer stays generic - each tool decides its title, stats and rows,
// since it's the thing that knows what its numbers mean.
function renderCard(display, raw) {
  append(buildCard(display, raw));
}

// "3m ago" rather than a timestamp: the question is always whether a result
// is still current, never what o'clock it was.
function ago(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function buildCard(display, raw) {
  const card = el("div", "card");

  const head = el("div", "card-head");
  head.appendChild(el("div", "card-title", display.title));
  // Without this an old collapsed result looks exactly as current as a new
  // one, which is the mistake this whole project keeps guarding against.
  if (raw && raw.at) head.appendChild(el("div", "card-when", ago(raw.at)));
  if (display.subtitle) head.appendChild(el("div", "card-sub", display.subtitle));
  card.appendChild(head);

  if (display.stats && display.stats.length) {
    const stats = el("div", "stats");
    for (const s of display.stats) {
      const box = el("div", "stat");
      box.appendChild(el("div", "stat-label", s.label));
      box.appendChild(el("div", "stat-value", s.value));
      stats.appendChild(box);
    }
    card.appendChild(stats);
  }

  // Explains an absent stats row rather than leaving it silently missing.
  if (display.caveat) card.appendChild(el("div", "caveat", display.caveat));

  // A failure's "here's what I did check" list.
  if (display.checked && display.checked.length) {
    const box = el("div", "checked");
    box.appendChild(el("div", "checked-label", "checked"));
    for (const item of display.checked) box.appendChild(el("div", "checked-item", item));
    card.appendChild(box);
  }

  // A choice with no way to take it is barely a choice. Each button carries
  // the exact call it would make, so picking one needs no retyping.
  if (display.choices && display.choices.length) {
    const box = el("div", "choices");
    for (const choice of display.choices) {
      const button = el("button", "choice");
      button.appendChild(el("span", "choice-label", choice.label));
      if (choice.hint) button.appendChild(el("span", "choice-hint", choice.hint));
      button.addEventListener("click", () => {
        logEcho(`chose: ${choice.label}`);
        chrome.runtime.sendMessage({ type: "runToolCall", toolCall: choice.call, label: choice.label }, (res) => {
          logResult(res);
        });
      });
      box.appendChild(button);
    }
    card.appendChild(box);
  }

  if (display.rows && display.rows.length) {
    const rows = el("div", "rows");
    for (const r of display.rows) {
      const row = el("div", "row" + (r.tone ? " " + r.tone : ""));
      const name = el("div", "row-name", r.name);
      if (r.meta) name.appendChild(el("span", "row-meta", r.meta));
      row.appendChild(name);
      row.appendChild(el("div", "row-value", r.value));
      rows.appendChild(row);
    }
    card.appendChild(rows);
  }

  const foot = el("div", "card-foot");
  foot.appendChild(el("span", null, display.note || ""));
  foot.appendChild(el("span", null, display.source || ""));
  card.appendChild(foot);

  // Undo is possible only because verification records the previous value of
  // everything it changed - it existed as a tool and was never reachable.
  const acts = el("div", "card-acts");
  const changes = raw && raw.verified && raw.verified.changes;
  if (changes && changes.some((c) => c.was !== undefined)) {
    const undo = el("button", "act", "undo");
    undo.addEventListener("click", () => {
      logEcho("undoing that");
      chrome.runtime.sendMessage({ type: "runToolCall", toolCall: { name: "pageUndo", args: { changes } } }, logResult);
    });
    acts.appendChild(undo);
  }
  const copy = el("button", "act", "copy");
  copy.addEventListener("click", () => {
    // The readable form, not the JSON: someone copying a reading wants the
    // reading, and the raw response is already one click away below.
    const lines = [display.title, display.subtitle]
      .concat((display.stats || []).map((x) => `${x.label}: ${x.value}`))
      .concat((display.rows || []).map((r) => [r.name, r.value, r.meta].filter(Boolean).join("  ")))
      .filter(Boolean);
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => { copy.textContent = "copied"; setTimeout(() => { copy.textContent = "copy"; }, 1200); },
      () => { copy.textContent = "couldn't copy"; }
    );
  });
  acts.appendChild(copy);
  card.appendChild(acts);

  // The exact JSON stays one click away - this is still a debugging tool.
  const details = el("details", "raw");
  details.appendChild(el("summary", null, "raw response"));
  details.appendChild(el("pre", null, JSON.stringify(raw, null, 2)));
  card.appendChild(details);

  return card;
}

// One place that decides how any response gets shown: a formatted card when
// the tool supplied a display block, plain JSON otherwise.
function logResult(res) {
  clearStatus();
  if (chrome.runtime.lastError) {
    log("runtime error: " + chrome.runtime.lastError.message);
    return;
  }
  // A data tool's display rides on res.result; smartAsk's own responses
  // (e.g. a disambiguation list) carry one directly.
  const display = res && ((res.result && res.result.display) || res.display);
  if (display) renderCard(display, res);
  else log(JSON.stringify(res, null, 2));
}

/* ---------------------------------------------------------------------------
 * Restoring the log.
 *
 * This popup is destroyed every time it loses focus, so its own DOM is not
 * where results can live. background.js records each ask, and everything
 * below renders from that - which is why an answer that lands while the
 * popup is shut is simply there on reopening, and why a slow ask shows as
 * running rather than as nothing.
 */
// Older results collapse to a one-line summary. History is worth keeping -
// an answer that arrived while the popup was shut has to be here - but a
// stack of full cards buries the one just asked for.
function renderEntry(entry, { collapsed = false } = {}) {
  const body = document.createElement("div");
  const into = (node) => body.appendChild(node);

  if (entry.status === "running") {
    into(el("div", "running", "still running - this stays here if you close the popup"));
  } else if (entry.display) {
    into(buildCard(entry.display, entry));
  } else if (entry.error) {
    into(el("pre", null, entry.error + (entry.hint ? `\n\nhint: ${entry.hint}` : "")));
  } else {
    into(el("pre", null, JSON.stringify(entry, null, 2)));
  }

  if (!collapsed) {
    append(el("div", "echo", `ask: "${entry.instruction}"`));
    append(body);
    return;
  }

  // Collapsed: the question, plus whatever the answer's own headline was.
  const box = el("details", "past");
  const summary = el("summary", null);
  summary.appendChild(el("span", "past-q", entry.instruction));
  const gist = entry.status === "running" ? "running"
    : entry.error ? "no match"
    : (entry.display && (entry.display.title || entry.display.subtitle)) || "done";
  summary.appendChild(el("span", "past-a", String(gist).slice(0, 34)));
  box.appendChild(summary);
  box.appendChild(body);
  append(box);
}

let renderedIds = new Set();
// What is on screen right now, as id -> status. renderedIds alone could not
// answer "has this changed?", only "have I ever seen it", and a running ask
// becoming a finished one is exactly a change worth redrawing for.
let drawnAt = new Map();
// The status line lives inside the log box, which restoreHistory empties to
// rebuild. Kept here so the rebuild can put it back.
let statusText = null;
// Who put the status line up. A line about an ask in flight has to come down
// when nothing is in flight - nobody was taking it down, because the popup
// deliberately ignores smartAsk's response, so "working on ..." sat there
// under a finished card. A model download is not an ask and stays.
let statusOwner = null;

// Past instructions, newest first, for up-arrow recall.
let recallList = [];
let recallAt = -1;

function restoreHistory() {
  chrome.runtime.sendMessage({ type: "askHistory" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    const box = logEl();
    box.textContent = "";
    renderedIds = new Set();
    drawnAt = new Map();
    recallList = res.history.map((h) => h.instruction).filter(Boolean).reverse();
    recallAt = -1;

    if (!res.history.length) {
      const empty = el("div", "empty");
      empty.appendChild(el("div", null, "Nothing asked yet."));
      empty.appendChild(el("div", null, "Try one of the examples above, or describe what you want in your own words."));
      box.appendChild(empty);
      if (statusText) setStatus(statusText, statusOwner);
      return;
    }
    const last = res.history.length - 1;
    res.history.forEach((entry, i) => {
      renderEntry(entry, { collapsed: i !== last });
      drawnAt.set(entry.id, entry.status);
      if (entry.status !== "running") renderedIds.add(entry.id);
    });
    // Put the running line back. It is written synchronously by the click
    // handler and this callback lands a few milliseconds later, so clearing
    // the box was deleting it every time: the panel went blank the instant
    // after it said "working on ...", which is why a slow ask looked like a
    // click that had not registered.
    // "ask" only. A speed test writes no history entry, so "nothing is
    // running" is true the whole time it runs - and this cleared its status
    // on the first redraw, which is why typing "speed test" looked like the
    // words simply vanished.
    if (statusOwner === "ask" && !res.history.some((h) => h.status === "running")) clearStatus();
    else if (statusText) setStatus(statusText, statusOwner);
    box.scrollTop = box.scrollHeight;
  });
}

// A result that arrives while the popup happens to be open should appear
// without waiting for a reopen.
if (chrome.storage && chrome.storage.onChanged) chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.askHistory) return;
  const next = changes.askHistory.newValue || [];
  // "running" was filtered out here, so the entry recorded before the work
  // starts - the whole point of recording it - never reached the screen. A
  // model ask then showed nothing for thirty seconds and the natural read of
  // that is that the button did not take, so it got pressed again. Anything
  // whose status differs from what is drawn is worth drawing, and an ask
  // that has just begun differs from not being there at all.
  const changed = next.some((e) => drawnAt.get(e.id) !== e.status);
  if (!changed) return;
  restoreHistory();
});

document.addEventListener("DOMContentLoaded", restoreHistory);

on("clearLog", "click", () => {
  chrome.runtime.sendMessage({ type: "clearHistory" }, () => {
    logEl().textContent = "";
    renderedIds = new Set();
    drawnAt = new Map();
  });
});

// chrome.permissions.request() only counts as triggered by a real click if
// there's no await before it in the same handler - an await, even a fast
// one, can cross a task boundary Chrome uses to decide "was this a genuine
// user gesture." So the tab's URL is looked up once when the popup opens
// (there's nothing else competing for the gesture at that point), cached,
// and the click handler below calls chrome.permissions.request as its
// first and only step, synchronously, using that cached value.
// Read once at load, this was a dead end on any site that was not already
// granted. Two faults compounded.
//
// Without the "tabs" permission chrome.tabs.query omits url for a tab the
// extension has no host permission for - which is every site the Enable
// button exists to grant. So enabling a new site needed its URL, and reading
// its URL needed the site to be enabled.
//
// And it was cached once, at panel load. A popup died on every blur so that
// was the same as reading it fresh; a side panel outlives navigation, so a
// panel first opened on a new tab kept a null origin for the rest of its
// life and the button never worked again.
let currentOriginPattern = null;
let currentUrl = null;
function rememberOrigin() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    currentOriginPattern = null;
    currentUrl = (tab && tab.url) || null;
    if (!currentUrl) return;
    try {
      const u = new URL(currentUrl);
      if (u.protocol === "http:" || u.protocol === "https:") {
        currentOriginPattern = `${u.protocol}//${u.hostname}/*`;
      }
    } catch (e) { /* leave it null; the button explains why below */ }
  });
}
rememberOrigin();
if (chrome.tabs.onActivated) chrome.tabs.onActivated.addListener(rememberOrigin);
if (chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((id, info, tab) => {
    if (tab && tab.active && (info.url || info.status === "complete")) rememberOrigin();
  });
}
if (chrome.windows && chrome.windows.onFocusChanged) chrome.windows.onFocusChanged.addListener(rememberOrigin);

on("enable", "click", () => {
  const status = document.getElementById("enableStatus");
  if (!currentOriginPattern) {
    // Say which of the two it is. "Couldn't read this tab's URL" described
    // the symptom and left nothing to do about it.
    status.textContent = currentUrl
      ? `this is a ${String(currentUrl).split(":")[0]}: page - extensions cannot run on browser pages, only on http and https sites`
      : "no page open in this tab yet - open a site first, then try again";
    return;
  }
  chrome.permissions.request({ origins: [currentOriginPattern] }, (granted) => {
    status.textContent = granted
      ? `enabled on ${currentOriginPattern}. Try Call with function "inventory" now.`
      : `permission denied for ${currentOriginPattern}`;
  });
});

// One grant instead of one per site. Registration already covers every
// origin that has been granted - registerFeedCapture reads them all and
// registers a document_start capture and a document_end publish across the
// lot - so the only thing standing between this and every page on the web
// was the granting, done one site at a time from this button.
//
// Which mattered more than convenience: tools are published at document_end
// on every granted origin, so a site nobody thought to enable was a site
// where modelContext stayed empty. "Works on any website" was true of the
// machinery and false of the installation.
//
// Same gesture rule as above: request first, synchronously, nothing awaited
// before it, or Chrome does not count the click.
on("enableAll", "click", () => {
  const status = document.getElementById("enableStatus");
  chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] }, (granted) => {
    status.textContent = granted
      ? "enabled everywhere - every page now publishes its own tools. Reload any open tab to pick it up."
      : "permission denied - you can still enable one site at a time";
  });
});

/* ---------------------------------------------------------------------------
 * The header badge and the example chips.
 *
 * Both are functional rather than decorative. The badge answers the first
 * question anyone has - does this thing even work on the page I'm looking at,
 * and what does it know about it - which previously required opening Debug
 * tools and reading a wall of text. The chips replace the paragraph that used
 * to explain what to type, and are drawn from the route's real tools, so they
 * cannot suggest something this page cannot do.
 */
const EXAMPLES = {
  USGS: ["select Alaska", "set the parameter to gage height", "group by county", "gage height in Alaska"],
  SITE: ["graph discharge", "set the time span to 30 days", "view tabular data"],
  NOAA: ["zoom in", "open the layers panel", "set the basemap to satellite", "is there flooding in Idaho"],
  FCP: ["toggle the legend", "set the basemap to terrain", "zoom out"],
  GENERIC: ["read this page", "what can I do here", "gage height in Alaska", "weather in Chicago"],
};

function renderChips(route) {
  const box = document.getElementById("chips");
  box.textContent = "";
  const add = (text, { run = true, title = "" } = {}) => {
    const chip = el("button", "chip", text);
    if (title) chip.title = title;
    chip.addEventListener("click", () => {
      const field = document.getElementById("smartInstruction");
      field.value = text;
      field.focus();
      // A chip that fills the box but does not send it is for the ones you
      // are meant to finish typing.
      if (run) document.getElementById("smartAsk").click();
      else field.setSelectionRange(field.value.length, field.value.length);
    });
    box.appendChild(chip);
  };

  for (const text of (EXAMPLES[route] || EXAMPLES.GENERIC).slice(0, 4)) add(text);
  add("diagnose", { title: "check this install end to end" });
  add("webmcp", { title: "the tools an agent can call on this page" });

  // The model prefix only exists as text typed into the box, which made it
  // unfindable: it was mentioned once, inside a collapsed panel. Offered here
  // when the model is on, and left unsent so the question can be finished.
  chrome.storage.local.get("localModelEnabled", ({ localModelEnabled }) => {
    if (localModelEnabled === true) {
      add("model: ", { run: false, title: "put the next question straight to the local model" });
    }
  });
}

function describeRoute() {
  // The enable buttons live behind this check, and the check is exactly what
  // fails when a site is not enabled - or when the worker is still waking, or
  // the panel was opened on a page the extension cannot see at all. If the
  // answer never comes the badge sat on "checking page..." with the one
  // control that fixes it hidden, which leaves nothing to do but guess.
  //
  // So the buttons appear on their own after a moment. Showing them when they
  // were not needed costs a row of the panel; hiding them when they were is a
  // dead end.
  let answered = false;
  const giveUp = setTimeout(() => {
    if (answered) return;
    const text = document.getElementById("routeText");
    if (text) text.textContent = "can't tell yet - try Enable everywhere";
    const row = document.getElementById("enableRow");
    if (row) row.classList.add("show");
  }, 2500);

  chrome.runtime.sendMessage({ type: "capabilities" }, (res) => {
    answered = true;
    clearTimeout(giveUp);
    const pill = document.getElementById("routePill");
    const text = document.getElementById("routeText");
    if (chrome.runtime.lastError || !res || !res.ok) {
      // Almost always an un-enabled site, which is the one case where the
      // enable button is worth showing at all.
      text.textContent = "not enabled here";
      document.getElementById("enableRow").classList.add("show");
      renderChips("GENERIC");
      return;
    }
    // The page could not be read at all. Reporting a count here would be
    // reporting the result of a look that never happened - and would hide the
    // Enable button, which is the only thing that fixes the usual cause.
    if (res.pageBlocked) {
      text.textContent = /not enabled/i.test(res.pageBlocked)
        ? "not enabled here" : "can't read this page";
      document.getElementById("enableRow").classList.add("show");
      renderChips(res.route);
      return;
    }
    const named = res.route !== "GENERIC";
    pill.classList.add(named ? "live" : "generic");
    text.textContent = named
      ? `${res.route} · ${res.tools.length} tools`
      : `any site · ${res.pageControls} controls`;
    renderChips(res.route);
  });
}

// Which build is loaded, where it can be read without opening anything. Most
// of the confusion about whether a fix had landed came down to having no way
// to tell a reloaded extension from a stale one - every build called itself
// 0.5.0, so "did you reload" was unanswerable by either side.
document.addEventListener("DOMContentLoaded", () => {
  const tag = document.getElementById("buildTag");
  if (tag) tag.textContent = "v" + chrome.runtime.getManifest().version;
});

document.addEventListener("DOMContentLoaded", describeRoute);

// The badge was read once, at load. A popup was destroyed on every blur, so
// that was the same as reading it fresh - a side panel is not. It stays open
// across navigations and tab switches, so the badge froze on whichever page
// happened to be open when the panel first appeared, and went on reporting
// "USGS - 13 tools" long after the user had moved somewhere else entirely.
let routeDebounce = null;
function refreshRoute() {
  clearTimeout(routeDebounce);
  routeDebounce = setTimeout(describeRoute, 150);
}
// Guarded, like the same three APIs are further up this file. They were not
// here, and an absent one throws - which stops every line after it running,
// describeRoute among them. That is a panel stuck on "checking page..." with
// its badge never filled in and its enable buttons never shown: not a
// failure of the check, a failure to ever reach it. Keeping the guards in one
// place and not the other was the whole bug.
if (chrome.tabs && chrome.tabs.onActivated) chrome.tabs.onActivated.addListener(refreshRoute);
if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    // A page announces itself many times while loading; only a settled URL or
    // a finished load changes the answer.
    if (!tab || !tab.active) return;
    if (info.url || info.status === "complete") refreshRoute();
  });
}
if (chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener(refreshRoute);
}

// Enter submits, which is what anyone types into a single-line box expects.
// Up and down walk previous instructions, as any prompt does - most asks here
// are a small edit of the last one.
on("smartInstruction", "keydown", (e) => {
  const field = e.target;
  if (e.key === "Enter") { document.getElementById("smartAsk").click(); return; }
  if (e.key === "ArrowUp" && recallAt + 1 < recallList.length) {
    e.preventDefault();
    field.value = recallList[++recallAt];
    field.setSelectionRange(field.value.length, field.value.length);
  } else if (e.key === "ArrowDown" && recallAt > -1) {
    e.preventDefault();
    field.value = --recallAt === -1 ? "" : recallList[recallAt];
  }
});

// "speed test" - the same twelve tokens, measured here and there.
//
// Every number the extension had about how fast the model runs was taken in
// the offscreen document, which is hidden, and Chrome throttles what it
// cannot see. One measurement cannot tell a slow machine from a throttled
// one; two can.
// The panel answers decisions while it is open.
//
// Measured: twelve tokens in 40.7s inside the offscreen document and 0.5s
// here, on the same machine and the same model. Chrome throttles what it
// cannot see, and every decision this extension made was made somewhere it
// could not see.
let panelModel = null;
async function panelModelModule() {
  if (!panelModel) panelModel = await import("./panel-model.js");
  return panelModel;
}
// Guarded, like everything else that reaches for a chrome API here. An
// extension page is not guaranteed every namespace, and an unguarded
// reference throws at the top level and takes every line after it with it -
// which is what the panel's own regression test exists to catch.
if (chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== "panel") return undefined;
  if (msg.type === "panelPing") {
    // Answering at all is the answer. This used to report
    // document.visibilityState, and a side panel calls itself hidden
    // whenever the focus is in the page - which is exactly when somebody is
    // asking it something. So the panel was open, fast, and never used: the
    // worker asked, was told "hidden", and went back to the throttled
    // document every time.
    //
    // Whether this window is actually quick is not a thing to reason about
    // from a flag. It is measured, by "speed test", and it came back
    // seventy-nine times quicker.
    sendResponse({ ok: true, visible: true });
    return undefined;
  }
  if (msg.type === "panelStep") {
    (async () => {
      try {
        const mod = await panelModelModule();
        const out = await mod.step(msg.model, msg.prompt, { timeoutMs: msg.timeoutMs },
          (t) => setStatus(`model loading - ${t}`, "load"));
        clearStatus();
        // Which model actually answered, from the window that answered. A
        // card naming the other one is how "use 3b" looked like it had not
        // taken for an hour.
        sendResponse({ ok: true, ...out, model: mod.status().model });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
  if (msg.type === "panelEmbed") {
    (async () => {
      try {
        const mod = await panelModelModule();
        sendResponse({ ok: true, vectors: await mod.embed(msg.texts || []) });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
  if (msg.type === "panelStatus") {
    (async () => {
      try {
        const mod = await panelModelModule();
        const st = mod.status();
        sendResponse({ ok: true, ...st, hasGpu: "gpu" in navigator });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
  if (msg.type === "panelRelease") {
    (async () => {
      try { const mod = await panelModelModule(); await mod.release(); } catch (e) { /* nothing held */ }
      sendResponse({ ok: true });
    })();
    return true;
  }
  return undefined;
});
}

async function runSpeedTest() {
  const chosen = (modelChoice && modelChoice.value) || globalThis.WC_DEFAULT_MODEL;
  const name = globalThis.WC_MODEL_NAME ? WC_MODEL_NAME(chosen) : chosen;
  // Written into the log, not just the status line. The status line is
  // transient by design and this can take minutes when the weights are not
  // loaded yet; a blank panel for two minutes is indistinguishable from
  // having swallowed the command.
  logEcho(`speed test: ${name}. This loads the model if it is not already`
    + " loaded, so it can take a few minutes the first time.");
  setStatus(`speed test: asking ${name} for twelve tokens in the background...`, "test");
  const there = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "llmBenchOffscreen" }, (r) => {
      void chrome.runtime.lastError;
      resolve(r || { ok: false, error: "no answer from the background" });
    });
  });
  // The hidden one is done with; let it go before measuring here, or this
  // measures two copies of the same model fighting over one card rather
  // than the card.
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "llmRelease" }, () => { void chrome.runtime.lastError; resolve(); });
  });
  setStatus(`speed test: now the same thing here, with the other copy unloaded...`, "test");
  let here = null;
  try {
    const mod = await import("./panel-bench.js");
    here = await mod.benchHere(chosen, (t) => setStatus(`speed test: ${t}`, "test"));
  } catch (e) {
    here = { error: String((e && e.message) || e) };
  }
  clearStatus();
  const rate = (x) => (x && x.decodePerS ? `${x.decodePerS.toFixed(1)} tok/s` : "unmeasured");
  const secs = (x) => (x && x.ms ? `${(x.ms / 1000).toFixed(1)}s` : "-");
  const lines = [
    `${name}, twelve tokens:`,
    `  hidden (offscreen):  ${there.ok ? `${secs(there)} · ${rate(there)}` : `failed - ${there.error}`}`,
    `  visible (this panel): ${here && !here.error ? `${secs(here)} · ${rate(here)}` : `failed - ${here && here.error}`}`,
  ];
  if (there.ok && here && here.ms) {
    const ratio = there.ms / here.ms;
    lines.push(ratio >= 3
      ? `  the visible window is ${ratio.toFixed(1)}x quicker - the offscreen document is being throttled,`
        + " and that is the whole problem rather than the model or the machine"
      : ratio <= 0.33
        ? `  the hidden one is quicker, which is not what anyone expected - worth reporting`
        : `  both about the same, so this machine is simply slow at running the model;`
          + " moving it would not help");
  }
  logEcho(lines.join("\n"));
}

on("smartAsk", "click", () => {
  const instruction = document.getElementById("smartInstruction").value.trim();
  if (!instruction) return;
  // Answered here, because it needs this window to be the visible one.
  if (/^\s*speed\s*test\s*$/i.test(instruction)) {
    document.getElementById("smartInstruction").value = "";
    runSpeedTest().catch((e) => logEcho(`speed test failed: ${(e && e.message) || e}`));
    return;
  }

  // No echo and no direct render: background.js records the ask immediately,
  // and the storage listener above draws it. Rendering here as well would
  // duplicate every entry, and would still lose anything that completed
  // after this popup was destroyed.
  chrome.runtime.sendMessage({ type: "smartAsk", instruction }, () => {
    // The response is deliberately ignored - it only arrives if this popup
    // survived long enough to receive it, which is exactly what cannot be
    // relied on. chrome.runtime.lastError is read to keep Chrome quiet.
    void chrome.runtime.lastError;
  });
  restoreHistory();
  // Written after the redraw, not before it. Nothing said anything here at
  // all: the first sign of life was the background's own progress message,
  // which cannot arrive until the model has been asked whether it is ready
  // and an offscreen document exists - so the first click looked like
  // nothing had happened and a second was needed to see the run. And a
  // status line written before restoreHistory is removed by it, since that
  // rebuilds the log this line lives in.
  setStatus(`working on "${instruction.slice(0, 50)}"...`);
});

// The comparison takes a while on a slow machine - one model decision per
// reworded ask - so it says so up front rather than looking stalled.
on("runBenchmark", "click", () => {
  setStatus("scoring both planners - one model decision per ask, this can take a few minutes...");
  chrome.runtime.sendMessage({ type: "benchmarkPlanners" }, (res) => {
    void chrome.runtime.lastError;
    clearStatus();
    if (res) logResult(res);
  });
});

// Same shape a model's tool call arrives in ({name, args}), typed by hand.
// Everything downstream of the model - findToolDef, argOrder remapping,
// invokeOnActiveTab, the bridge - runs exactly as it would for a real one.
on("runToolCall", "click", () => {
  const name = document.getElementById("toolName").value.trim();
  const argsText = document.getElementById("toolArgs").value.trim() || "{}";
  let args;
  try {
    args = JSON.parse(argsText);
  } catch (e) {
    log("bad arguments JSON: " + e.message);
    return;
  }
  if (!name) return;

  logEcho(`tool call: ${name}(${JSON.stringify(args)})`);
  chrome.runtime.sendMessage({ type: "runToolCall", toolCall: { name, args } }, (res) => {
    logResult(res);
  });
});

on("showContext", "click", () => {
  logEcho("building the context a model would see...");
  chrome.runtime.sendMessage({ type: "showContext" }, (res) => {
    if (chrome.runtime.lastError) {
      log("runtime error: " + chrome.runtime.lastError.message);
      return;
    }
    if (!res.ok) {
      log(JSON.stringify(res, null, 2));
      return;
    }
    log(`route: ${res.calledOn}\ntools: ${res.tools.join(", ")}\n\n${res.context || "(no context for this route)"}`);
  });
});

// offscreen.js reports model-download progress via a plain broadcast
// (no target field), so it reaches whichever popup happens to be open.
// Progress during the first, multi-gigabyte download is easy to mistake
// for a hang without this - closing the popup loses these, since a popup
// is torn down when it loses focus, but the download itself keeps going
// in the offscreen document regardless.
// One status line, replaced in place. These used to append a new <pre> per
// message, which stacked "model is thinking..." on top of the running entry
// and left the two overlapping mid-sentence. Progress during a multi-gigabyte
// download arrives many times a second, so appending was never right.
function setStatus(text, owner = "ask") {
  statusText = text;
  statusOwner = owner;
  let node = document.getElementById("modelStatus");
  if (!node) {
    node = el("div", "running", "");
    node.id = "modelStatus";
    const box = logEl();
    box.insertBefore(node, box.firstChild);
  }
  node.textContent = text;
}
function clearStatus() {
  statusText = null;
  statusOwner = null;
  const node = document.getElementById("modelStatus");
  if (node) node.remove();
}

if (chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "llmProgress") {
    setStatus("model loading - " + msg.text, "load");
    const ms = document.getElementById("modelState");
    if (ms) {
      ms.textContent = msg.text;
      // Unmistakable while it is happening. A five gigabyte download that
      // looks like nothing is the commonest way this appears broken.
      const done = /ready|finish|completed loading|using |smallest there is/i.test(msg.text);
      ms.className = done ? "modelstate" : "modelstate loading";
    }
  }
  if (msg.type === "llmGenerating") setStatus("model is thinking...");
  // Which step, not just that something is happening. "Still running" for a
  // minute reads the same as a hang.
  // done arrives with the answer, so the line comes down at the moment the
  // work stops rather than whenever something else happens to redraw.
  if (msg.type === "agentProgress") {
    if (msg.done) clearStatus();
    else if (msg.text) setStatus(msg.text);
  }
});

// Reflects and sets the opt-in. Off means background.js never downloads the
// model, never warms it on startup, and never reaches for it from Ask.
const localModelBox = document.getElementById("localModelEnabled");
chrome.storage.local.get("localModelEnabled", ({ localModelEnabled }) => {
  // Matches what the service worker actually does with this setting, which
  // treats anything but an explicit false as on. The box read "=== true", so
  // an unset setting showed the model switched off while it was planning
  // every instruction.
  localModelBox.checked = localModelEnabled !== false;
});

// Which model plans. Every step of an instruction is one turn of it, so this
// is most of what waiting for an instruction is, and the choice belongs to
// whoever is waiting rather than to a default nobody can reach.
const modelChoice = document.getElementById("modelChoice");
const modelState = document.getElementById("modelState");

// What is actually loaded, next to what is chosen. A picker you cannot
// confirm is worse than none: two switches to a smaller model looked like
// they had done nothing, because nothing on screen ever mentioned the model
// again until a card came back naming the old one.
function showModelState() {
  if (!modelState) return;
  chrome.runtime.sendMessage({ type: "llmStatus" }, (res) => {
    if (chrome.runtime.lastError || !res) { modelState.textContent = ""; return; }
    const want = modelChoice ? modelChoice.value : null;
    const have = res.model || null;
    const name = (id) => (globalThis.WC_MODEL_NAME ? WC_MODEL_NAME(id) : id);
    modelState.className = res.loading ? "modelstate loading" : "modelstate";
    modelState.textContent = !have ? "nothing loaded yet - the next instruction loads it"
      // The figure it is already at, not just that it is loading. A panel
      // opened part-way through a five gigabyte download used to say
      // "loading..." and sit there until the next broadcast happened to
      // arrive, which on a slow link is a long time to look stuck.
      : res.loading ? `loading ${name(have)} - ${res.progress || "starting"}`
      : have === want ? `${name(have)} is loaded and answering`
      : `${name(have)} is still loaded - ${name(want)} loads on the next instruction`;
    // And on the main line too, where somebody is actually looking.
    if (res.loading && res.progress) setStatus(`model loading - ${res.progress}`, "load");
  });
}

if (modelChoice) {
  // Built from the one list, so the panel cannot offer something the
  // offscreen document will refuse.
  for (const m of (globalThis.WC_MODELS || [])) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${m.name} - ${WC_MODEL_SIZE(m)}, ${m.note}`;
    modelChoice.appendChild(o);
  }
  chrome.storage.local.get("llmModelId", ({ llmModelId }) => {
    if (llmModelId && (globalThis.WC_MODEL_IDS || []).includes(llmModelId)) {
      modelChoice.value = llmModelId;
    } else {
      modelChoice.value = globalThis.WC_DEFAULT_MODEL || modelChoice.value;
    }
    showModelState();
    // And start loading it here, because the panel is what answers now.
    // Nothing else warms it any more: the service worker deliberately stops
    // short while this window is open, so that only one copy of the weights
    // is ever on the card.
    chrome.storage.local.get("localModelEnabled", async ({ localModelEnabled }) => {
      if (localModelEnabled === false) return;
      try {
        const mod = await panelModelModule();
        if (mod.status().ready || mod.status().loading) return;
        setStatus("model loading...", "load");
        mod.warm(modelChoice.value, (t) => {
          setStatus(`model loading - ${t}`, "load");
          const ms = document.getElementById("modelState");
          if (ms) { ms.textContent = t; ms.className = "modelstate loading"; }
        });
      } catch (e) { /* it loads on the first instruction instead */ }
    });
  });
  modelChoice.addEventListener("change", () => {
    const chosen = modelChoice.options[modelChoice.selectedIndex].text;
    modelState.textContent = `switching to ${chosen.split(" - ")[0]}...`;
    // Chosen deliberately, so it is no longer a demotion - and picking the
    // one that was stepped down from is how somebody asks to try it again.
    chrome.storage.local.set({ llmModelId: modelChoice.value,
      }, () => {
      // The offscreen document keeps the weights it loaded, so it has to be
      // let go of before another model can take its place. Then it is warmed
      // straight away rather than on the next instruction: a 5GB download
      // that starts silently the next time somebody asks something looks
      // exactly like an instruction that hung.
      chrome.runtime.sendMessage({ type: "llmSwitchModel", warm: true }, () => {
        void chrome.runtime.lastError;
        showModelState();
      });
      // Loaded here too, for the same reason: this window is the one that
      // will answer with it.
      panelModelModule().then((mod) => {
        mod.warm(modelChoice.value, (t) => {
          setStatus(`model loading - ${t}`, "load");
          const ms = document.getElementById("modelState");
          if (ms) { ms.textContent = t; ms.className = "modelstate loading"; }
        });
      }).catch(() => { /* it loads on the first instruction instead */ });
      logEcho(`model set to ${chosen} - loading now, watch the line under the picker`);
    });
  });
}
localModelBox.addEventListener("change", () => {
  chrome.storage.local.set({ localModelEnabled: localModelBox.checked }, () => {
    describeRoute(); // the model chip appears or disappears with the switch
    if (localModelBox.checked) {
      // Started here, rather than by the first instruction. The default is
      // five gigabytes: beginning that download inside somebody's first ask
      // makes the first ask look broken, and the whole point of turning it
      // on in advance is that it is ready when it is wanted.
      chrome.runtime.sendMessage({ type: "llmSwitchModel", warm: true }, () => {
        void chrome.runtime.lastError;
        showModelState();
      });
    }
    logEcho(localModelBox.checked
      ? "local model enabled - loading now, watch the line under the picker"
      : "local model disabled - Ask will use the instant paths only");
  });
});

// The API-key field and the hosted-model button are gone. Everything the
// panel can do is decided by the local model in the offscreen document, so
// there is no key to save and nothing to send anywhere.

