#!/usr/bin/env node
/* server.js - the mini browser: a proxy that re-serves one site on this
 * origin, with the agent's page-side script put into every page it serves.
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
 * are rewritten on the way out, and app/proxy-shim.js does the same inside
 * the page for the addresses its scripts build as they run.
 *
 * Paths. The site that is open is served at the root: /path is
 * https://<open site>/path, so the page's own address is what its scripts
 * expect - an app that routes on location.pathname works. Everything from
 * any other host goes under /__x/<host>/<path>. One site is open at a time;
 * /__open?site=<host>/<path> opens another and the page's links to other
 * sites go through it.
 *
 * Reserved: /__app/* is the mini browser's own page and shim, /__wc/* the
 * widget's files, /__stats what passed through.
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
// Namespaces, schemas and the like are names, not places the page fetches;
// a bot-check widget (Turnstile, reCAPTCHA, hCaptcha) only runs from its own
// origin and looks for its script tag by that address, so it is left there.
const NOT_FETCHED = /^(www\.w3\.org|schema\.org|ogp\.me|purl\.org|xmlns\.com|challenges\.cloudflare\.com|(www\.)?recaptcha\.net|(js\.|api\.)?hcaptcha\.com)$/i;
const stats = { requests: 0, upstreamFail: 0, byHost: {}, byStatus: {} };

// The page's half only: the manifests and the bridge the agent reaches
// them through. The agent, the model and the panel are in the address-bar
// page, which is what lets an ask survive a press that leaves the page.
const PAGE_TAG = `<script src="${ME}/__wc/web-controls-page.js"></script>`;
// And before any of the page's own scripts, the proxy continued in the
// page (app/proxy-shim.js): addresses a script builds as it runs are
// turned back towards this server as they are used.
const shimTag = (host, base) => `<script src="${ME}/__app/proxy-shim.js" data-me="${ME}" data-host="${host}" data-base="${base}"></script>`;

const allowedBy = (list) => (host) => !list.length || list.some((a) => host === a || host.endsWith(`.${a}`));

/* The site that is open: served at the root. */
let openHost = null;
const baseFor = (host) => (host === openHost ? "" : `/__x/${host}`);

