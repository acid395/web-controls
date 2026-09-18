const logEl = () => document.getElementById("log");

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
        chrome.runtime.sendMessage({ type: "runToolCall", toolCall: choice.call }, (res) => {
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

// Past instructions, newest first, for up-arrow recall.
let recallList = [];
let recallAt = -1;

function restoreHistory() {
  chrome.runtime.sendMessage({ type: "askHistory" }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    const box = logEl();
    box.textContent = "";
    renderedIds = new Set();
    recallList = res.history.map((h) => h.instruction).filter(Boolean).reverse();
    recallAt = -1;

    if (!res.history.length) {
      const empty = el("div", "empty");
      empty.appendChild(el("div", null, "Nothing asked yet."));
      empty.appendChild(el("div", null, "Try one of the examples above, or describe what you want in your own words."));
      box.appendChild(empty);
      return;
    }
    const last = res.history.length - 1;
    res.history.forEach((entry, i) => {
      renderEntry(entry, { collapsed: i !== last });
      if (entry.status !== "running") renderedIds.add(entry.id);
    });
    box.scrollTop = box.scrollHeight;
  });
}

// A result that arrives while the popup happens to be open should appear
// without waiting for a reopen.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.askHistory) return;
  const next = changes.askHistory.newValue || [];
  const unseen = next.filter((e) => e.status !== "running" && !renderedIds.has(e.id));
  if (!unseen.length) return;
  restoreHistory();
});

document.addEventListener("DOMContentLoaded", restoreHistory);

document.getElementById("clearLog").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clearHistory" }, () => {
    logEl().textContent = "";
    renderedIds = new Set();
  });
});

// chrome.permissions.request() only counts as triggered by a real click if
// there's no await before it in the same handler - an await, even a fast
// one, can cross a task boundary Chrome uses to decide "was this a genuine
// user gesture." So the tab's URL is looked up once when the popup opens
// (there's nothing else competing for the gesture at that point), cached,
// and the click handler below calls chrome.permissions.request as its
// first and only step, synchronously, using that cached value.
let currentOriginPattern = null;
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.url) return;
  try {
    const u = new URL(tab.url);
    currentOriginPattern = `${u.protocol}//${u.hostname}/*`;
  } catch (e) { /* not a http(s) page, e.g. chrome:// - leave it null */ }
});

