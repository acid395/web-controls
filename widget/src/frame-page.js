/* frame-page.js - a page shown in a frame, as the agent's "tab".
 *
 * The mini browser keeps the agent in the page that holds the frame, so a
 * press that leaves the page does not end the ask with it: the frame loads
 * the next page, the agent waits for it as the extension waits for a tab,
 * and carries on. The widget mounted in a page (chrome-shim.js's default)
 * cannot do that, because a full navigation ends the widget too.
 *
 * What the shim asks of a page, answered about the frame:
 *   href()     the page's real address (the proxy's /host/path mapped back)
 *   title()    its title
 *   status()   "loading" while the frame's document is still being parsed
 *   call(m, globals)   a call on the page's manifests, over postMessage to
 *                      frame-bridge.js, which the proxy put in the page
 *   watch(onLoading, onComplete)   navigations and route changes
 *
 * A call left unanswered when the page goes away rejects as the extension's
 * does ("message channel closed"): the agent reads that as a press that
 * navigated, which is the press working.
 */
function createFramePage(frame, { realUrl, origin = location.origin, timeoutMs = 20000 } = {}) {
  // The proxy serves https://host/path as /host/path on this origin.
  const mapped = realUrl || ((href) => {
    try {
      const u = new URL(href);
      if (u.origin !== origin) return "";
      const m = u.pathname.match(/^\/([a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i);
      return m ? `https://${m[1]}${m[2] || "/"}${u.search}${u.hash}` : "";
    } catch (e) { return ""; }
  });
  const win = () => frame.contentWindow;
  const doc = () => frame.contentDocument;
  const rawHref = () => { try { return win().location.href; } catch (e) { return ""; } };
  const href = () => mapped(rawHref());

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
  note(href());
  const canGoBack = () => visited.length > 1;

  const pending = new Map();
  let seq = 0;
  const fail = (why) => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
    pending.clear();
  };
  const onMessage = (e) => {
    const m = e.data;
    // From the frame, on this origin (jsdom sends no source and an empty
    // origin; a browser never sends an empty one).
    if (!m || m.wc !== "page-reply" || !(e.origin === origin || e.origin === "") || (e.source != null && e.source !== win())) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    p.resolve(m.ok ? { ok: true, result: m.result } : { ok: false, error: m.error });
  };
  window.addEventListener("message", onMessage);
  const call = (m, globals) => new Promise((resolve, reject) => {
    const target = win();
    if (!target || !href()) { reject(new Error("no page is open in the frame")); return; }
    if (m.fn === "goBack") {
      const from = href();
      if (!canGoBack()) { resolve({ ok: true, result: { from, note: "nothing to go back to: this is the first page opened here" } }); return; }
      try { target.history.back(); } catch (e) { /* the frame will say */ }
      resolve({ ok: true, result: { from, note: "asked the browser to go back - the page may take a moment" } });
      return;
    }
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: "timed out waiting for the page to reply" }); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { target.postMessage({ wc: "page-call", id, fn: m.fn, args: m.args || [], globals }, origin); }
    catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
  });

  // Navigations. The frame's document is same-origin, so its address and
  // readyState can be read: a new address is a load beginning (or a route
  // change, which completes at once), and the frame's load event is its
  // end. Calls still waiting when the document is replaced are failed.
  let watching = null;
  const watch = (onLoading, onComplete) => {
    let last = rawHref();
    let loading = false;
    const begin = () => { if (!loading) { loading = true; onLoading(); } };
    const end = () => { if (loading) { loading = false; onComplete(); } };
    const tick = () => {
      const now = rawHref();
      let parsing = false;
      try { parsing = !!doc() && doc().readyState === "loading"; } catch (e) { /* not ours */ }
      if (now !== last) { last = now; note(href()); fail("message channel closed before a response was received"); begin(); }
      if (parsing) begin(); else end();
    };
    const loaded = () => { last = rawHref(); note(href()); fail("message channel closed before a response was received"); begin(); end(); };
    const timer = setInterval(tick, 150);
    frame.addEventListener("load", loaded);
    watching = () => { clearInterval(timer); frame.removeEventListener("load", loaded); };
    return watching;
  };

  return {
    href,
    title: () => { try { return doc().title; } catch (e) { return ""; } },
    status: () => { try { return doc() && doc().readyState === "loading" ? "loading" : "complete"; } catch (e) { return "complete"; } },
    call,
    watch,
    canGoBack,
    dispose: () => { window.removeEventListener("message", onMessage); if (watching) watching(); fail("the frame was let go"); },
  };
}
