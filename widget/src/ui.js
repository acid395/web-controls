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
  --accent-soft: color-mix(in srgb, var(--accent) 10%, transparent);
  --bg: #ffffff; --bg-2: #f5f7fa; --ink: #16202c; --ink-2: #5b6778; --line: #e3e8ee;
  --good: #1d7f4e; --bad: #b42318; --warn: #a15c00;
  --shadow: 0 1px 2px rgba(16,24,40,.06), 0 12px 32px rgba(16,24,40,.14);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .root:not(.light) { --bg: #161b22; --bg-2: #1f262f; --ink: #e6ebf1; --ink-2: #9aa6b4; --line: #2d3641;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.5); }
}
.root.dark { --bg: #161b22; --bg-2: #1f262f; --ink: #e6ebf1; --ink-2: #9aa6b4; --line: #2d3641;
  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.5); }
button { font: inherit; }

/* The launcher: the logo as it was, with a little lift. */
.launcher {
  position: fixed; z-index: 2147483646; width: 56px; height: 56px; border-radius: 50%;
  border: 0; background: var(--accent); color: var(--accent-ink); cursor: pointer;
  box-shadow: 0 6px 20px rgba(16,24,40,.24); display: grid; place-items: center;
  transition: transform .15s ease, box-shadow .15s ease;
}
.launcher:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(16,24,40,.28); }
.launcher:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.launcher svg { width: 26px; height: 26px; }

/* The panel. */
.panel {
  position: fixed; z-index: 2147483647; width: min(392px, calc(100vw - 24px));
  height: min(620px, calc(100vh - 104px)); background: var(--bg); color: var(--ink);
  border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow);
  display: flex; flex-direction: column; overflow: hidden;
  animation: wc-open .18s ease-out;
}
.panel[hidden] { display: none; }
@keyframes wc-open { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
.bottom-right .launcher { right: 20px; bottom: 20px; } .bottom-right .panel { right: 16px; bottom: 88px; transform-origin: bottom right; }
.bottom-left .launcher { left: 20px; bottom: 20px; } .bottom-left .panel { left: 16px; bottom: 88px; transform-origin: bottom left; }

header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px 16px; }
.badge { flex: none; width: 32px; height: 32px; border-radius: 10px; background: var(--accent); color: var(--accent-ink);
  display: grid; place-items: center; }
