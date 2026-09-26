/* panel-model.js - the model, in a window Chrome can see.
 *
 * Measured on one machine, same model, same prompt, twelve tokens:
 *
 *     hidden (offscreen document):  40.7s   0.0 tokens/s
 *     visible (this panel):          0.5s  13.2 tokens/s
 *
 * Seventy-nine times. Chrome throttles what it cannot see, an offscreen
 * document is hidden by definition, and every decision this extension has
 * ever made was made inside one. That is the whole of it - not memory, not
 * the adapter, not the size of the weights, and not the seven other things
 * that got blamed on the way here.
 *
 * So the panel hosts the engine while it is open, and the offscreen document
 * is what is left for when it is not. Only ever one of them holds weights:
 * two engines on one card is how the first attempt to measure this came back
 * saying the panel was slow too.
 */
let enginePromise = null;
let engineReady = false;
let engineModel = null;

async function engineFor(modelId, onProgress) {
  if (enginePromise && engineModel === modelId) return enginePromise;
  if (enginePromise) await release();
  engineModel = modelId;
  const { CreateMLCEngine } = await import("../offscreen/vendor/web-llm.js");
  enginePromise = CreateMLCEngine(modelId, {
    initProgressCallback: (r) => onProgress && onProgress(String((r && r.text) || "")),
  }, (globalThis.WC_MODEL_VRAM && WC_MODEL_VRAM(modelId) >= 4000)
    ? { context_window_size: 3072 } : undefined)
    .then((e) => { engineReady = true; return e; })
    .catch((err) => { enginePromise = null; engineReady = false; engineModel = null; throw err; });
  return enginePromise;
}

export async function release() {
  if (!enginePromise) return;
  const held = enginePromise;
  enginePromise = null; engineReady = false; engineModel = null;
  try { const e = await held; if (e && e.unload) await e.unload(); } catch (e) { /* gone */ }
}

export function status() {
  return { ready: engineReady, loading: !!enginePromise && !engineReady, model: engineModel };
}

// One decision. The same shape the offscreen document answers with, so the
// caller cannot tell which one served it apart from the speed.
export async function step(modelId, prompt, { timeoutMs = 45000 } = {}, onProgress) {
  const engine = await engineFor(modelId, onProgress);
  const began = Date.now();
  const reply = await Promise.race([
    engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 192,
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`inference timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)),
  ]);
  const u = (reply && reply.usage) || {};
  const x = u.extra || {};
  return {
    text: (reply.choices[0].message.content || "").trim(),
    ms: Date.now() - began,
    cost: {
      promptTokens: u.prompt_tokens ?? null,
      replyTokens: u.completion_tokens ?? null,
      prefillPerS: x.prefill_tokens_per_s ?? null,
      decodePerS: x.decode_tokens_per_s ?? null,
      firstTokenS: x.time_to_first_token_s ?? null,
    },
  };
}
