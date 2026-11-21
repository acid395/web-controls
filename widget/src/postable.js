/* postable.js - a page's answer, as it can be posted.
 *
 * Results cross a boundary - postMessage from a frame, or the shim's copy
 * inside one page - and are copied so the agent never holds a live object
 * the page bundle still mutates. An element is described, as the extension's
 * bridge describes it: fill() returns the box it typed into, and on an
 * Angular page a key-by-key copy of that box walked the whole app through
 * its __ngContext__ and froze the tab (NID). The walk is bounded for the
 * same reason.
 */
function wcDescribeNode(n) {
  return {
    element: String(n.tagName || "node").toLowerCase(),
    text: String(n.textContent || "").trim().slice(0, 80) || undefined,
    id: n.id || undefined,
    href: n.href || undefined,
  };
}
function wcPostable(v, depth = 0) {
  if (v == null || typeof v !== "object") return v;
  if (typeof Node !== "undefined" && v instanceof Node) return wcDescribeNode(v);
  try { return structuredClone(v); } catch (e) {
    if (depth >= 6) return String(v);
    if (Array.isArray(v)) return v.map((x) => wcPostable(x, depth + 1));
    const out = {};
    for (const k of Object.keys(v)) { try { out[k] = wcPostable(v[k], depth + 1); } catch (e2) { out[k] = String(v[k]); } }
    return out;
  }
}
