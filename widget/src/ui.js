/* ui.js - the launcher and the panel.
 *
 * Everything lives in a closed shadow root, for two reasons that are really
 * one: the host app's CSS cannot reach in and restyle it, and the agent
 * cannot reach in and drive it. GENERIC walks open shadow roots looking for
 * controls; a closed one has no shadowRoot to walk, so the widget's own
 * buttons never turn up as "controls on this page" - which in an extension
 * was never a question, because the panel was another window.
 */
const WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --accent: #1a6fd1; --accent-ink: #fff;
  --bg: #ffffff; --bg-2: #f4f6f9; --ink: #16202c; --ink-2: #566275; --line: #dde3ea;
  --good: #1d7f4e; --bad: #b42318; --warn: #9a6200;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
}
@media (prefers-color-scheme: dark) {
  .root:not(.light) { --bg: #151a21; --bg-2: #1e252e; --ink: #e6ebf1; --ink-2: #9aa6b4; --line: #2c3540; }
}
.root.dark { --bg: #151a21; --bg-2: #1e252e; --ink: #e6ebf1; --ink-2: #9aa6b4; --line: #2c3540; }
.launcher {
  position: fixed; z-index: 2147483646; width: 52px; height: 52px; border-radius: 50%;
  border: 0; background: var(--accent); color: var(--accent-ink); cursor: pointer;
  box-shadow: 0 6px 20px rgba(0,0,0,.22); display: grid; place-items: center;
}
.launcher:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.launcher svg { width: 24px; height: 24px; }
.panel {
  position: fixed; z-index: 2147483647; width: min(400px, calc(100vw - 24px));
  height: min(600px, calc(100vh - 100px)); background: var(--bg); color: var(--ink);
  border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,.25);
  display: flex; flex-direction: column; overflow: hidden;
}
.panel[hidden] { display: none; }
.bottom-right .launcher { right: 20px; bottom: 20px; } .bottom-right .panel { right: 12px; bottom: 84px; }
.bottom-left .launcher { left: 20px; bottom: 20px; } .bottom-left .panel { left: 12px; bottom: 84px; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
header .title { font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { border: 0; background: transparent; color: var(--ink-2); cursor: pointer; padding: 4px 6px; border-radius: 6px; font: inherit; }
.icon-btn:hover { background: var(--bg-2); color: var(--ink); }
.model { padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--bg-2); font-size: 12.5px; color: var(--ink-2); }
.model-row { display: flex; align-items: center; gap: 8px; }
.model-row .state { flex: 1; min-width: 0; }
.model select { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 2px 4px; max-width: 150px; }
.btn { font: inherit; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-ink); border-radius: 7px; padding: 3px 10px; cursor: pointer; }
.btn.quiet { background: transparent; color: var(--accent); }
.btn:disabled { opacity: .5; cursor: default; }
.bar { height: 4px; background: var(--line); border-radius: 2px; margin-top: 6px; overflow: hidden; }
.bar > div { height: 100%; background: var(--accent); width: 0; transition: width .3s; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: var(--ink-2); }
.dot.ready { background: var(--good); } .dot.loading { background: var(--warn); } .dot.bad { background: var(--bad); }
.log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.empty { color: var(--ink-2); font-size: 13px; }
.empty .ex { display: block; text-align: left; width: 100%; margin-top: 6px; font: inherit; color: var(--ink); background: var(--bg-2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; cursor: pointer; }
.echo { align-self: flex-end; max-width: 85%; background: var(--accent); color: var(--accent-ink); padding: 6px 10px; border-radius: 12px 12px 2px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 11px; background: var(--bg); }
.card.running { color: var(--ink-2); }
.card.failed { border-color: color-mix(in srgb, var(--bad) 40%, var(--line)); }
.card-title { font-weight: 600; overflow-wrap: anywhere; }
.card-sub { color: var(--ink-2); font-size: 13px; margin-top: 2px; overflow-wrap: anywhere; }
.answer { margin-top: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; margin-top: 8px; }
.stat { background: var(--bg-2); border-radius: 7px; padding: 5px 7px; }
.stat-label { font-size: 11.5px; color: var(--ink-2); } .stat-value { font-weight: 600; }
.rows { margin-top: 8px; border-top: 1px solid var(--line); }
.row { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.row-name { min-width: 0; overflow-wrap: anywhere; } .row-meta { color: var(--ink-2); margin-left: 6px; font-size: 12px; }
.row-value { text-align: right; font-weight: 500; }
.caveat, .checked { margin-top: 8px; font-size: 12.5px; color: var(--ink-2); }
.checked-item::before { content: "· "; }
.choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.choice { font: inherit; font-size: 13px; border: 1px solid var(--line); background: var(--bg-2); color: var(--ink); border-radius: 7px; padding: 4px 8px; cursor: pointer; text-align: left; }
.choice-hint { display: block; color: var(--ink-2); font-size: 11.5px; }
.card-foot { margin-top: 8px; display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--ink-2); }
.acts { display: flex; gap: 6px; margin-top: 6px; }
.acts button { font: inherit; font-size: 12px; border: 1px solid var(--line); background: transparent; color: var(--ink-2); border-radius: 6px; padding: 1px 7px; cursor: pointer; }
details.past { border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; }
details.past summary { cursor: pointer; display: flex; gap: 8px; list-style: none; }
details.past summary::-webkit-details-marker { display: none; }
.past-q { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.past-a { color: var(--ink-2); font-size: 12px; white-space: nowrap; }
details.past .card { margin-top: 8px; }
form { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); }
textarea { flex: 1; resize: none; font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 9px; padding: 7px 9px; height: 40px; max-height: 120px; }
textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
.spin { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; margin-right: 6px; vertical-align: -1px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } .bar > div { transition: none; } }
`;

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 10h6M9 13.5h4"/></svg>`;

function createWidgetUI({ send, modelHost, storage, options }) {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  };

  const host = document.createElement("div");
  host.setAttribute("data-web-controls-widget", "");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  const root = el("div", `root ${options.position === "bottom-left" ? "bottom-left" : "bottom-right"}`);
  if (options.theme === "dark") root.classList.add("dark");
  if (options.theme === "light") root.classList.add("light");
  if (options.accent) root.style.setProperty("--accent", options.accent);
  shadow.appendChild(root);

  const launcher = el("button", "launcher");
  launcher.type = "button";
  launcher.innerHTML = ICON;
  launcher.setAttribute("aria-label", `Open ${options.title}`);
  launcher.setAttribute("aria-expanded", "false");
  root.appendChild(launcher);

  const panel = el("section", "panel");
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", options.title);
  root.appendChild(panel);

  const header = el("header");
  header.appendChild(el("div", "title", options.title));
  const clearBtn = el("button", "icon-btn", "Clear");
  clearBtn.type = "button";
  clearBtn.title = "Clear the history";
  const closeBtn = el("button", "icon-btn", "✕");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  header.append(clearBtn, closeBtn);
  panel.appendChild(header);

  // --- the model strip -----------------------------------------------------
  const modelBox = el("div", "model");
  const modelRow = el("div", "model-row");
  const dot = el("span", "dot");
  const stateText = el("span", null, "");
  const state = el("div", "state");
  state.append(dot, stateText);
  const picker = document.createElement("select");
  picker.setAttribute("aria-label", "Model");
  const models = (globalThis.WC_MODELS || []).filter((m) => !options.models || options.models.includes(m.id));
  for (const m of models) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${m.name} (~${(m.vramMB / 1024).toFixed(1)} GB)`;
    picker.appendChild(o);
  }
  const loadBtn = el("button", "btn", "Load model");
  loadBtn.type = "button";
  modelRow.append(state, picker, loadBtn);
  const bar = el("div", "bar");
  const fill = el("div");
  bar.appendChild(fill);
  bar.hidden = true;
  modelBox.append(modelRow, bar);
  panel.appendChild(modelBox);

  const log = el("div", "log");
  log.setAttribute("aria-live", "polite");
  panel.appendChild(log);

  const form = el("form");
  const input = el("textarea");
  input.placeholder = options.placeholder;
  input.setAttribute("aria-label", "Ask about this page");
  const sendBtn = el("button", "btn", "Ask");
  sendBtn.type = "submit";
  form.append(input, sendBtn);
  panel.appendChild(form);

  // --- model state -----------------------------------------------------------
  const chosenModel = async () => {
    const got = await storage.get("llmModelId");
    const id = got.llmModelId;
    return id && models.some((m) => m.id === id) ? id : (models[0] && models[0].id);
  };
  const nameOf = (id) => (globalThis.WC_MODEL_NAME ? globalThis.WC_MODEL_NAME(id) : id);

  function drawModel() {
    const s = modelHost.status();
    bar.hidden = !s.loading;
    if (s.loading) fill.style.width = `${Math.round((s.fraction || 0) * 100)}%`;
    loadBtn.hidden = s.ready || s.loading;
    picker.disabled = s.loading;
    if (!s.hasGpu) {
      dot.className = "dot bad";
      stateText.textContent = "This browser has no WebGPU, so only the page's own controls are used";
      loadBtn.disabled = true;
    } else if (s.ready) {
      dot.className = "dot ready";
      stateText.textContent = `${nameOf(s.model)} ready${s.where ? `, in ${s.where}` : ""}`;
    } else if (s.loading) {
      dot.className = "dot loading";
      const pct = typeof s.fraction === "number" ? ` ${Math.round(s.fraction * 100)}%` : "";
      stateText.textContent = `Loading${pct}${s.progress ? ` · ${s.progress.slice(0, 60)}` : ""}`;
    } else if (s.error) {
      dot.className = "dot bad";
      stateText.textContent = `Model failed: ${s.error.slice(0, 90)}`;
    } else {
      dot.className = "dot";
      stateText.textContent = "Model not loaded. Simple requests still work.";
    }
    return s;
  }
  let poll = null;
  const startPolling = () => {
    if (poll) return;
    poll = setInterval(() => {
      const s = drawModel();
      if (!s.loading && panel.hidden) { clearInterval(poll); poll = null; }
    }, 700);
  };
  async function loadModel() {
    modelHost.load(await chosenModel());
    drawModel();
    startPolling();
  }
  loadBtn.addEventListener("click", loadModel);
  picker.addEventListener("change", async () => {
    const was = modelHost.status();
    await storage.set({ llmModelId: picker.value });
    if (was.ready || was.loading) await loadModel();
    else drawModel();
  });

  // --- cards ---------------------------------------------------------------
  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  function buildCard(display, raw) {
    const card = el("div", "card");
    card.appendChild(el("div", "card-title", display.title || "Done"));
    if (display.subtitle) card.appendChild(el("div", "card-sub", display.subtitle));
    if (display.answer) card.appendChild(el("div", "answer", display.answer));
    if (display.stats && display.stats.length) {
      const stats = el("div", "stats");
      for (const s of display.stats) {
        const box = el("div", "stat");
        box.append(el("div", "stat-label", s.label), el("div", "stat-value", s.value));
        stats.appendChild(box);
      }
      card.appendChild(stats);
    }
    if (display.caveat) card.appendChild(el("div", "caveat", display.caveat));
    if (display.checked && display.checked.length) {
      const box = el("div", "checked");
      box.appendChild(el("div", null, "Checked:"));
      for (const item of display.checked) box.appendChild(el("div", "checked-item", item));
      card.appendChild(box);
    }
    if (display.choices && display.choices.length) {
      const box = el("div", "choices");
      for (const choice of display.choices) {
        const b = el("button", "choice");
        b.type = "button";
        b.appendChild(el("span", null, choice.label));
        if (choice.hint) b.appendChild(el("span", "choice-hint", choice.hint));
        b.addEventListener("click", () => run(choice.label,
          { type: "runToolCall", toolCall: choice.call, label: choice.label }));
        box.appendChild(b);
      }
      card.appendChild(box);
    }
    if (display.rows && display.rows.length) {
      const rows = el("div", "rows");
      for (const r of display.rows.slice(0, 40)) {
        const row = el("div", "row");
        const name = el("div", "row-name", r.name);
        if (r.meta) name.appendChild(el("span", "row-meta", r.meta));
        row.append(name, el("div", "row-value", r.value));
        rows.appendChild(row);
      }
      card.appendChild(rows);
    }
    if (display.note || display.source) {
      const foot = el("div", "card-foot");
      foot.append(el("span", null, display.note || ""), el("span", null, display.source || ""));
      card.appendChild(foot);
    }
    const acts = el("div", "acts");
    const changes = raw && raw.verified && raw.verified.changes;
    if (changes && changes.some((c) => c.was !== undefined)) {
      const undo = el("button", null, "Undo");
      undo.type = "button";
      undo.addEventListener("click", () => run("undo that",
        { type: "runToolCall", toolCall: { name: "pageUndo", args: { changes } } }));
      acts.appendChild(undo);
    }
    const copy = el("button", null, "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => {
      const lines = [display.title, display.subtitle, display.answer]
        .concat((display.stats || []).map((x) => `${x.label}: ${x.value}`))
        .concat((display.rows || []).map((r) => [r.name, r.value, r.meta].filter(Boolean).join("  ")))
        .filter(Boolean);
      navigator.clipboard.writeText(lines.join("\n")).then(
        () => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1200); },
        () => { copy.textContent = "Couldn't copy"; });
    });
    acts.appendChild(copy);
    card.appendChild(acts);
    return card;
  }

  function cardFor(res) {
    if (!res) return buildCard({ title: "No answer", subtitle: "The agent did not reply." }, null);
    if (res.display) return buildCard(res.display, res);
    if (res.result && res.result.display) return buildCard(res.result.display, res);
    if (res.error || res.ok === false) {
      const c = buildCard({ title: "That did not work",
        subtitle: String(res.error || "no reason given").slice(0, 300),
        caveat: res.hint || "" }, res);
      c.classList.add("failed");
      return c;
    }
    return buildCard({ title: "Done" }, res);
  }

  // --- history -------------------------------------------------------------
  // Asks that were running when the page went away cannot finish: the agent
  // was in the page. Said plainly rather than left spinning forever.
  const startedAt = Date.now();
  function drawEntry(entry, collapsed) {
    let body;
    if (entry.status === "running") {
      const stale = !entry.at || new Date(entry.at).getTime() < startedAt;
      body = buildCard(stale
        ? { title: "Interrupted", subtitle: "The page changed before this finished. Ask again to carry on from here." }
        : { title: "Still running" }, null);
    } else {
      body = cardFor(entry);
    }
    if (!collapsed) {
      log.append(el("div", "echo", entry.instruction), body);
      return;
    }
    const box = el("details", "past");
    const summary = el("summary");
    const gist = entry.error ? "no match" : (entry.display && (entry.display.title || entry.display.subtitle)) || "done";
    summary.append(el("span", "past-q", entry.instruction), el("span", "past-a", String(gist).slice(0, 30)));
    box.append(summary, body);
    log.appendChild(box);
  }

  function drawEmpty() {
    const empty = el("div", "empty");
    empty.appendChild(el("div", null,
      "Ask me to do something on this page, or to explain what it shows."));
    for (const ex of options.suggestions || []) {
      const b = el("button", "ex", ex);
      b.type = "button";
      b.addEventListener("click", () => ask(ex));
      empty.appendChild(b);
    }
    log.appendChild(empty);
  }

  let recall = [];
  let recallAt = -1;
  // The redraw in flight, if any. Opening the panel redraws the history,
  // and an ask made in the same moment - a suggestion, or ask() from the
  // site's own code - was having its running card wiped by that redraw
  // when it landed, so the answer went to a card no longer on screen and
  // the panel said "still running" forever.
  let drawing = Promise.resolve();
  function drawHistory() {
    drawing = drawing.then(redraw, redraw);
    return drawing;
  }
  async function redraw() {
    const res = await send({ type: "askHistory" }).catch(() => null);
    log.textContent = "";
    const history = (res && res.ok && res.history) || [];
    recall = history.map((h) => h.instruction).filter(Boolean).reverse();
    if (!history.length) { drawEmpty(); return; }
    history.forEach((entry, i) => drawEntry(entry, i !== history.length - 1));
    scrollDown();
  }

  // --- asking --------------------------------------------------------------
  let busy = false;
  let runningCard = null;
  async function run(echo, message) {
    if (busy) return;
    busy = true;
    sendBtn.disabled = true;
    await drawing;
    const empty = log.querySelector(".empty");
    if (empty) empty.remove();
    log.appendChild(el("div", "echo", echo));
    runningCard = el("div", "card running");
    const line = el("div");
    line.append(el("span", "spin"), document.createTextNode("Working on it…"));
    runningCard.appendChild(line);
    log.appendChild(runningCard);
    scrollDown();
    let res;
    try { res = await send(message); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
    const card = cardFor(res);
    runningCard.replaceWith(card);
    runningCard = null;
    busy = false;
    sendBtn.disabled = false;
    scrollDown();
    drawModel();
    return res;
  }
  function ask(text) {
    const instruction = String(text || "").trim();
    if (!instruction) return Promise.resolve(null);
    recall.unshift(instruction);
    recallAt = -1;
    return run(instruction, { type: "smartAsk", instruction });
  }

  function progress(m) {
    if (!m || !runningCard) return;
    let text = null;
    if (m.type === "agentProgress" && m.text) text = m.text;
    if (m.type === "llmGenerating") text = "The model is thinking…";
    if (m.type === "llmProgress" && m.text) text = `Loading the model: ${m.text}`;
    if (!text) return;
    const line = el("div");
    line.append(el("span", "spin"), document.createTextNode(String(text).slice(0, 160)));
    runningCard.replaceChildren(line);
  }

  // --- open and close --------------------------------------------------------
  const OPEN_KEY = `${options.storageKey}:open`;
  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", `${open ? "Close" : "Open"} ${options.title}`);
    try { sessionStorage.setItem(OPEN_KEY, open ? "1" : ""); } catch (e) { /* not remembered */ }
    if (open) {
      drawHistory();
      chosenModel().then((id) => { if (id) picker.value = id; drawModel(); });
      startPolling();
      if (options.autoLoad && !modelHost.status().ready && !modelHost.status().loading) loadModel();
      setTimeout(() => input.focus(), 0);
    }
  }
  const toggle = () => setOpen(panel.hidden);
  launcher.addEventListener("click", toggle);
  closeBtn.addEventListener("click", () => { setOpen(false); launcher.focus(); });
  clearBtn.addEventListener("click", async () => {
    await send({ type: "clearHistory" }).catch(() => {});
    drawHistory();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    ask(text);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === "ArrowUp" && !input.value.includes("\n") && recall.length) {
      e.preventDefault();
      recallAt = Math.min(recallAt + 1, recall.length - 1);
      input.value = recall[recallAt];
    }
    if (e.key === "Escape") { setOpen(false); launcher.focus(); }
  });
  if (options.hotkey !== false) {
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Space") { e.preventDefault(); toggle(); }
    });
  }

  (document.body || document.documentElement).appendChild(host);
  // Open again after a navigation if it was open before: on a multi-page
  // site every link is one.
  try { if (sessionStorage.getItem(OPEN_KEY) === "1") setOpen(true); } catch (e) { /* closed */ }

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle,
    ask,
    progress,
    loadModel,
    destroy: () => { if (poll) clearInterval(poll); host.remove(); },
    host,
  };
}
