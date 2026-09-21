const fs = require("fs");
const { loadPage, loadBackground } = require("/Users/vincenthuang/web-controls/extension/test/harness.js");
const SITES = [["usgs","/tmp/gov/usgs.html","https://waterdata.usgs.gov/nwis/rt"],
  ["drought","/tmp/gov/drought.html","https://www.drought.gov/"],
  ["fws","/tmp/new3/fws.html","https://www.fws.gov/"],
  ["usbr","/tmp/new3/usbr.html","https://www.usbr.gov/"]];
const Q = ["what is the datum","what is the drainage area","how many gauges are there",
  "what is the current stage","read this page","what is the flood stage",
  "average discharge","what is the moon phase","what is the elevation",
  "what does this page say about drought","total rainfall","what is the contact email"];
(async () => {
  const bad = [];
  for (const [name, file, url] of SITES) {
    const html = fs.readFileSync(file, "utf8");
    for (const q of Q) {
      const page = loadPage(html, { url });
      if (!page) continue;
      const bg = loadBackground({ page });
      // Comparing innerHTML cries wolf: fws.gov is a Next.js app that
      // finishes hydrating while the question is being answered, so the
      // markup differs whether anything was asked or not. The invariant that
      // matters is that a question presses nothing.
      let pressed = 0;
      page.document.addEventListener("click", () => pressed++, true);
      const t0 = Date.now(); let r, err = null;
      try { r = await bg.__ask({ type: "smartAsk", instruction: q }); }
      catch (e) { err = e.message; }
      const ms = Date.now() - t0;
      const d = (r && r.display) || {};
      const f = [];
      if (err) f.push("THREW:" + err.slice(0, 50));
      if (r && !d.title) f.push("no-card");
      if (ms > 6000) f.push("slow:" + ms);
      if (pressed) f.push(`PRESSED ${pressed}`);
      if (page.location.pathname !== new URL(url).pathname) f.push("NAVIGATED");
      if (f.length) bad.push(`  [${name}] ${q.slice(0,32).padEnd(34)} ${f.join(" ")}`);
    }
  }
  console.log(`\ndata questions: ${bad.length} flagged of ${SITES.length * Q.length}`);
  bad.forEach((l) => console.log(l));
})();
