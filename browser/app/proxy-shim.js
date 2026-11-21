/* proxy-shim.js - the proxy, continued inside the page.
 *
 * The server rewrites the addresses it can see in HTML, CSS and script
 * text. A page also builds addresses as it runs - "https://api." + host,
 * img.src = url, pushState to "/map" - and those the server never sees.
 * This runs before any of the page's own scripts and turns every such
 * address back towards the server as it is used:
 *
 *   https://<open site>/p, //<open site>/p   ->  /p
 *   https://x.y.z/p, //x.y.z/p               ->  <server>/__x/x.y.z/p
 *   /p in a page served under /__x/<host>    ->  /__x/<host>/p
 *
 * The open site is at the server's root, so its own root-relative
 * addresses, and window.location, are already right and are left alone.
 *
 * Patched: fetch, XMLHttpRequest, sendBeacon, EventSource, Worker,
 * history.pushState/replaceState, window.open (which stays in this frame,
 * where the address bar is), the src/href/action/srcset setters of the
 * elements that load things, setAttribute, innerHTML and friends,
 * document.write, and a click on a link to another site, which opens that
 * site at the root through /__open. Service workers are refused: one would
 * cache the site's addresses and answer them without the server.
 */
(function () {
  const tag = document.currentScript;
  if (!tag || window.__wcProxyShim) return;
  window.__wcProxyShim = true;
  const ME = tag.dataset.me;
  const HOST = (tag.dataset.host || "").toLowerCase();
  const BASE = tag.dataset.base || "";
  window.__wcProxyHost = HOST;
  const NOT_FETCHED = /^(www\.w3\.org|schema\.org|ogp\.me|purl\.org|xmlns\.com|challenges\.cloudflare\.com|(www\.)?recaptcha\.net|(js\.|api\.)?hcaptcha\.com)$/i;
  const OURS = /^\/(?:__x|__wc|__app|__open)(?:\/|\?|$)/;
  // The open site's host: this page's, unless this page is another site's
  // under /__x/.
  const OPEN = BASE ? null : HOST;
  const baseFor = (h) => (h === OPEN ? "" : `/__x/${h}`);

  function fix(u) {
    if (u instanceof URL) u = u.href;
    if (typeof u !== "string" || !u) return u;
    if (u.startsWith(ME + "/")) return u;
    const abs = u.match(/^(https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/?#]|$)/i);
    if (abs) {
      if (NOT_FETCHED.test(abs[2])) return u;
      const rest = u.slice(abs[0].length);
      return `${ME}${baseFor(abs[2].toLowerCase())}${rest.startsWith("/") || !rest ? rest || "/" : `/${rest}`}`;
    }
    if (BASE && u.startsWith("/") && !u.startsWith("//") && !OURS.test(u)) return `${BASE}${u}`;
    return u;
  }
  const fixSrcset = (v) => (typeof v === "string" ? v.split(",").map((c) => { const m = c.trim().match(/^(\S+)(\s.*)?$/); return m ? fix(m[1]) + (m[2] || "") : c; }).join(", ") : v);
  // The same rewrite the server does, for HTML a script builds.
  const fixHtml = (html) => (typeof html !== "string" ? html : html
    .replace(/(https?:|(?<=["'`=(]))\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'`\s)?#,;]|$)/gi, (m, s, h) => (NOT_FETCHED.test(h) ? m : `${ME}${baseFor(h.toLowerCase())}`))
    .replace(/(href|src|action|data-src|poster|formaction)=(["'])\/(?!\/|__x\/|__wc\/|__app\/)/gi, (m, a, q) => `${a}=${q}${BASE}/`)
    .replace(/srcset=(["'])([^"']*)\1/gi, (m, q, v) => `srcset=${q}${fixSrcset(v)}${q}`)
    .replace(/url\((["']?)\/(?!\/|__x\/)/gi, (m, q) => `url(${q}${BASE}/`)
    .replace(/\sintegrity=(["'])[^"']*\1/gi, "")
    .replace(/\starget=(["']?)(_blank|_top|_parent)\1/gi, ' target="_self"'));
  window.__wcProxyFix = fix;

  // --- requests -----------------------------------------------------------
  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string" || input instanceof URL) input = fix(input);
        else if (input && typeof input.url === "string") { const to = fix(input.url); if (to !== input.url) input = new Request(to, input); }
      } catch (e) { /* as it was */ }
      return nativeFetch.call(this, input, init);
    };
  }
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { return xo.call(this, method, fix(url), ...rest); };
  if (navigator.sendBeacon) { const sb = navigator.sendBeacon; navigator.sendBeacon = function (url, data) { return sb.call(this, fix(url), data); }; }
  for (const name of ["EventSource", "Worker", "SharedWorker"]) {
    const Native = window[name];
    if (typeof Native !== "function") continue;
    const Wrapped = function (url, opts) { return new Native(fix(url), opts); };
    Wrapped.prototype = Native.prototype;
    window[name] = Wrapped;
  }
  if (navigator.serviceWorker && navigator.serviceWorker.register) {
    navigator.serviceWorker.register = () => Promise.reject(new Error("service workers are not run through the web-controls proxy"));
  }

  // --- navigation ---------------------------------------------------------
  for (const name of ["pushState", "replaceState"]) {
    const h = history[name];
    history[name] = function (state, title, url) { return h.call(this, state, title, url == null ? url : fix(String(url))); };
  }
  // Another site, opened as the site at the root rather than shown under
  // /__x/, where its own address would be wrong.
  const openOther = (u) => {
    const m = String(u).match(/^(?:https?:\/\/[^/]+)?\/__x\/([^/?#]+)(.*)$/);
    return m ? `/__open?site=${encodeURIComponent(m[1] + (m[2] || "/"))}` : null;
  };
  const nativeOpen = window.open;
  window.open = function (url, target, features) {
    if (url && target !== "_self") {
      try { const to = fix(String(url)); location.href = openOther(to) || to; return window; } catch (e) { /* below */ }
    }
    return nativeOpen ? nativeOpen.call(this, url == null ? url : fix(String(url)), target, features) : null;
  };
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download")) return;
    const to = openOther(a.href);
    if (to) { e.preventDefault(); location.href = to; }
  }, true);

  // --- elements -----------------------------------------------------------
  const URL_ATTRS = /^(src|href|action|formaction|poster|data|data-src|xlink:href)$/i;
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = String(name);
    if (URL_ATTRS.test(n)) value = fix(String(value));
    else if (/^srcset$/i.test(n)) value = fixSrcset(String(value));
    else if (/^integrity$/i.test(n)) return;
    return sa.call(this, name, value);
  };
  const props = [
    [HTMLScriptElement, "src"], [HTMLImageElement, "src"], [HTMLImageElement, "srcset", fixSrcset], [HTMLSourceElement, "src"], [HTMLSourceElement, "srcset", fixSrcset],
    [HTMLLinkElement, "href"], [HTMLAnchorElement, "href"], [HTMLAreaElement, "href"], [HTMLIFrameElement, "src"], [HTMLFrameElement, "src"],
    [HTMLVideoElement, "src"], [HTMLVideoElement, "poster"], [HTMLAudioElement, "src"], [HTMLTrackElement, "src"], [HTMLEmbedElement, "src"],
    [HTMLObjectElement, "data"], [HTMLFormElement, "action"], [HTMLInputElement, "src"], [HTMLInputElement, "formAction"], [HTMLButtonElement, "formAction"],
  ];
  for (const [Ctor, prop, f = fix] of props) {
    if (typeof Ctor !== "function") continue;
    const d = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!d || !d.set) continue;
    Object.defineProperty(Ctor.prototype, prop, { ...d, set(v) { d.set.call(this, f(String(v))); } });
  }
  for (const [Ctor, prop] of [[Element, "innerHTML"], [Element, "outerHTML"], [ShadowRoot, "innerHTML"]]) {
    if (typeof Ctor !== "function") continue;
    const d = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
    if (!d || !d.set) continue;
    Object.defineProperty(Ctor.prototype, prop, { ...d, set(v) { d.set.call(this, fixHtml(String(v))); } });
  }
  const iah = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (where, html) { return iah.call(this, where, fixHtml(String(html))); };
  for (const name of ["write", "writeln"]) {
    const w = document[name];
    document[name] = function (...parts) { return w.apply(this, parts.map((p) => fixHtml(String(p)))); };
  }
})();
