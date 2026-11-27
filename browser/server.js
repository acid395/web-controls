#!/usr/bin/env node
/* server.js - the mini browser: a proxy that serves any site from its own
 * subdomain of localhost, with the agent's page-side script in every page.
 *
 *   node browser/server.js            # http://localhost:8787
 *   node browser/server.js --port 9000 --allow www.drought.gov,water.noaa.gov
 *
 * Why a proxy. A page cannot reach into a frame showing another site, and
 * most of the sites we care about send X-Frame-Options, which stops a frame
 * from showing them at all. Fetching the page here and serving it from this
 * machine removes the headers; a script put into the page gives the agent
 * its hands.
 *
 * Addresses. Each site is served from its own subdomain, path unchanged
 * (app/proxy-url.js, the scheme of viewer/, Samrat Shrestha's):
 *
 *   https://waterdata.usgs.gov/state/Idaho/
 *   http://waterdata--usgs--gov.localhost:8787/state/Idaho/
 *
 * So a site's root-relative links, its router and its pushState all work
 * untouched, its cookies and storage are its own, any number of sites can
 * be open, and nothing in a script has to be rewritten: a page's requests
 * to other sites are routed inside the page (app/proxy-shim.js), and its
 * stylesheets, images and scripts from elsewhere load from where they
 * are. Browsers resolve every *.localhost name to this machine, so there
 * is nothing to configure.
 *
 *   localhost:8787        the address-bar page (app/), the widget's files
 *                         at /__wc/, /__stats
 *   *.localhost:8787      the sites; /__wc/ there too, for the page's script
 *
 * Local use only. This is a proxy to anywhere, so it listens on the
 * loopback interface alone and refuses addresses on this machine or the
 * local network. --allow limits it to listed hosts and their subdomains.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable, pipeline } = require("stream");
const ProxyUrl = require("./app/proxy-url.js");

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(flag("port", 8787));
const ALLOW = flag("allow", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
// A browser leaves the default port out of the Host header.
const HOST = PORT === 80 ? "localhost" : `localhost:${PORT}`;
const ME = `http://${HOST}`;
const urls = ProxyUrl.create(HOST, "http:");
const WIDGET_DIR = path.join(__dirname, "..", "widget", "dist");
const APP_DIR = path.join(__dirname, "app");
const stats = { requests: 0, upstreamFail: 0, byHost: {}, byStatus: {} };

// Two tags in every page. First in <head>, before any of the site's own
// scripts: the proxy continued in the page (app/proxy-shim.js), which routes
// the requests a script makes to other sites back through here, keeps
// navigations in the frame, and tells the address-bar page where the frame
// is. Before </body>: the page's half of the widget (web-controls-page.js) -
// the manifests and a bridge the agent calls them through. The agent, the
// model and the panel are in the address-bar page, which is what lets an
// ask survive a press that leaves the page.
const SHIM_TAG = `<script src="/__wc/proxy-shim.js" data-me="${ME}" data-proxy="${HOST}"></script>`;
const PAGE_TAG = `<script src="/__wc/web-controls-page.js"></script>`;

const allowedBy = (list) => (host) => !list.length || list.some((a) => host === a || host.endsWith(`.${a}`));

// Not this machine, and not the local network: a site in the frame can make
// requests through this proxy, and must not reach a router or a service on
// localhost by doing so.
function blockedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return false;
}

// Hop-by-hop headers and the ones fetch sets for itself. The rest of the
// browser's headers go up as they are, so the site sees the browser it is
// really talking to.
const DROP_REQUEST = /^(host|connection|keep-alive|proxy-.*|transfer-encoding|upgrade|te|trailer|expect|accept-encoding|content-length|sec-fetch-site)$/i;
// Encoding and length change on the way through (fetch decompresses). The
// rest forbid framing, pin the site to https, or would let the site's own
// CORS answer through instead of this one.
const DROP_RESPONSE = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive|x-frame-options|content-security-policy(-report-only)?|strict-transport-security|cross-origin-.*|access-control-allow-(origin|credentials)|report-to|nel|alt-svc|clear-site-data|set-cookie)$/i;

// Response.text() reads everything as UTF-8; an older site in ISO-8859-1 or
// windows-1252 came through with its accents broken. Decoded as the site
// says and sent as UTF-8. A byte-order mark outranks every header, as it
// does in a browser.
function decodeText(buf, ct, isHtml) {
  let charset = buf[0] === 0xff && buf[1] === 0xfe ? "utf-16le" : buf[0] === 0xfe && buf[1] === 0xff ? "utf-16be" : buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? "utf-8" : null;
  if (!charset) charset = (ct.match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = buf.subarray(0, 4096).toString("latin1");
    charset = isHtml ? (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] : (head.match(/^@charset\s+["']([\w-]+)["']/) || [])[1];
  }
  let text;
  try { text = new TextDecoder(charset || "utf-8").decode(buf); } catch (e) { text = buf.toString("utf8"); }
  if (isHtml) text = text.replace(/(<meta[^>]+charset=["']?)([\w-]+)/i, "$1utf-8");
  return text;
}

// A site's absolute links to itself, pointed at its proxied origin instead:
// "https://www.drought.gov/x" anywhere, and "//www.drought.gov/x" where it
// is a value - after a quote, "=" or "(" - but not where it begins a
// script comment, which the rewrite would turn into a label and a comment
// ("Label 'http' has already been declared", cdc.gov). In HTML and CSS
// only; scripts are not rewritten, their requests are routed in the page.
function pointAtProxy(text, realOrigin, proxyOrigin) {
  const host = new URL(realOrigin).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?:https?://|(?<=["'=(])//)${host}(?=[/"'\\s)?#<]|$)`, "gi"), proxyOrigin);
}

// What only a page gets: the two tags, and no CSP in a meta tag (it forbids
// framing and inline handlers as the header does).
function inject(html) {
  let out = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy(?:-report-only)?["']?[^>]*>/gi, "");
  const head = /<head(?:\s[^>]*)?>/i.exec(out);
  const root = /<html(?:\s[^>]*)?>/i.exec(out);
  const at = head ? head.index + head[0].length : root ? root.index + root[0].length : 0;
  out = out.slice(0, at) + SHIM_TAG + out.slice(at);
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${PAGE_TAG}</body>`);
  return out + PAGE_TAG;
}

// A proxied page's address, back to the real one, for the services that
// check which site is asking (ProxyUrl.REFERRER_CHECKED): the Google Maps
// script sends location.href to Google, which checks it against the API
// key's allowed sites - older versions in a query string, newer ones in a
// JSON request body. Plain or percent-encoded, as it was found.
const PROXIED_ORIGIN_RE = new RegExp(`http(:|%3A)(?:/|%2F){2}([a-z0-9-]+)\\.localhost${PORT === 80 ? "" : `(?::|%3A)${PORT}`}`, "gi");
const unproxyText = (text) => text.replace(PROXIED_ORIGIN_RE, (m, colon, label) => {
  const real = ProxyUrl.decodeLabel(label.toLowerCase());
  return real ? (colon === ":" ? real : encodeURIComponent(real)) : m;
});
function unproxyQuery(pathAndQuery) {
  const q = pathAndQuery.indexOf("?");
  return q < 0 ? pathAndQuery : pathAndQuery.slice(0, q) + unproxyText(pathAndQuery.slice(q));
}
// Text bodies only: a changed length would corrupt a binary protobuf.
function unproxyBody(body, contentType) {
  if (!body || !body.length || !/json|text|x-www-form-urlencoded/i.test(contentType || "")) return body;
  const text = body.toString("utf8");
  const out = unproxyText(text);
  return out === text ? body : Buffer.from(out);
}

// The widget's built files, made when they are missing or older than what
// they are built from, so a fresh clone runs with `node browser/server.js`
// alone. The build is widget/scripts/build.js, a few seconds, no packages.
const BUILD = path.join(__dirname, "..", "widget", "scripts", "build.js");
const BUILT_FROM = [path.join(__dirname, "..", "widget", "src"), path.join(__dirname, "..", "widget", "package.json"), BUILD,
  path.join(__dirname, "..", "extension", "background.js"), path.join(__dirname, "..", "extension", "lib"), path.join(__dirname, "..", "extension", "page"), path.join(__dirname, "..", "extension", "offscreen", "vendor")];
const newest = (p) => {
  let t = 0;
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) t = Math.max(t, newest(path.join(p, f)));
    else t = st.mtimeMs;
  } catch (e) { /* not there: nothing to be newer than */ }
  return t;
};
// True when dist is missing a file or any source is newer than it.
function widgetStale(dist = WIDGET_DIR, sources = BUILT_FROM) {
  const files = ["web-controls-widget.js", "web-controls-page.js", "web-llm.js", "web-llm-worker.mjs"].map((f) => path.join(dist, f));
  if (!files.every((f) => fs.existsSync(f))) return true;
  const built = Math.min(...files.map((f) => fs.statSync(f).mtimeMs));
  return sources.some((s) => newest(s) > built);
}
function buildWidget() {
  console.log("building the widget (widget/dist is missing or out of date)...");
  require("child_process").execFileSync(process.execPath, [BUILD], { stdio: "inherit" });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".d.ts": "text/plain" };

