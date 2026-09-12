/* ============================================================================
 * map-probe.js - paste into the DevTools console on any page with a map.
 *
 * Answers one question: can this map be driven by script, and how?
 *
 *   1. DOM markers      Leaflet and some others draw each marker as a real
 *                       element. If so, the existing WC toolbox can click them.
 *   2. JS map instance  MapLibre / Mapbox GL, OpenLayers, Esri, Google draw to
 *                       a canvas, but keep a JavaScript map object with pan /
 *                       zoom / query-feature / open-popup methods. If that
 *                       object is reachable from the page, script can drive it.
 *   3. Neither          Canvas map, instance buried in a closure. Stuck.
 *
 * Read-only. It does not move the map or click anything.
 *   window.__mapProbe -> the full result, including any map instance found
 * ========================================================================== */
(() => {
  const out = { libraries: [], domMarkers: {}, instances: [], verdict: "" };

  const deepQueryAll = (sel, root = document) => {
    const acc = [];
    const visit = (node) => {
      node.querySelectorAll(sel).forEach((el) => acc.push(el));
      node.querySelectorAll("*").forEach((el) => el.shadowRoot && visit(el.shadowRoot));
    };
    visit(root);
    return acc;
  };

  /* ---------- 1. which libraries are loaded ---------- */
  const libSigns = {
    "Leaflet": () => !!window.L && !!window.L.Map,
    "Mapbox GL": () => !!window.mapboxgl,
    "MapLibre GL": () => !!window.maplibregl,
    "OpenLayers": () => !!window.ol && !!window.ol.Map,
    "Esri ArcGIS": () => !!(window.__esri || document.querySelector("[class*='esri-']")),
    "Google Maps": () => !!(window.google && window.google.maps),
  };
  for (const [name, test] of Object.entries(libSigns)) {
    let hit = false;
    try { hit = test(); } catch (e) {}
    if (hit) out.libraries.push(name);
  }
  // also infer from DOM classes, in case the global is namespaced away
  const domHints = {
    "Leaflet": ".leaflet-container",
    "Mapbox GL": ".mapboxgl-canvas",
    "MapLibre GL": ".maplibregl-canvas",
    "OpenLayers": ".ol-viewport",
    "Esri ArcGIS": "[class*='esri-']",
    "Google Maps": ".gm-style",
  };
  for (const [name, sel] of Object.entries(domHints)) {
    if (deepQueryAll(sel).length && !out.libraries.includes(name)) out.libraries.push(name + " (DOM only)");
  }

  /* ---------- 2. DOM markers you could click directly ---------- */
  out.domMarkers = {
    leafletMarkerIcons: deepQueryAll(".leaflet-marker-icon").length,
    leafletVectorPaths: deepQueryAll(".leaflet-interactive").length,   // SVG circles/polys
    svgInsideMap: deepQueryAll(".leaflet-container svg path, .leaflet-container circle").length,
    genericRoleButtonsInMap: deepQueryAll(
      ".leaflet-container [role=button], .ol-viewport [role=button], [class*='esri-'] [role=button]"
    ).length,
  };

  /* ---------- 3. hunt for a JavaScript map instance ---------- */
  // duck-typed signatures: an object is "a <lib> map" if it has these methods
  const instanceSigns = [
    { lib: "Leaflet",     keys: ["getCenter", "getZoom", "eachLayer", "setView"],
      read: (m) => ({ center: m.getCenter(), zoom: m.getZoom(), layers: (() => { let n = 0; m.eachLayer(() => n++); return n; })() }) },
    { lib: "Mapbox/MapLibre GL", keys: ["getCenter", "getZoom", "queryRenderedFeatures", "getStyle"],
      read: (m) => ({ center: m.getCenter(), zoom: m.getZoom(),
        sources: Object.keys(m.getStyle().sources || {}),
        renderedFeatures: m.queryRenderedFeatures().length }) },
    { lib: "OpenLayers", keys: ["getView", "getLayers", "forEachFeatureAtPixel", "renderSync"],
      read: (m) => ({ center: m.getView().getCenter(), zoom: m.getView().getZoom(),
        layers: m.getLayers().getLength() }) },
    { lib: "Esri MapView/SceneView", keys: ["hitTest", "goTo", "toScreen", "toMap"],
      read: (m) => ({ center: m.center && [m.center.longitude, m.center.latitude], zoom: m.zoom,
        layers: m.map && m.map.layers && m.map.layers.length }) },
    { lib: "Google Maps", keys: ["getBounds", "panTo", "setZoom", "getDiv"],
      read: (m) => ({ center: m.getCenter && m.getCenter().toJSON(), zoom: m.getZoom && m.getZoom() }) },
  ];

  const looksLike = (obj, keys) => {
    try { return obj && typeof obj === "object" && keys.every((k) => typeof obj[k] === "function"); }
    catch (e) { return false; }
  };

  const seen = new Set();
  let scanned = 0;
  const MAX = 60000;
  const scan = (obj, path, depth) => {
    if (scanned++ > MAX || depth > 3 || obj == null) return;
    if (typeof obj !== "object" && typeof obj !== "function") return;
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const sig of instanceSigns) {
      if (looksLike(obj, sig.keys) && !out.instances.some((i) => i.obj === obj)) {
        let facts = {};
        try { facts = sig.read(obj); } catch (e) { facts = { readError: String(e) }; }
        out.instances.push({ lib: sig.lib, foundAt: path, obj, facts });
      }
    }
    // don't walk into DOM nodes or huge builtins
    if (obj instanceof Node || obj instanceof Window) return;
    let keys = [];
    try { keys = Object.getOwnPropertyNames(obj); } catch (e) { return; }
    for (const k of keys) {
      if (k === "self" || k === "window" || k === "top" || k === "parent" || k === "frames" || k === "globalThis") continue;
      let v;
      try { v = obj[k]; } catch (e) { continue; }
      scan(v, path + "." + k, depth + 1);
    }
  };
  scan(window, "window", 0);

  /* ---------- verdict ---------- */
  const markerCount = out.domMarkers.leafletMarkerIcons + out.domMarkers.leafletVectorPaths + out.domMarkers.genericRoleButtonsInMap;
  if (markerCount > 0) {
    out.verdict = `DOM markers present (${markerCount}). WC.realClick / clickByText can drive individual markers directly.`;
  } else if (out.instances.length) {
    out.verdict = `Canvas map, but a JS instance is reachable at: ${out.instances.map((i) => i.foundAt).join(", ")}. ` +
      `Drive it through the library API (pan/zoom/queryFeatures/openPopup). window.__mapProbe.instances[0].obj is the handle.`;
  } else if (out.libraries.length) {
    out.verdict = `Map library detected (${out.libraries.join(", ")}) but no DOM markers and no reachable JS instance. ` +
      `Only option left is synthetic pixel clicks, which need each feature's screen position from an outside source.`;
  } else {
    out.verdict = "No recognised map library found on this page.";
  }

  window.__mapProbe = out;
  console.log("%cmap-probe", "font-weight:bold;font-size:13px");
  console.log("libraries:", out.libraries);
  console.log("DOM markers:", out.domMarkers);
  console.log("JS instances found:", out.instances.map((i) => ({ lib: i.lib, foundAt: i.foundAt, facts: i.facts })));
  console.log("%cverdict: " + out.verdict, "font-weight:bold;color:#06c");
  console.log("full result on window.__mapProbe (instance handles included)");
  return out;
})();
