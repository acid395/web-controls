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
import "../lib/models.js";
import "../lib/step-prompt.js";

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
// Switchable, because size is the whole of load time: this one is about 2GB,
// Qwen2.5-1.5B about 1GB, Llama-3.2-1B about 700MB. The task is now "reply
// with a number and one word", which is far less than a 3B model is for, so
// a smaller one may well hold the format just as well and start in a third
// of the time - and having both selectable is what makes that measurable
// rather than a guess.
//
// The default stays at 3B for anyone who has already paid for the download;
// switching costs a fresh one.
// Was the 3B. It crashed Chrome on the machine this was being tested on -
// roughly two gigabytes of weights resident in the GPU process alongside a
// map-heavy government page - and before that it was costing thirty-odd
// seconds a decision there. A browser that falls over is not a slower
// answer, it is somebody's tabs gone, and no amount of planning quality is
// worth it. The 1.5B is about a gigabyte and two to three times quicker;
// the 3B is still one line away in the panel for anyone whose machine can
// hold it.
// One list, in lib/models.js. This held its own copy, and an id the panel
// offered but this did not recognise fell back to the default in silence -
// so adding a model to the picker made the picker stop working.
const DEFAULT_MODEL_ID = globalThis.WC_DEFAULT_MODEL;
let MODEL_ID = DEFAULT_MODEL_ID;
const KNOWN_MODELS = globalThis.WC_MODEL_IDS;
// Read as a promise, and waited for before any engine is built. It used to
// be a callback that set MODEL_ID whenever it happened to arrive - while
// getEngine read MODEL_ID synchronously, and the service worker warms the
// model almost as soon as the document exists. So the default won the race
// and loaded, and choosing a smaller model in the panel changed nothing: a
// card still came back saying Llama 3.2 3B, thirty-five seconds a decision,
// after somebody had switched precisely to avoid that.
let modelChoice = null;
// How long one decision is allowed, against what the model needs.
//
// A flat forty-five seconds was right when the default was a 1.5B and is
// less than a single turn of an 8B on ordinary hardware - so once the
// default changed, every turn timed out and the model never answered at all.
// A card reading "the model did not answer in time" after exactly 45.3s is
// this number, not the model: it had not finished its first sentence.
//
// The ceiling still matters. A generation left running holds the engine, so
// the next step queues behind a decision nobody is waiting for any more.
// What the GPU actually is, rather than whether the API exists.
//
// hasGpu has always been `"gpu" in navigator`, which says only that this
// browser has the interface - not that requesting an adapter succeeds, and
// not that the adapter is hardware. Chrome will quietly hand back a software
// renderer, and a software renderer is roughly ten times slower: the same
// 8B doing a whole multi-step instruction in ten to thirty-five seconds on
// one machine, and failing to finish a single turn in forty-five on another,
// is that difference and nothing else. Without this there was no way to tell
// the two apart from a card, so "the model is slow" and "the model is not on
// the GPU at all" looked identical.
let gpuInfo = null;
async function describeGpu() {
  if (!("gpu" in navigator)) return { ok: false, why: "this browser has no WebGPU" };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, why: "WebGPU is present but no adapter was granted" };
    const info = adapter.info
      || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null) || {};
    const described = [info.vendor, info.architecture, info.device, info.description]
      .filter(Boolean).join(" ").trim();
    const limits = adapter.limits || {};
    const mb = (n) => (typeof n === "number" ? Math.round(n / (1024 * 1024)) : null);
    return {
      ok: true,
      describedAs: described || null,
      // Named outright. A fallback adapter runs, so nothing errors - it is
      // just slow enough that every timeout here looks like the model's
      // fault.
      software: adapter.isFallbackAdapter === true
        || /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(described),
      maxBufferMB: mb(limits.maxBufferSize),
      maxStorageMB: mb(limits.maxStorageBufferBindingSize),
      // How much memory the machine has, roughly. Chrome reports this in
      // powers of two and caps it at 8, so it cannot tell 8GB from 32 - but
      // it can tell 4 from 8, and that is the distinction that matters when
      // the weights are five gigabytes.
      //
      // Wanted because loading is fast here and inference is not: 3161MB
      // came off disk in seven seconds on a machine that then managed a
      // tenth of a token a second. Sequential reads are fine and random
      // access across five gigabytes of weights is not, which is what
      // paging looks like from the outside, and the GPU's own limits - a
      // 4096MB buffer and a 4096MB storage binding - say nothing about it.
      deviceMemoryGB: (typeof navigator.deviceMemory === "number") ? navigator.deviceMemory : null,
      cores: (typeof navigator.hardwareConcurrency === "number") ? navigator.hardwareConcurrency : null,
      // Which Chrome. The 1.5B takes thirty-two seconds a turn on this
      // machine and times out at forty-five - a 1630MB model, on a real
      // Metal adapter, with four gigabytes of storage binding and memory to
      // spare. Every model being twenty to thirty times slow is not a model
      // problem, and the remaining explanation that fits is the browser
      // itself running translated: an Intel build of Chrome under Rosetta on
      // an Apple GPU will drive Metal, and drive it badly.
      //
      // Every Mac Chrome says "Intel Mac OS X" in its user agent whatever it
      // is built for, so the string cannot answer this. This can.
      arch: await (async () => {
        try {
          if (!navigator.userAgentData || !navigator.userAgentData.getHighEntropyValues) return null;
          const h = await navigator.userAgentData.getHighEntropyValues(["architecture", "bitness"]);
          return h && h.architecture ? String(h.architecture) : null;
        } catch (e) { return null; }
      })(),
    };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e).slice(0, 160) };
  }
}
// Asked once, early, so llmStatus can answer without becoming asynchronous.
describeGpu().then((g) => { gpuInfo = g; }).catch(() => { gpuInfo = null; });

