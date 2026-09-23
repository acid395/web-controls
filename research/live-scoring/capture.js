const { spawn } = require("child_process");
const fs = require("fs");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/private/tmp/claude-501/-Users-vincenthuang-hydro-harvester/c2d60a91-5920-44b6-96bc-dd2166f69279/scratchpad/pages";
const PORT = 9334;
const PAGES = {
  usgs: "https://waterdata.usgs.gov/monitoring-location/01646500/",
  noaa: "https://water.noaa.gov/",
  drought: "https://www.drought.gov/",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
    "--no-first-run", "--use-angle=swiftshader",
    "--user-data-dir=" + OUT + "/prof"], { stdio: "ignore" });
  await sleep(2500);
  for (const [name, url] of Object.entries(PAGES)) {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let id = 0;
    const send = (method, params) => new Promise((resolve) => {
      const mine = ++id;
      const on = (e) => { const m = JSON.parse(e.data); if (m.id === mine) { ws.removeEventListener("message", on); resolve(m.result); } };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
    await send("Page.enable", {});
    await sleep(10000);
    const r = await send("Runtime.evaluate", {
      returnByValue: true,
      // strip scripts: the snapshot is a DOM to reason about, not an app to run
      expression: `(() => {
        document.querySelectorAll("script").forEach(s => s.remove());
        return "<!doctype html>" + document.documentElement.outerHTML;
      })()`,
    });
    const html = (r.result && r.result.value) || "";
    fs.writeFileSync(`${OUT}/${name}.html`, html);
    console.log(`${name}: ${(html.length / 1024).toFixed(0)}KB  ${url}`);
    ws.close();
  }
  chrome.kill();
})();
