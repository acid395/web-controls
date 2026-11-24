/* proxy-shim.js - the proxy, continued inside the page.
 *
 * The server puts this first in <head> of every page it serves, before any
 * of the site's own scripts, with two values on the tag: data-me, the
 * address-bar page's origin, and data-proxy, the server's host. Three jobs:
 *
 *   1. Keep the site inside the proxy. The page is on its own subdomain
 *      with its real path, so its own links and requests already work. Its
 *      requests to other sites (fetch, XHR, beacons, event streams) are
 *      pointed at those sites' proxied addresses, so they neither fail on
 *      CORS nor go round the server; navigations to other sites, new-tab
 *      links and window.open stay in this frame, where the address bar is.
 *   2. Tell the address-bar page where the frame is (the real address) and
 *      when it changes: at the start of every document, when it is ready,
 *      and on every route change. The frame is cross-origin to that page,
 *      so this is the only way it can know.
 *   3. Carry out the address bar's own navigation: back, forward, reload.
 *
 * Service workers are refused: one would cache the site's pages and answer
 * them without the server, without these tags.
 */
(function () {
  const tag = document.currentScript;
  if (!tag || window.__wcProxyShim) return;
  window.__wcProxyShim = true;
  const ME = tag.dataset.me;
  const PROXY = tag.dataset.proxy;
  window.__wcShellOrigin = ME;

  // --- addresses (the scheme of proxy-url.js, inline) ----------------------
  const SUFFIX = `.${PROXY}`;
  const encodeOrigin = (u) => {
    const host = u.hostname.toLowerCase();
    if (!host || host.includes("--") || host.startsWith("[")) return null;
    let label = host.replace(/\./g, "--");
    if (u.protocol === "http:") label = `http---${label}`;
    if (u.port) label += `---${u.port}`;
    return label;
  };
  const decodeLabel = (label) => {
    let protocol = "https:", rest = label, port = "";
    if (rest.startsWith("http---")) { protocol = "http:"; rest = rest.slice(7); }
    const m = rest.match(/---(\d{1,5})$/);
    if (m) { port = `:${m[1]}`; rest = rest.slice(0, -m[0].length); }
    const host = rest.replace(/--/g, ".");
    return /^[a-z0-9.-]+$/.test(host) && !host.startsWith(".") && !host.endsWith(".") ? `${protocol}//${host}${port}` : null;
  };
  const isProxied = (u) => u.protocol === location.protocol && u.host.endsWith(SUFFIX) && u.host.length > SUFFIX.length;
  const toProxy = (u) => { const label = encodeOrigin(u); return label ? `${location.protocol}//${label}${SUFFIX}${u.pathname}${u.search}${u.hash}` : null; };
  const toReal = (href) => {
    try {
      const u = new URL(href);
      const real = isProxied(u) ? decodeLabel(u.host.slice(0, -SUFFIX.length)) : null;
      return real ? real + u.pathname + u.search + u.hash : href;
    } catch (e) { return href; }
  };
  window.__wcRealOrigin = toReal(`${location.origin}/`).slice(0, -1);

  // Names, not places the page fetches; and a bot-check widget (Turnstile,
  // reCAPTCHA, hCaptcha), which only runs from its own origin.
  const NOT_ROUTED = /^(www\.w3\.org|schema\.org|ogp\.me|purl\.org|xmlns\.com|challenges\.cloudflare\.com|(www\.)?recaptcha\.net|(js\.|api\.)?hcaptcha\.com)$/i;
  // The proxied address for an http(s) address of another site, or null
  // when it is to be left alone.
  function route(url) {
    let u;
    try { u = new URL(String(url), document.baseURI); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || u.origin === ME || isProxied(u) || NOT_ROUTED.test(u.hostname)) return null;
    return toProxy(u);
  }
  window.__wcProxyFix = (u) => route(u) || u;

  // --- 1. requests ----------------------------------------------------------
  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof Request !== "undefined" && input instanceof Request) { const to = route(input.url); if (to) input = new Request(to, input); }
        else { const to = route(String(input)); if (to) input = to; }
      } catch (e) { /* as the page wrote it */ }
      return nativeFetch.call(window, input, init);
    };
  }
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { try { const to = route(String(url)); if (to) url = to; } catch (e) { /* as written */ } return xo.call(this, method, url, ...rest); };
  if (navigator.sendBeacon) { const sb = navigator.sendBeacon; navigator.sendBeacon = function (url, data) { return sb.call(this, route(String(url)) || url, data); }; }
  if (typeof EventSource === "function") {
    const Native = EventSource;
    const Wrapped = function (url, opts) { return new Native(route(String(url)) || url, opts); };
    Wrapped.prototype = Native.prototype;
    window.EventSource = Wrapped;
  }
  if (navigator.serviceWorker && navigator.serviceWorker.register) {
    navigator.serviceWorker.register = () => Promise.reject(new Error("service workers are not run through the web-controls proxy"));
  }

  // Scripts from services that check the asking site's address (Google
  // Maps: an API key allowed for the real site refuses localhost) go
  // through the proxy, which tells them the real site. Maps adds its scripts
  // by setting src on new <script>s, so the setter is where to catch them;
  // the tags already in the HTML are rewritten by the server.
  const CHECKED = new Set(["maps.googleapis.com", "maps.google.com"]);
  const viaProxyIfChecked = (value) => {
    try { const u = new URL(String(value), document.baseURI); return (CHECKED.has(u.hostname) && toProxy(u)) || value; } catch (e) { return value; }
  };
  const scriptSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
  if (scriptSrc && scriptSrc.set) Object.defineProperty(HTMLScriptElement.prototype, "src", { ...scriptSrc, set(v) { scriptSrc.set.call(this, viaProxyIfChecked(v)); } });
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLScriptElement && String(name).toLowerCase() === "src") value = viaProxyIfChecked(value);
    return sa.call(this, name, value);
  };

  // --- navigations ----------------------------------------------------------
  // A form's POST body is lost if its navigation is redirected afterwards,
  // so its action is pointed at the proxy before it is sent.
  const fixForm = (form) => { if (form && form.tagName === "FORM") { const to = route(form.action); if (to) form.setAttribute("action", to); } };
  window.addEventListener("submit", (e) => fixForm(e.target), true);
  const nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () { fixForm(this); return nativeSubmit.call(this); };
  // Links and scripted navigations (location.href = ...) that would leave
  // the proxy. The Navigation API sees all of them; without it, clicks on
  // links are the common case and are caught below.
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    window.navigation.addEventListener("navigate", (e) => {
      if (!e.cancelable || e.downloadRequest != null || e.formData) return;
      const to = route(e.destination.url);
      if (to) { e.preventDefault(); location.assign(to); }
    });
  }
  // New tabs and windows, and links aimed at the top (_top, _parent), open
  // in this frame: a page outside it is a page the agent cannot reach.
  window.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.composedPath ? e.composedPath() : [e.target]).find((n) => n && (n.tagName === "A" || n.tagName === "AREA") && n.href);
    if (!a || a.hasAttribute("download")) return;
    const target = (a.getAttribute("target") || "").toLowerCase();
    const leaves = target && target !== "_self";
    const to = route(a.href);
    if (!leaves && !(to && !window.navigation)) return;
    const dest = to || a.href;
    if (!/^https?:/i.test(dest)) return;
    e.preventDefault();
    location.assign(dest);
  }, true);
  const nativeOpen = window.open;
  window.open = function (url, ...rest) {
    if (url) {
      let to = route(String(url));
      if (!to) { try { to = new URL(String(url), document.baseURI).href; } catch (e) { to = null; } }
      if (to && /^https?:/.test(to)) { location.assign(to); return null; }
    }
    return nativeOpen ? nativeOpen.call(window, url, ...rest) : null;
  };

  // --- 2. telling the address bar where we are -----------------------------
  // Only the page directly inside the address-bar page reports. The site's
  // own iframes get this script too, and stay quiet.
  const framed = window.parent !== window && window.parent === window.top;
  const post = (msg) => { if (framed) { try { window.parent.postMessage({ wc: "page-state", ...msg }, ME); } catch (e) { /* parent gone */ } } };
  const report = (status) => post({ url: toReal(location.href), title: document.title, status });
  report(document.readyState === "loading" ? "loading" : "complete");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => report("complete"), { once: true });
  window.addEventListener("load", () => report("complete"));
  for (const name of ["pushState", "replaceState"]) {
    const h = history[name];
    history[name] = function (...a) { const out = h.apply(this, a); try { report("complete"); } catch (e) { /* never break the router */ } return out; };
  }
  window.addEventListener("popstate", () => report("complete"));
  window.addEventListener("hashchange", () => report("complete"));
  window.addEventListener("pagehide", () => post({ status: "leaving", url: toReal(location.href), title: document.title }));

  // --- 3. the address bar's own navigation ----------------------------------
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.wc !== "page-nav" || !(e.origin === ME || e.origin === "") || (e.source != null && e.source !== window.parent)) return;
    if (m.do === "back") history.back();
    else if (m.do === "forward") history.forward();
    else if (m.do === "reload") location.reload();
    else if (m.do === "go" && typeof m.url === "string") location.assign(route(m.url) || m.url);
  });
})();
