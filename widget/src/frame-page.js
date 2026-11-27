/* frame-page.js - a page shown in a frame, as the agent's "tab".
 *
 * The mini browser keeps the agent in the page that holds the frame, so a
 * press that leaves the page does not end the ask with it: the frame loads
 * the next page, the agent waits for it as the extension waits for a tab,
 * and carries on. The widget mounted in a page (chrome-shim.js's default)
 * cannot do that, because a full navigation ends the widget too.
 *
 * The framed page is on another origin (the proxy serves each site from
 * its own subdomain), so nothing in it can be read from here. Everything
 * known about it is what it says: the proxy's shim in the page reports its
 * real address, title and state at the start of every document, when it is
 * ready, and on every route change ({ wc: "page-state" }); frame-bridge.js
 * answers calls on the page's manifests ({ wc: "page-call" } in,
 * { wc: "page-reply" } out).
 *
 * What the shim asks of a page, answered about the frame:
 *   href()     the page's real address
 *   title()    its title
 *   status()   "loading" while the frame's document is still being parsed
 *   call(m, globals)   a call on the page's manifests, over postMessage
 *   watch(onLoading, onComplete)   navigations and route changes
 *
 * A call left unanswered when the page goes away rejects as the extension's
 * does ("message channel closed"): the agent reads that as a press that
 * navigated, which is the press working.
 */
function createFramePage(frame, { timeoutMs = 20000 } = {}) {
  const win = () => frame.contentWindow;
  // What the page last said about itself.
  const state = { href: "", title: "", status: "complete", origin: null };
  const href = () => state.href;

  // The pages the frame has shown, in order, so "go back" knows whether
  // there is one. A frame's history is the tab's: history.back() on the
  // first page the frame showed would take the whole mini browser back to
  // whatever was open before it.
  const visited = [];
  const note = (h) => {
    if (!h) return;
    if (visited.length >= 2 && visited[visited.length - 2] === h) visited.pop();
    else if (visited[visited.length - 1] !== h) visited.push(h);
  };
  const canGoBack = () => visited.length > 1;

  const pending = new Map();
  let seq = 0;
  const fail = (why) => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
    pending.clear();
  };
  const CLOSED = "message channel closed before a response was received";

  // The watcher, when there is one: a load beginning and ending.
  let loading = false;
  let onLoading = null;
  let onComplete = null;
  let settle = null;
  const begin = () => { if (!loading) { loading = true; if (onLoading) onLoading(); } };
  const end = () => { clearTimeout(settle); if (loading) { loading = false; if (onComplete) onComplete(); } };

  // Whether the document now in the frame has reported; "leaving" is the
  // old one's last word, so the next has not.
  let reported = false;
  const fromFrame = (e) => e.source == null || e.source === win();
  const onMessage = (e) => {
    const m = e.data;
    if (!m || !fromFrame(e)) return;
    if (m.wc === "page-state") {
      reported = m.status !== "leaving";
      if (e.origin) state.origin = e.origin;
      if (m.status === "loading") {
        // The first word of a new document: whatever was waiting on the
        // old one will never be answered.
        fail(CLOSED);
        Object.assign(state, { href: m.url || "", title: m.title || "", status: "loading" });
        note(state.href);
        begin();
      } else if (m.status === "leaving") {
        fail(CLOSED);
        state.status = "loading";
        begin();
      } else {
        const moved = m.url !== state.href;
        Object.assign(state, { href: m.url || "", title: m.title || "", status: "complete" });
        note(state.href);
        // A route change arrives complete, with no loading before it: it
        // is announced as a load all the same, so the agent re-reads.
        if (moved && !loading) begin();
        end();
      }
      return;
    }
    if (m.wc === "page-reply") {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      p.resolve(m.ok ? { ok: true, result: m.result } : { ok: false, error: m.error });
    }
  };
  window.addEventListener("message", onMessage);
  // The frame's own load event. A page that has not reported by then has
  // no shim: a same-origin page of the widget's own, whose address can be
  // read, or one that did not come through the proxy, which ends after a
  // moment's grace (a proxied page's "complete" follows its load at once).
  const loaded = () => {
    clearTimeout(settle);
    if (!reported) {
      let h = "";
      // A readable page with the shim will report in a moment; only a
      // page without it is read here.
      try { h = win().__wcProxyShim ? "" : win().location.href; if (h === "about:blank") h = ""; } catch (e) { /* another origin */ }
      if (h) {
        fail(CLOSED);
        const moved = h !== state.href;
        Object.assign(state, { href: h, title: (() => { try { return frame.contentDocument.title; } catch (e) { return ""; } })(), status: "complete" });
        note(h);
        if (moved && !loading) begin();
        end();
      } else settle = setTimeout(() => { if (loading) { fail(CLOSED); end(); } }, 600);
    }
    reported = false;
  };
  frame.addEventListener("load", loaded);

  const send = (msg) => win().postMessage(msg, state.origin || "*");
  const call = (m, globals) => new Promise((resolve, reject) => {
    if (!win() || !href()) { reject(new Error("no page is open in the frame")); return; }
    if (m.fn === "goBack") {
      const from = href();
      if (!canGoBack()) { resolve({ ok: true, result: { from, note: "nothing to go back to: this is the first page opened here" } }); return; }
      try { send({ wc: "page-nav", do: "back" }); } catch (e) { /* the frame will say */ }
      resolve({ ok: true, result: { from, note: "asked the browser to go back - the page may take a moment" } });
      return;
    }
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "timed out waiting for the page to reply" }); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { send({ wc: "page-call", id, fn: m.fn, args: m.args || [], globals }); }
    catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
  });

  const watch = (onLoad, onDone) => {
    onLoading = onLoad;
    onComplete = onDone;
    return () => { onLoading = null; onComplete = null; };
  };

  return {
    href,
    title: () => state.title,
    status: () => state.status,
    call,
    watch,
    canGoBack,
    dispose: () => { window.removeEventListener("message", onMessage); frame.removeEventListener("load", loaded); clearTimeout(settle); onLoading = null; onComplete = null; fail("the frame was let go"); },
  };
}
