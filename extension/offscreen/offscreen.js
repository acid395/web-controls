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

// WebLLM 0.2.85 only accepts ChatCompletionRequest.tools on Hermes-2-Pro and
// Hermes-3 at 7-8B - its own error names them - so using the API meant an 8B
// model. That model was measured here and it is not viable for this: several
// gigabytes to download, ~5GB of VRAM, and inference that exceeded a 120s
// ceiling on ordinary hardware while saturating the GPU, which is felt as the
// whole machine slowing down. A tool nobody can run is not a tool.
//
// The restriction is on WebLLM's tool-calling API, not on the models. Asking
// a small model for JSON and parsing it here sidesteps the API entirely and
// frees the choice of model, which is the only way this tier runs on a
// typical laptop. The task is narrow - pick one tool from a short list and
// fill a couple of arguments - which is well within a 3B model.
//
// Both paths are kept, but only one can be loaded at a time: llmPlanJson
// prompts and works with this model, while llmPlan uses the native tools API
// and needs MODEL_ID set back to Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC to work
// at all. Ask uses the JSON path; llmPlan stays as a debug comparison.
const MODEL_ID = "Llama-3.2-3B-Instruct-q4f16_1-MLC";

/* @testable-start buildStepPrompt */
// The page, what has happened, and one question: what next. Kept small on
// purpose - every token here is prefill on a 3B model, and prefill is what
// made the 8B path unusable. Controls are numbered because a number is one
// token and a name is many, and because a small model gets numbers right.
function buildStepPrompt({ goal, controls = [], history = [], observation, note }) {
  const list = controls.map((c, i) => {
    const kind = c.type || c.kind || "";
    const opts = (c.options || []).length
      ? ` [${c.options.map((o) => o.text || o.value).slice(0, 8).join("|")}]` : "";
    const state = typeof c.checked === "boolean" ? (c.checked ? " (on)" : " (off)") : "";
    return `${i}. ${String(c.label || "").slice(0, 46)} <${kind}>${state}${opts}`;
  }).join("\n");

  const done = history.length
    ? history.map((h, i) => `${i + 1}. ${h.did}${h.outcome ? ` -> ${h.outcome}` : ""}`).join("\n")
    : "nothing yet";

  return [
    "You are operating a web page to carry out a request. Reply with JSON only.",
    "",
    `Request: ${goal}`,
    "",
    "Controls on the page:",
    list || "(none found)",
    "",
    "Steps already taken:",
    done,
    observation ? `\nWhat the page shows now:\n${String(observation).slice(0, 1200)}` : "",
    note ? `\nNote: ${note}` : "",
    "",
    "Choose ONE next action:",
    '  {"n": <control number>, "do": "click"}',
    '  {"n": <control number>, "do": "check", "on": true}',
    '  {"n": <control number>, "do": "select", "value": "<option text>"}',
    '  {"n": <control number>, "do": "type", "value": "<text>"}',
    '  {"do": "read"}                      to look at the page before deciding',
    '  {"do": "finish", "answer": "<answer or summary>"}',
    "",
    "Pick the control whose label matches what was asked. Use read when you",
    "need to see values before answering. Use finish when the request is",
    "carried out, or when nothing on this page can carry it out.",
    "Never repeat a step that already worked - if the page changed, the job is",
    "done and the next action is finish.",
    "Reply with one JSON object and nothing else.",
  ].filter(Boolean).join("\n");
}
/* @testable-end buildStepPrompt */

/* @testable-start firstJsonObject */
// Small models do not reliably obey "JSON only" - they add a preamble, wrap
// the object in ``` fences, or continue talking afterwards. Taking the first
// balanced object tolerates all three, where JSON.parse on the whole reply
// fails on any of them. Braces inside string values are respected, since a
// gauge name or a selector can legitimately contain one.
function firstJsonObject(text) {
  const start = (text || "").indexOf("{");
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch (e) { return null; }
    }
  }
  return null;
}
/* @testable-end */

let enginePromise = null;
// The last thing the loader said, so status can report progress rather than a
// bare "not ready" through a multi-gigabyte download.
let lastProgress = null;
let engineReady = false; // a Promise can't be asked "are you resolved yet?" directly - tracked separately so llmStatus can answer synchronously instead of waiting on the engine.