// A file from one of this server's own directories, and nothing outside it:
// "/__wc/../../package.json" resolves to the directory above and is refused.
function serveFile(res, dir, rel) {
  let file;
  try { file = path.resolve(dir, decodeURIComponent(rel)); } catch (e) { file = ""; }
  if (!file.startsWith(dir + path.sep)) { res.writeHead(404); return res.end("not found"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  });
}
// The widget's built files, and the shim beside them, on every host.
const serveShared = (res, rel) => (rel === "proxy-shim.js" || rel === "proxy-url.js" ? serveFile(res, APP_DIR, rel) : serveFile(res, WIDGET_DIR, rel));

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// What the frame shows when a site cannot be: a page of ours, with the shim
// so the address bar still learns where the frame is.
function errorPage(res, status, title, detail) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${SHIM_TAG}</head>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#17212e">
<h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${detail}</p></body></html>`);
}

async function proxy(req, res, host, allowed) {
  const proxyOrigin = `http://${host}`;
  const realOrigin = urls.realOrigin(`${proxyOrigin}/`);
  if (!realOrigin) return errorPage(res, 400, "Not a site address", `${escapeHtml(host)} does not name a site.`);
  const target = new URL(unproxyQuery(req.url), realOrigin);
  if (blockedHost(target.hostname)) return errorPage(res, 403, "Blocked", `The mini browser does not open addresses on this machine or the local network (${escapeHtml(target.hostname)}).`);
  if (!allowed(target.hostname)) return errorPage(res, 403, "Not on the allow list", `${escapeHtml(target.hostname)} is not on this server's allow list.`);
  stats.requests++;
  stats.byHost[target.hostname] = (stats.byHost[target.hostname] || 0) + 1;

  // CORS between proxied sites (a page on one fetching an API on another),
  // answered here for whichever proxied origin asked.
  const origin = req.headers.origin;
  const cors = origin && origin !== "null" ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {};
  if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
    res.writeHead(204, { ...cors, "access-control-allow-methods": req.headers["access-control-request-method"], "access-control-allow-headers": req.headers["access-control-request-headers"] || "*", "access-control-max-age": "600" });
    return res.end();
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP_REQUEST.test(k) && v != null) headers[k] = Array.isArray(v) ? v.join(", ") : v;
  // The site sees itself, not localhost.
  if (origin && origin !== "null") headers.origin = urls.realOrigin(`${origin}/`) || origin;
  // The address bar's own address, which the first page in the frame would
  // carry as its referer, is nobody's business.
  if (req.headers.referer) {
    const referer = urls.toReal(req.headers.referer);
    if (referer.startsWith(`${ME}/`)) delete headers.referer; else headers.referer = referer;
  }

  // The site has a minute to answer with headers; the body takes as long
  // as it takes (a download, an event stream). When the browser gives up
  // on the request, so does the proxy.
  const upstream = new AbortController();
  const slow = setTimeout(() => upstream.abort(new Error("the site did not answer within 60 s")), 60000);
  res.on("close", () => upstream.abort());
  let up;
  try {
    let body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise((r, j) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); req.on("error", j); });
    if (body && ProxyUrl.REFERRER_CHECKED.includes(target.hostname)) body = unproxyBody(body, req.headers["content-type"]);
    up = await fetch(target, { method: req.method, headers, body, redirect: "manual", signal: upstream.signal });
  } catch (e) {
    stats.upstreamFail++;
    if (res.writableEnded || res.destroyed) return;
    const why = (e && e.cause && e.cause.code) || (upstream.signal.reason && upstream.signal.reason.message) || (e && e.message) || String(e);
    return errorPage(res, 502, "Could not reach the site", `${escapeHtml(target.href)}<br><br>${escapeHtml(why)}`);
  } finally { clearTimeout(slow); }
  stats.byStatus[up.status] = (stats.byStatus[up.status] || 0) + 1;

  // A bot check (Cloudflare's managed challenge) answers the server's
  // request, which it takes for a bot, with a page that proves a browser is
  // a browser - at the real site, in a real tab. Through here it can only
  // fail: the page would run on the proxied origin, inside a frame. Said
  // plainly, with the way round it, in place of the broken check.
  if (up.headers.get("cf-mitigated") === "challenge" && /text\/html/i.test(up.headers.get("content-type") || "")) {
    const site = escapeHtml(target.hostname);
    return errorPage(res, 403, `${site} is checking for bots`,
      `The site asked for a browser check before it would answer, and the check only runs at the site itself, not through the mini browser. `
      + `<a href="${escapeHtml(target.href)}" target="_blank" rel="noopener" data-wc-leave>Open ${site} in a new tab</a> to use it there, or use the extension, which works in that tab. `
      + `If the site is yours, a Cloudflare rule that skips the challenge for it lets the mini browser in.`);
  }

  const out = {};
  for (const [k, v] of up.headers) if (!DROP_RESPONSE.test(k)) out[k] = v;
  // Cookies stay on the proxied origin: a Domain naming the real site would
  // be refused by the browser.
  const cookies = typeof up.headers.getSetCookie === "function" ? up.headers.getSetCookie() : [];
  if (cookies.length) out["set-cookie"] = cookies.map((c) => c.replace(/;\s*domain=[^;]*/gi, ""));
  if (out.location) { try { out.location = urls.toProxy(new URL(out.location, target).href) || out.location; } catch (e) { /* as sent */ } }
  // The site's own Vary is kept, with Origin added to it.
  const vary = out.vary;
  Object.assign(out, cors);
  if (vary && cors.vary && !/(^|,)\s*(origin|\*)\s*(,|$)/i.test(vary)) out.vary = `${vary}, Origin`; else if (vary) out.vary = vary;

  const type = out["content-type"] || "";
  const dest = req.headers["sec-fetch-dest"];
  // Only a page load gets the tags: a site that fetches an HTML fragment
  // and runs it would otherwise get a second copy.
  const isDocument = /text\/html|application\/xhtml\+xml/i.test(type) && (!dest || dest === "document" || dest === "iframe" || dest === "frame");
  const isCss = /text\/css/i.test(type);
  const hasBody = req.method !== "HEAD" && up.body && up.status !== 204 && up.status !== 304;

  if (hasBody && (isDocument || isCss)) {
    let text = pointAtProxy(decodeText(Buffer.from(await up.arrayBuffer()), type, isDocument), realOrigin, proxyOrigin);
    if (isDocument) {
      for (const h of ProxyUrl.REFERRER_CHECKED) text = pointAtProxy(text, `https://${h}`, urls.toProxy(`https://${h}/`).slice(0, -1));
      text = inject(text);
      // The document carries a script the site never sent; a cached copy
      // from before the shim changed would carry an old one.
      out["cache-control"] = "no-store"; delete out.etag; delete out["last-modified"];
    }
    out["content-type"] = `${type.replace(/;\s*charset=[^;]+/i, "")}; charset=utf-8`;
    res.writeHead(up.status, out);
    return res.end(text);
  }
  // Everything else as the site sent it, streamed.
  res.writeHead(up.status, out);
  if (!hasBody) return res.end();
  // pipeline, not pipe: a browser that gives up on a download closes the
  // response, and the site's stream has to be let go with it.
  pipeline(Readable.fromWeb(up.body), res, () => {});
}

