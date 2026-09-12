/* background.js - the service worker. Owns nothing about USGS itself; its
 * only job here is: get the active tab, make sure the bridge + page bundle
 * are injected, forward a call, return the result.
 *
 * No LLM here yet. This proves the plumbing (popup -> background -> content
 * script -> page's own JS world -> back) works before anything gets that
 * complicated. Once this round-trips reliably, this is where the tool-call
 * loop would go: instead of the popup asking for one named function, an LLM
 * decides which function and with what arguments.
 */

async function ensureInjected(tabId) {
  // isolated world first (the relay), then the page's own world (WC + USGS).
  // Re-injecting on every call is wasteful but simple and safe for a proof
  // of concept: both files guard against installing duplicate listeners.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/bridge.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["page/usgs-bundle.js"],
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "invoke") return;

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error("no active tab");
      if (!/^https:\/\/waterdata\.usgs\.gov\//.test(tab.url || "")) {
        throw new Error("open a waterdata.usgs.gov page first");
      }
      await ensureInjected(tab.id);
      const result = await chrome.tabs.sendMessage(tab.id, { type: "call", fn: msg.fn, args: msg.args });
      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();

  return true; // keep the message channel open for the async response above
});
