/* server.js - the viewer page, and the proxy that lets it control a site.
 *
 *   node viewer/server.js            then open http://localhost:5280
 *
 * Why a proxy at all. A page cannot reach into an iframe showing another
 * site (the same-origin policy), and many sites refuse to be framed at all
 * (X-Frame-Options, CSP frame-ancestors). So the iframe loads the site
 * through this server, which:
 *
 *   - serves it from its own subdomain, path unchanged (see proxy-url.js)
 *   - drops the headers that forbid framing
 *   - puts one <script> at the top of every HTML page: frame/agent.js, the
 *     command executor, which talks to the viewer through postMessage
 *
 * localhost:5280          the viewer (public/)
 * *.localhost:5280        the proxied sites
 *
 * Browsers resolve every *.localhost name to this machine, so there is no
 * DNS or hosts-file setup.
 *
 * Local use only. It is a proxy to anywhere, so it listens on the loopback
 * interface and refuses private-network targets.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const ProxyUrl = require("./public/proxy-url.js");

const PORT = Number(process.env.PORT) || 5280;
const SHELL_HOST = `localhost:${PORT}`;
const SHELL_ORIGIN = `http://${SHELL_HOST}`;
const urls = ProxyUrl.create(SHELL_HOST, "http:");
const PUBLIC = path.join(__dirname, "public");
const AGENT_PATH = "/__wc/agent.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

// --- the viewer page ------------------------------------------------------

function serveShell(req, res) {
  const url = new URL(req.url, SHELL_ORIGIN);
  let rel = decodeURIComponent(url.pathname);
  // Lets the page tell this server from a plain static one (Live Server,
  // file://), which can't proxy anything.
  if (rel === "/__wc/viewer") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end(SHELL_ORIGIN); return; }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

// The executor, with the two values it needs written in. Wrapped so nothing
// but window.__wcFrame lands on the site's window.
function agentScript() {
  const shared = fs.readFileSync(path.join(PUBLIC, "proxy-url.js"), "utf8");
  const agent = fs.readFileSync(path.join(__dirname, "frame", "agent.js"), "utf8");
  return `(function () {
if (window.__wcFrame) return;
const WC_SHELL_ORIGIN = ${JSON.stringify(SHELL_ORIGIN)};
const WC_PROXY_HOST = ${JSON.stringify(SHELL_HOST)};
const WCProxyUrl = (function () { const module = { exports: {} };
${shared}
return module.exports; })();
${agent}
})();
`;
}

// --- the proxy ------------------------------------------------------------

// Hop-by-hop headers, and the ones fetch sets for itself.
const DROP_REQUEST = new Set([
  "host", "connection", "keep-alive", "proxy-connection", "proxy-authorization",
  "transfer-encoding", "upgrade", "te", "trailer", "expect",
  "accept-encoding", "content-length", "sec-fetch-site",
]);

// Encoding and length change on the way through (fetch decompresses). The
// rest forbid framing, pin the site to https, or would let the site's own
// CORS answer through instead of this one.
const DROP_RESPONSE = new Set([
  "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive",
  "x-frame-options", "content-security-policy", "content-security-policy-report-only",
  "strict-transport-security", "cross-origin-opener-policy", "cross-origin-embedder-policy",
  "cross-origin-resource-policy", "access-control-allow-origin", "access-control-allow-credentials",
  "report-to", "nel", "alt-svc", "clear-site-data", "set-cookie",
]);

// Not the local machine, and not the local network: a site in the frame can
// make requests through this proxy, and should not reach a router or a
// service bound to localhost by doing so.
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function charsetOf(type) {
  const m = /charset=([^;]+)/i.exec(type || "");
  return m ? m[1].trim().replace(/^["']|["']$/g, "").toLowerCase() : "utf-8";
}

function decodeText(buf, type) {
  try { return new TextDecoder(charsetOf(type)).decode(buf); } catch (e) { return buf.toString("utf8"); }
}

// Absolute links back to the site itself, pointed at its proxy instead:
// "https://waterdata.usgs.gov/x" and "//waterdata.usgs.gov/x". Only in HTML
// and CSS, where they are attribute and url() values; script text is left
// alone, and its requests are routed in the page instead.
function pointAtProxy(text, realOrigin, proxyOrigin) {
  const host = new URL(realOrigin).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:https?:)?//${host}(?=[/"'\\s)?#<]|$)`, "gi");
  return text.replace(re, proxyOrigin);
}

// A proxied page's address, back to the real one. The Google Maps script
// sends location.href to Google, which checks it against the API key's
// allowed sites: older versions in a query string ("1shttp%3A%2F%2F..."),
// newer ones in a JSON request body (MapsJsInternalService/GetViewportInfo).
// Plain or percent-encoded, as it was found.
const PROXIED_ORIGIN_RE = new RegExp(`http(:|%3A)(?:/|%2F){2}([a-z0-9-]+)\\.localhost(?::|%3A)${PORT}`, "gi");
function unproxyText(text) {
  return text.replace(PROXIED_ORIGIN_RE, (m, colon, label) => {
    const real = ProxyUrl.decodeLabel(label.toLowerCase());
    if (!real) return m;
    return colon === ":" ? real : encodeURIComponent(real);
  });
}
function unproxyQuery(pathAndQuery) {
  const q = pathAndQuery.indexOf("?");
  if (q < 0) return pathAndQuery;
  return pathAndQuery.slice(0, q) + unproxyText(pathAndQuery.slice(q));
}

// Text bodies only: rewriting changes the length, which would corrupt a
// binary (length-prefixed) protobuf.
function unproxyBody(body, contentType) {
  if (!body || !body.length || !/json|text|x-www-form-urlencoded/i.test(contentType || "")) return body;
  const text = body.toString("utf8");
  const out = unproxyText(text);
  return out === text ? body : out;
}

function injectAgent(html) {
  const tag = `<script src="${AGENT_PATH}"></script>`;
  // A CSP in a meta tag forbids framing and inline handlers just as the
  // header does.
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy(?:-report-only)?["']?[^>]*>/gi, "");
  // First in <head>, so the request and navigation patches are in place
  // before any of the site's own scripts run.
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const root = /<html(?:\s[^>]*)?>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + tag + html.slice(root.index + root[0].length);
  return tag + html;
}

function errorPage(res, status, title, detail) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#17212e">
<h1 style="font-size:20px">${title}</h1><p>${detail}</p></body>`);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function proxy(req, res, host) {
  const proxyOrigin = `http://${host}`;
  if (req.url.split("?")[0] === AGENT_PATH) {
    res.writeHead(200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache" });
    res.end(agentScript());
    return;
  }

  const realOrigin = urls.realOrigin(proxyOrigin + "/");
  if (!realOrigin) { errorPage(res, 400, "Not a site address", `${escapeHtml(host)} does not name a site.`); return; }
  const target = new URL(unproxyQuery(req.url), realOrigin);
  if (blockedHost(target.hostname)) {
    errorPage(res, 403, "Blocked", `The viewer does not open addresses on this machine or the local network (${escapeHtml(target.hostname)}).`);
    return;
  }

  // CORS for requests between proxied sites (a page on one fetching an API
  // on another): answered here, for whichever proxied origin asked.
  const origin = req.headers.origin;
  const cors = origin && origin !== "null"
    ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" }
    : {};
  if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
    res.writeHead(204, {
      ...cors,
      "access-control-allow-methods": req.headers["access-control-request-method"],
      "access-control-allow-headers": req.headers["access-control-request-headers"] || "*",
      "access-control-max-age": "600",
    });
    res.end();
    return;
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP_REQUEST.has(k) && v != null) headers[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  // The site sees itself, not localhost.
  if (origin && origin !== "null") headers.origin = urls.realOrigin(origin + "/") || origin;
  if (req.headers.referer) headers.referer = urls.toReal(req.headers.referer);

  let upstream;
  try {
    let body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    if (body && ProxyUrl.REFERRER_CHECKED.includes(target.hostname)) body = unproxyBody(body, req.headers["content-type"]);
    upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual" });
  } catch (e) {
    const why = (e && e.cause && e.cause.code) || (e && e.message) || String(e);
    errorPage(res, 502, "Could not reach the site", `${escapeHtml(target.href)}<br><br>${escapeHtml(why)}`);
    return;
  }

  const out = {};
  upstream.headers.forEach((v, k) => { if (!DROP_RESPONSE.has(k)) out[k] = v; });
  // Cookies stay on the proxied origin: a Domain= naming the real site would
  // be refused by the browser.
  const cookies = upstream.headers.getSetCookie().map((c) => c.replace(/;\s*domain=[^;]*/gi, ""));
  if (cookies.length) out["set-cookie"] = cookies;
  if (out.location) {
    try { out.location = urls.toProxy(new URL(out.location, target).href) || out.location; } catch (e) { /* left as sent */ }
  }
  Object.assign(out, cors);

  const type = out["content-type"] || "";
  const dest = req.headers["sec-fetch-dest"];
  const isDocument = /text\/html|application\/xhtml\+xml/i.test(type) && (!dest || dest === "document" || dest === "iframe");
  const isCss = /text\/css/i.test(type);
  const hasBody = req.method !== "HEAD" && upstream.body && upstream.status !== 204 && upstream.status !== 304;

  if (hasBody && (isDocument || isCss)) {
    let text = decodeText(Buffer.from(await upstream.arrayBuffer()), type);
    text = pointAtProxy(text, realOrigin, proxyOrigin);
    if (isDocument) {
      for (const h of ProxyUrl.REFERRER_CHECKED) {
        text = pointAtProxy(text, `https://${h}`, urls.toProxy(`https://${h}/`).slice(0, -1));
      }
      text = injectAgent(text);
    }
    out["content-type"] = type.replace(/;\s*charset=[^;]+/i, "") + "; charset=utf-8";
    // The document now carries a script the site never sent; a cached copy
    // from before the viewer changed would carry an old one.
    if (isDocument) { out["cache-control"] = "no-store"; delete out.etag; delete out["last-modified"]; }
    res.writeHead(upstream.status, out);
    res.end(text);
    return;
  }

  res.writeHead(upstream.status, out);
  if (!hasBody) { res.end(); return; }
  Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
}

