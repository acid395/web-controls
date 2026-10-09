/* model-host.js - the model, in the page that installed the widget.
 *
 * The extension's panel-model.js, without the extension. Same engine, same
 * prompt shape, same reply shape, so background.js cannot tell which one
 * answered it: it sends "panelStep" and gets text back.
 *
 * Two differences, both because this runs inside somebody else's app:
 *
 *   - A Web Worker where one can be had. The extension's panel is a window
 *     of its own; here the model shares a main thread with the host app,
 *     and a generation that holds it would freeze that app's UI. Falls back
 *     to the main thread when the page's CSP refuses blob workers.
 *
 *   - Nothing loads until somebody asks for it. A page visitor did not
 *     choose a two gigabyte download by landing on the page, so load() is
 *     only ever called from the widget's own button or from an ask.
 */
/* Where WebLLM comes from, two ways.
 *
 * By URL, for the script tag and for a site that hosts the file itself:
 * import() of an absolute address, and a worker made from a blob that
 * imports the same address.
 *
 * By a loader the module build supplies, for an app that installed the
 * package: import("./web-llm.js") and new Worker(new URL(..., import.meta
 * .url)) written out literally, because those two shapes are what Vite and
 * webpack recognise and copy into the app's build. A URL worked out at run
 * time is invisible to a bundler, so the file it names never ships.
 */
function urlLoaders(webllmUrl) {
  const libUrl = new URL(webllmUrl, location.href).href;
  return {
    loadLib: () => import(/* webpackIgnore: true */ /* @vite-ignore */ libUrl),
    makeWorker: () => {
      const src = `import { WebWorkerMLCEngineHandler } from ${JSON.stringify(libUrl)};\n`
        + "const handler = new WebWorkerMLCEngineHandler();\n"
        + "self.onmessage = (e) => handler.onmessage(e);\n";
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      return { worker: new Worker(url, { type: "module" }), done: () => URL.revokeObjectURL(url) };
    },
  };
}

