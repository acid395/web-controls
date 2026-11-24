/* server-test.js - the mini browser's server, without the network.
 *
 *   node browser/test/server-test.js
 *
 * The addresses, what a page gets, the decoding, the shim in a page, and
 * the server's routes against a stand-in for the sites. What a real site
 * does through the proxy is in browser/README.md, measured by hand.
 */
const http = require("http");
const path = require("path");
const fs = require("fs");
const { pointAtProxy, inject, decodeText, blockedHost, unproxyQuery, unproxyBody, widgetStale, createServer } = require(path.join(__dirname, "..", "server.js"));
const ProxyUrl = require(path.join(__dirname, "..", "app", "proxy-url.js"));
const { JSDOM, VirtualConsole } = require(path.join(__dirname, "..", "..", "extension", "test", "node_modules", "jsdom"));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
};
const ME = "http://localhost:8787";
const SITE = "http://www--drought--gov.localhost:8787";

// A request with the path exactly as written and the Host header of our
// choosing: fetch() would tidy ".." away and would not let the host be set.
const raw = (port, p, { host = "localhost:8787", headers = {}, method = "GET" } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { host, ...headers } }, (res) => {
    const c = [];
    res.on("data", (d) => c.push(d));
    res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", headers: res.headers, buf: Buffer.concat(c), body: Buffer.concat(c).toString() }));
  });
  req.on("error", reject);
  req.end();
});

