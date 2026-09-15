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
  const card = el("div", "card");

  const head = el("div", "card-head");
  head.appendChild(el("div", "card-title", display.title));
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

  // The exact JSON stays one click away - this is still a debugging tool.
  const details = el("details", "raw");
  details.appendChild(el("summary", null, "raw response"));
  details.appendChild(el("pre", null, JSON.stringify(raw, null, 2)));
  card.appendChild(details);

  append(card);
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

document.getElementById("smartAsk").addEventListener("click", () => {
  const instruction = document.getElementById("smartInstruction").value.trim();
  if (!instruction) return;

  logEcho(`ask: "${instruction}"`);
  chrome.runtime.sendMessage({ type: "smartAsk", instruction }, (res) => {
    logResult(res);
  });
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
