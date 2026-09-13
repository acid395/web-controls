/* offscreen.js - runs inside the offscreen document, the one place in this
 * extension with real WebGPU/DOM access. Hosts the actual WebLLM engine.
 *
 * llmPing (confirmed working live) just proves the model answers at all.
 * llmPlan is the real thing: instruction + a tool list in, WebLLM's own
 * OpenAI-compatible function-calling decides which tool (if any) applies,
 * that decision goes back to background.js to actually execute. This part
 * hasn't been run live yet.
 *
 * web-llm.js is vendored locally (vendor/web-llm.js, pulled from
 * @mlc-ai/web-llm@0.2.85's own published bundle) rather than loaded from a
 * CDN at runtime, since Chrome Web Store policy doesn't allow remotely
 * hosted code in extensions, and an extension page's default CSP wouldn't
 * permit it either. The model weights themselves (multi-gigabyte, unlike
 * this ~6.6MB runtime file) still have to come from MLC's own CDN at
 * load time - there's no vendoring those into the extension package.
 */
import { CreateMLCEngine } from "./vendor/web-llm.js";

// Smaller than the Hermes-2-Pro-8B model discussed earlier, on purpose: this
// is the first real test of whether WebLLM works in this environment at
// all, so it's worth minimizing download size and GPU memory needed before
// trusting a bigger model to matter. Swapping this string is the entire
// upgrade once this is confirmed working.
const MODEL_ID = "Hermes-3-Llama-3.2-3B-q4f16_1-MLC";

let enginePromise = null;

function getEngine(onProgress) {
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        if (onProgress) onProgress(report);
      },
    });
  }
  return enginePromise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return; // not for us, e.g. content-script traffic relayed elsewhere

  if (msg.type === "llmPing") {
    (async () => {
      try {
        if (!("gpu" in navigator)) {
          throw new Error("navigator.gpu is undefined - this browser/machine doesn't expose WebGPU");
        }
        const engine = await getEngine((report) => {
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text });
        });
        const reply = await engine.chat.completions.create({
          messages: [{ role: "user", content: msg.prompt || "Say hello in exactly five words." }],
        });
        sendResponse({ ok: true, text: reply.choices[0].message.content });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "llmPlan") {
    (async () => {
      try {
        if (!("gpu" in navigator)) {
          throw new Error("navigator.gpu is undefined - this browser/machine doesn't expose WebGPU");
        }
        const engine = await getEngine((report) => {
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text });
        });
        const reply = await engine.chat.completions.create({
          messages: [{ role: "user", content: msg.instruction }],
          tools: msg.tools,
          tool_choice: "auto",
        });
        const choice = reply.choices[0].message;
        const call = choice.tool_calls && choice.tool_calls[0];
        if (!call) {
          // valid outcome, not an error: the model decided no tool applied
          // and just answered in plain text instead.
          sendResponse({ ok: true, toolCall: null, text: choice.content });
          return;
        }
        let args;
        try {
          args = JSON.parse(call.function.arguments);
        } catch (e) {
          sendResponse({ ok: false, error: `model's arguments weren't valid JSON: ${call.function.arguments}` });
          return;
        }
        sendResponse({ ok: true, toolCall: { name: call.function.name, args } });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // async response
  }

  // Fire-and-forget: background.js sends this as soon as the browser
  // starts, well before anyone opens the popup, so getEngine()'s promise is
  // usually already resolved (or at least in progress) by the time an
  // actual llmPing arrives. Only saves real time after the very first ever
  // load, since that one still has to hit the network no matter when it
  // starts - this just moves the wait earlier, out of the moment someone's
  // actually waiting on an answer, rather than making it wait less overall.
  if (msg.type === "llmWarm") {
    if (!("gpu" in navigator)) {
      chrome.runtime.sendMessage({ type: "llmProgress", text: "no WebGPU, skipping warm-load" });
      return;
    }
    getEngine((report) => {
      chrome.runtime.sendMessage({ type: "llmProgress", text: report.text });
    }).then(() => {
      chrome.runtime.sendMessage({ type: "llmProgress", text: "model ready" });
    }).catch((err) => {
      chrome.runtime.sendMessage({ type: "llmProgress", text: "warm-load failed: " + String((err && err.message) || err) });
    });
    // no sendResponse: nothing is waiting on this one
  }
});