function getEngine(onProgress) {
  if (!enginePromise) {
    enginePromise = CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        // Kept, not just forwarded: the panel may not be open when this
        // arrives, and "still downloading, 41%" is the answer to why the
        // model did not plan.
        lastProgress = String((report && report.text) || "").slice(0, 120);
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
    // Ready or not is no longer enough to act on. The model is the planner
    // now, so when it is not used the first question is why - never started,
    // still downloading, or a machine that cannot run it at all. Those want
    // three different responses and used to look identical from outside.
    sendResponse({
      ready: engineReady,
      hasGpu: "gpu" in navigator,
      loading: !!enginePromise && !engineReady,
      started: !!enginePromise,
      progress: lastProgress || null,
      model: MODEL_ID,
    });
    return; // synchronous, no need to keep the channel open
  }

  // Picking, not writing. The JSON path asks the model to generate a tool
  // name and every argument, and decode is most of the time that takes -
  // roughly thirty tokens for a decision carrying about four bits of
  // information. A numbered list and "reply with the number" is one token.
  // The arguments are then filled by the same deterministic code that fills
  // them everywhere else, which is both faster and unable to invent a value
  // the page does not offer.
  if (msg.type === "llmPick") {
    (async () => {
      try {
        if (!("gpu" in navigator)) {
          throw new Error("navigator.gpu is undefined - this browser/machine doesn't expose WebGPU");
        }
        const engine = await getEngine((report) => {
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text });
        });
        const numbered = (msg.tools || [])
          .map((t, i) => `${i + 1}. ${t.name}${t.gist ? " - " + t.gist : ""}`).join("\n");
        const prompt = [
          "Pick the one tool that best answers the request.",
          "",
          numbered,
          "",
          `Request: ${msg.instruction}`,
          "",
          "Reply with the number only. If none fit, reply 0.",
        ].join("\n");

        chrome.runtime.sendMessage({ type: "llmGenerating" });
        const started = Date.now();
        const reply = await Promise.race([
          engine.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 4,   // a number, and nothing else
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("the model took too long to pick")), 60000)),
        ]);
        const text = ((reply.choices[0] || {}).message || {}).content || "";
        const n = parseInt(String(text).match(/\d+/), 10);
        sendResponse({
          ok: true,
          index: Number.isFinite(n) && n > 0 ? n - 1 : null,
          ms: Date.now() - started,
          raw: String(text).slice(0, 40),
        });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // Tool-calling by prompting rather than by API. Works on any model, which
  // is the point: the native path forces an 8B download that most machines
  // cannot run usefully.
  /* llmStep - one decision, given the page as it is now and what has already
   * been done. The loop itself lives in background.js, because deciding and
   * acting are different jobs: this document can reason and cannot touch a
   * page, and the service worker can touch a page and should not be where
   * prompts are built.
   *
   * Controls are numbered and chosen by number. A 3B model asked to emit
   * `toggleFloodInundationMapping` exactly will sometimes emit something
   * close to it, and close is useless; asked for 14 it says 14. The number
   * is also far cheaper than the name, and on a page with a hundred and sixty
   * controls every token of the list is prefill.
   */
  if (msg.type === "llmStep") {
    (async () => {
      try {
        if (!("gpu" in navigator)) {
          throw new Error("navigator.gpu is undefined - this browser/machine doesn't expose WebGPU");
        }
        const engine = await getEngine((report) => {
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text });
        });
        const prompt = buildStepPrompt(msg);
        chrome.runtime.sendMessage({ type: "llmGenerating" });
        const INFERENCE_TIMEOUT_MS = 120000;
        const reply = await Promise.race([
          engine.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 160,
          }),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error(`inference timed out after ${INFERENCE_TIMEOUT_MS / 1000}s`)),
            INFERENCE_TIMEOUT_MS)),
        ]);
        const text = (reply.choices[0].message.content || "").trim();
        const parsed = firstJsonObject(text);
        if (!parsed) {
          sendResponse({ ok: false, error: `model did not return usable JSON: ${text.slice(0, 200)}` });
          return;
        }
        sendResponse({ ok: true, step: parsed, raw: text.slice(0, 300) });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  if (msg.type === "llmPlanJson") {
    (async () => {
      try {
        if (!("gpu" in navigator)) {
          throw new Error("navigator.gpu is undefined - this browser/machine doesn't expose WebGPU");
        }
        const engine = await getEngine((report) => {
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text });
        });

        // Compact: every token of schema is prefill time on a small model,
        // and prefill is what made the 8B path unusable.
        const catalogue = (msg.tools || []).map((t) => {
          const spec = (t.parameters && t.parameters.properties) || {};
          // An enum is worth its tokens - it stops the model inventing a
          // value the page does not offer. Prose is not: the first clause of
          // a description carries the meaning and the rest is prefill.
          const props = Object.entries(spec).map(([k, v]) =>
            Array.isArray(v.enum) && v.enum.length <= 8 ? `${k}: ${v.enum.join("|")}` : k);
          const gist = String(t.description || "").split(/[.\u2013-]/)[0].trim().slice(0, 60);
          return `${t.name}(${props.join(", ")})${gist ? " - " + gist : ""}`;
        }).join("\n");

        const prompt = [
          "You choose one tool to answer the request, and reply with JSON only.",
          "",
          "Tools:",
          catalogue,
          "",
          msg.context ? `Context:\n${msg.context}\n` : "",
          `Request: ${msg.instruction}`,
          "",
          'Reply with exactly {"tool":"<name>","args":{...}} and nothing else.',
          'If no tool fits, reply {"tool":null,"reply":"<short answer>"}.',
        ].filter(Boolean).join("\n");

        chrome.runtime.sendMessage({ type: "llmGenerating" });
        const INFERENCE_TIMEOUT_MS = 120000;
        const reply = await Promise.race([
          engine.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            temperature: 0,      // picking a tool is not a creative task
            max_tokens: 96,      // a routing decision is one small JSON object
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`inference timed out after ${INFERENCE_TIMEOUT_MS / 1000}s`)), INFERENCE_TIMEOUT_MS)),
        ]);

        const text = (reply.choices[0].message.content || "").trim();
        const parsed = firstJsonObject(text);
        if (!parsed) {
          sendResponse({ ok: false, error: `model did not return usable JSON: ${text.slice(0, 200)}` });
          return;
        }
        if (!parsed.tool) {
          sendResponse({ ok: true, toolCall: null, text: parsed.reply || text });
          return;
        }
        sendResponse({ ok: true, toolCall: { name: parsed.tool, args: parsed.args || {} }, raw: text.slice(0, 300) });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
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
