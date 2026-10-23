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
// The last thing the loader said, kept so a panel that opens mid-download
// can show where it is rather than a bare "loading".
let lastProgress = { text: "", fraction: null };

async function engineFor(modelId, onProgress) {
  if (enginePromise && engineModel === modelId) return enginePromise;
  if (enginePromise) await release();
  engineModel = modelId;
  const { CreateMLCEngine } = await import("../offscreen/vendor/web-llm.js");
  enginePromise = CreateMLCEngine(modelId, {
    // The fraction as well as the words. WebLLM reports both and only the
    // words were passed on, so the panel could say "loading" and never how
    // far along - which on a five gigabyte download is the difference
    // between waiting and assuming it has hung.
    initProgressCallback: (r) => {
      lastProgress = {
        text: String((r && r.text) || ""),
        fraction: typeof (r && r.progress) === "number" ? r.progress : null,
      };
      if (onProgress) onProgress(lastProgress.text, lastProgress.fraction);
    },
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
  lastProgress = { text: "", fraction: null };
  try { const e = await held; if (e && e.unload) await e.unload(); } catch (e) { /* gone */ }
}

// Start loading, without waiting for it.
//
// warmModel in the service worker stopped warming the hidden document while
// the panel is open - rightly, since two copies of the weights on one card
// is what made everything crawl. But nothing was given to the panel to warm
// instead, so the model stopped preloading altogether: every card said "the
// local model has not started yet", and the first instruction that needed it
// would have paid the whole load.
export function warm(modelId, onProgress) {
  engineFor(modelId, onProgress).catch(() => { /* reported through status() */ });
}

export function status() {
  return {
    ready: engineReady,
    loading: !!enginePromise && !engineReady,
    model: engineModel,
    progress: lastProgress.text || null,
    fraction: engineReady ? 1 : lastProgress.fraction,
  };
}

// One decision. The same shape the offscreen document answers with, so the
// caller cannot tell which one served it apart from the speed.
export async function step(modelId, prompt, { timeoutMs = 45000, schema = null, logprobs = false, maxTokens = null } = {}, onProgress) {
  const engine = await engineFor(modelId, onProgress);
  const began = Date.now();
  // A schema, where one is given, keeps the reply inside it - a plan can
  // only name controls on its list. A model that cannot take one is asked
  // again without it.
  // Streamed and gathered, as the widget's host does. A non-streamed
  // completion checks its interrupt flag before the step that clears it, so
  // after one stopped generation every later one aborted on the spot; a
  // streamed request clears the flag as it starts. That is what lets a
  // cancelled request stop the model without breaking the next one.
  const create = async (withSchema) => {
    const chunks = await engine.chat.completions.create({
      messages: [{ role: "user", content: /qwen3/i.test(String(engineModel || "")) ? `${prompt}\n/no_think` : prompt }],
      // At temperature 0 every distribution is one certain token, so a
      // choice read for its probabilities is read at 1, and its most likely
      // option taken from those probabilities rather than from the sample.
      temperature: logprobs ? 1 : 0,
      max_tokens: maxTokens || (withSchema ? 320 : 192),
      ...(withSchema ? { response_format: { type: "json_object", schema: withSchema } } : {}),
      // Each token's probability, and the next most likely ones: a choice
      // read as a distribution over its options, not just the one written.
      ...(logprobs ? { logprobs: true, top_logprobs: 5 } : {}),
      stream: true,
      stream_options: { include_usage: true },
    });
    let content = "";
    let usage = null;
    const lps = [];
    for await (const c of chunks) {
      const ch = c && c.choices && c.choices[0];
      if (ch && ch.delta && ch.delta.content) content += ch.delta.content;
      if (ch && ch.logprobs && Array.isArray(ch.logprobs.content)) lps.push(...ch.logprobs.content);
      if (c && c.usage) usage = c.usage;
    }
    return { choices: [{ message: { content } }], usage, lps };
  };
  let timer = null;
  let reply;
  try {
    reply = await Promise.race([
      schema ? create(schema).catch(() => create(null)) : create(null),
      new Promise((_, reject) => { timer = setTimeout(() => {
        // Stopped, not abandoned: a generation nobody waits for still holds
        // the engine, and the next decision would queue behind it.
        try { if (engine.interruptGenerate) engine.interruptGenerate(); } catch (e) { /* done already */ }
        reject(new Error(`inference timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const u = (reply && reply.usage) || {};
  const x = u.extra || {};
  return {
    text: (reply.choices[0].message.content || "").trim(),
    ...(logprobs ? { logprobs: (reply.lps || []).map((t) => ({ token: t.token, logprob: t.logprob,
      top: (t.top_logprobs || []).map((x) => ({ token: x.token, logprob: x.logprob })) })) } : {}),
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

// A request was cancelled: whatever the model is writing, stop.
export function interrupt() {
  try { if (engineReady && enginePromise) enginePromise.then((e) => { try { if (e && e.interruptGenerate) e.interruptGenerate(); } catch (x) { /* done */ } }); } catch (e) { /* nothing loaded */ }
}

/* The shortlist, in the same window as the planner.
 *
 * Narrowing a page to the dozen controls closest to the request is what
 * keeps a prompt at a few hundred tokens instead of a few thousand, and the
 * embedder that does it lived only in the offscreen document. When that
 * document stopped being created - because it was loading a second copy of
 * the planner and starving the card - the shortlist went with it, silently.
 * A 475-control page then went to the model whole, and "explain this page"
 * took 88 seconds in a window measured at 13 tokens a second.
 *
 * arctic-embed-s is 1023MB and answers once per instruction.
 */
const EMBED_ID = "snowflake-arctic-embed-s-q0f32-MLC";
let embedPromise = null;

export async function embed(texts) {
  if (!embedPromise) {
    const { CreateMLCEngine } = await import("../offscreen/vendor/web-llm.js");
    embedPromise = CreateMLCEngine(EMBED_ID, {})
      .catch((err) => { embedPromise = null; throw err; });
  }
  const engine = await embedPromise;
  const out = await engine.embeddings.create({ input: texts });
  return (out && out.data ? out.data : []).map((d) => d.embedding);
}
