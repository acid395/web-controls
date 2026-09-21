/* page/publish-tools.js - runs in the page's own world at document_end.
 *
 * Publishing used to depend on the service worker waking up, chrome.tabs
 * .onUpdated firing, and a message round trip - three things that have to go
 * right before a site becomes agent-usable. A content script registered in
 * the MAIN world needs none of them: it runs on the page, at document_end,
 * and can see document.modelContext directly.
 *
 * The check comes first and the work comes second, deliberately. Deriving
 * tools walks every control on the page, and a portal has hundreds; doing
 * that on every page load in a browser with no modelContext would be a cost
 * paid for nothing. Where the API is absent this script does nothing at all.
 */
(() => {
  // Parked, not deleted. Publishing derived tools to modelContext works and
  // is tested, but nothing consumes it: no site declares tools of its own and
  // no agent on Chrome reads them, so the whole path was a claim rather than
  // a capability. It stays here, behind a switch, because the moment a
  // consumer exists it is a few lines to turn back on - and because the
  // measurements taken through it are worth keeping reproducible.
  //
  // Set __wcPublishWebMcp = true before load to enable it.
  if (!window.__wcPublishWebMcp) return;

  const api = (typeof document !== "undefined" && document.modelContext)
    || (typeof navigator !== "undefined" && navigator.modelContext);
  if (!api || typeof api.registerTool !== "function") return;
  if (window.__wcPublishedAtLoad) return;

  // GENERIC is injected alongside this script, but ordering inside a single
  // registration is not something to rely on - if it is not there yet, wait
  // for the frame after parsing rather than silently publishing nothing.
  const publish = () => {
    if (!window.GENERIC || typeof window.GENERIC.mcpPublishControls !== "function") return false;
    window.__wcPublishedAtLoad = true;
    try { window.GENERIC.mcpPublishControls(); } catch (e) { /* a page we cannot read is not an error worth raising */ }
    return true;
  };

  if (!publish()) {
    // One retry on idle, then give up: the panel publishes on demand anyway.
    (window.requestIdleCallback || window.setTimeout)(() => publish(), 1);
  }
})();