function inferenceTimeoutMs() {
  const mb = globalThis.WC_MODEL_VRAM ? globalThis.WC_MODEL_VRAM(MODEL_ID) : 0;
  return mb >= 4000 ? 180000 : mb >= 2000 ? 90000 : 45000;
}

// Forget what was chosen, so the next load reads the choice again.
//
// This promise was cached for the life of the document and never invalidated,
// and its .then also reassigned MODEL_ID. So stepping down set MODEL_ID to
// the smaller model, released the engine - and the next load asked this,
// which handed back the cached large one and put MODEL_ID back with it. The
// 8B reloaded, failed its twelve tokens, stepped down, reloaded, forever,
// while the card named the small model and the panel said "still loading"
// for ten minutes because it genuinely never stopped.
function forgetChosenModel(id) {
  modelChoice = id ? Promise.resolve(id) : null;
}

function chosenModelId() {
  if (!modelChoice) {
    modelChoice = new Promise((resolve) => {
      try {
        chrome.storage.local.get("llmModelId", ({ llmModelId }) => {
          resolve(llmModelId && KNOWN_MODELS.includes(llmModelId) ? llmModelId : DEFAULT_MODEL_ID);
        });
      } catch (e) { resolve(DEFAULT_MODEL_ID); }
    }).then((id) => { MODEL_ID = id; return id; });
  }
  return modelChoice;
}
// Settled early too, so llmStatus reports the model that is going to load
// rather than the one that would have.
try { chosenModelId(); } catch (e) { /* no storage here; the default stands */ }

// buildStepPrompt moved to lib/step-prompt.js, because the panel builds the
// same prompt now. See the note there.


// firstJsonObject moved to lib/step-prompt.js beside the prompt builder,
// because the panel needs it too. See the note there.


let enginePromise = null;
// The last thing the loader said, so status can report progress rather than a
// bare "not ready" through a multi-gigabyte download.
let lastProgress = null;
let engineReady = false; // a Promise can't be asked "are you resolved yet?" directly - tracked separately so llmStatus can answer synchronously instead of waiting on the engine.

// Weights let go of when nothing has used them for a while. They sit in the
// GPU process for as long as the offscreen document lives, which is for as
// long as the browser does, and on a machine where that is most of the
// available memory the next thing to ask for some is what falls over. The
// cache keeps the download, so coming back costs a load rather than a
// fetch.
// Nothing unloads on a timer any more.
//
// The idle release and the embedder hand-back were both added here for
// memory pressure that was reasoned about rather than measured, and both
// produced "Object has already been disposed" on real instructions - an
// engine pulled out from under a live generation, which reads from a card as
// the model failing. Guarding them was tried twice and the error came back
// both times, because there is no moment at which it is safe to dispose
// something another request may be about to touch.
//
// So the weights stay until the model is deliberately changed, which closes
// the whole document and takes everything with it. Holding a model while the
// browser is open is what every other WebLLM application does; disposing it
// underneath somebody is not.
let idleTimer = null;
function touchEngine() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

