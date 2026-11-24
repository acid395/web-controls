/* proxy-url.js - how a real site's address maps onto the proxy.
 *
 * The scheme is the viewer's (viewer/public/proxy-url.js, Samrat Shrestha),
 * kept the same so the two proxies' addresses are interchangeable. Each
 * site gets its own subdomain of the server's host, and keeps its own
 * path:
 *
 *   https://waterdata.usgs.gov/state/Idaho/?x=1
 *   http://waterdata--usgs--gov.localhost:8787/state/Idaho/?x=1
 *
 * Keeping the path is what lets a site's own router, its root-relative links
 * ("/static/app.js") and its pushState calls work unchanged: only the origin
 * differs. Giving each site its own origin keeps their cookies and storage
 * apart, and keeps every one of them cross-origin to the viewer itself.
 *
 *   "."            -> "--"
 *   http://...     -> "http---" in front (https is the default)
 *   :8080          -> "---8080" at the end
 *
 * A host that already contains "--" (punycode, "xn--") cannot be told apart
 * and is not supported.
 *
 * Shared by the server (require), the address-bar page and the shim put
 * into every proxied page.
 */
(function () {
  const HTTP_PREFIX = "http---";
  const PORT_RE = /---(\d{1,5})$/;

  function encodeOrigin(u) {
    const host = u.hostname.toLowerCase();
    if (!host || host.includes("--") || host.startsWith("[")) return null;
    let label = host.replace(/\./g, "--");
    if (u.protocol === "http:") label = HTTP_PREFIX + label;
    if (u.port) label += `---${u.port}`;
    return label;
  }

  function decodeLabel(label) {
    let protocol = "https:";
    let rest = label;
    if (rest.startsWith(HTTP_PREFIX)) { protocol = "http:"; rest = rest.slice(HTTP_PREFIX.length); }
    let port = "";
    const m = rest.match(PORT_RE);
    if (m) { port = `:${m[1]}`; rest = rest.slice(0, -m[0].length); }
    const host = rest.replace(/--/g, ".");
    if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) return null;
    return `${protocol}//${host}${port}`;
  }

  // proxyHost is the server's own host with its port, "localhost:8787".
  function create(proxyHost, proxyProtocol = "http:") {
    const suffix = `.${proxyHost.toLowerCase()}`;

    const parse = (url) => { try { return new URL(url); } catch (e) { return null; } };

    function isProxy(url) {
      const u = parse(url);
      return !!u && u.protocol === proxyProtocol && u.host.endsWith(suffix) && u.host.length > suffix.length;
    }

    // The real origin behind a proxied one, or null.
    function realOrigin(url) {
      const u = parse(url);
      if (!u || !isProxy(u.href)) return null;
      return decodeLabel(u.host.slice(0, -suffix.length));
    }

    function toReal(url) {
      const u = parse(url);
      if (!u) return url;
      const origin = realOrigin(u.href);
      return origin ? origin + u.pathname + u.search + u.hash : u.href;
    }

    // null when the address cannot be proxied (not http(s), or a host the
    // encoding cannot carry).
    function toProxy(url) {
      const u = parse(url);
      if (!u || !/^https?:$/.test(u.protocol)) return null;
      if (isProxy(u.href)) return u.href;
      const label = encodeOrigin(u);
      if (!label) return null;
      return `${proxyProtocol}//${label}${suffix}${u.pathname}${u.search}${u.hash}`;
    }

    return { isProxy, realOrigin, toReal, toProxy };
  }

  // Services that check which site is asking: a Google Maps API key is
  // restricted to its site's address, and refuses one on localhost
  // (RefererNotAllowedMapError). Their scripts are sent through the proxy,
  // which tells them the real site, in the Referer header and in the page
  // address the Maps script puts in its own query string.
  const REFERRER_CHECKED = ["maps.googleapis.com", "maps.google.com"];

  const api = { create, encodeOrigin, decodeLabel, REFERRER_CHECKED };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else self.WCProxyUrl = api;
})();
