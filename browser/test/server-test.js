/* server-test.js - the mini browser's server, without the network.
 *
 *   node browser/test/server-test.js
 *
 * The rewrite, the widget tag, the allow list and the server's own routes.
 * What a real site does through the proxy is in browser/README.md, measured
 * by hand; nothing here fetches anything.
 */
const http = require("http");
const path = require("path");
const fs = require("fs");
const { rewrite, inject, createServer } = require(path.join(__dirname, "..", "server.js"));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
};
const ME = "http://localhost:8787";

// A request with the path exactly as written: fetch() would tidy the ".."
// away before the server ever saw it.
const raw = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path: p }, (res) => {
    const c = [];
    res.on("data", (d) => c.push(d));
    res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body: Buffer.concat(c).toString() }));
  }).on("error", reject);
});

(async () => {
  console.log("rewriting a page");
  {
    const out = rewrite(`<a href="https://www.drought.gov/data">d</a> <img src="//cdn.example.org/x.png">
      <link href="/css/site.css"> <form action='/search'> <svg xmlns="http://www.w3.org/2000/svg">
      <a href="https://www.weather.gov" target="_blank">w</a> <style>.x{background:url(/img/a.png)}</style>`, "www.drought.gov");
    check("an absolute address comes back through the server", out.includes(`href="${ME}/www.drought.gov/data"`), out);
    check("so does a scheme-relative one", out.includes(`src="${ME}/cdn.example.org/x.png"`), out);
    check("a root-relative one belongs to the page's host", out.includes(`href="/www.drought.gov/css/site.css"`) && out.includes(`action='/www.drought.gov/search'`), out);
    check("and so does a CSS url()", out.includes("url(/www.drought.gov/img/a.png)"), out);
    check("an XML namespace is left alone", out.includes('xmlns="http://www.w3.org/2000/svg"'), out);
    check("a new-tab link stays in the frame", out.includes('target="_self"') && !/_blank/.test(out), out);
  }

  console.log("the widget's tag");
  {
    const page = inject("<html><body><p>hi</p></body></html>");
    check("the page's half goes in before </body>", /<script src="[^"]+\/__wc\/web-controls-page\.js"><\/script><\/body>/.test(page), page);
    check("and not the widget: the agent is in the parent", !page.includes("web-controls-widget.js"), page);
    check("a page with no </body> gets it at the end", inject("<p>x</p>").endsWith("</script>"));
  }

  console.log("the server's own routes");
  {
    const server = createServer({ allow: ["www.drought.gov"] });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const app = await raw(port, "/");
    check("/ is the address bar", app.status === 200 && app.body.includes('id="url"'), `${app.status}`);
    const site = await raw(port, "/?site=www.drought.gov");
    check("with a query too", site.status === 200 && site.body.includes('id="url"'), `${site.status}`);
    if (fs.existsSync(path.join(__dirname, "..", "..", "widget", "dist", "web-controls-widget.js"))) {
      const w = await raw(port, "/__wc/web-controls-widget.js");
      check("/__wc/ serves the built widget", w.status === 200 && /javascript/.test(w.type), `${w.status} ${w.type}`);
    }
    const out = await raw(port, "/__wc/../../package.json");
    check("but nothing above its directory", out.status === 404, `${out.status} ${out.body.slice(0, 80)}`);
    const enc = await raw(port, "/__app/..%2F..%2Fpackage.json");
    check("not even spelled with %2F", enc.status === 404, `${enc.status}`);
    const stats = await raw(port, "/__stats");
    check("/__stats is JSON", stats.status === 200 && JSON.parse(stats.body).requests >= 0);
    const none = await raw(port, "/nothing-here");
    check("a path with no site in it says so", none.status === 404 && /no site/.test(none.body), `${none.status} ${none.body}`);
    const other = await raw(port, "/www.weather.gov?x=1");
    check("a site off the allow list is refused, query or not", other.status === 403 && /www\.weather\.gov is not/.test(other.body), `${other.status} ${other.body}`);
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