// Meaning, as distinct from judgment.
//
// A 1.5B asked to pick one of a hundred and twenty controls is being given a
// retrieval problem, which is the thing small generative models are worst
// at: it anchors on a word it recognises and answers "Last page, page 42"
// for "last month of data". It is also where the waiting goes - the control
// list is most of a 700-token prompt, and prompt is most of a decision.
//
// An embedder answers "which of these means what was asked" in milliseconds
// and learned it rather than being told. A month near 30 days, water level
// near gage height, how dry is the ground near soil moisture - every one of
// those is a rule written by hand in this codebase this week, and none of
// them should have had to be.
//
// Small on purpose: arctic-embed-s is tens of megabytes beside the 1.5B's
// gigabyte, and this machine has already had Chrome fall over once.
//
// "Small" stopped being the whole story when the default became an eight
// billion parameter model: this wants a gigabyte of its own on top of the
// planner's five. Standing it down was tried and was worse - it is the only
// thing that narrows a long page, and without it a 163-control page went to
// the model whole. It is handed back the moment it has answered instead.
const EMBED_MODEL_ID = "snowflake-arctic-embed-s-q0f32-MLC";
let embedPromise = null;
let embedReady = false;
// Tried, not refused. Standing this down beside a large planner removed the
// only thing that narrows a long page, and a 163-control page then went to
// the 8B whole: forty-seven seconds and an unusable reply, which is worse
// than the out-of-memory this was avoiding. Where it does fail for want of
// video memory the caller catches it and ranks by words instead, so the
// shortlist survives either way and the prompt stays bounded.
// Handed back as soon as it has answered, where the planner is large.
//
// Both engines can be live at once: an 8B wants 5001MB and this wants
// another 1023MB, and on Apple Silicon that is unified memory shared with
// Chrome and the page. Nothing errors - Metal pages instead - and the
// symptom is a decision that will not finish in three minutes on a machine
// whose adapter reports a 4096MB maximum buffer. Keeping it loaded bought
// nothing: it is asked once per instruction and reloads from cache.

function getEmbedder(onProgress) {
  if (!embedPromise) {
    embedPromise = CreateMLCEngine(EMBED_MODEL_ID, {
      initProgressCallback: (report) => {
        if (onProgress) onProgress(report);
      },
    }).then((engine) => { embedReady = true; return engine; });
  }
  return embedPromise;
}


