#!/usr/bin/env node
/* server.js - the mini browser: a proxy that re-serves one site on this
 * origin, with the widget put into every page it serves.
 *
 *   node browser/server.js            # http://localhost:8787
 *   node browser/server.js --port 9000 --allow www.drought.gov,water.noaa.gov
 *
 * Why a proxy. A page can only read and operate a frame from its own origin,
 * and most of the sites we care about send X-Frame-Options, which stops a
 * frame from another origin showing them at all. Fetching the page here and
 * serving it from this origin removes both: the frame is same-origin, and
 * the headers never reach the browser. The price is that every request the
 * page makes has to come back through here, so the HTML, CSS and scripts
 * are rewritten on the way out, and what the rewrite misses is what breaks.
 *
 * Paths: /<host>/<path> is https://<host>/<path>. A request with no host in
 * its path (an absolute URL the site's own script built) is sent to the
 * host of the page that made it, read from the Referer.
 *
 * Reserved: /__app/* is the mini browser's own page, /__wc/* the widget's
 * files, /__stats what passed through.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(flag("port", 8787));
const ALLOW = flag("allow", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ME = `http://localhost:${PORT}`;
const ME_RE = ME.replace(/[.]/g, "\\.");
const WIDGET_DIR = path.join(__dirname, "..", "widget", "dist");
const APP_DIR = path.join(__dirname, "app");
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
// Namespaces, schemas and the like are names, not places the page fetches.
const NOT_FETCHED = /^(www\.w3\.org|schema\.org|ogp\.me|purl\.org|xmlns\.com|www\.google\.com\/recaptcha)$/i;
const stats = { requests: 0, upstreamFail: 0, byHost: {}, byStatus: {} };

// The page's half only: the manifests and the bridge the agent reaches
// them through. The agent, the model and the panel are in the address-bar
// page, which is what lets an ask survive a press that leaves the page.
const PAGE_TAG = `<script src="${ME}/__wc/web-controls-page.js"></script>`;

const allowedBy = (list) => (host) => !list.length || list.some((a) => host === a || host.endsWith(`.${a}`));

function hostFromReferer(req) {
  const ref = req.headers.referer || "";
  const m = ref.match(new RegExp(`^${ME_RE}/([^/?#]+)`));
  return m && HOST_RE.test(m[1]) ? m[1] : null;
}

function rewrite(text, host) {
  return text
    // https://x.y.z/... and //x.y.z/... come back through here
    .replace(/(https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'\s)?#,;]|$)/gi, (m, scheme, h) => (NOT_FETCHED.test(h) ? m : `${ME}/${h}`))
    // root-relative in attributes and CSS belong to the page's own host
    .replace(/(href|src|action|content|data-src|srcset|poster|formaction)=(["'])\/(?!\/)/gi, (m, a, q) => `${a}=${q}/${host}/`)
    .replace(/url\((["']?)\/(?!\/)/gi, (m, q) => `url(${q}/${host}/`)
    // a link that opens a new tab or replaces the top page would leave the
    // address bar behind: everything stays in the frame
    .replace(/\starget=(["']?)(_blank|_top|_parent)\1/gi, ' target="_self"');
}

function inject(html) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${PAGE_TAG}</body>`);
  return html + PAGE_TAG;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };

// A file from one of this server's own directories, and nothing outside it:
// "/__wc/../../package.json" resolves to the directory above and is refused.
function serveFile(res, dir, rel) {
  let file;
  try { file = path.resolve(dir, decodeURIComponent(rel)); } catch (e) { file = ""; }
  if (!file.startsWith(dir + path.sep)) { res.writeHead(404); return res.end("not found"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

async function proxy(req, res, allowed) {
  // /<host><rest>, the rest keeping its query: "/www.x.gov?a=1" is the
  // site's front page with a query, not a host called "www.x.gov?a=1".
  const m = req.url.match(/^\/([^/?#]+)(.*)$/);
  let host, pathPart;
  if (m && HOST_RE.test(m[1])) { host = m[1].toLowerCase(); pathPart = m[2] || "/"; if (!pathPart.startsWith("/")) pathPart = `/${pathPart}`; }
  else { host = hostFromReferer(req); pathPart = req.url; }
  if (!host) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("no site in the path: use /<host>/<path>"); }
  if (!allowed(host)) { res.writeHead(403, { "content-type": "text/plain" }); return res.end(`${host} is not on this server's allow list`); }
  stats.requests++;
  stats.byHost[host] = (stats.byHost[host] || 0) + 1;
  const url = `https://${host}${pathPart}`;

  const headers = {
    "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
    accept: req.headers.accept || "*/*",
    "accept-language": req.headers["accept-language"] || "en-US,en",
  };
  for (const h of ["content-type", "cookie", "x-requested-with", "range", "if-none-match", "if-modified-since"]) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  if (req.headers.referer) headers.referer = req.headers.referer.replace(new RegExp(`^${ME_RE}/`), "https://");
  let body = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
  }
  let up;
  try { up = await fetch(url, { method: req.method, headers, body, redirect: "manual" }); }
  catch (e) { stats.upstreamFail++; res.writeHead(502, { "content-type": "text/plain" }); return res.end(`could not reach ${url}: ${e.message}`); }
  stats.byStatus[up.status] = (stats.byStatus[up.status] || 0) + 1;

  const out = {};
  const drop = /^(x-frame-options|content-security-policy(-report-only)?|strict-transport-security|content-encoding|content-length|transfer-encoding|cross-origin-.*|report-to|nel|permissions-policy)$/i;
  for (const [k, v] of up.headers) {
    if (drop.test(k)) continue;
    if (k === "location") { out[k] = v.replace(/^https?:\/\//, `${ME}/`).replace(/^\/(?!\/)/, `/${host}/`); continue; }
    out[k] = v;
  }
  // Cookies for the site, kept on this origin under the same names; the
  // site's Domain and Secure would otherwise keep them from being sent back.
  const cookies = typeof up.headers.getSetCookie === "function" ? up.headers.getSetCookie() : [];
  if (cookies.length) out["set-cookie"] = cookies.map((c) => c.replace(/;\s*domain=[^;]*/i, "").replace(/;\s*secure/i, "").replace(/;\s*samesite=none/i, ""));
  out["access-control-allow-origin"] = "*";

  const ct = up.headers.get("content-type") || "";
  if (/text\/html/i.test(ct)) {
    // Only a page load gets the tag. A site that fetches an HTML fragment
    // and runs it (drought.gov does, for its feedback box) would otherwise
    // get a second copy.
    const dest = req.headers["sec-fetch-dest"];
    const isPage = dest ? /^(document|iframe|frame)$/.test(dest) : !req.headers["x-requested-with"];
    const rewritten = rewrite(await up.text(), host);
    const text = isPage ? inject(rewritten) : rewritten;
    const b = Buffer.from(text);
    out["content-length"] = b.length;
    res.writeHead(up.status, out); return res.end(b);
  }
  if (/text\/css|javascript|json|text\/plain|xml/i.test(ct)) {
    const b = Buffer.from(rewrite(await up.text(), host));
    out["content-length"] = b.length;
    res.writeHead(up.status, out); return res.end(b);
  }
  const b = Buffer.from(await up.arrayBuffer());
  out["content-length"] = b.length;
  res.writeHead(up.status, out); res.end(b);
}

function createServer({ allow = ALLOW } = {}) {
  const allowed = allowedBy(allow);
  return http.createServer((req, res) => {
    const bare = req.url.split("?")[0];
    if (bare === "/" || bare.startsWith("/__app")) {
      return serveFile(res, APP_DIR, bare === "/" ? "index.html" : bare.replace(/^\/__app\/?/, "") || "index.html");
    }
    if (bare.startsWith("/__wc/")) return serveFile(res, WIDGET_DIR, bare.slice("/__wc/".length));
    if (bare === "/__stats") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(stats, null, 2)); }
    if (bare === "/favicon.ico") { res.writeHead(204); return res.end(); }
    proxy(req, res, allowed).catch((e) => { try { res.writeHead(500); res.end(String(e)); } catch (_) { /* gone */ } });
  });
}

module.exports = { rewrite, inject, createServer };

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`web-controls mini browser: ${ME}`);
    if (ALLOW.length) console.log(`sites allowed: ${ALLOW.join(", ")}`);
    else console.log("any site (pass --allow host1,host2 to limit it)");
  });
}
