const fs = require("fs");
const BUNDLE = fs.readFileSync("/Users/vincenthuang/web-controls/extension/page/generic-bundle.js", "utf8");
const CAPTURE = fs.readFileSync("/Users/vincenthuang/web-controls/extension/page/feed-capture.js", "utf8");
(async () => {
  const list = await (await fetch("http://localhost:9333/json/list")).json();
  const ws = new WebSocket(list.find((x) => x.type === "page").webSocketDebuggerUrl);
  let id = 0; const w = new Map();
  const send = (m, p = {}) => new Promise((r) => { const n = ++id; w.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: CAPTURE });
  await send("Page.navigate", { url: "https://dashboard.waterdata.usgs.gov/app/nwd/en/" });
  await new Promise((r) => setTimeout(r, 28000));
  await send("Runtime.evaluate", { expression: BUNDLE });
  const ev = async (x) => {
    const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    const s = r.result || {};
    if (s.exceptionDetails) return { ERROR: String((s.exceptionDetails.exception||{}).description || s.exceptionDetails.text).slice(0,150) };
    return s.result ? s.result.value : null;
  };
  console.log("points found:", JSON.stringify(await ev(
    `(() => { const p = window.GENERIC.capturedPoints(); return { count: p.count, sample: p.points.slice(0,3) }; })()`), null, 1));
  for (const q of ["salmon river", "malad river", "lick creek", "fhqwhgads river"]) {
    const hit = await ev(`JSON.stringify(window.GENERIC.findCapturedPoint(${JSON.stringify(q)}) || null)`);
    console.log(`  ${q.padEnd(18)} -> ${String(hit).slice(0, 110)}`);
  }
  ws.close();
})().catch((e) => console.log("FAILED:", e.message));
