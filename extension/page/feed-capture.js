/* feed-capture.js - records the data a page fetches, so a chart drawn to a
 * canvas can still be read.
 *
 * Runs at document_start in the page's own world, registered per site once
 * that site is enabled (see background.js). Timing is the whole point: a
 * chart requests its series during page load, so an interceptor installed
 * when someone finally asks a question arrives far too late and sees nothing.
 *
 * Deliberately self-contained and side-effect-free beyond the two patches -
 * it runs on every page load of an enabled site, before that site's own code.
 */
(() => {
  if (window.__wcFeedCapture) return;

  // Only data-looking requests are kept; recording every image and analytics
  // beacon would be noise, and holding whole bodies on a long-lived page
  // would leak memory.
  const FEED_URL_RE = /(\/api\/|\/rest\/|\/ogcapi\/|nwis|nwps|waterservices|waterdata|gridpoints|geoserver|\bwfs\b|\bwms\b|query\?|\.json(\?|$)|\.geojson(\?|$)|\.csv(\?|$)|observations|forecast|gauges?\/)/i;
  const FEED_LIMIT = 40;          // most recent N requests
  // Per response, and for all of them together. 200,000 characters each cut
  // off the one response that mattered most: a USGS monitoring location
  // draws its chart from a single 885 KB request - seven days of readings at
  // fifteen minutes - and a truncated body is never parsed, so the agent saw
  // none of it. A budget across all of them keeps a long-lived page from
  // holding forty such bodies at once: the oldest go first.
  const FEED_BODY_CAP = 4000000;
  const FEED_TOTAL_CAP = 24000000;
  // Pictures are not data. NOAA's map requests its marker icons through a
  // URL this pattern matches, and reading every PNG as text was memory spent
  // on nothing.
  const NOT_DATA = /^(image|font|audio|video)\/|octet-stream|protobuf/i;
  const feeds = [];
  let held = 0;
  // Absolute, before it is tested. A page's own requests are often relative:
  // USGS fetches its flood stages from "/flood-stage/01646500/", which has
  // none of the words the pattern looks for until the host is put back on -
  // so the four numbers that answer "how far below flood stage" were never
  // recorded. And fetch() takes a URL object as readily as a string.
  const absolute = (u) => {
    try {
      const raw = typeof u === "string" ? u : (u && (u.href || u.url));
      return raw ? new URL(String(raw), location.href).href : null;
    } catch (e) { return null; }
  };
  const record = (url, method, status, text, contentType) => {
    if (!url || !FEED_URL_RE.test(url)) return;
    if (contentType && NOT_DATA.test(contentType)) return;
    const body = text ? text.slice(0, FEED_BODY_CAP) : null;
    held += body ? body.length : 0;
    feeds.push({
      url: String(url).slice(0, 400), method, status, contentType: contentType || null,
      at: new Date().toISOString(),
      bytes: text ? text.length : 0,
      body,
      truncated: !!(text && text.length > FEED_BODY_CAP),
    });
    while (feeds.length > FEED_LIMIT || (held > FEED_TOTAL_CAP && feeds.length > 1)) {
      const gone = feeds.shift();
      held -= gone.body ? gone.body.length : 0;
    }
  };

  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (...args) {
      return nativeFetch.apply(this, args).then((res) => {
        try {
          const url = absolute(args[0]);
          const type = res.headers.get("content-type");
          if (url && FEED_URL_RE.test(url) && !(type && NOT_DATA.test(type))) {
            // Clone first: reading the body the page is about to read
            // would consume the stream and break the page itself.
            res.clone().text()
              .then((t) => record(url, (args[1] && args[1].method) || "GET", res.status, t, type))
              .catch(() => {});
          }
        } catch (e) { /* never let capture break a real request */ }
        return res;
      });
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url, ...rest) {
      this.__wcMethod = method; this.__wcUrl = absolute(url);
      return open.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          const type = this.getResponseHeader && this.getResponseHeader("content-type");
          const text = typeof this.responseText === "string" ? this.responseText : null;
          record(this.__wcUrl, this.__wcMethod, this.status, text, type);
        } catch (e) { /* responseType blob/arraybuffer has no responseText */ }
      });
      return send.apply(this, args);
    };
  }

  window.__wcFeedCapture = { feeds, installedAt: new Date().toISOString() };
  
})();