// How many requests are inside the engine right now.
//
// "Object has already been disposed" is WebLLM saying something unloaded the
// engine while a generation was still running in it. Three things here
// unload: the idle timer, stepping down a model, and handing the embedder
// back - and all three were added for good reasons and none of them asked
// whether anybody was mid-answer. A release while a decision is in flight
// kills the decision and reads, from a card, as the model failing.
let inFlight = 0;
async function whileBusy(fn) {
  inFlight++;
  try { return await fn(); } finally { inFlight--; }
}
// Waits for the work to finish rather than cutting it off. Bounded, because
// a generation that never returns must not make this wait for ever either.
async function whenIdle({ waitMs = 5000 } = {}) {
  const until = Date.now() + waitMs;
  while (inFlight > 0 && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return inFlight === 0;
}

// Let go of the planner, so the next request builds whichever one is chosen.
async function releaseEngine() {
  if (!enginePromise) return;
  // Refuses rather than proceeds. This waited and then unloaded anyway, and
  // waiting five seconds for a decision that takes thirteen is not waiting -
  // it is a pause before the same disposal. Something still running keeps
  // its engine; stepping down can happen when it is done.
  if (!(await whenIdle({ waitMs: 20000 }))) return;
  const held = enginePromise;
  enginePromise = null;
  engineReady = false;
  try {
    const engine = await held;
    if (engine && typeof engine.unload === "function") await engine.unload();
  } catch (e) { /* already gone */ }
}

// A shorter context, where the weights are already large.
//
// The 8B is 5001MB of weights and, separately, a key-value cache sized by
// the context window: thirty-two layers, eight key-value heads, 128 wide,
// two bytes a number, twice over for keys and values - about 128KB a token,
// so 4096 tokens is another half a gigabyte. That is half a gigabyte of the
// scarcest thing on the machine, held for a window nothing here fills: the
// prompt is a few hundred tokens once the shortlist has narrowed the page,
// and twenty-five hundred at its very worst.
//
// Only for the large ones. A 1.5B's cache is small enough that trimming it
// buys nothing and could truncate a long page for no reason.
const LARGE_CONTEXT = 3072;
function chatOptsFor(id) {
  const mb = globalThis.WC_MODEL_VRAM ? globalThis.WC_MODEL_VRAM(id) : 0;
  return mb >= 4000 ? { context_window_size: LARGE_CONTEXT } : undefined;
}

function buildEngine(id, onProgress) {
  return CreateMLCEngine(id, {
    initProgressCallback: (report) => {
      // Kept, not just forwarded: the panel may not be open when this
      // arrives, and "still downloading, 41%" is the answer to why the
      // model did not plan.
      lastProgress = String((report && report.text) || "").slice(0, 120);
      if (onProgress) onProgress(report);
    },
  }, chatOptsFor(id));
}

function getEngine(onProgress) {
  touchEngine();
  if (!enginePromise) {
    // The choice first, then the engine. Building one before knowing which
    // model was asked for is how the wrong weights get two gigabytes of
    // download and every decision after it.
    enginePromise = chosenModelId()
      .then((id) => buildEngine(id, onProgress).catch((err) => {
        // Said, not worked around. Switching models on somebody's behalf is
        // what all of this used to do, and between the ladder, the
        // step-downs and the reload loop it did more damage than the problem
        // it was for. The picker is at the top of the panel; choosing is
        // theirs.
        lastProgress = `${WC_MODEL_NAME(id)} would not load here`
          + ` - ${String((err && err.message) || err).slice(0, 120)}`;
        throw err;
      }))
      .then((engine) => {
        engineReady = true;
        return engine;
      })
      .catch((err) => { enginePromise = null; engineReady = false; throw err; });
  }
  return enginePromise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return; // not for us, e.g. content-script traffic relayed elsewhere

  // Raw throughput, on a prompt too small to blame.
  //
  // Their whole multi-step instruction runs in ten to thirty seconds; one
  // turn here will not finish in a hundred and eighty. That is not hardware
  // variance, and four explanations for it have now been wrong. This settles
  // it by measuring the thing itself: a dozen tokens in, a dozen out, no page
  // and no control list. If that is slow, the machine cannot run this model
  // and no amount of work on the prompt will help. If it is fast, the wait is
  // something we are building, and it is ours to fix.
  if (msg.type === "llmBench") {
    (async () => {
      try {
        if (!("gpu" in navigator)) throw new Error("no WebGPU here");
        const engine = await getEngine((report) => {
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text, fraction: report.progress }).catch(() => {});
        });
        const began = Date.now();
        const reply = await whileBusy(() => Promise.race([
          engine.chat.completions.create({
            messages: [{ role: "user", content: "Reply with the single word: ready" }],
            temperature: 0,
            max_tokens: 12,
          }),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error("even a twelve-token reply did not finish in 60s")), 60000)),
        ]));
        const u = (reply && reply.usage) || {};
        const x = u.extra || {};
        sendResponse({
          ok: true,
          model: MODEL_ID,
          ms: Date.now() - began,
          promptTokens: u.prompt_tokens ?? null,
          replyTokens: u.completion_tokens ?? null,
          prefillPerS: x.prefill_tokens_per_s ?? null,
          decodePerS: x.decode_tokens_per_s ?? null,
          firstTokenS: x.time_to_first_token_s ?? null,
        });
      } catch (err) {
        sendResponse({ ok: false, model: MODEL_ID, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  if (msg.type === "llmPing") {
    (async () => {
      try {
        if (!("gpu" in navigator)) {
          throw new Error("navigator.gpu is undefined - this browser/machine doesn't expose WebGPU");
        }
        const engine = await getEngine((report) => {
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text, fraction: report.progress });
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

  // Vectors for a list of short strings. Everything else about ranking -
  // what to compare, what counts as close, what to do when nothing is -
  // belongs in the service worker with the rest of the judgment.
  if (msg.type === "llmEmbed") {
    (async () => {
      try {
        if (!("gpu" in navigator)) throw new Error("no WebGPU here");
        const texts = (msg.texts || []).map((t) => String(t || "").slice(0, 120));
        if (!texts.length) { sendResponse({ ok: true, vectors: [] }); return; }
        const engine = await getEmbedder((report) => {
          chrome.runtime.sendMessage({
            type: "llmProgress", text: `meaning model: ${(report && report.text) || ""}`.slice(0, 120),
          }).catch(() => {});
        });
        const began = Date.now();
        const out = await whileBusy(() => engine.embeddings.create({ input: texts }));
        sendResponse({
          ok: true,
          vectors: (out && out.data ? out.data : []).map((d) => d.embedding),
          ms: Date.now() - began,
        });
        // Not unloaded here. Handing it back mid-instruction is what
        // "Object has already been disposed" was: the next model step
        // reached for something this had just torn down. A gigabyte held is
        // worth less than an instruction that dies.
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  if (msg.type === "llmEmbedStatus") {
    sendResponse({ ready: embedReady, started: !!embedPromise, hasGpu: "gpu" in navigator });
    return;
  }

  // Switch model, in place.
  //
  // Switching used to work by closing this whole document and letting the
  // next request build a new one - which reads the stored choice and so
  // picks up the change. But closeDocument can fail, and when it does the
  // failure is swallowed: the old document lives on, ensureOffscreenDocument
  // finds one already there, and every card goes on naming the model
  // somebody just switched away from. It fails most reliably while a large
  // model is mid-load, which is exactly when somebody reaches for the picker.
  //
  // So the document is told directly instead. No closing, nothing to fail
  // silently, and the same path whether or not anything was loaded.
  if (msg.type === "llmUseModel") {
    (async () => {
      const want = String(msg.model || "");
      if (!want || !KNOWN_MODELS.includes(want)) {
        sendResponse({ ok: false, error: `not a model this build offers: ${want}` });
        return;
      }
      if (want === MODEL_ID && engineReady) { sendResponse({ ok: true, model: MODEL_ID }); return; }
      MODEL_ID = want;
      forgetChosenModel(want);
      engineReady = false;

      // The engine promise is replaced, not awaited.
      //
      // releaseEngine awaits whatever it is holding, and what it was holding
      // was a four-gigabyte load in progress - so switching queued behind
      // the model being switched away from, which on the machine that
      // reported this takes minutes. "use 3b" answered "stored", and the 8B
      // carried on loading, and every card went on naming it.
      //
      // Pointing enginePromise at the new one immediately means the status
      // is honest from this moment, and nothing else starts a second engine
      // while the change is happening. The old load still has to finish -
      // WebLLM offers no way to abandon one - but it is unloaded the instant
      // it lands rather than being waited for first.
      const old = enginePromise;
      lastProgress = old
        ? `waiting for the previous model to finish loading, then switching to ${WC_MODEL_NAME(want)}`
        : null;
      enginePromise = (async () => {
        try {
          const e = await old;
          // Waits for generations, not for loads. A load in progress is not
          // inFlight, so this returns at once in the ordinary case - and
          // where a decision really is running on the old engine, it is
          // allowed to finish rather than being disposed underneath.
          await whenIdle({ waitMs: 20000 });
          if (e && typeof e.unload === "function") await e.unload();
        } catch (err) { /* it never finished loading; nothing to give back */ }
        return buildEngine(want, (r) => {
          lastProgress = String((r && r.text) || "").slice(0, 120);
          chrome.runtime.sendMessage({ type: "llmProgress", text: r.text, fraction: r.progress }).catch(() => {});
        });
      })().then((e) => { engineReady = true; return e; })
        .catch((err) => { enginePromise = null; engineReady = false; throw err; });
      enginePromise.catch(() => { /* reported through llmStatus */ });
      sendResponse({ ok: true, model: MODEL_ID, waitingForPrevious: !!old });
    })();
    return true;
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
      gpu: gpuInfo,
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
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text, fraction: report.progress });
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
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text, fraction: report.progress });
        });
        // The same two prompts the panel is given. A question asked here
        // would otherwise still get the operating prompt, so which window
        // answered would change the kind of answer.
        const prompt = msg.mode === "read" && globalThis.WC_BUILD_READ_PROMPT
          ? globalThis.WC_BUILD_READ_PROMPT(msg)
          : globalThis.WC_BUILD_STEP_PROMPT(msg);
        chrome.runtime.sendMessage({ type: "llmGenerating" });
        // Shorter than the two minutes the planning paths allow, because a
        // step is one small JSON object and the caller only waits the length
        // of its own request anyway. A generation left running past that
        // point holds the engine, so the next step queues behind a decision
        // nobody is waiting for any more.
        const INFERENCE_TIMEOUT_MS = inferenceTimeoutMs();
        const reply = await whileBusy(() => Promise.race([
          engine.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            // A decision is `{"n":14,"do":"check","on":true}` - about twenty
            // tokens, and that is what it costs: this is a ceiling, not a
            // budget, so an action turn decodes twenty tokens whatever the
            // number here says. Fifty-six only ever bit on a finish that
            // carried a real answer, cutting it mid-string - which parses to
            // nothing, reads as an off-format reply, and made "summarize the
            // difference" fail in a way that looked like the model refusing.
            // Room for a phrase of reasoning before the object. Still a
            // ceiling rather than a budget: a short answer costs what it
            // costs, and this only binds on one that rambles.
            max_tokens: 192,
          }),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error(`inference timed out after ${INFERENCE_TIMEOUT_MS / 1000}s`)),
            INFERENCE_TIMEOUT_MS)),
        ]));
        const text = (reply.choices[0].message.content || "").trim();
        // Where the time went, from the engine rather than from a guess.
        //
        // Three explanations were offered for the same forty-five seconds -
        // the model cannot interpret it, the model is too big, the GPU is
        // software - and the machine turned out to have a real Metal adapter,
        // so all three were wrong. Reading the page costs milliseconds and
        // the decision costs everything, but "the decision" is two very
        // different things: prefill is the prompt we built, decode is the
        // reply the model chose to write, and they are fixed by opposite
        // work. Nothing here has ever said which.
        const u = reply.usage || {};
        const x = u.extra || {};
        const cost = {
          promptTokens: u.prompt_tokens ?? null,
          replyTokens: u.completion_tokens ?? null,
          prefillPerS: x.prefill_tokens_per_s ?? null,
          decodePerS: x.decode_tokens_per_s ?? null,
          firstTokenS: x.time_to_first_token_s ?? null,
        };
        const parsed = globalThis.WC_FIRST_JSON_OBJECT(text);
        if (!parsed) {
          sendResponse({ ok: false, cost,
            error: `model did not return usable JSON: ${text.slice(0, 200)}` });
          return;
        }
        sendResponse({ ok: true, step: parsed, cost, raw: text.slice(0, 300) });
      } catch (err) {
        const why = String((err && err.message) || err);
        // Reported as it is. This used to switch models here, and switching
        // from the 1B to the 1.5B - a larger one - is what that came to.
        sendResponse({ ok: false, error: /timed out/i.test(why)
          ? `${WC_MODEL_NAME(MODEL_ID)} did not finish a decision in`
            + ` ${Math.round(inferenceTimeoutMs() / 1000)}s here`
            + " - a smaller model from the picker at the top of the panel will be quicker"
          : why });
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
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text, fraction: report.progress });
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
        const parsed = globalThis.WC_FIRST_JSON_OBJECT(text);
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
          chrome.runtime.sendMessage({ type: "llmProgress", text: report.text, fraction: report.progress });
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
      chrome.runtime.sendMessage({ type: "llmProgress", text: report.text, fraction: report.progress });
    }).then(async (engine) => {
      chrome.runtime.sendMessage({ type: "llmProgress", text: "model ready" });
      // Loaded is not the same as usable. Measured on this machine: twelve
      // tokens took 37.1 seconds - a tenth of a token a second - on a model
      // that does a four-step instruction in twelve seconds elsewhere. It
      // had loaded perfectly, reported ready, and every check passed.
      //
      // So a large model proves itself once, here, on a prompt with nothing
      // of ours in it. Finding this out now costs a few seconds; finding it
      // out from an instruction costs three minutes and looks like the model
      // refusing to answer.
    }).catch((err) => {
      chrome.runtime.sendMessage({ type: "llmProgress", text: "warm-load failed: " + String((err && err.message) || err) });
    });
    // no sendResponse: nothing is waiting on this one
  }
});
