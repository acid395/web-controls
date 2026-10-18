// First-contact gate. Runs a site's frozen prompts in headed Chrome with the
// widget injected and scores each on the page's real state afterwards.
// The prompts and checks are written before the code ever sees the site, and
// the number is recorded before anything is fixed for it.
//
//   node gate.js sites/a.json sites/b.json        model on (PROFILE = a Chrome profile with it cached)
//   MODEL=0 node gate.js sites/a.json             model off
//   MODEL_ID=Llama-3.1-8B-Instruct-q4f16_1-MLC   another model (first run downloads it)
//   LOOK=1 node gate.js sites/a.json              screenshot + visible text only, to write prompts from
//   BASELINE=1 node gate.js sites/a.json          checks on the untouched page: any PASS here is a bad check
//
// A site file: { name, url, prompts: [{ q, kind: "chain"|"act"|"explain", check }] }
// `check` is a function source run in the page after the ask: (card) => boolean.
// Exits 1 when the share passed is under GATE (default 0.8).
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDGET = path.join(__dirname, "../../widget/dist/web-controls-widget.js");
const WEBLLM = "https://cdn.jsdelivr.net/gh/acid395/web-controls@widget-v0.1.1/dist/web-llm.js";
const PORT = +(process.env.PORT || 9370);
const PER = +(process.env.PER || 300000);
const MODEL = process.env.MODEL !== "0";
const MODEL_ID = process.env.MODEL_ID || "Llama-3.2-3B-Instruct-q4f16_1-MLC";
const LOOK = !!process.env.LOOK;
const BASELINE = !!process.env.BASELINE;
const GATE = +(process.env.GATE || 0.8);
// How long a model may take to load: a first visit to an origin downloads it.
const LOAD_MS = +(process.env.LOAD_MS || 900000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OFF = `{ status: () => ({ ready: false, loading: false, hasGpu: false }), async step() { throw new Error("off"); },
  load() {}, embed: async () => { throw new Error("off"); }, release: async () => {} }`;

async function main() {
  const sites = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.PROFILE || path.join(__dirname, ".profile")}`, "--no-first-run",
    "--no-default-browser-check", "--window-size=1400,900",
    // On screen. Chrome throttles GPU work for a window it considers hidden,
    // and a window parked off-screen counts: the 3B fell from ~25 to 0.5
    // tokens a second there, and every model looked broken.
    `--window-position=${process.env.WINPOS || "0,0"}`, "--enable-unsafe-webgpu", "about:blank"],
    { stdio: "ignore" });
  process.on("exit", () => { try { chrome.kill(); } catch (e) {} });
  let tabs = [];
  for (let i = 0; i < 150 && !tabs.length; i++) {
    try { tabs = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === "page"); } catch (e) {}
    await sleep(200);
  }
  const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const waiting = new Map();
  // An alert() stops the page until someone presses OK, as a person would.
  let dialogs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === "Page.javascriptDialogOpening") {
      dialogs.push(String(m.params.message || "").slice(0, 80));
      ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = async (expression, ms = 60000) => {
    const r = await Promise.race([send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => null)]);
    if (!r) return { error: "timeout" };
    if (!r.result) return { error: "navigated" };
    if (r.result.exceptionDetails) return { error: String((r.result.exceptionDetails.exception || {}).description || "threw").slice(0, 200) };
    return { value: r.result.result.value };
  };
  await send("Page.enable");
  await send("Page.setBypassCSP", { enabled: true });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: fs.readFileSync(WIDGET, "utf8").replace("const WC_CURRENT_SCRIPT = document.currentScript;", "const WC_CURRENT_SCRIPT = null;") });
  const open = async (url) => {
    await send("Page.navigate", { url });
    for (let i = 0; i < 12; i++) {
      await sleep(4000);
      const t = await run("document.readyState + '|' + document.title", 5000);
      if (t.value && /^(?:interactive|complete)\|/.test(t.value) && !/Just a moment/i.test(t.value)) break;
    }
    await sleep(+(process.env.SETTLE || 5000));
  };

  const rows = [];
  for (const site of sites) {
    if (LOOK) {
      await open(site.url);
      const m = (await send("Page.getLayoutMetrics")).result.cssContentSize;
      const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 60, captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: m.width, height: Math.min(m.height, 3200), scale: 1 } });
      const file = path.join(__dirname, `${site.name}.jpg`);
      fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
      const text = await run("document.body.innerText.replace(/\\s+/g, ' ').slice(0, 3000)");
      console.log(`## ${site.name}  ${file}\n${text.value || text.error}\n`);
      // The form as markup, to write checks against - never the agent's view of it.
      const form = await run(`[...document.querySelectorAll("input, select, button, [role=tab], [role=button]")].slice(0, 150).map((e) =>
        e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.name ? "[" + e.name + "]" : "") + (e.type ? " " + e.type : "")
        + (e.checked ? " ON" : "") + " " + JSON.stringify(((e.labels && e.labels[0] && e.labels[0].textContent) || e.value || e.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40))).join("\\n")`);
      console.log(form.value || form.error);
      continue;
    }
    for (const p of site.prompts) {
      await open(site.url);
      dialogs = [];
      const began = Date.now();
      const asked = BASELINE ? { value: { title: "", sub: "" } } : await run(`(async () => {
        const host = ${MODEL ? "null" : OFF};
        const w = WebControls.mount(host ? { _modelHost: host } : { webllmUrl: ${JSON.stringify(WEBLLM)}, model: ${JSON.stringify(MODEL_ID)} });
        if (!host) {
          await w.setModel(${JSON.stringify(MODEL_ID)});
          await w.loadModel();
          const t0 = Date.now();
          while (!w.modelStatus().ready && !w.modelStatus().error && Date.now() - t0 < ${LOAD_MS}) await new Promise((r) => setTimeout(r, 2000));
          if (!w.modelStatus().ready) return { title: "model not ready", sub: String(w.modelStatus().error || "") };
        }
        const r = await Promise.race([w.ask(${JSON.stringify(p.q)}), new Promise((res) => setTimeout(() => res({ error: "timed out" }), ${PER}))]);
        const d = r.display || {};
        return { by: r.plannedBy || "", title: String(d.title || ""), sub: String(d.subtitle || r.error || ""),
          answer: String(d.answer || r.answer || ""), rows: (d.rows || []).map((x) => x.name + ": " + x.value) };
      })()`, PER + LOAD_MS + 30000);
      await sleep(3000);
      const card = asked.value || { title: asked.error || "no card", sub: "" };
      const checked = await run(`(${p.check})(${JSON.stringify(card)})`, 15000);
      const result = checked.value === true ? "PASS" : "FAIL";
      // Where the page ended up: a navigation that went to the wrong place
      // and one that went to the right place read the same on the card.
      const where = await run("location.pathname + location.search + \" | \" + document.title.slice(0, 50)", 5000);
      const said = [card.title, card.sub, card.answer, ...dialogs.map((d) => `alert: ${d}`), where.value ? `at ${where.value}` : null].filter(Boolean).join(" | ").replace(/\s+/g, " ").slice(0, 200);
      rows.push({ q: p.q, site: site.name, kind: p.kind, result, said: checked.error ? `${said} (check: ${checked.error})` : said });
      console.log(`${result}  ${site.name}  [${Math.round((Date.now() - began) / 1000)}s]  ${p.q}\n      ${rows[rows.length - 1].said}`);
    }
  }
  if (LOOK) return process.exit(0);
  if (BASELINE) {
    const bad = rows.filter((r) => r.result === "PASS");
    console.log(bad.length ? `${bad.length} check(s) pass on an untouched page - fix them before running` : "every check fails on an untouched page, as it should");
    return process.exit(bad.length ? 1 : 0);
  }
  const out = path.join(__dirname, `run-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}${MODEL ? "-" + MODEL_ID.replace(/-Instruct.*|-q4f16.*/, "") : "-off"}.tsv`);
  fs.writeFileSync(out, ["Question\tWebsite\tKind\tResult\tWhat it said", ...rows.map((r) => [r.q, r.site, r.kind, r.result, r.said].join("\t"))].join("\n") + "\n");
  const share = (list) => `${list.filter((r) => r.result === "PASS").length}/${list.length}`;
  console.log(`\n${out}`);
  for (const k of [...new Set(rows.map((r) => r.site)), ...new Set(rows.map((r) => r.kind))]) {
    console.log(`  ${k.padEnd(14)} ${share(rows.filter((r) => r.site === k || r.kind === k))}`);
  }
  const passed = rows.filter((r) => r.result === "PASS").length / Math.max(1, rows.length);
  console.log(`  all            ${share(rows)}  (${Math.round(passed * 100)}%, gate ${Math.round(GATE * 100)}%)`);
  process.exit(passed >= GATE ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
