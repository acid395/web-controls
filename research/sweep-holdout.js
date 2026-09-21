const fs = require("fs");
const { loadPage, loadBackground } = require("/Users/vincenthuang/web-controls/extension/test/harness.js");
const URLS = { fws:"https://www.fws.gov/", usbr:"https://www.usbr.gov/", ncei:"https://www.ncei.noaa.gov/" };
const PROMPTS = [
  "what can I do here", "read this page", "search for smith river",
  'search for "trinity river"', "click about us", "click contact",
  "enable something that is not there", "click fhqwhgads",
  "set the filter to 2024", "open the menu and then click about",
  "click search and then click home", "download the data",
  "turn off notifications", "what is the current temperature",
  "click español", "go to data", "click on it",
];
(async () => {
  const flagged = [];
  for (const [name, url] of Object.entries(URLS)) {
    const html = fs.readFileSync(`/tmp/new3/${name}.html`, "utf8");
    for (const prompt of PROMPTS) {
      const page = loadPage(html, { url });
      if (!page) continue;
      const bg = loadBackground({ page });
      const t0 = Date.now(); let r, err = null;
      try { r = await bg.__ask({ type: "smartAsk", instruction: prompt }); }
      catch (e) { err = e.message; }
      const ms = Date.now() - t0;
      const d = (r && r.display) || {};
      const nav = page.location.pathname !== new URL(url).pathname;
      const f = [];
      if (err) f.push("THREW:" + err.slice(0, 60));
      if (r && !d.title) f.push("no-card");
      if (r && d.title && !d.subtitle && !(d.rows || []).length) f.push("empty-card");
      if (ms > 5000) f.push("slow:" + ms);
      if (nav) f.push("NAVIGATED:" + page.location.pathname);
      if (f.length) flagged.push(`  [${name}] ${prompt.slice(0,34).padEnd(36)} ${f.join(" ")}`);
    }
  }
  console.log(`\n${flagged.length} flagged of ${Object.keys(URLS).length * PROMPTS.length}`);
  flagged.forEach((l) => console.log(l));
})();
