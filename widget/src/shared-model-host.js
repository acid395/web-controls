/* shared-model-host.js - one model for every page a frame shows.
 *
 * In the mini browser the widget is inside the framed page, and a full
 * navigation ends that page, model and all: the next page loaded the model
 * again, 3.4 GB from cache into the GPU on every click that left the page.
 * The extension never has this problem because its model lives in the side
 * panel, outside the page.
 *
 * So the address-bar page keeps the model (shareModelHost) and the widget
 * in the frame talks to it (createRemoteModelHost), with the same interface
 * as the in-page host: load, step, embed, status, release, interrupt. The
 * two are on the same origin - the proxy serves both - and postMessage
 * carries plain data both ways.
 *
 *   parent: { wc: "model-status", status }           pushed while loading
 *   frame:  { wc: "model", id, op, args }            a call
 *   parent: { wc: "model-reply", id, ok, value|error } its answer
 */

function shareModelHost(host, { win = window, origin = location.origin } = {}) {
  const sources = new Set();
  const say = (source, msg) => { try { source.postMessage(msg, origin); } catch (e) { sources.delete(source); } };
  const tell = () => { const status = host.status(); for (const s of sources) say(s, { wc: "model-status", status }); };

  const onMessage = async (e) => {
    const m = e.data;
    if (!m || m.wc !== "model" || e.origin !== origin || !e.source) return;
    sources.add(e.source);
    const reply = (out) => say(e.source, { wc: "model-reply", id: m.id, ...out });
    try {
      switch (m.op) {
        case "status": return reply({ ok: true, value: host.status() });
        case "load": host.load(m.args[0]); return reply({ ok: true, value: host.status() });
        case "step": return reply({ ok: true, value: await host.step(m.args[0], m.args[1], m.args[2] || {}) });
        case "embed": return reply({ ok: true, value: await host.embed(m.args[0] || []) });
        case "release": await host.release(); return reply({ ok: true, value: null });
        case "interrupt": if (host.interrupt) host.interrupt(); return reply({ ok: true, value: null });
        default: return reply({ ok: false, error: `unknown model op ${m.op}` });
      }
    } catch (err) {
      reply({ ok: false, error: String((err && err.message) || err) });
    } finally {
      if (m.op !== "status") tell();
    }
  };
  win.addEventListener("message", onMessage);

  // Whatever changes the model's state - a frame's load, the parent's own
  // button, a failure - goes out to every frame as soon as it shows.
  let lastSent = "";
  const watch = setInterval(() => {
    if (!sources.size) return;
    const now = JSON.stringify(host.status());
    if (now !== lastSent) { lastSent = now; tell(); }
  }, 500);

  return {
    tell,
    stop: () => { win.removeEventListener("message", onMessage); clearInterval(watch); },
  };
}

function createRemoteModelHost({ win = window, target = win.parent, origin = location.origin, onProgress } = {}) {
  let last = {
    ready: false, loading: false, model: null, progress: null, fraction: null, error: null, where: null,
    hasGpu: typeof navigator !== "undefined" && "gpu" in navigator, gpu: null,
  };
  const pending = new Map();
  let seq = 0;
  const take = (status) => {
    if (!status) return;
    last = status;
    if (onProgress) onProgress(status.progress || "", status.fraction);
  };
  const onMessage = (e) => {
    const m = e.data;
    if (!m || e.origin !== origin) return;
    if (m.wc === "model-status") { take(m.status); return; }
    if (m.wc !== "model-reply" || !pending.has(m.id)) return;
    const { resolve, reject, timer } = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(timer);
    if (m.ok) resolve(m.value); else reject(new Error(m.error || "the shared model host refused"));
  };
  win.addEventListener("message", onMessage);

  // timeoutMs 0: wait for the answer however long it takes.
  const call = (op, args = [], timeoutMs = 10000) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = timeoutMs ? setTimeout(() => {
      pending.delete(id);
      reject(new Error(`the shared model host did not answer "${op}" in ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs) : null;
    pending.set(id, { resolve, reject, timer });
    try { target.postMessage({ wc: "model", id, op, args }, origin); }
    catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
  });
  const refresh = () => call("status", [], 3000).then(take).catch(() => {});

  // What the host has now, before anything is asked of it: a model it already
  // holds shows as ready at once on the next page. No answer means the page
  // holding this one is not the mini browser, and the panel says so rather
  // than showing a model that will never load.
  call("status", [], 3000).then(take).catch(() => {
    if (!last.ready && !last.loading) last = { ...last, error: "no shared model host answered: this page is framed by something other than the mini browser" };
  });

  return {
    load: (modelId) => { call("load", [modelId], 5000).then(take).catch(() => {}); },
    // No clock of its own: the host times the generation and answers with
    // the error, and a step asked while the model is still loading waits
    // for the load, as the in-page host's does.
    step: async (modelId, prompt, opts = {}) => {
      const out = await call("step", [modelId, prompt, opts], 0);
      refresh();
      return out;
    },
    embed: (texts) => call("embed", [texts], 120000),
    status: () => last,
    release: async () => { await call("release", [], 10000).catch(() => {}); refresh(); },
    interrupt: () => { call("interrupt", [], 3000).catch(() => {}); },
    dispose: () => { win.removeEventListener("message", onMessage); for (const p of pending.values()) clearTimeout(p.timer); pending.clear(); },
  };
}