function handle(req, res) {
  const host = String(req.headers.host || "").toLowerCase();
  if (host === SHELL_HOST) { serveShell(req, res); return; }
  // Subdomains of 127.0.0.1 are not a thing; the viewer has to be on
  // localhost for its sites to be on *.localhost.
  if (host === `127.0.0.1:${PORT}`) { res.writeHead(302, { Location: SHELL_ORIGIN + req.url }); res.end(); return; }
  if (host.endsWith(`.${SHELL_HOST}`)) {
    proxy(req, res, host).catch((e) => {
      if (!res.headersSent) errorPage(res, 500, "Proxy error", escapeHtml((e && e.message) || e));
      else res.destroy();
    });
    return;
  }
  res.writeHead(400, { "Content-Type": "text/plain" });
  res.end(`open ${SHELL_ORIGIN}`);
}

// Both loopback addresses, since a browser may resolve localhost to either.
// Never all interfaces: this is an open proxy.
if (require.main === module) {
  const server = http.createServer(handle).listen(PORT, "127.0.0.1", () => {
    console.log(`web-controls viewer: ${SHELL_ORIGIN}`);
  });
  server.on("error", (e) => { console.error(String(e.message || e)); process.exit(1); });
  http.createServer(handle).listen(PORT, "::1").on("error", () => { /* no IPv6 loopback here */ });
}

module.exports = { pointAtProxy, injectAgent, blockedHost, unproxyQuery, unproxyBody };
