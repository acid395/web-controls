/* background.js - the service worker.
 *
 * Eight things live here:
 *   1. NAMED_MANIFESTS - sites with a real, hand-written manifest, checked
 *      first. Currently just USGS's state page (page/usgs-bundle.js,
 *      window.USGS). Anything else routes to the zero-manifest tier
 *      (page/generic-bundle.js, window.GENERIC) automatically - no per-site
 *      entry needed here at all. This is the actual generalization: adding
 *      a new GENERIC-eligible site used to mean editing this file *and*
 *      manifest.json's host_permissions, then reloading the extension. Now
 *      it means clicking "Enable on this site" in the popup once - see (3).
 *   2. invokeOnActiveTab(fn, args) - checks the site is actually permitted
 *      (chrome.permissions.contains, not just "did we hardcode a route for
 *      it"), injects the bridge + whichever bundle applies, calls
 *      <fn>(...args) on the real page, returns the result. Proven live on
 *      USGS, Drought.gov, EPA, and the National Water Dashboard.
 *   3. planTool(instruction) - a stub stand-in for an LLM, USGS-route only
 *      for now. Plain keyword matching, not a model. It exists to prove
 *      the *shape* of the loop (typed instruction -> a tool call gets
 *      picked -> it actually runs) without needing an API key or spending
 *      anything.
 *   4. ensureOffscreenDocument() - a service worker has no WebGPU access at
 *      all, so the actual WebLLM engine can't run here. It runs in
 *      offscreen/offscreen.js instead, inside a hidden document this
 *      function creates on demand, the one context in an extension that
 *      does have WebGPU. Confirmed working live: model loads, runs, answers.
 *   5. llmPing relay - forwards a test prompt to the offscreen document and
 *      back. Confirmed working. Not tool-calling, just proves the model
 *      loads and answers at all.
 *   6. TOOL_DEFS + llmPlan - WebLLM's version of the real thing, using the
 *      offscreen document. Requires a real (large) one-time model download
 *      and WebGPU. Confirmed loading and answering; tool-calling itself
 *      still mid-test as of this writing.
 *   7. askGemini + geminiPlan - a second, parallel path to the exact same
 *      TOOL_DEFS and the exact same invokeOnActiveTab execution afterward,
 *      calling Google's Gemini API (free tier, needs an API key from
 *      aistudio.google.com/apikey, saved via the popup) instead of a local
 *      model. No download, no WebGPU, no offscreen document - a plain
 *      fetch() from this file. Traded away "fully local" for "instant and
 *      still free." An explicit, separate choice a user opts into (needs a
 *      key), not something smartAsk below falls back to on its own.
 *   8. smartAsk - the actual intended default: try the free, instant
 *      planTool() stub first; only reach for WebLLM if that didn't match,
 *      and only if it has actually finished loading (checked via
 *      offscreen.js's llmStatus, not assumed) - never a silent multi-minute
 *      wait a user didn't ask for. This is the answer to the real tension
 *      in this project's goal: fully local and free, but also easy to use
 *      from the first click, not just eventually. Untested live.
 */

const NAMED_MANIFESTS = [
  { test: /^https:\/\/waterdata\.usgs\.gov\/state\//, bundle: "page/usgs-bundle.js", global: "USGS" },
];

function routeFor(url) {
  return NAMED_MANIFESTS.find((r) => r.test.test(url || "")) || { bundle: "page/generic-bundle.js", global: "GENERIC" };
}

function originPatternFor(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch (e) {
    return null;
  }
}

async function ensureInjected(tabId, bundle) {
  // isolated world first (the relay), then the page's own world (WC + the
  // manifest that bundle exposes). Re-injecting on every call is wasteful
  // but simple and safe for a proof of concept: both files guard against
  // installing duplicate listeners.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/bridge.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [bundle],
  });
}

async function invokeOnActiveTab(fn, args) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) throw new Error("no active tab");
  const pattern = originPatternFor(tab.url);
  if (!pattern) throw new Error("can't determine this page's origin");
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) {
    throw new Error(`not enabled on this site yet. Click "Enable on this site" in the popup first.`);
  }
  const route = routeFor(tab.url);
  await ensureInjected(tab.id, route.bundle);
  const result = await chrome.tabs.sendMessage(tab.id, { type: "call", fn, args });
  return { ...result, calledOn: route.global }; // which manifest actually ran, for the popup log
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

