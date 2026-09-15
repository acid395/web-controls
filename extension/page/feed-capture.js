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
  const FEED_BODY_CAP = 200000;   // characters kept per response
  const feeds = [];
  const record = (url, method, status, text, contentType) => {
    if (!url || !FEED_URL_RE.test(url)) return;
    feeds.push({
      url: String(url).slice(0, 400), method, status, contentType: contentType || null,
      at: new Date().toISOString(),
      bytes: text ? text.length : 0,
      body: text ? text.slice(0, FEED_BODY_CAP) : null,
      truncated: !!(text && text.length > FEED_BODY_CAP),
    });
    while (feeds.length > FEED_LIMIT) feeds.shift();
  };

  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (...args) {
      return nativeFetch.apply(this, args).then((res) => {
        try {
          const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url);
          if (url && FEED_URL_RE.test(url)) {
            // Clone first: reading the body the page is about to read
            // would consume the stream and break the page itself.
            res.clone().text()
              .then((t) => record(url, (args[1] && args[1].method) || "GET", res.status, t, res.headers.get("content-type")))
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
      this.__wcMethod = method; this.__wcUrl = url;
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
