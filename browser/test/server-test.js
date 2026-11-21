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
const { rewrite, rewritePage, inject, decodeText, parseSite, createServer, open } = require(path.join(__dirname, "..", "server.js"));
const { JSDOM } = require(path.join(__dirname, "..", "..", "extension", "test", "node_modules", "jsdom"));

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
    res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", headers: res.headers, body: Buffer.concat(c).toString() }));
  }).on("error", reject);
});

(async () => {
  console.log("rewriting a page of the open site");
  {
    open("www.drought.gov");
    const out = rewrite(`<a href="https://www.drought.gov/data">d</a> <a href="https://www.weather.gov" target="_blank">w</a> <img src="//cdn.example.org/x.png">
      <link href="/css/site.css"> <form action='/search'> <svg xmlns="http://www.w3.org/2000/svg">
      <style>.x{background:url(/img/a.png)}</style><script>// www.weather.gov/x in a comment
      var u = "//cdn.example.org/y.js"; //www.weather.gov/another</script>`, "www.drought.gov");
    check("the site's own absolute address becomes its root path", out.includes('href="http://localhost:8787/data"'), out);
    check("another site's goes under /__x/", out.includes(`href="${ME}/__x/www.weather.gov"`), out);
    check("so does a scheme-relative one", out.includes(`src="${ME}/__x/cdn.example.org/x.png"`), out);
    check("root-relative addresses are already right and left alone", out.includes('href="/css/site.css"') && out.includes("action='/search'") && out.includes("url(/img/a.png)"), out);
    check("an XML namespace is left alone", out.includes('xmlns="http://www.w3.org/2000/svg"'), out);
    const bot = rewrite('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>', "www.drought.gov");
    check("so is a bot-check widget, which only runs from its own origin", bot.includes('src="https://challenges.cloudflare.com/turnstile/v0/api.js"'), bot);
    check("a new-tab link stays in the frame", out.includes('target="_self"') && !/_blank/.test(out), out);
    check("//host in a quoted string is an address", out.includes(`"${ME}/__x/cdn.example.org/y.js"`), out);
    check("//host at the start of a script comment is not", out.includes("// www.weather.gov/x in a comment") && out.includes("//www.weather.gov/another"), out);
  }

  console.log("rewriting a page of another site, under /__x/");
  {
    const out = rewrite(`<a href="/about">a</a> <img src="https://www.weather.gov/i.png" srcset="/s.png 1x, /t.png 2x"> <style>.x{background:url('/b.png')}</style> <a href="https://www.drought.gov/">home</a>`, "www.weather.gov");
    check("root-relative addresses belong to that site", out.includes('href="/__x/www.weather.gov/about"') && out.includes("url('/__x/www.weather.gov/b.png')"), out);
    check("its own absolute address too", out.includes(`src="${ME}/__x/www.weather.gov/i.png"`), out);
    check("every candidate in a srcset", out.includes('srcset="/__x/www.weather.gov/s.png 1x, /__x/www.weather.gov/t.png 2x"'), out);
    check("and the open site's address goes to the root", out.includes(`href="${ME}/"`), out);
  }

  console.log("what only a page gets");
  {
    const page = inject("<html><head><title>t</title></head><body><p>hi</p></body></html>", "www.drought.gov");
    check("the page's half goes in before </body>", /<script src="[^"]+\/__wc\/web-controls-page\.js"><\/script><\/body>/.test(page), page);
    check("and not the widget: the agent is in the parent", !page.includes("web-controls-widget.js"), page);
    check("the proxy shim goes in at the top of <head>, before the page's scripts", /<head><script src="[^"]+\/__app\/proxy-shim\.js" data-me="[^"]+" data-host="www\.drought\.gov" data-base=""><\/script><title>/.test(page), page);
    check("a page of another site is told its base", /data-base="\/__x\/www\.weather\.gov"/.test(inject("<p>x</p>", "www.weather.gov")));
    check("a page with no </body> gets the agent's half at the end", inject("<p>x</p>", "a.gov").endsWith("</script>"));
    check("and one with no <head> gets the shim first", inject("<p>x</p>", "a.gov").startsWith("<script src="));
    const p = rewritePage(`<script src="https://cdn.example.org/x.js" integrity="sha384-abc" crossorigin></script>
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'"><meta name="referrer" content="no-referrer">`, "www.drought.gov");
    check("a rewritten script loses its integrity hash, which no longer matches", !/integrity=/.test(p) && p.includes("crossorigin"), p);
    check("a CSP or referrer policy in a meta tag goes with the headers", !/http-equiv|name="referrer"/.test(p), p);
    const latin = Buffer.from("<html><head><meta charset=\"iso-8859-1\"></head><body>caf\xe9</body></html>", "latin1");
    const txt = decodeText(latin, "text/html", true);
    check("an older site's charset is honoured and sent as UTF-8", txt.includes("café") && /charset="utf-8"/.test(txt), txt);
    check("a header charset wins", decodeText(Buffer.from("caf\xe9", "latin1"), "text/css; charset=windows-1252", false), "café");
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("var café = 1;", "utf16le")]);
    check("a byte-order mark outranks the header: UTF-16 script with no charset", decodeText(u16, "application/javascript", false) === "var café = 1;", JSON.stringify(decodeText(u16, "application/javascript", false)));
    const u8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("café", "utf8")]);
    check("and a UTF-8 mark over a wrong header", decodeText(u8bom, "text/css; charset=iso-8859-1", false) === "café", JSON.stringify(decodeText(u8bom, "text/css; charset=iso-8859-1", false)));
    check("a stylesheet's own @charset", decodeText(Buffer.from("@charset \"windows-1252\"; a{content:'\xe9'}", "latin1"), "text/css", false).includes("'é'"));
    check("what is typed in the bar is a host and a path", JSON.stringify(parseSite("https://www.drought.gov/data?x=1")) === JSON.stringify({ host: "www.drought.gov", path: "/data?x=1" }) && parseSite("www.drought.gov").path === "/" && parseSite("drought") === null);
  }

  console.log("the proxy continued in the page");
  {
    // The shim, loaded as the page's first script, with the page's fetch,
    // XHR, elements and history all seen through it.
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost:8787/data", runScripts: "outside-only" });
    const w = dom.window;
    const seen = [];
    w.fetch = (input) => { seen.push(typeof input === "string" ? input : input.url); return Promise.resolve({}); };
    w.navigator.sendBeacon = (u) => { seen.push(`beacon:${u}`); return true; };
    const tag = w.document.createElement("script");
    tag.dataset.me = "http://localhost:8787"; tag.dataset.host = "www.drought.gov";
    w.document.head.appendChild(tag);
    Object.defineProperty(w.document, "currentScript", { value: tag, configurable: true });
    const xo = []; w.XMLHttpRequest.prototype.open = function (m, u) { xo.push(u); };
    w.eval(fs.readFileSync(path.join(__dirname, "..", "app", "proxy-shim.js"), "utf8"));
    const fix = w.__wcProxyFix;
    check("the page names its host", w.__wcProxyHost, "www.drought.gov");
    check("another site's address comes back through the server", fix("https://api.weather.gov/points/1,2"), "http://localhost:8787/__x/api.weather.gov/points/1,2");
    check("a bare host too", fix("https://api.weather.gov"), "http://localhost:8787/__x/api.weather.gov/");
    check("the open site's own absolute address is its root path", fix("https://www.drought.gov/api/data?x=1"), "http://localhost:8787/api/data?x=1");
    check("a root-relative one is already right", fix("/api/data?x=1") === "/api/data?x=1" && fix("/config.json") === "/config.json");
    check("an address already pointed at the server is left alone", fix("http://localhost:8787/__x/a.gov/x"), "http://localhost:8787/__x/a.gov/x");
    check("a relative one resolves against the page as it is", fix("data/x.json"), "data/x.json");
    check("a namespace is not a place", fix("http://www.w3.org/2000/svg"), "http://www.w3.org/2000/svg");
    w.fetch("https://api.weather.gov/alerts"); w.fetch("/feed.json");
    check("fetch goes through the server", seen.join("|"), "http://localhost:8787/__x/api.weather.gov/alerts|/feed.json");
    const img = w.document.createElement("img");
    img.src = "https://cdn.example.org/a.png";
    img.setAttribute("srcset", "/s.png 1x, //cdn.example.org/b.png 2x");
    check("an element's src setter and setAttribute go through it", img.getAttribute("src") === "http://localhost:8787/__x/cdn.example.org/a.png" && img.getAttribute("srcset") === "/s.png 1x, http://localhost:8787/__x/cdn.example.org/b.png 2x", `${img.getAttribute("src")} | ${img.getAttribute("srcset")}`);
    const s2 = w.document.createElement("script");
    s2.setAttribute("integrity", "sha384-x"); s2.src = "/app.js";
    check("integrity is dropped", !s2.hasAttribute("integrity") && s2.getAttribute("src") === "/app.js");
    w.document.body.innerHTML = '<a href="https://www.weather.gov/x" target="_blank">w</a><img src="/i.png">';
    check("HTML a script writes is rewritten like a page", w.document.body.innerHTML, '<a href="http://localhost:8787/__x/www.weather.gov/x" target="_self">w</a><img src="/i.png">');
    w.history.pushState({}, "", "/map?z=3");
    check("a router's pushState is left where it is", w.location.pathname + w.location.search, "/map?z=3");
    new w.XMLHttpRequest().open("GET", "https://api.weather.gov/x");
    check("XMLHttpRequest.open is seen through it", xo[0], "http://localhost:8787/__x/api.weather.gov/x");
    let swErr = null;
    if (w.navigator.serviceWorker) { await w.navigator.serviceWorker.register("/sw.js").catch((e) => { swErr = e.message; }); check("a service worker is refused", /not run through/.test(swErr), swErr); }

    // The same shim in a page of another site, served under /__x/.
    const dom2 = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost:8787/__x/www.weather.gov/safety", runScripts: "outside-only" });
    const w2 = dom2.window;
    const tag2 = w2.document.createElement("script");
    tag2.dataset.me = "http://localhost:8787"; tag2.dataset.host = "www.weather.gov"; tag2.dataset.base = "/__x/www.weather.gov";
    w2.document.head.appendChild(tag2);
    Object.defineProperty(w2.document, "currentScript", { value: tag2, configurable: true });
    w2.eval(fs.readFileSync(path.join(__dirname, "..", "app", "proxy-shim.js"), "utf8"));
    const fix2 = w2.__wcProxyFix;
    check("under /__x/, a root-relative address belongs to that site", fix2("/api/x"), "/__x/www.weather.gov/api/x");
    check("and one already under /__x/ is left alone", fix2("/__x/www.weather.gov/y"), "/__x/www.weather.gov/y");
    check("its own absolute address goes under its base", fix2("https://www.weather.gov/z"), "http://localhost:8787/__x/www.weather.gov/z");
    w2.history.pushState({}, "", "/forecast");
    check("a router's pushState is kept under the base", w2.location.pathname, "/__x/www.weather.gov/forecast");
  }

  console.log("the server's own routes");
  {
    open(null);
    const server = createServer({ allow: ["www.drought.gov"] });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const app = await raw(port, "/__app/");
    check("/__app/ is the address bar", app.status === 200 && app.body.includes('id="url"'), `${app.status}`);
    const site = await raw(port, "/__app/?site=www.drought.gov");
    check("with a query too", site.status === 200 && site.body.includes('id="url"'), `${site.status}`);
    const rootBefore = await raw(port, "/");
    check("and so is / until a site is open", rootBefore.status === 200 && rootBefore.body.includes('id="url"'), `${rootBefore.status}`);
    const shim = await raw(port, "/__app/proxy-shim.js");
    check("the shim is served", shim.status === 200 && /javascript/.test(shim.type) && shim.body.includes("__wcProxyShim"), `${shim.status}`);
    const opened = await raw(port, "/__open?site=www.drought.gov%2Fdata%3Fx%3D1");
    check("opening a site answers with its path", opened.status === 302 && opened.headers.location === "/data?x=1", `${opened.status} ${opened.headers.location}`);
    const refused = await raw(port, "/__open?site=www.weather.gov");
    check("a site off the allow list is refused at the door", refused.status === 403 && /www\.weather\.gov is not/.test(refused.body), `${refused.status} ${refused.body}`);
    const bad = await raw(port, "/__open?site=drought");
    check("and a word that is not a site is sent back to the bar", bad.status === 400, `${bad.status}`);
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
    const other = await raw(port, "/__x/www.weather.gov?x=1");
    check("another site off the allow list is refused, query or not", other.status === 403 && /www\.weather\.gov is not/.test(other.body), `${other.status} ${other.body}`);
    server.close();
  }

  console.log("what the browser may keep");
  {
    // The one place a site is reached: a stand-in for the network that
    // answers like a site that wants to be cached.
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return new Response("<html><body>hi</body></html>", { status: 200, headers: { "content-type": "text/html", etag: '"v1"', "cache-control": "public, max-age=3600", "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT" } });
    };
    const server = createServer({ allow: ["www.drought.gov", "www.weather.gov"] });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    await raw(port, "/__open?site=www.drought.gov");
    const ask = (p) => new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: p, headers: { "if-none-match": '"v1"', "sec-fetch-dest": "document" } }, (res) => { res.resume(); res.on("end", () => resolve(res.headers)); }).on("error", reject);
    });
    const root = await ask("/");
    check("the open site's page is not kept: its address is every site's address", root["cache-control"] === "no-store" && !root.etag && !root["last-modified"], JSON.stringify(root));
    check("and the browser's copy is never asked about upstream", seen[0] && seen[0].url === "https://www.drought.gov/" && !("if-none-match" in seen[0].headers), JSON.stringify(seen[0]));
    const under = await ask("/__x/www.weather.gov/");
    check("a site under /__x/ keeps its own caching: its address names it", under.etag === '"v1"' && /max-age/.test(under["cache-control"]), JSON.stringify(under));
    globalThis.fetch = realFetch;
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
