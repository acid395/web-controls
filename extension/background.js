/* background.js - the service worker.
 *
 * Two things live here:
 *   1. invokeOnActiveTab(fn, args) - inject the bridge + page bundle, call
 *      USGS.<fn>(...args) on the real page, return the result. This is the
 *      plumbing, proven live already: getState() and setParameter() both
 *      round-trip correctly.
 *   2. planTool(instruction) - a stub stand-in for an LLM. Plain keyword
 *      matching, not a model. It exists to prove the *shape* of the loop
 *      (typed instruction -> a tool call gets picked -> it actually runs)
 *      without needing an API key or spending anything. Swapping this one
 *      function for a real model call is the entire upgrade path later.
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

async function invokeOnActiveTab(fn, args) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("no active tab");
  if (!/^https:\/\/waterdata\.usgs\.gov\//.test(tab.url || "")) {
    throw new Error("open a waterdata.usgs.gov page first");
  }
  await ensureInjected(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: "call", fn, args });
}

// Stub planner: instruction text -> { fn, args } on the USGS manifest, or
// null if nothing matched. Ordered rules, first match wins. Nowhere near
// what a real model would handle (no real language understanding, no
// argument extraction beyond what's baked into each rule), but it proves
// the loop end to end with zero cost and zero external dependency.
const PLANNER_RULES = [
  { test: /gage height|gauge height|\bstage\b/i, fn: "setParameter", args: ["gage height"] },
  { test: /discharge|streamflow|\bflow\b/i, fn: "setParameter", args: ["discharge"] },
  { test: /water temp|\btemperature\b|\btemp\b/i, fn: "setParameter", args: ["water temperature"] },
  { test: /water level|groundwater/i, fn: "setParameter", args: ["water level"] },
  { test: /huc.?8/i, fn: "groupBy", args: ["huc8"] },
  { test: /huc.?6/i, fn: "groupBy", args: ["huc6"] },
  { test: /\bcounty\b/i, fn: "groupBy", args: ["county"] },
  { test: /hide.*map/i, fn: "setMap", args: [false] },
  { test: /show.*map/i, fn: "setMap", args: [true] },
  { test: /state|status|summary|current/i, fn: "getState", args: [] },
];

function planTool(instruction) {
  for (const rule of PLANNER_RULES) {
    if (rule.test.test(instruction)) return { fn: rule.fn, args: rule.args };
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "invoke") {
    (async () => {
      try {
        sendResponse(await invokeOnActiveTab(msg.fn, msg.args));
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // keep the channel open for the async response above
  }

  if (msg.type === "ask") {
    (async () => {
      const plan = planTool(msg.instruction || "");
      if (!plan) {
        sendResponse({ ok: false, error: "the stub planner didn't recognize that instruction (it only knows a handful of fixed phrases, see PLANNER_RULES)" });
        return;
      }
      try {
        const result = await invokeOnActiveTab(plan.fn, plan.args);
        sendResponse({ ...result, plannedCall: plan });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err), plannedCall: plan });
      }
    })();
    return true;
  }
});