.badge svg { width: 18px; height: 18px; }
.titles { flex: 1; min-width: 0; }
.title { font-weight: 650; font-size: 15px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subtitle { font-size: 12px; color: var(--ink-2); line-height: 1.3; }
.icon-btn { border: 0; background: transparent; color: var(--ink-2); cursor: pointer; padding: 6px 8px; border-radius: 8px;
  font-size: 13px; line-height: 1; }
.icon-btn:hover { background: var(--bg-2); color: var(--ink); }
.icon-btn:focus-visible, .btn:focus-visible, .ex:focus-visible, .choice:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.icon-btn.close { font-size: 16px; padding: 6px 9px; }

/* The model strip: what is loaded, which model, and the button to load it. */
.model { margin: 0 14px; padding: 10px 12px; border-radius: 12px; background: var(--bg-2); font-size: 12.5px; color: var(--ink-2); }
.model[hidden] { display: none; }
.state { display: flex; align-items: flex-start; gap: 8px; line-height: 1.4; }
.model-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.model select { flex: 1; min-width: 0; font: inherit; font-size: 13px; color: var(--ink); background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; height: 32px; }
.model select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn { flex: none; font-size: 13px; font-weight: 600; border: 0; background: var(--accent); color: var(--accent-ink);
  border-radius: 8px; padding: 0 12px; height: 32px; cursor: pointer; transition: filter .15s ease; }
.btn:hover { filter: brightness(1.08); }
.btn[hidden] { display: none; }
.btn:disabled { opacity: .45; cursor: default; filter: none; }
.bar { height: 4px; background: var(--line); border-radius: 2px; margin-top: 8px; overflow: hidden; }
.bar[hidden] { display: none; }
.bar > div { height: 100%; background: var(--accent); width: 0; transition: width .3s; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: #9aa6b4; }
.dot.ready { background: var(--good); } .dot.loading { background: var(--warn); } .dot.bad { background: var(--bad); }

/* The conversation. */
.log { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
.empty { color: var(--ink-2); font-size: 13.5px; }
.empty .lead { margin-bottom: 10px; }
.empty .try { font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; margin: 14px 0 6px; }
.empty .ex { display: block; text-align: left; width: 100%; margin-top: 6px; font-size: 13.5px; color: var(--ink);
  background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; cursor: pointer;
  transition: border-color .15s ease, background .15s ease; }
.empty .ex:hover { border-color: var(--accent); background: var(--accent-soft); }
.echo { align-self: flex-end; max-width: 85%; background: var(--accent); color: var(--accent-ink); padding: 8px 12px;
  border-radius: 14px 14px 4px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 12px 13px; background: var(--bg);
  box-shadow: 0 1px 2px rgba(16,24,40,.04); }
.card.running { color: var(--ink-2); background: var(--bg-2); border-color: transparent; box-shadow: none; }
.card.failed { border-color: color-mix(in srgb, var(--bad) 35%, var(--line)); background: color-mix(in srgb, var(--bad) 4%, var(--bg)); }
.card-title { font-weight: 600; overflow-wrap: anywhere; line-height: 1.35; }
.card-sub { color: var(--ink-2); font-size: 13px; margin-top: 3px; overflow-wrap: anywhere; }
.answer { margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 6px; margin-top: 10px; }
.stat { background: var(--bg-2); border-radius: 8px; padding: 6px 8px; }
.stat-label { font-size: 11.5px; color: var(--ink-2); } .stat-value { font-weight: 600; }
.rows { margin-top: 10px; border-top: 1px solid var(--line); }
.row { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.row-name { min-width: 0; overflow-wrap: anywhere; } .row-meta { color: var(--ink-2); margin-left: 6px; font-size: 12px; }
.row-value { text-align: right; font-weight: 500; }
.caveat, .checked { margin-top: 8px; font-size: 12.5px; color: var(--ink-2); }
.checked-item::before { content: "· "; }
.choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.choice { font-size: 13px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 8px;
  padding: 5px 9px; cursor: pointer; text-align: left; }
.choice:hover { border-color: var(--accent); background: var(--accent-soft); }
.choice-hint { display: block; color: var(--ink-2); font-size: 11.5px; }
.card-foot { margin-top: 10px; display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--ink-2); }
.acts { display: flex; gap: 6px; margin-top: 8px; }
.acts button { font-size: 12px; border: 1px solid var(--line); background: transparent; color: var(--ink-2); border-radius: 7px;
  padding: 2px 9px; cursor: pointer; }
.acts button:hover { color: var(--ink); border-color: var(--ink-2); }
details.past { border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; background: var(--bg); }
details.past summary { cursor: pointer; display: flex; gap: 8px; list-style: none; font-size: 13px; }
details.past summary::-webkit-details-marker { display: none; }
.past-q { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.past-a { color: var(--ink-2); font-size: 12px; white-space: nowrap; }
details.past .card { margin-top: 8px; }

/* The input. */
form { padding: 12px 14px 10px; border-top: 1px solid var(--line); }
.compose { display: flex; align-items: flex-end; gap: 8px; border: 1px solid var(--line); border-radius: 14px;
  padding: 6px 6px 6px 12px; background: var(--bg); transition: border-color .15s ease, box-shadow .15s ease; }
.compose:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
textarea { flex: 1; resize: none; font: inherit; color: var(--ink); background: transparent; border: 0; outline: none;
  padding: 6px 0; height: 34px; max-height: 120px; }
textarea::placeholder { color: var(--ink-2); }
.send { flex: none; width: 34px; height: 34px; padding: 0; border-radius: 10px; display: grid; place-items: center; }
.send svg { width: 18px; height: 18px; }
.foot { margin-top: 7px; text-align: center; font-size: 11px; color: var(--ink-2); }
.spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--line); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .8s linear infinite; margin-right: 8px; vertical-align: -1px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spin, .panel { animation: none; } .bar > div, .launcher, .ex, .compose { transition: none; } .log { scroll-behavior: auto; }
}
`;

const SEND_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
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
  const badge = el("div", "badge");
  badge.innerHTML = ICON;
  const titles = el("div", "titles");
  titles.append(el("div", "title", options.title), el("div", "subtitle", "Runs privately in your browser"));
  header.append(badge, titles);
  const clearBtn = el("button", "icon-btn", "Clear");
  clearBtn.type = "button";
  clearBtn.title = "Clear the history";
  const closeBtn = el("button", "icon-btn close", "✕");
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
  modelRow.append(picker, loadBtn);
  const bar = el("div", "bar");
  const fill = el("div");
  bar.appendChild(fill);
  bar.hidden = true;
  modelBox.append(state, modelRow, bar);
  // A site that turned the model off should not offer to download one.
  if (options.useModel === false) modelBox.hidden = true;
  panel.appendChild(modelBox);

  const log = el("div", "log");
  log.setAttribute("aria-live", "polite");
  panel.appendChild(log);

  const form = el("form");
  const input = el("textarea");
  input.placeholder = options.placeholder;
  input.setAttribute("aria-label", "Ask about this page");
  const sendBtn = el("button", "btn send");
  sendBtn.type = "submit";
  sendBtn.setAttribute("aria-label", "Ask");
  sendBtn.title = "Ask";
  sendBtn.innerHTML = SEND_ICON;
  const compose = el("div", "compose");
  compose.append(input, sendBtn);
  form.append(compose, el("div", "foot", "Answers come from this page. Check anything important."));
  panel.appendChild(form);

  // --- model state -----------------------------------------------------------
  // The site's model when nothing is stored yet. Falling back to the first
  // in the list picked the 1B on a first open, because the site's default
  // is written to storage asynchronously and the panel can ask first.
  const chosenModel = async () => {
    const got = await storage.get("llmModelId");
    const id = got.llmModelId;
    if (id && models.some((m) => m.id === id)) return id;
    if (models.some((m) => m.id === options.model)) return options.model;
    return models[0] && models[0].id;
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
    empty.appendChild(el("div", "lead",
      "Ask me to do something on this page, or to explain what it shows."));
    if ((options.suggestions || []).length) empty.appendChild(el("div", "try", "Try"));
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
    let history = (res && res.ok && res.history) || [];
    recall = history.map((h) => h.instruction).filter(Boolean).reverse();
    // The request running now is in the history as "running", and also on
    // screen as its live card. Drawn once - live - or the panel shows it
    // twice, and the stored copy never updates.
    if (busy) {
      const last = history.length - 1;
      if (last >= 0 && history[last].status === "running") history = history.slice(0, last);
    }
    if (!history.length && !live.length) { drawEmpty(); return; }
    history.forEach((entry, i) => drawEntry(entry, i !== history.length - 1));
    // Put back what is running and what is queued behind it. A redraw that
    // left them out is how an answer ended up on a card no longer on screen:
    // opening the panel mid-ask, or pressing Clear, emptied the log under it.
    for (const slot of live) log.append(slot.echo, slot.card);
    scrollDown();
  }

  // --- asking --------------------------------------------------------------
  // One at a time, in order. A second request while the first was running
  // used to be dropped - and the input box had already been cleared, so
  // whatever was typed was simply gone.
  let busy = false;
  let runningCard = null;
  const live = [];
  let queue = Promise.resolve();
  const statusLine = (text) => {
    const line = el("div");
    line.append(el("span", "spin"), document.createTextNode(text));
    return line;
  };
  function attach(slot) {
    if (slot.echo.isConnected) return;
    const empty = log.querySelector(".empty");
    if (empty) empty.remove();
    log.append(slot.echo, slot.card);
    scrollDown();
  }
  function run(echo, message) {
    const slot = { echo: el("div", "echo", echo), card: el("div", "card running") };
    slot.card.appendChild(statusLine(live.length ? "Waiting for the request before this one…" : "Working on it…"));
    live.push(slot);
    drawing.then(() => attach(slot));
    const job = queue.then(async () => {
      await drawing;
      attach(slot);
      busy = true;
      runningCard = slot.card;
      slot.card.replaceChildren(statusLine("Working on it…"));
      let res;
      try { res = await send(message); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
      slot.card.replaceWith(cardFor(res));
      live.splice(live.indexOf(slot), 1);
      runningCard = null;
      busy = false;
      scrollDown();
      drawModel();
      return res;
    });
    queue = job.catch(() => {});
    return job;
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
    runningCard.replaceChildren(statusLine(String(text).slice(0, 160)));
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
      if (options.autoLoad && options.useModel !== false
        && !modelHost.status().ready && !modelHost.status().loading) loadModel();
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
  const onHotkey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Space") { e.preventDefault(); toggle(); }
  };
  if (options.hotkey !== false) window.addEventListener("keydown", onHotkey);

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
    destroy: () => {
      if (poll) clearInterval(poll);
      window.removeEventListener("keydown", onHotkey);
      host.remove();
    },
    host,
  };
}