document.getElementById("enable").addEventListener("click", () => {
  const status = document.getElementById("enableStatus");
  if (!currentOriginPattern) {
    status.textContent = "couldn't read this tab's URL (not a normal http/https page?)";
    return;
  }
  chrome.permissions.request({ origins: [currentOriginPattern] }, (granted) => {
    status.textContent = granted
      ? `enabled on ${currentOriginPattern}. Try Call with function "inventory" now.`
      : `permission denied for ${currentOriginPattern}`;
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
  for (const text of (EXAMPLES[route] || EXAMPLES.GENERIC).slice(0, 4)) {
    const chip = el("button", "chip", text);
    chip.addEventListener("click", () => {
      const field = document.getElementById("smartInstruction");
      field.value = text;
      field.focus();
      document.getElementById("smartAsk").click();
    });
    box.appendChild(chip);
  }
}

function describeRoute() {
  chrome.runtime.sendMessage({ type: "capabilities" }, (res) => {
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
chrome.tabs.onActivated.addListener(refreshRoute);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // A page announces itself many times while loading; only a settled URL or
  // a finished load changes the answer.
  if (!tab || !tab.active) return;
  if (info.url || info.status === "complete") refreshRoute();
});
chrome.windows.onFocusChanged.addListener(refreshRoute);

// Enter submits, which is what anyone types into a single-line box expects.
// Up and down walk previous instructions, as any prompt does - most asks here
// are a small edit of the last one.
document.getElementById("smartInstruction").addEventListener("keydown", (e) => {
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

document.getElementById("smartAsk").addEventListener("click", () => {
  const instruction = document.getElementById("smartInstruction").value.trim();
  if (!instruction) return;

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
});

// Same shape a model's tool call arrives in ({name, args}), typed by hand.
// Everything downstream of the model - findToolDef, argOrder remapping,
// invokeOnActiveTab, the bridge - runs exactly as it would for a real one.
document.getElementById("runToolCall").addEventListener("click", () => {
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

document.getElementById("showContext").addEventListener("click", () => {
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

document.getElementById("call").addEventListener("click", () => {
  const fn = document.getElementById("fn").value.trim();
  const argsText = document.getElementById("args").value.trim() || "[]";
  let args;
  try {
    args = JSON.parse(argsText);
  } catch (e) {
    log("bad arguments JSON: " + e.message);
    return;
  }

  // Which manifest (USGS vs GENERIC) actually runs is decided by
  // background.js's ROUTES, based on the active tab's URL, not known here.
  // The response's calledOn field says which one it was.
  logEcho(`-> ${fn}(${JSON.stringify(args)})`);
  chrome.runtime.sendMessage({ type: "invoke", fn, args }, (res) => {
    logResult(res);
  });
});

// offscreen.js reports model-download progress via a plain broadcast
// (no target field), so it reaches whichever popup happens to be open.
// Progress during the first, multi-gigabyte download is easy to mistake
// for a hang without this - closing the popup loses these, since a popup
// is torn down when it loses focus, but the download itself keeps going
// in the offscreen document regardless.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "llmProgress") log("model loading: " + msg.text);
  if (msg.type === "llmGenerating") log("model is thinking...");
});

// Reflects and sets the opt-in. Off means background.js never downloads the
// model, never warms it on startup, and never reaches for it from Ask.
const localModelBox = document.getElementById("localModelEnabled");
chrome.storage.local.get("localModelEnabled", ({ localModelEnabled }) => {
  localModelBox.checked = localModelEnabled === true;
});
localModelBox.addEventListener("change", () => {
  chrome.storage.local.set({ localModelEnabled: localModelBox.checked }, () => {
    logEcho(localModelBox.checked
      ? "local model enabled - it will start downloading/loading in the background"
      : "local model disabled - Ask will use the instant paths only");
  });
});

document.getElementById("llmTest").addEventListener("click", () => {
  const prompt = document.getElementById("prompt").value.trim();
  logEcho(`llm test: "${prompt}" (first run downloads the model, can take a while)`);
  chrome.runtime.sendMessage({ type: "llmPing", prompt }, (res) => {
    logResult(res);
  });
});

document.getElementById("llmAsk").addEventListener("click", () => {
  const instruction = document.getElementById("llmInstruction").value.trim();
  if (!instruction) return;

  logEcho(`ask webllm: "${instruction}"`);
  chrome.runtime.sendMessage({ type: "llmPlan", instruction }, (res) => {
    logResult(res);
  });
});

// Shows "(key saved)" as a placeholder rather than the real key, so the
// field doesn't need to hold and display the actual secret every time the
// popup reopens - chrome.storage.local already has it.
chrome.storage.local.get("geminiApiKey", ({ geminiApiKey }) => {
  if (geminiApiKey) document.getElementById("geminiKey").placeholder = "(key saved)";
});

document.getElementById("saveKey").addEventListener("click", () => {
  const key = document.getElementById("geminiKey").value.trim();
  if (!key) {
    log("no key entered");
    return;
  }
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    log("Gemini API key saved.");
    document.getElementById("geminiKey").value = "";
    document.getElementById("geminiKey").placeholder = "(key saved)";
  });
});

document.getElementById("geminiAsk").addEventListener("click", () => {
  const instruction = document.getElementById("geminiInstruction").value.trim();
  if (!instruction) return;

  logEcho(`ask gemini: "${instruction}"`);
  chrome.runtime.sendMessage({ type: "geminiPlan", instruction }, (res) => {
    logResult(res);
  });
});

document.getElementById("ask").addEventListener("click", () => {
  const instruction = document.getElementById("instruction").value.trim();
  if (!instruction) return;

  logEcho(`ask: "${instruction}"`);
  chrome.runtime.sendMessage({ type: "ask", instruction }, (res) => {
    logResult(res);
  });
});