function createModelHost({ loadLib, makeWorker, useWorker = true, allowEmbed = false, onProgress } = {}) {
  let lib = null;
  const webllm = () => lib || (lib = loadLib());

  let enginePromise = null;
  let engineReady = false;
  let engineModel = null;
  let where = null;
  let lastProgress = { text: "", fraction: null };
  let lastError = null;
  let gpuInfo = null;

  if (typeof globalThis.WC_DESCRIBE_GPU === "function") {
    globalThis.WC_DESCRIBE_GPU().then((g) => { gpuInfo = g; }).catch(() => {});
  }

  const progressCb = (r) => {
    lastProgress = {
      text: String((r && r.text) || ""),
      fraction: typeof (r && r.progress) === "number" ? r.progress : null,
    };
    if (onProgress) onProgress(lastProgress.text, lastProgress.fraction);
  };

  async function inWorker(api, modelId, chatOpts) {
    // A worker the page's CSP forbids fails with an error event and nothing
    // else, and CreateWebWorkerMLCEngine would wait on it forever - so the
    // error is raced against the load.
    // Some refusals are thrown by the constructor rather than reported later.
    let made;
    try { made = makeWorker(); } catch (e) {
      const err = new Error(`the model worker could not start: ${String((e && e.message) || e)}`);
      err.workerDidNotStart = true;
      throw err;
    }
    const worker = made.worker;
    const failed = new Promise((_, reject) => {
      worker.addEventListener("error", (e) => {
        const err = new Error(`the model worker could not start${e && e.message ? `: ${e.message}` : ""}`);
        err.workerDidNotStart = true;
        reject(err);
      }, { once: true });
    });
    try {
      const engine = await Promise.race([
        api.CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback: progressCb }, chatOpts),
        failed,
      ]);
      where = "a worker";
      return engine;
    } catch (e) {
      worker.terminate();
      throw e;
    } finally {
      if (made.done) made.done();
    }
  }

  async function build(modelId) {
    const api = await webllm();
    // The same allowance panel-model.js makes: the large models get a
    // smaller context window, which is what lets them fit beside a page.
    const chatOpts = (globalThis.WC_MODEL_VRAM && globalThis.WC_MODEL_VRAM(modelId) >= 4000)
      ? { context_window_size: 3072 } : undefined;
    // The main thread only when the worker itself could not start - a CSP
    // without blob:, a browser without module workers. A worker that started
    // and then failed to load the model failed for a reason the main thread
    // shares (the network, the card's memory), and falling back there began
    // the whole multi-gigabyte download again to fail the same way.
    if (useWorker && makeWorker && typeof Worker !== "undefined" && api.CreateWebWorkerMLCEngine) {
      try { return await inWorker(api, modelId, chatOpts); } catch (e) {
        if (!(e && e.workerDidNotStart)) throw e;
      }
    }
    where = "the page";
    return api.CreateMLCEngine(modelId, { initProgressCallback: progressCb }, chatOpts);
  }

  function engineFor(modelId) {
    if (enginePromise && engineModel === modelId) return enginePromise;
    const previous = enginePromise;
    engineModel = modelId;
    engineReady = false;
    lastError = null;
    enginePromise = (async () => {
      // Two copies of the weights on one card is what made the extension
      // crawl, so the old one goes before the new one comes.
      if (previous) {
        try { const e = await previous; if (e && e.unload) await e.unload(); } catch (e) { /* never loaded */ }
      }
      return build(modelId);
    })()
      .then((e) => { engineReady = true; return e; })
      .catch((err) => {
        enginePromise = null; engineReady = false; engineModel = null;
        lastError = String((err && err.message) || err);
        throw err;
      });
    return enginePromise;
  }

  async function release() {
    if (!enginePromise) return;
    const held = enginePromise;
    enginePromise = null; engineReady = false; engineModel = null;
    lastProgress = { text: "", fraction: null };
    try { const e = await held; if (e && e.unload) await e.unload(); } catch (e) { /* gone */ }
  }

  async function step(modelId, prompt, { timeoutMs = 45000 } = {}) {
    const engine = await engineFor(modelId);
    const began = Date.now();
    let timer = null;
    let reply;
    try {
      reply = await Promise.race([
        engine.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 192,
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            // Stopped, not just abandoned. A generation nobody is waiting
            // for still holds the engine, and the next decision queued
            // behind it - so one slow turn made the turn after it slow too.
            try { if (engine.interruptGenerate) engine.interruptGenerate(); } catch (e) { /* already done */ }
            reject(new Error(`inference timed out after ${Math.round(timeoutMs / 1000)}s`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
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

  // The shortlist's embedder is another gigabyte. Off unless the site asks
  // for it: without it the agent narrows a page by words instead, which is
  // what the extension does on any machine that cannot hold both.
  const EMBED_ID = "snowflake-arctic-embed-s-q0f32-MLC";
  let embedPromise = null;
  async function embed(texts) {
    if (!allowEmbed) throw new Error("the meaning model is off in this widget");
    if (!embedPromise) {
      embedPromise = webllm().then((api) => api.CreateMLCEngine(EMBED_ID, {}))
        .catch((err) => { embedPromise = null; throw err; });
    }
    const engine = await embedPromise;
    const out = await engine.embeddings.create({ input: texts });
    return (out && out.data ? out.data : []).map((d) => d.embedding);
  }

  function status() {
    return {
      ready: engineReady,
      loading: !!enginePromise && !engineReady,
      model: engineModel,
      progress: lastProgress.text || null,
      fraction: engineReady ? 1 : lastProgress.fraction,
      error: lastError,
      where,
      hasGpu: typeof navigator !== "undefined" && "gpu" in navigator,
      gpu: gpuInfo,
    };
  }

  // Start loading without waiting for it. Failures are reported through
  // status(), which the widget polls while a load is running.
  function load(modelId) {
    engineFor(modelId).catch(() => {});
  }

  return { load, step, embed, status, release };
}
