/* frame-bridge.js - the page's half of the mini browser.
 *
 * Runs inside the framed page, where the proxy put it with the page bundles.
 * The agent is in the page that holds the frame (frame-page.js), as the
 * extension's agent is in its service worker, and reaches this page the way
 * the extension's content bridge does: one call in, one answer out.
 *
 *   parent: { wc: "page-call", id, fn, args, globals }
 *   page:   { wc: "page-reply", id, ok, result | error }
 *
 * `globals` names the manifests to answer from, in order - a site's own
 * (USGS, NOAA...) before GENERIC - and any named one not yet loaded here is
 * loaded first, from the bundles built in beside this file.
 */
(function () {
  if (window === window.parent) return; // not framed: nobody to answer
  const loaded = new Set();
  const load = (g) => {
    if (g === "GENERIC" || loaded.has(g) || typeof WC_NAMED_BUNDLES === "undefined" || !WC_NAMED_BUNDLES[g]) return;
    try { WC_NAMED_BUNDLES[g](); } catch (e) { /* GENERIC still answers */ }
    loaded.add(g);
  };
  // From the parent: the address-bar page, whose origin the proxy's shim
  // names on this window (the page is on its own subdomain), or this
  // origin where the widget frames a page of its own. jsdom delivers a
  // message with no source and an empty origin; a browser never sends an
  // empty one, so allowing it changes nothing where this runs for real.
  const shell = () => window.__wcShellOrigin || location.origin;
  const fromParent = (e) => (e.source == null || e.source === window.parent) && (e.origin === shell() || e.origin === location.origin || e.origin === "");
  window.addEventListener("message", async (e) => {
    const m = e.data;
    if (!m || m.wc !== "page-call" || !fromParent(e)) return;
    const reply = (out) => { try { window.parent.postMessage({ wc: "page-reply", id: m.id, ...out }, e.origin || shell()); } catch (err) { /* parent gone */ } };
    const names = Array.isArray(m.globals) && m.globals.length ? m.globals : ["GENERIC"];
    names.forEach(load);
    const owner = names.map((n) => window[n])
      .find((t) => t && typeof t.nodeType !== "number" && typeof t[m.fn] === "function");
    if (!owner) return reply({ ok: false, error: `${m.fn} is not a function on any manifest loaded here` });
    try { reply({ ok: true, result: wcPostable(await owner[m.fn](...(m.args || []))) }); }
    catch (err) { reply({ ok: false, error: String((err && err.message) || err) }); }
  });
})();
