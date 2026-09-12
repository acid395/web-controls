/* content/bridge.js - runs in the extension's isolated world on the page.
 * Relays calls between the background service worker (chrome.runtime messages)
 * and the page bundle (page/usgs-bundle.js, running in the MAIN world, which
 * has no access to chrome.* APIs and can only talk out via postMessage).
 *
 * Injected on demand by background.js, once per tab. Guarded so re-injection
 * (background does this before every call, to be safe) doesn't stack up
 * duplicate listeners.
 */
if (!self.__wcBridgeInstalled) {
  self.__wcBridgeInstalled = true;

  let counter = 0;
  const pending = new Map();

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (!e.data || e.data.channel !== "web-controls-res") return;
    const waiter = pending.get(e.data.id);
    if (!waiter) return;
    pending.delete(e.data.id);
    waiter(e.data);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "call") return;
    const id = "wc-" + (++counter) + "-" + Date.now();

    pending.set(id, (data) => {
      if (data.ok) sendResponse({ ok: true, result: data.result });
      else sendResponse({ ok: false, error: data.error });
    });

    window.postMessage({ channel: "web-controls-req", id, fn: msg.fn, args: msg.args || [] }, "*");

    // the page bundle might not be loaded yet (or the function might not
    // exist), so don't hang forever waiting for a reply that never comes
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        sendResponse({ ok: false, error: "timed out waiting for the page bundle to reply" });
      }
    }, 8000);

    return true; // keep sendResponse valid across the async wait
  });
}