// Real tool definitions for the WebLLM planner, one set per route. Same
// tools and descriptions as webmcp-register.js's navigator.modelContext
// versions, reshaped for WebLLM's OpenAI-compatible function-calling format
// (type: "function", function: {name, description, parameters}) instead of
// the W3C draft's shape - same underlying schemas either way. argOrder maps
// the named arguments a tool-calling model returns (an object, since that's
// what JSON Schema properties describe) back to the positional array
// invokeOnActiveTab/the page bridge actually expects.
const TOOL_DEFS = {
  USGS: [
    {
      name: "usgsSetParameter", fn: "setParameter", argOrder: ["parameter"],
      description: "Set which water parameter is shown on this USGS state map (discharge, gage height, water level, water temperature, or all).",
      parameters: { type: "object", properties: { parameter: { type: "string", description: "e.g. discharge, gage height, water temperature, water level, all" } }, required: ["parameter"] },
    },
    {
      name: "usgsGroupBy", fn: "groupBy", argOrder: ["groupBy"],
      description: "Group the map's stream sites by county, HUC-8 subbasin, or HUC-6 basin.",
      parameters: { type: "object", properties: { groupBy: { type: "string", enum: ["county", "huc8", "huc6"] } }, required: ["groupBy"] },
    },
    {
      name: "usgsSetRecency", fn: "setRecency", argOrder: ["recency"],
      description: "Filter sites to only those with data in the last 120 days, or show all years of historical data.",
      parameters: { type: "object", properties: { recency: { type: "string", enum: ["120 days", "all"] } }, required: ["recency"] },
    },
    {
      name: "usgsGetState", fn: "getState", argOrder: [],
      description: "Read the current parameter, grouping, sort order, recency filter, and map visibility on this page.",
      parameters: { type: "object", properties: {} },
    },
  ],
  GENERIC: [
    {
      name: "pageInventory", fn: "inventory", argOrder: [],
      description: "List every interactive control on the current page with a CSS selector for each, so they can be acted on directly.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "pageClick", fn: "click", argOrder: ["selector"],
      description: "Click an element on the page by CSS selector, e.g. one returned by pageInventory.",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
    },
    {
      name: "pageFill", fn: "fill", argOrder: ["selector", "text"],
      description: "Type text into an input or textarea on the page by CSS selector.",
      parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] },
    },
    {
      name: "pageSelectOption", fn: "selectOption", argOrder: ["selector", "value"],
      description: "Choose an option in a <select> dropdown by CSS selector and the option's value or visible text.",
      parameters: { type: "object", properties: { selector: { type: "string" }, value: { type: "string" } }, required: ["selector", "value"] },
    },
  ],
};

function toOpenAITools(defs) {
  return defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.parameters } }));
}

function findToolDef(route, name) {
  return (TOOL_DEFS[route] || []).find((d) => d.name === name);
}

// Check aistudio.google.com/apikey's own model list if this ever 404s -
// Google's free-tier model names change more often than most APIs'.
const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Same shape as toOpenAITools, wrapped the way Gemini's REST API wants it:
// one functionDeclarations array instead of one {type,function} object per
// tool. The actual JSON Schema in each tool's `parameters` is identical
// either way - both APIs happen to want plain JSON Schema here.
function toGeminiTools(defs) {
  return [{ functionDeclarations: defs.map((d) => ({ name: d.name, description: d.description, parameters: d.parameters })) }];
}

async function askGemini(instruction, defs) {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    throw new Error('no Gemini API key saved. Get a free one at aistudio.google.com/apikey and save it in the popup.');
  }
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: instruction }] }],
      tools: toGeminiTools(defs),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  // Gemini's args come back as a real object already, unlike WebLLM/OpenAI's
  // JSON-stringified arguments - one less parsing step, one less way to fail.
  const callPart = parts.find((p) => p.functionCall);
  if (callPart) return { toolCall: { name: callPart.functionCall.name, args: callPart.functionCall.args || {} } };
  const textPart = parts.find((p) => p.text);
  return { toolCall: null, text: textPart ? textPart.text : "" };
}

// Shared by llmPlan, geminiPlan, and smartAsk below: whichever model
// decided on a tool call, actually running it is the same one step either
// way - look up the real manifest function behind the tool's WebMCP-style
// name, reorder the model's named arguments into the positional array
// invokeOnActiveTab expects, run it.
async function executeToolCall(routeGlobal, toolCall) {
  const def = findToolDef(routeGlobal, toolCall.name);
  if (!def) throw new Error(`model picked an unknown tool "${toolCall.name}"`);
  const args = def.argOrder.map((key) => toolCall.args[key]);
  return invokeOnActiveTab(def.fn, args);
}

