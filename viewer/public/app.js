/* app.js - the viewer: an address bar, the site in an iframe, and the agent
 * widget that drives it.
 *
 * The site runs on its own origin (see proxy-url.js), so the only way to
 * reach it is postMessage, to frame/agent.js inside it:
 *
 *   viewer -> frame   { source: "wc-shell", type: "run", id, command }
 *   frame -> viewer   { source: "wc-frame", type: "page", url, title, status }
 *                     { source: "wc-frame", type: "result", id, ok, result | error }
 *                     { source: "wc-frame", type: "leaving" }
 *
 * The viewer outlives every navigation inside the frame, so a request with
 * several steps carries on across page loads: each step waits until the
 * new page has said it is ready.
 */
(() => {
  const urls = WCProxyUrl.create(location.host, location.protocol);
  const $ = (id) => document.getElementById(id);
  const frame = $("site");
  const address = $("address");
  const log = $("log");
  const prompt = $("prompt");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const state = {
    url: "",
    title: "",
    frameOrigin: null,
    ready: false,
    waiters: [],
    pending: new Map(),
    seq: 0,
    busy: false,
    loadTimer: null,
  };

  // --- the frame ----------------------------------------------------------

  function normalizeUrl(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
    try {
      const u = new URL(s);
      return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.href : null;
    } catch (e) { return null; }
  }

  function setDot(kind, title) {
    const dot = $("status-dot");
    dot.className = `dot ${kind || ""}`;
    dot.title = title || { ok: "Agent connected", wait: "Loading…", bad: "Agent not connected" }[kind] || "No site loaded";
  }

  // The proxy lives in viewer/server.js. Opened any other way (VS Code's Live
  // Server, the file itself, another port), the frame would point at a proxy
  // that isn't there and stay blank.
  const NOT_SERVED = "This page has to be opened from the viewer's own server: run `node viewer/server.js`, then go to http://localhost:5280.";
  const served = fetch("/__wc/viewer", { cache: "no-store" })
    .then((r) => r.ok ? r.text() : "")
    .then((origin) => origin === location.origin, () => false);

  async function open(input) {
    if (!(await served)) { notice(NOT_SERVED); return false; }
    return openServed(input);
  }

  function openServed(input) {
    const real = normalizeUrl(input);
    if (!real) { notice(`"${input}" isn't a web address.`); return false; }
    const to = urls.toProxy(real);
    if (!to) { notice(`The viewer can't load ${new URL(real).host}: addresses containing "--" aren't supported.`); return false; }
    hideNotice();
    notReady();
    state.url = real;
    state.title = "";
    $("landing").hidden = true;
    frame.hidden = false;
    frame.src = to;
    address.value = real;
    remember(real);
    updatePage();
    return true;
  }

  function notReady() {
    state.ready = false;
    setDot("wait");
    clearTimeout(state.loadTimer);
  }

  function remember(real) {
    try { history.replaceState(null, "", `#url=${encodeURIComponent(real)}`); } catch (e) { /* only a convenience */ }
  }

  function updatePage() {
    $("panel-page").textContent = state.title || state.url || "No site loaded";
    const real = $("open-real");
    real.hidden = !state.url;
    real.href = state.url || "#";
    $("back").disabled = !state.url;
    $("reload").disabled = !state.url;
    document.title = state.title ? `${state.title} · Site Viewer` : "Site Viewer";
  }

  function flushWaiters() {
    const waiters = state.waiters;
    state.waiters = [];
    waiters.forEach((w) => w(true));
  }

  function waitReady(ms = 15000) {
    if (state.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      state.waiters.push(finish);
      setTimeout(() => finish(false), ms);
    });
  }

  // A command that set off a navigation did its job, but its page is gone
  // before it could say so. Whatever is still waiting when a new document
  // starts is answered here.
  function settleNavigated() {
    for (const p of state.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ ok: true, result: { message: "Done. A new page loaded." } });
    }
    state.pending.clear();
  }

  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || !urls.isProxy(`${e.origin}/`)) return;
    const m = e.data;
    if (!m || m.source !== "wc-frame") return;
    if (m.type === "page") {
      // "loading" is only ever the first word of a new document.
      if (m.status === "loading") settleNavigated();
      state.frameOrigin = e.origin;
      state.url = m.url;
      state.title = m.title || "";
      state.ready = true;
      clearTimeout(state.loadTimer);
      setDot(m.status === "complete" ? "ok" : "wait");
      if (document.activeElement !== address) address.value = m.url;
      remember(m.url);
      hideNotice();
      updatePage();
      flushWaiters();
    } else if (m.type === "leaving") {
      notReady();
      settleNavigated();
    } else if (m.type === "result") {
      const p = state.pending.get(m.id);
      if (!p) return;
      state.pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(m);
    }
  });

  // A page that loads and never reports either failed in a way the proxy
  // could not show, or navigated somewhere outside it.
  frame.addEventListener("load", () => {
    if (frame.hidden) return;
    settleNavigated();
    clearTimeout(state.loadTimer);
    state.loadTimer = setTimeout(() => {
      if (state.ready) return;
      setDot("bad");
      notice("This page isn't talking to the agent. It may have left the viewer, or blocked the agent's script.",
        "Reload in viewer", () => open(state.url));
    }, 2500);
  });

  async function run(command) {
    if (frame.hidden || !state.url) throw new Error("Open a website first: type its address in the bar at the top.");
    if (!(await waitReady(15000))) throw new Error("The page isn't ready. It may still be loading, or it left the viewer.");
    const id = ++state.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        resolve({ ok: false, error: "The page took too long to answer." });
      }, 25000);
      state.pending.set(id, { resolve, timer });
      frame.contentWindow.postMessage({ source: "wc-shell", type: "run", id, command }, state.frameOrigin);
    });
  }

  // --- notices --------------------------------------------------------------

  function notice(text, actionLabel, action) {
    $("notice").hidden = false;
    $("notice-text").textContent = text;
    const btn = $("notice-action");
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || "";
    btn.onclick = action ? () => { hideNotice(); action(); } : null;
  }
  function hideNotice() { $("notice").hidden = true; }
  $("notice-close").addEventListener("click", hideNotice);

  // --- the panel ------------------------------------------------------------

  const el = (tag, props = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  };

  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  function addMessage(kind, ...children) {
    const m = el("div", { class: `msg ${kind}` }, ...children);
    log.append(m);
    scrollDown();
    return m;
  }

  function addStep(bubble, label) {
    const mark = el("b", {}, "…");
    const text = el("span", {}, label);
    const row = el("div", { class: "step run" }, mark, text);
    bubble.append(row);
    scrollDown();
    return {
      done(ok, message, readAs) {
        row.className = `step ${ok ? "ok" : "bad"}`;
        mark.textContent = ok ? "✓" : "✕";
        text.replaceChildren(message, readAs ? el("span", { class: "as" }, `  (${readAs})`) : "");
        if (!ok) bubble.classList.add("error");
        scrollDown();
      },
    };
  }

  // Click an item in a list to put a command for it in the box.
  const pick = (label, command) => el("button", {
    type: "button", class: "pick",
    onclick: () => { prompt.value = command; prompt.focus(); },
  }, label);

  const append = (parent, ...nodes) => parent.append(...nodes.filter(Boolean));

  function section(title, items) {
    if (!items.length) return null;
    return el("details", {}, el("summary", {}, `${title} (${items.length})`), el("ul", {}, items.map((i) => el("li", {}, i))));
  }

  function renderInventory(bubble, d) {
    const q = (s) => (/\s(?:in|from|then|to)\s/i.test(s) ? `"${s}"` : s);
    append(bubble,
      section("Dropdowns", d.dropdowns.map((s) => el("span", {},
        el("strong", {}, s.label), s.selected ? ` = ${s.selected}` : "", ` · ${s.count} options: `,
        ...s.options.flatMap((o, i) => [i ? ", " : "", pick(o, `select ${q(o)} in ${q(s.label)}`)]),
        s.count > s.options.length ? " …" : ""))),
      section("Text fields", d.fields.map((f) => pick(f, `type  into ${q(f)}`))),
      section("Checkboxes and choices", d.checks.map((c) => pick(`${c.checked ? "☑" : "☐"} ${c.label}`, `${c.checked ? "uncheck" : "check"} ${q(c.label)}`))),
      section("Buttons", d.buttons.map((b) => pick(b, `click ${q(b)}`))),
      section("Links", d.links.map((l) => pick(l, `click ${q(l)}`))),
    );
  }

  function renderRead(bubble, d) {
    const parts = [];
    if (d.headings.length) {
      parts.push(section("Headings", d.headings.map((h) => el("span", { style: `padding-left:${(h.level - 1) * 10}px` }, h.text))));
    }
    d.tables.forEach((t, i) => {
      parts.push(el("details", {},
        el("summary", {}, t.caption || `Table ${i + 1}`, ` (${t.totalRows} rows)`),
        el("table", {}, t.rows.map((r) => el("tr", {}, r.map((c) => el("td", {}, c)))))));
    });
    if (d.text) parts.push(el("details", {}, el("summary", {}, "Text"), el("p", {}, d.text)));
    append(bubble, ...parts);
  }

  function renderHelp(bubble) {
    bubble.append(el("div", { class: "help" },
      el("span", {}, "Things you can say:"),
      ...WCCommands.HELP.map(([cmd, what]) => el("span", {}, el("code", {}, cmd), ` · ${what}`))));
  }

  async function ask(text) {
    text = String(text || "").trim();
    if (!text || state.busy) return;
    state.busy = true;
    $("send").disabled = true;
    addMessage("user", text);
    const bubble = addMessage("agent");
    const steps = WCCommands.parse(text);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.action === "help") { renderHelp(bubble); continue; }
      const readAs = WCCommands.describe(step);
      const row = addStep(bubble, `${readAs}…`);
      try {
        let result;
        if (step.action === "navigate") {
          if (!(await open(step.url))) throw new Error(`"${step.url}" isn't a web address.`);
          await waitReady(20000);
          result = { message: `Opened ${state.title || state.url}.` };
        } else {
          const reply = await run(step);
          if (!reply.ok) throw new Error(reply.error);
          result = reply.result;
        }
        row.done(true, result.message, steps.length > 1 || step.action === "auto" ? readAs : null);
        if (result.details && result.details.kind === "inventory") renderInventory(bubble, result.details);
        if (result.details && result.details.kind === "read") renderRead(bubble, result.details);
      } catch (e) {
        row.done(false, String((e && e.message) || e), readAs);
        break;
      }
      // The next step acts on whatever page this one left behind, which may
      // be a new one still loading.
      if (i < steps.length - 1) { await sleep(500); await waitReady(15000); }
    }
    if (!bubble.childNodes.length) bubble.remove();
    state.busy = false;
    $("send").disabled = false;
    prompt.focus();
  }

  const CHIPS = ["list controls", "read this page", "scroll down", "help"];
  $("chips").append(...CHIPS.map((c) => el("button", { type: "button", onclick: () => ask(c) }, c)));

  function greet() {
    addMessage("agent", "Open a site with the bar at the top, then tell me what to do on it: ",
      el("em", {}, "select Alaska"), ", ", el("em", {}, "click Download"), ", ", el("em", {}, "search for Boise River"),
      ". Type ", el("em", {}, "help"), " for more.");
  }

  const fab = $("fab");
  const panel = $("panel");
  function setOpen(on) {
    panel.hidden = !on;
    fab.setAttribute("aria-expanded", String(on));
    if (on) { prompt.focus(); scrollDown(); } else fab.focus();
  }
  fab.addEventListener("click", () => setOpen(true));
  $("panel-close").addEventListener("click", () => setOpen(false));
  $("panel-clear").addEventListener("click", () => { log.replaceChildren(); greet(); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "Space") { e.preventDefault(); setOpen(panel.hidden); }
    else if (e.key === "Escape" && !panel.hidden && panel.contains(document.activeElement)) setOpen(false);
  });
  $("ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = prompt.value;
    prompt.value = "";
    ask(text);
  });

  // --- the address bar ------------------------------------------------------

  $("go").addEventListener("submit", (e) => { e.preventDefault(); open(address.value); });
  $("examples").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-url]");
    if (b) open(b.dataset.url);
  });
  $("back").addEventListener("click", () => { run({ action: "back" }).catch(() => {}); });
  $("reload").addEventListener("click", () => {
    if (state.ready) run({ action: "reload" }).catch(() => open(state.url));
    else open(state.url);
  });

  greet();
  updatePage();
  served.then((ok) => { if (!ok) notice(NOT_SERVED); });
  const fromHash = /^#url=(.+)$/.exec(location.hash);
  if (fromHash) {
    try { open(decodeURIComponent(fromHash[1])); } catch (e) { /* a bad link; the landing page shows */ }
  }
})();
