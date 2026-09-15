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

// Started as the smaller Hermes-3-Llama-3.2-3B to validate loading itself
// cheaply. Confirmed live it loads and answers - but WebLLM 0.2.85 rejected
// it outright for tool-calling: "not supported for ChatCompletionRequest.
// tools." Its own error message names exactly which models are, all
// Hermes-2-Pro or Hermes-3 at 7-8B, none smaller. This is that one, as
// planned from the start once tool-calling was the actual feature needed.
// Bigger download than the 3B model, real bandwidth and time again.
const MODEL_ID = "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC";

let enginePromise = null;
let engineReady = false; // a Promise can't be asked "are you resolved yet?" directly - tracked separately so llmStatus can answer synchronously instead of waiting on the engine.

function getEngine(onProgress) {
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        if (onProgress) onProgress(report);
      },
    }).then((engine) => {
      engineReady = true;
      return engine;
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

  if (msg.type === "llmStatus") {
    sendResponse({ ready: engineReady, hasGpu: "gpu" in navigator });
    return; // synchronous, no need to keep the channel open
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
        // background.js optionally supplies context (env-vocab synonyms,
        // and for GENERIC-route asks, the live inventory() output) - this is
        // what lets the model pick a real selector on a page it's never
        // seen, rather than guessing one blind. It can't go in a system
        // message: WebLLM 0.2.85 rejects any custom system prompt outright
        // once `tools` is set ("cannot specify customized system prompt"),
        // confirmed live - Hermes-2-Pro's tool-calling mode installs its own
        // fixed system prompt instead. So it's folded into the one user
        // message instead.
        const content = msg.context ? `${msg.context}\n\n${msg.instruction}` : msg.instruction;
        const messages = [{ role: "user", content }];
        // llmProgress only fires during model *loading*, so a slow-but-
        // working inference call (realistically seconds on an 8B model over
        // WebGPU) looks identical to a hang in the popup otherwise.
        chrome.runtime.sendMessage({ type: "llmGenerating" });
        // Without a bound here, a genuinely stuck request and a merely slow
        // one look identical from the popup's side - both just say
        // "thinking" forever, with no way to tell them apart or recover
        // short of reloading the extension. 120s is generous for even a
        // slow-GPU 8B model on a real turn; if it's not back by then,
        // something is actually wrong, not just slow.
        const INFERENCE_TIMEOUT_MS = 120000;
        const reply = await Promise.race([
          engine.chat.completions.create({ messages, tools: msg.tools, tool_choice: "auto" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`inference timed out after ${INFERENCE_TIMEOUT_MS / 1000}s - the model may be stuck, or this hardware is too slow for local WebGPU inference on an 8B model`)), INFERENCE_TIMEOUT_MS)
          ),
        ]);
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