function createServer({ allow = ALLOW } = {}) {
  const allowed = allowedBy(allow);
  return http.createServer((req, res) => {
    const host = String(req.headers.host || "").toLowerCase();
    const bare = req.url.split("?")[0];
    if (bare.startsWith("/__wc/")) return serveShared(res, bare.slice("/__wc/".length));
    if (host === HOST || host === `localhost`) {
      if (bare === "/" || bare === "/__app" || bare === "/__app/" || bare.startsWith("/__app/")) return serveFile(res, APP_DIR, bare.replace(/^\/__app\/?/, "").replace(/^\/$/, "") || "index.html");
      if (bare === "/__stats") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(stats, null, 2)); }
      if (bare === "/favicon.ico") { res.writeHead(204); return res.end(); }
      res.writeHead(404, { "content-type": "text/plain" }); return res.end(`not found: the mini browser is at ${ME}/`);
    }
    // Subdomains of 127.0.0.1 are not a thing: the address bar has to be on
    // localhost for its sites to be on *.localhost.
    if (/^127\.0\.0\.1(:|$)|^\[::1\](:|$)/.test(host)) { res.writeHead(302, { location: ME + req.url }); return res.end(); }
    if (host.endsWith(`.${HOST}`)) {
      return proxy(req, res, host, allowed).catch((e) => {
        if (!res.headersSent) errorPage(res, 500, "Proxy error", escapeHtml((e && e.message) || e)); else res.destroy();
      });
    }
    res.writeHead(400, { "content-type": "text/plain" }); res.end(`open ${ME}/`);
  });
}

module.exports = { pointAtProxy, inject, decodeText, blockedHost, unproxyQuery, unproxyBody, widgetStale, createServer, SHIM_TAG, PAGE_TAG };

// Both loopback addresses, since a browser may resolve localhost to either.
// Never all interfaces: this is an open proxy.
if (require.main === module) {
  if (widgetStale()) {
    try { buildWidget(); } catch (e) { console.error(`the widget could not be built: ${e.message}\n  run: node widget/scripts/build.js`); }
  }
  const server = createServer().listen(PORT, "127.0.0.1", () => {
    console.log(`web-controls mini browser: ${ME}/`);
    if (ALLOW.length) console.log(`sites allowed: ${ALLOW.join(", ")}`);
    else console.log("any site (pass --allow host1,host2 to limit it)");
  });
  server.on("error", (e) => { console.error(String(e.message || e)); process.exit(1); });
  createServer().listen(PORT, "::1").on("error", () => { /* no IPv6 loopback here */ });
}
