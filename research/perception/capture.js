/* capture.js - the perception corpus: each site in sites.json loaded in a real
 * Chrome window, its rendered DOM saved to pages/<name>.html. The pages stay
 * out of git (see .gitignore); run this to refresh them.
 *
 *   node research/perception/capture.js
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9380;
const DIR = path.join(__dirname, "pages");
const SITES = JSON.parse(fs.readFileSync(path.join(__dirname, "sites.json"), "utf8"));
fs.mkdirSync(DIR, { recursive: true });
setTimeout(() => { console.log("capture timed out"); process.exit(2); }, 20 * 60000).unref();
(async () => {
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(DIR, "..", ".profile")}`,
    "--no-first-run", "--no-default-browser-check", "--window-size=1400,900", "--window-position=3000,3000", "about:blank"], { stdio: "ignore" });
  process.on("exit", () => { try { chrome.kill(); } catch (e) {} });
  let t; for (let i = 0; i < 150; i++) { try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === "page"); if (t.length) break; } catch (e) {} await new Promise((r) => setTimeout(r, 200)); }
  const ws = new WebSocket(t[0].webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
  let id = 0; const w = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } };
  const s = (m, p = {}) => new Promise((r) => { const n = ++id; w.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  await s("Page.enable");
  for (const [name, url] of SITES) {
    try {
      await s("Page.navigate", { url });
      let title = "";
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const r = await s("Runtime.evaluate", { returnByValue: true, expression: "document.title" });
        title = (r.result && r.result.result && r.result.result.value) || "";
        if (title && !/just a moment|attention required|access denied/i.test(title)) break;
      }
      if (!title || /just a moment|attention required|access denied/i.test(title)) { console.log(`skip ${name}: ${title || "no title"}`); continue; }
      await new Promise((r) => setTimeout(r, 3000));
      const r = await s("Runtime.evaluate", { returnByValue: true, expression: "document.documentElement.outerHTML" });
      const html = r.result && r.result.result && r.result.result.value;
      if (!html) { console.log(`skip ${name}: no html`); continue; }
      fs.writeFileSync(path.join(DIR, `${name}.html`), `<!-- captured ${new Date().toISOString()} from ${url} -->\n${html}`);
      console.log(`${name}: ${Math.round(html.length / 1024)} KB - ${title.slice(0, 60)}`);
    } catch (e) { console.log(`skip ${name}: ${String((e && e.message) || e).slice(0, 80)}`); }
  }
  process.exit(0);
})();
