const fs = require("fs");
const BUNDLE = fs.readFileSync("/Users/vincenthuang/web-controls/extension/page/generic-bundle.js", "utf8");
(async () => {
  const list = await (await fetch("http://localhost:9333/json/list")).json();
  const ws = new WebSocket(list.find((x) => x.type === "page").webSocketDebuggerUrl);
  let id = 0; const w = new Map();
  const send = (m, p = {}) => new Promise((r) => { const n = ++id; w.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r));
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: "https://water.noaa.gov/" });
  await new Promise((r) => setTimeout(r, 22000));
  const ev = async (x) => {
    const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    const s = r.result || {};
    if (s.exceptionDetails) return { ERROR: String((s.exceptionDetails.exception||{}).description || s.exceptionDetails.text).slice(0,160) };
    return s.result ? s.result.value : null;
  };
  await send("Runtime.evaluate", { expression: BUNDLE });
  const box = await ev(`(() => {
    const t = document.getElementById("uk-accordion-9");
    if (!t) return null;
    t.scrollIntoView({block:"center"});
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), w: r.width, h: r.height };
  })()`);
  console.log("accordion box:", JSON.stringify(box));
  if (box && box.w > 0) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("after a genuine mouse click:", JSON.stringify(await ev(`(() => {
    const t = document.getElementById("uk-accordion-9");
    const li = t.closest("li");
    const c = li && li.querySelector(".uk-accordion-content");
    return { ariaExpanded: t.getAttribute("aria-expanded"), liClass: li ? li.className : null,
      display: c ? getComputedStyle(c).display : "no el",
      inputsInside: c ? c.querySelectorAll("input").length : 0,
      text: c ? (c.textContent||"").replace(/\\s+/g," ").trim().slice(0,110) : "" };
  })()`), null, 1));
  ws.close();
})().catch((e) => { console.log("FAILED:", e.message); process.exit(1); });