// An address in a page, as it comes back through here: the open site's at
// the root, any other's under /__x/<host>. In a page served under /__x/
// (`base`), root-relative addresses belong to that host and are prefixed.
function rewrite(text, host, base = baseFor(host)) {
  return text
    // https://x.y.z/... anywhere; //x.y.z/... only after a quote, = or (,
    // where an address is - inside a script, //x.y.z at the start of a
    // comment rewritten to http://... turned the line into a label and
    // broke the script ("Label 'http' has already been declared").
    .replace(/(https?:|(?<=["'`=(]))\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'`\s)?#,;]|$)/gi, (m, scheme, h) => (NOT_FETCHED.test(h) ? m : `${ME}${baseFor(h.toLowerCase())}`))
    // root-relative in attributes and CSS belong to the page's own host
    .replace(/(href|src|action|content|data-src|poster|formaction)=(["'])\/(?!\/|__x\/|__wc\/|__app\/)/gi, (m, a, q) => `${a}=${q}${base}/`)
    .replace(/srcset=(["'])([^"']*)\1/gi, (m, q, v) => `srcset=${q}${fixSrcset(v, base)}${q}`)
    .replace(/url\((["']?)\/(?!\/|__x\/)/gi, (m, q) => `url(${q}${base}/`)
    // a link that opens a new tab or replaces the top page would leave the
    // address bar behind: everything stays in the frame
    .replace(/\starget=(["']?)(_blank|_top|_parent)\1/gi, ' target="_self"');
}
const fixSrcset = (v, base) => v.split(",").map((c) => {
  const m = c.trim().match(/^(\S+)(\s.*)?$/);
  if (!m) return c;
  const u = m[1].startsWith("/") && !m[1].startsWith("//") && !m[1].startsWith("/__x/") ? `${base}${m[1]}` : m[1];
  return u + (m[2] || "");
}).join(", ");

// What only a page needs: a rewritten script no longer matches its
// integrity hash, so the attribute goes; a CSP or referrer policy in a meta
// tag would do what the dropped headers did.
function rewritePage(html, host, base = baseFor(host)) {
  return rewrite(html, host, base)
    .replace(/\sintegrity=(["'])[^"']*\1/gi, "")
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<meta[^>]+name=["']?referrer["']?[^>]*>/gi, "");
}

// The shim first - before the page's own scripts, at the top of <head> -
// and the page's half of the agent last.
function inject(html, host, base = baseFor(host)) {
  const shim = shimTag(host, base);
  let out;
  if (/<head[^>]*>/i.test(html)) out = html.replace(/<head[^>]*>/i, (m) => `${m}${shim}`);
  else if (/<html[^>]*>/i.test(html)) out = html.replace(/<html[^>]*>/i, (m) => `${m}${shim}`);
  else out = shim + html;
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${PAGE_TAG}</body>`);
  return out + PAGE_TAG;
}

// Response.text() reads everything as UTF-8; an older site in ISO-8859-1 or
// windows-1252 came through with its accents broken. Decoded as the site
// says - in the header, or in a meta tag near the top - and sent as UTF-8.
function decodeText(buf, ct, isHtml) {
  // A byte-order mark outranks every header, as it does in a browser: a
  // script served as UTF-16 with no charset (nps.gov's) is only readable
  // that way.
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

// "www.drought.gov", "www.drought.gov/data", "https://www.drought.gov/data"
// -> the host and the path.
function parseSite(typed) {
  let s = String(typed || "").trim().replace(/^https?:\/\//i, "");
  const m = s.match(/^([^/?#]+)(.*)$/);
  if (!m || !HOST_RE.test(m[1])) return null;
  return { host: m[1].toLowerCase(), path: m[2] && m[2].startsWith("/") ? m[2] : `/${m[2] || ""}` };
}

async function proxy(req, res, host, pathPart, allowed) {
  if (!allowed(host)) { res.writeHead(403, { "content-type": "text/plain" }); return res.end(`${host} is not on this server's allow list`); }
  stats.requests++;
  stats.byHost[host] = (stats.byHost[host] || 0) + 1;
  const url = `https://${host}${pathPart}`;
  const base = baseFor(host);

  // The browser's own headers go up as they are, so the site sees the
  // browser it is really talking to; only the ones that name this server
  // or its connection are kept back.
  const headers = {};
  const keepBack = /^(host|connection|keep-alive|accept-encoding|content-length|transfer-encoding|upgrade|te|trailer|proxy-.*|sec-fetch-.*|origin|referer)$/i;
  // The open site lives at this server's root, so its addresses are the
  // same in the browser's cache whichever site is open: a cached page or
  // script of the last site would be shown for this one. Nothing of the
  // open site is cached, and no "is it still the same?" question goes up
  // that a 304 would answer with the browser's copy.
  const conditional = /^(if-none-match|if-modified-since|if-match|if-unmodified-since|if-range)$/i;
  for (const [h, v] of Object.entries(req.headers)) if (!keepBack.test(h) && !(base === "" && conditional.test(h)) && typeof v === "string") headers[h] = v;
  if (req.headers.referer) {
    const r = req.headers.referer.match(new RegExp(`^${ME_RE}(?:/__x/([^/?#]+))?(/.*)?$`));
    if (r) headers.referer = `https://${r[1] || openHost || host}${r[2] || "/"}`;
  }
  if (req.headers.origin) headers.origin = `https://${host}`;
  let body = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
  }
  let up;
  try { up = await fetch(url, { method: req.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(60000) }); }
  catch (e) { stats.upstreamFail++; res.writeHead(502, { "content-type": "text/plain" }); return res.end(`could not reach ${url}: ${e.message}`); }
  stats.byStatus[up.status] = (stats.byStatus[up.status] || 0) + 1;

  const out = {};
  const drop = /^(x-frame-options|content-security-policy(-report-only)?|strict-transport-security|content-encoding|content-length|transfer-encoding|cross-origin-.*|report-to|nel|permissions-policy|referrer-policy|x-content-type-options)$/i;
  const caching = /^(cache-control|etag|last-modified|expires|age|vary)$/i;
  for (const [k, v] of up.headers) {
    if (drop.test(k) || (base === "" && caching.test(k))) continue;
    if (k === "location") { out[k] = rewrite(v.startsWith("/") && !v.startsWith("//") ? `${base}${v}` : v, host, base); continue; }
    out[k] = v;
  }
  // Cookies for the site, kept on this origin under the same names; the
  // site's Domain and Secure would otherwise keep them from being sent back.
  const cookies = typeof up.headers.getSetCookie === "function" ? up.headers.getSetCookie() : [];
  if (cookies.length) out["set-cookie"] = cookies.map((c) => c.replace(/;\s*domain=[^;]*/i, "").replace(/;\s*secure/i, "").replace(/;\s*samesite=none/i, ""));
  out["access-control-allow-origin"] = "*";
  if (base === "") out["cache-control"] = "no-store";

  const ct = up.headers.get("content-type") || "";
  const raw = Buffer.from(await up.arrayBuffer());
  if (/text\/html|application\/xhtml/i.test(ct)) {
    // Only a page load gets the tags. A site that fetches an HTML fragment
    // and runs it (drought.gov does, for its feedback box) would otherwise
    // get a second copy.
    const dest = req.headers["sec-fetch-dest"];
    const isPage = dest ? /^(document|iframe|frame)$/.test(dest) : !req.headers["x-requested-with"];
    const rewritten = rewritePage(decodeText(raw, ct, true), host, base);
    const b = Buffer.from(isPage ? inject(rewritten, host, base) : rewritten);
    out["content-type"] = "text/html; charset=utf-8";
    out["content-length"] = b.length;
    res.writeHead(up.status, out); return res.end(b);
  }
  if (/text\/css|javascript|json|text\/plain|xml/i.test(ct)) {
    const b = Buffer.from(rewrite(decodeText(raw, ct, false), host, base));
    out["content-type"] = ct.replace(/;\s*charset=[^;]*/i, "") + "; charset=utf-8";
    out["content-length"] = b.length;
    res.writeHead(up.status, out); return res.end(b);
  }
  out["content-length"] = raw.length;
  res.writeHead(up.status, out); res.end(raw);
}

function createServer({ allow = ALLOW } = {}) {
  const allowed = allowedBy(allow);
  return http.createServer((req, res) => {
    const bare = req.url.split("?")[0];
    if (bare === "/__app" || bare === "/__app/" || bare.startsWith("/__app/")) {
      return serveFile(res, APP_DIR, bare.replace(/^\/__app\/?/, "") || "index.html");
    }
    if (bare.startsWith("/__wc/")) return serveFile(res, WIDGET_DIR, bare.slice("/__wc/".length));
    if (bare === "/__stats") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ...stats, open: openHost }, null, 2)); }
    if (bare === "/favicon.ico" && !openHost) { res.writeHead(204); return res.end(); }
    // Opening a site: it becomes the one at the root, and the frame goes
    // to its page.
    if (bare === "/__open") {
      const site = parseSite(new URL(req.url, ME).searchParams.get("site"));
      if (!site) { res.writeHead(400, { "content-type": "text/plain" }); return res.end("type a site, like www.drought.gov"); }
      if (!allowed(site.host)) { res.writeHead(403, { "content-type": "text/plain" }); return res.end(`${site.host} is not on this server's allow list`); }
      openHost = site.host;
      res.writeHead(302, { location: site.path, "cache-control": "no-store" }); return res.end();
    }
    const x = req.url.match(/^\/__x\/([^/?#]+)(.*)$/);
    let host, pathPart;
    if (x && HOST_RE.test(x[1])) { host = x[1].toLowerCase(); pathPart = x[2] && x[2].startsWith("/") ? x[2] : `/${x[2] || ""}`; }
    else if (bare === "/" && !openHost) { return serveFile(res, APP_DIR, "index.html"); }
    else if (openHost) { host = openHost; pathPart = req.url; }
    if (!host) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("no site is open: /__open?site=<host>"); }
    proxy(req, res, host, pathPart, allowed).catch((e) => { try { res.writeHead(500); res.end(String(e)); } catch (_) { /* gone */ } });
  });
}

module.exports = { rewrite, rewritePage, inject, decodeText, parseSite, createServer, open: (host) => { openHost = host; } };

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`web-controls mini browser: ${ME}/__app/`);
    if (ALLOW.length) console.log(`sites allowed: ${ALLOW.join(", ")}`);
    else console.log("any site (pass --allow host1,host2 to limit it)");
  });
}