const OFFSCREEN_URL = "offscreen/offscreen.html";
let creatingOffscreen = null; // avoids racing two createDocument calls at once

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"], // closest existing justification; WebLLM does its
    // real work via WebGPU + a Worker internally, and Chrome's offscreen
    // reason list (as of this writing) has no dedicated "WEBGPU" or
    // "AI_MODEL" value - WORKERS is the standard stand-in other on-device-
    // model extensions use for exactly this situation.
    justification: "Run the WebLLM model, which needs WebGPU, unavailable in a service worker.",
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// Start loading the model as soon as the browser opens, or the extension is
// installed/reloaded, instead of waiting for someone to actually ask it
// something. Doesn't shrink the real download time, just moves the wait to
// before it's needed rather than during it - after the first successful
// load ever, the weights are cached locally, so this finishes fast on every
// later browser launch.
async function warmModel() {
  try {
    await ensureOffscreenDocument();
    chrome.runtime.sendMessage({ target: "offscreen", type: "llmWarm" });
  } catch (e) { /* best effort - a real llmPing later will surface any real error */ }
}
chrome.runtime.onStartup.addListener(warmModel);
chrome.runtime.onInstalled.addListener(warmModel);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "offscreen") return; // that message is for offscreen.js, not this listener

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

  if (msg.type === "llmPing") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        // first call downloads the model (can take a while, real bandwidth
        // and disk space), subsequent calls reuse the same loaded engine
        // for as long as the offscreen document stays alive.
        const result = await chrome.runtime.sendMessage({ target: "offscreen", type: "llmPing", prompt: msg.prompt });
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // The real thing: instruction -> WebLLM picks a tool -> it actually runs,
  // same execution path (invokeOnActiveTab) planTool()'s stub already used.
  // Only the "which tool" decision changed; everything downstream of that
  // decision is code already proven working across six sites.
  if (msg.type === "llmPlan") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);
        const defs = TOOL_DEFS[route.global] || [];
        await ensureOffscreenDocument();
        const plan = await chrome.runtime.sendMessage({
          target: "offscreen", type: "llmPlan",
          instruction: msg.instruction, tools: toOpenAITools(defs),
        });
        if (!plan.ok) { sendResponse(plan); return; }
        if (!plan.toolCall) {
          // the model answered in plain text instead of picking a tool -
          // a real, valid outcome, not an error (e.g. the instruction
          // wasn't actually asking to do anything on the page).
          sendResponse({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        sendResponse({ ...result, plannedBy: "webllm", toolCall: plan.toolCall });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // Same shape as llmPlan above, same TOOL_DEFS, same invokeOnActiveTab
  // execution - only the "which tool" decision is different: a direct
  // fetch() to Gemini instead of the offscreen document's local model.
  if (msg.type === "geminiPlan") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);
        const defs = TOOL_DEFS[route.global] || [];
        const plan = await askGemini(msg.instruction, defs);
        if (!plan.toolCall) {
          sendResponse({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        sendResponse({ ...result, plannedBy: "gemini", toolCall: plan.toolCall });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // The actual intended default experience: instant where possible, honest
  // about waiting where it isn't, never silently blocked. Tries the
  // zero-download stub matcher first (planTool, USGS route only, same as
  // it's always been) - if that hits, done, no model involved at all, no
  // wait. Only reaches for WebLLM if the fast path didn't match, and even
  // then checks it's actually finished loading first rather than kicking
  // off a multi-minute wait a user didn't ask for. Never touches Gemini:
  // that stays an explicit, separate choice (needs a key), not a fallback.
  if (msg.type === "smartAsk") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) throw new Error("no active tab");
        const route = routeFor(tab.url);

        if (route.global === "USGS") {
          const fast = planTool(msg.instruction || "");
          if (fast) {
            const result = await invokeOnActiveTab(fast.fn, fast.args);
            sendResponse({ ...result, plannedBy: "fast-path", plannedCall: fast });
            return;
          }
        }

        await ensureOffscreenDocument();
        const status = await chrome.runtime.sendMessage({ target: "offscreen", type: "llmStatus" });
        if (!status.ready) {
          sendResponse({
            ok: false,
            stillLoading: true,
            error: status.hasGpu
              ? "No quick match for that, and the local model is still loading in the background. Try a simpler instruction, or wait and ask again."
              : "No quick match for that, and this browser/machine has no WebGPU, so the local model can't load at all here.",
          });
          return;
        }

        const defs = TOOL_DEFS[route.global] || [];
        const plan = await chrome.runtime.sendMessage({
          target: "offscreen", type: "llmPlan",
          instruction: msg.instruction, tools: toOpenAITools(defs),
        });
        if (!plan.ok) { sendResponse(plan); return; }
        if (!plan.toolCall) {
          sendResponse({ ok: true, modelReply: plan.text, calledOn: route.global });
          return;
        }
        const result = await executeToolCall(route.global, plan.toolCall);
        sendResponse({ ...result, plannedBy: "webllm", toolCall: plan.toolCall });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }
});
