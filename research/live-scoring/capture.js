const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Beside the scorers that read them. This pointed at one machine's temporary
// directory, so "node capture.js refreshes pages/" - which the README says
// and which is the whole point of the script - has never once been true. The
// pages in the repo were put there by hand.
const OUT = path.join(__dirname, "pages");
const PORT = 9334;
// Two of these have hand-written manifests - usgs (SITE) and noaa (NOAA).
// The other six have no site-specific code anywhere in this repo and go
// through GENERIC, which reads whatever the page happens to offer. That
// split is the point: a fix that only holds where someone wrote a manifest
// is not a fix, it is a sixth manifest.
const PAGES = {
  usgs: "https://waterdata.usgs.gov/monitoring-location/01646500/",
  noaa: "https://water.noaa.gov/",
  drought: "https://www.drought.gov/",
  // The page a tester actually used. "select data and select gis data and
  // select shp" runs here on someone else's machine and did not on ours, and
  // a case that only exists in a screenshot cannot be fixed twice.
  droughtmap: "https://droughtmonitor.unl.edu/CurrentMap.aspx",
  usgsstate: "https://waterdata.usgs.gov/nwis/rt",
  quakes: "https://earthquake.usgs.gov/earthquakes/map/",
  airnow: "https://www.airnow.gov/",
  weather: "https://www.weather.gov/",
  climate: "https://www.ncei.noaa.gov/access/monitoring/monthly-report/",
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