(async () => {
  console.log("addresses: each site on its own subdomain, path unchanged");
  {
    const u = ProxyUrl.create("localhost:8787");
    check("https host to its label", u.toProxy("https://waterdata.usgs.gov/state/Idaho/?x=1#y"), "http://waterdata--usgs--gov.localhost:8787/state/Idaho/?x=1#y");
    check("and back", u.toReal("http://waterdata--usgs--gov.localhost:8787/state/Idaho/?x=1"), "https://waterdata.usgs.gov/state/Idaho/?x=1");
    check("http and a port are carried in the label", u.toProxy("http://x.org:8080/"), "http://http---x--org---8080.localhost:8787/");
    check("and read back", u.realOrigin("http://http---x--org---8080.localhost:8787/"), "http://x.org:8080");
    check("a host with -- in it cannot be carried", u.toProxy("https://xn--80ak6aa92e.com/") === null);
    check("an address not on the proxy is left as it is", u.toReal("https://www.weather.gov/x"), "https://www.weather.gov/x");
    check("the server's own address is not a site", u.realOrigin("http://localhost:8787/") === null);
  }

  console.log("what a page gets");
  {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><title>t</title></head>
      <body><a href="https://www.drought.gov/data">d</a> <img src="//www.drought.gov/i.png"> <a href="https://www.weather.gov/">w</a>
      <link href="/css/site.css"> <svg xmlns="http://www.w3.org/2000/svg"></svg>
      <script>var u = "https://www.drought.gov/api"; var v = "//www.drought.gov/y"; //www.drought.gov/in-a-comment</script></body></html>`;
    const pointed = pointAtProxy(html, "https://www.drought.gov", SITE);
    check("the site's absolute links to itself point at its proxied origin", pointed.includes(`href="${SITE}/data"`) && pointed.includes(`src="${SITE}/i.png"`), pointed);
    check("another site's are left alone: they load from where they are", pointed.includes('href="https://www.weather.gov/"'), pointed);
    check("so are root-relative ones: the path is the site's own", pointed.includes('href="/css/site.css"'));
    check("an XML namespace is left alone", pointed.includes('xmlns="http://www.w3.org/2000/svg"'));
    check("a quoted address in script text is pointed as well, which the shim would do anyway", pointed.includes(`"${SITE}/api"`) && pointed.includes(`"${SITE}/y"`), pointed);
    check("but //host at the start of a script comment is not an address", pointed.includes("//www.drought.gov/in-a-comment"), pointed);
    const out = inject(pointed);
    const shimAt = out.indexOf("/__wc/proxy-shim.js");
    check("the shim is the first thing in <head>, with this server's addresses on it", shimAt > 0 && out.slice(0, shimAt).endsWith('<head><script src="') && /data-me="http:\/\/localhost:8787" data-proxy="localhost:8787"/.test(out), out.slice(0, 160));
    check("the page's script is the last thing in <body>", /web-controls-page\.js"><\/script><\/body>/.test(out));
    check("a CSP in a meta tag is gone", !/content-security-policy/i.test(out));
    check("a page with no <head> gets the shim after <html>", /^<html><script src="\/__wc\/proxy-shim\.js"/.test(inject("<html><body>x</body></html>")));
    check("one with neither gets both tags round it", /^<script src="\/__wc\/proxy-shim\.js".*<\/script>hi<script src="\/__wc\/web-controls-page\.js"><\/script>$/.test(inject("hi")), inject("hi"));
  }

  console.log("decoding, as a browser would");
  {
    const latin = Buffer.from("<html><head><meta charset=\"iso-8859-1\"></head><body>caf\xe9</body></html>", "latin1");
    const txt = decodeText(latin, "text/html", true);
    check("an older site's charset is honoured and sent as UTF-8", txt.includes("café") && /charset="utf-8"/.test(txt), txt);
    check("a header charset wins", decodeText(Buffer.from("caf\xe9", "latin1"), "text/css; charset=windows-1252", false), "café");
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("var café = 1;", "utf16le")]);
    check("a byte-order mark outranks the header", decodeText(u16, "text/html", true), "var café = 1;");
    const u8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("café", "utf8")]);
    check("a UTF-8 mark over a wrong header", decodeText(u8bom, "text/css; charset=iso-8859-1", false), "café");
    check("a stylesheet's own @charset", decodeText(Buffer.from("@charset \"windows-1252\"; a{content:'\xe9'}", "latin1"), "text/css", false).includes("'é'"));
  }

  console.log("what the proxy refuses");
  {
    check("this machine", blockedHost("localhost") && blockedHost("127.0.0.1") && blockedHost("foo.localhost"));
    check("the local network", blockedHost("10.0.0.1") && blockedHost("192.168.1.1") && blockedHost("172.16.0.1") && blockedHost("169.254.1.1"));
    check("not the internet", !blockedHost("www.drought.gov") && !blockedHost("8.8.8.8"));
  }

  console.log("a service that checks which site is asking (Google Maps)");
  {
    check("the page's proxied address in a query string is the real one again", unproxyQuery("/maps/api/js?callback=x&url=http%3A%2F%2Fwww--drought--gov.localhost%3A8787%2Fmap"), "/maps/api/js?callback=x&url=https%3A%2F%2Fwww.drought.gov%2Fmap");
    check("and plain, in a JSON body", unproxyBody(Buffer.from('{"url":"http://www--drought--gov.localhost:8787/map"}'), "application/json").toString(), '{"url":"https://www.drought.gov/map"}');
    const bin = Buffer.from([0, 1, 2]);
    check("a binary body is not touched", unproxyBody(bin, "application/x-protobuf") === bin);
  }

  console.log("the proxy continued in the page");
  {
    const shim = fs.readFileSync(path.join(__dirname, "..", "app", "proxy-shim.js"), "utf8");
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", () => { /* navigation is not implemented in jsdom; the rest is checked */ });
    const dom = new JSDOM(`<!doctype html><html><head><script src="/__wc/proxy-shim.js" data-me="${ME}" data-proxy="localhost:8787"></script></head><body></body></html>`, {
      url: `${SITE}/data`, runScripts: "dangerously", virtualConsole,
    });
    const w = dom.window;
    // The tag's src is not fetched in this jsdom; the script is run in its place.
    const tag = w.document.querySelector("script");
    const run = w.document.createElement("script"); run.textContent = shim;
    run.dataset.me = ME; run.dataset.proxy = "localhost:8787";
    tag.replaceWith(run);
    check("the shim is in, and knows the real site", w.__wcProxyShim === true && w.__wcRealOrigin === "https://www.drought.gov" && w.__wcShellOrigin === ME, `${w.__wcRealOrigin} ${w.__wcShellOrigin}`);
    // jsdom has no fetch for the shim to wrap; the routing every patch
    // uses is checked through the exported fix.
    const fix = w.__wcProxyFix;
    check("a request to another site goes to that site's proxied address", fix("https://api.example.org/v1?x=1"), "http://api--example--org.localhost:8787/v1?x=1");
    check("one to the site's own real address too", fix("https://www.drought.gov/api/x"), "http://www--drought--gov.localhost:8787/api/x");
    check("a relative one is already right", fix("/api/local"), "/api/local");
    check("and an already proxied one is left", fix("http://api--example--org.localhost:8787/v1"), "http://api--example--org.localhost:8787/v1");
    check("a bot-check widget stays on its own origin", fix("https://challenges.cloudflare.com/turnstile/v0/api.js"), "https://challenges.cloudflare.com/turnstile/v0/api.js");
    check("so does a namespace", fix("http://www.w3.org/2000/svg"), "http://www.w3.org/2000/svg");
    const s = w.document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=k";
    check("a Google Maps script goes through the proxy, which tells it the real site", s.getAttribute("src"), "http://maps--googleapis--com.localhost:8787/maps/api/js?key=k");
    const s2 = w.document.createElement("script");
    s2.src = "https://cdn.example.org/lib.js";
    check("any other script loads from where it is", s2.getAttribute("src"), "https://cdn.example.org/lib.js");
    s2.setAttribute("src", "https://maps.google.com/maps/api/js");
    check("set as an attribute too", s2.getAttribute("src"), "http://maps--google--com.localhost:8787/maps/api/js");
    w.history.pushState(null, "", "/map?lat=1");
    check("pushState is the site's own, untouched", w.location.pathname + w.location.search, "/map?lat=1");
    check("a page not in a frame reports to nobody", w.parent === w);
  }

  console.log("the page reports to the address bar");
  {
    const shim = fs.readFileSync(path.join(__dirname, "..", "app", "proxy-shim.js"), "utf8");
    const { requestInterceptor } = require(path.join(__dirname, "..", "..", "extension", "test", "node_modules", "jsdom"));
    const page = `<!doctype html><html><head><title>Data</title><script src="${SITE}/__wc/proxy-shim.js" data-me="${ME}" data-proxy="localhost:8787"></script></head><body>hi</body></html>`;
    const serve = requestInterceptor((request) => {
      if (request.url === `${SITE}/__wc/proxy-shim.js`) return new Response(shim, { headers: { "Content-Type": "text/javascript" } });
      if (request.url === `${SITE}/data`) return new Response(page, { headers: { "Content-Type": "text/html" } });
      return new Response("not found", { status: 404 });
    });
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", () => {});
    const dom = new JSDOM(`<!doctype html><body><iframe id="f"></iframe></body>`, { url: `${ME}/`, runScripts: "dangerously", resources: { interceptors: [serve] }, virtualConsole });
    const w = dom.window;
    const heard = [];
    w.addEventListener("message", (e) => { if (e.data && e.data.wc === "page-state") heard.push(`${e.data.status}:${e.data.url}:${e.data.title}`); });
    const f = w.document.getElementById("f");
    await new Promise((r) => { f.addEventListener("load", r); f.src = `${SITE}/data`; });
    await new Promise((r) => setTimeout(r, 50));
    check("a new document says it is loading, with its real address", heard[0], "loading:https://www.drought.gov/data:");
    check("then that it is ready, with its title", heard.includes("complete:https://www.drought.gov/data:Data"), heard.join(" | "));
    f.contentWindow.history.pushState(null, "", "/data?x=2");
    await new Promise((r) => setTimeout(r, 20));
    check("a route change is reported, with no load", heard[heard.length - 1], "complete:https://www.drought.gov/data?x=2:Data");
  }

  console.log("the widget is built by the server when it has to be");
  {
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wc-dist-"));
    const srcDir = path.join(tmp, "src"); fs.mkdirSync(srcDir);
    const dist = path.join(tmp, "dist"); fs.mkdirSync(dist);
    const touch = (p, when) => { fs.writeFileSync(p, "x"); fs.utimesSync(p, when, when); };
    const t0 = new Date(Date.now() - 60000), t1 = new Date(Date.now() - 30000), t2 = new Date();
    touch(path.join(srcDir, "a.js"), t0);
    check("with no dist, it is stale", widgetStale(dist, [srcDir]) === true);
    for (const f of ["web-controls-widget.js", "web-controls-page.js", "web-llm.js", "web-llm-worker.mjs"]) touch(path.join(dist, f), t1);
    check("built after every source, it is not", widgetStale(dist, [srcDir]) === false);
    touch(path.join(srcDir, "b.js"), t2);
    check("a source edited since is", widgetStale(dist, [srcDir]) === true);
    check("a source that does not exist is nothing to be newer than", widgetStale(dist, [path.join(tmp, "nowhere")]) === false);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("the server's routes, against a stand-in for the sites");
  {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), headers: init.headers, method: init.method, body: init.body });
      const u = new URL(url);
      if (u.pathname === "/page") return new Response('<html><head><title>p</title></head><body><a href="https://www.drought.gov/data">d</a> <a href="/rel">r</a></body></html>', { status: 200, headers: { "content-type": "text/html; charset=utf-8", etag: '"v1"', "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'", "set-cookie": "s=1; Domain=.drought.gov; Path=/; Secure" } });
      if (u.pathname === "/style.css") return new Response(".a{background:url(https://www.drought.gov/i.png)}", { headers: { "content-type": "text/css", etag: '"c1"' } });
      if (u.pathname === "/app.js") return new Response(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("var a = 1; // https://www.drought.gov/x", "utf16le")]), { headers: { "content-type": "application/javascript", etag: '"j1"' } });
      if (u.pathname === "/go") return new Response("", { status: 302, headers: { location: "https://www.drought.gov/page" } });
      if (u.pathname === "/fragment") return new Response("<div>part</div>", { headers: { "content-type": "text/html" } });
      if (u.pathname === "/checked") return new Response("<html><body>Performing security verification</body></html>", { status: 403, headers: { "content-type": "text/html; charset=UTF-8", "cf-mitigated": "challenge", server: "cloudflare" } });
      return new Response("not found", { status: 404 });
    };
    const server = createServer({ allow: ["www.drought.gov", "maps.googleapis.com"] });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    const app = await raw(port, "/");
    check("/ on localhost is the address bar", app.status === 200 && app.body.includes('id="url"'), `${app.status}`);
    const alias = await raw(port, "/__app/?site=www.drought.gov");
    check("/__app/ too, with a query", alias.status === 200 && alias.body.includes('id="url"'), `${alias.status}`);
    const pu = await raw(port, "/__app/proxy-url.js");
    check("the address module is served to the page", pu.status === 200 && /javascript/.test(pu.type) && pu.body.includes("WCProxyUrl"), `${pu.status}`);
    const shimOnSite = await raw(port, "/__wc/proxy-shim.js", { host: "www--drought--gov.localhost:8787" });
    check("the shim is served on a site's own origin", shimOnSite.status === 200 && /javascript/.test(shimOnSite.type) && shimOnSite.body.includes("__wcProxyShim"), `${shimOnSite.status}`);
    if (fs.existsSync(path.join(__dirname, "..", "..", "widget", "dist", "web-controls-page.js"))) {
      const pg = await raw(port, "/__wc/web-controls-page.js", { host: "www--drought--gov.localhost:8787" });
      check("and so is the page's script", pg.status === 200 && /javascript/.test(pg.type), `${pg.status}`);
    }
    const out = await raw(port, "/__wc/../../package.json");
    check("but nothing above its directory", out.status === 404, `${out.status}`);
    const enc = await raw(port, "/__app/..%2F..%2Fpackage.json");
    check("not even spelled with %2F", enc.status === 404, `${enc.status}`);
    const stats = await raw(port, "/__stats");
    check("/__stats is JSON", stats.status === 200 && JSON.parse(stats.body).requests >= 0);
    const loop = await raw(port, "/?site=x", { host: "127.0.0.1:8787" });
    check("127.0.0.1 is sent to localhost, where the subdomains are", loop.status === 302 && loop.headers.location === "http://localhost:8787/?site=x", `${loop.status} ${loop.headers.location}`);

    const page = await raw(port, "/page?x=1", { host: "www--drought--gov.localhost:8787", headers: { "sec-fetch-dest": "iframe", "if-none-match": '"v1"', referer: "http://localhost:8787/", "accept-language": "en" } });
    check("a site's page is fetched at its real address, path and query unchanged", seen[0].url, "https://www.drought.gov/page?x=1");
    check("with the browser's headers, and the referer mapped to the real site", seen[0].headers["accept-language"] === "en" && seen[0].headers.referer === "http://localhost:8787/" && !("host" in seen[0].headers), JSON.stringify(seen[0].headers));
    check("the page gets both tags", page.body.includes('<head><script src="/__wc/proxy-shim.js"') && /web-controls-page\.js"><\/script><\/body>/.test(page.body), page.body.slice(0, 200));
    check("its own absolute links point at its proxied origin", page.body.includes(`href="${SITE}/data"`) && page.body.includes('href="/rel"'), page.body);
    check("the framing headers are gone", !page.headers["x-frame-options"] && !page.headers["content-security-policy"], JSON.stringify(page.headers));
    check("a document is never kept by the browser: it carries the shim", page.headers["cache-control"] === "no-store" && !page.headers.etag && !page.headers["last-modified"], JSON.stringify(page.headers));
    check("the cookie stays on the proxied origin", String(page.headers["set-cookie"]), "s=1; Path=/; Secure");
    const css = await raw(port, "/style.css", { host: "www--drought--gov.localhost:8787" });
    check("a stylesheet's absolute url() too, and it may be cached", css.body.includes(`url(${SITE}/i.png)`) && css.headers.etag === '"c1"', `${css.body} ${JSON.stringify(css.headers)}`);
    const js = await raw(port, "/app.js", { host: "www--drought--gov.localhost:8787" });
    check("a script is passed through byte for byte, UTF-16 mark and all", js.buf[0] === 0xff && js.buf[1] === 0xfe && js.buf.toString("utf16le").includes("https://www.drought.gov/x") && js.headers.etag === '"j1"', `${js.buf.length} ${JSON.stringify(js.headers)}`);
    const frag = await raw(port, "/fragment", { host: "www--drought--gov.localhost:8787", headers: { "sec-fetch-dest": "empty" } });
    check("an HTML fragment a page fetches gets no tags", !frag.body.includes("proxy-shim") && frag.body.includes("<div>part</div>"), frag.body);
    const chk = await raw(port, "/checked", { host: "www--drought--gov.localhost:8787", headers: { "sec-fetch-dest": "iframe" } });
    check("a bot check that only a real tab can pass is said so, with the way round it", chk.status === 403 && /checking for bots/.test(chk.body) && /href="https:\/\/www\.drought\.gov\/checked" target="_blank" rel="noopener" data-wc-leave/.test(chk.body) && chk.body.includes("proxy-shim.js") && !/Performing security verification/.test(chk.body), chk.body.slice(0, 300));
    const go = await raw(port, "/go", { host: "www--drought--gov.localhost:8787" });
    check("a redirect is pointed at the proxy", go.status === 302 && go.headers.location === `${SITE}/page`, `${go.status} ${go.headers.location}`);
    const pre = await raw(port, "/api", { host: "api--example--org.localhost:8787", method: "OPTIONS", headers: { origin: SITE, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    check("a preflight between proxied sites is answered here", pre.status === 403 || (pre.status === 204 && pre.headers["access-control-allow-origin"] === SITE), `${pre.status} ${JSON.stringify(pre.headers)}`);
    const other = await raw(port, "/", { host: "www--weather--gov.localhost:8787" });
    check("a site off the allow list is refused", other.status === 403 && /not on this server's allow list/.test(other.body), `${other.status}`);
    const local = await raw(port, "/", { host: "10--0--0--1.localhost:8787" });
    check("the local network is refused whatever the list says", local.status === 403 && /local network/.test(local.body), `${local.status} ${local.body.slice(0, 100)}`);
    const bad = await raw(port, "/", { host: "xn--80ak6aa92e--com.localhost:8787" });
    check("a label that names no site is refused", bad.status === 400 || bad.status === 403, `${bad.status}`);
    const stray = await raw(port, "/", { host: "example.org" });
    check("any other host is sent to the address bar", stray.status === 400 && /open http:\/\/localhost:8787/.test(stray.body), `${stray.status} ${stray.body}`);
    seen.length = 0;
    await raw(port, "/maps/api/js?url=http%3A%2F%2Fwww--drought--gov.localhost%3A8787%2Fmap", { host: "maps--googleapis--com.localhost:8787", headers: { referer: `${SITE}/map` } });
    check("Google Maps is told the real site, in the query and the referer", seen[0] && seen[0].url === "https://maps.googleapis.com/maps/api/js?url=https%3A%2F%2Fwww.drought.gov%2Fmap" && seen[0].headers.referer === "https://www.drought.gov/map", JSON.stringify(seen[0]));
    globalThis.fetch = realFetch;
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
