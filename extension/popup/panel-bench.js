/* panel-bench.js - the same twelve tokens, in a window somebody can see.
 *
 * The model runs in an offscreen document, which is hidden by definition,
 * and Chrome throttles what it cannot see. On one machine here a 1.5B took
 * thirty-two seconds a turn and an 8B managed a tenth of a token a second -
 * on a real Metal adapter, with a 4096MB storage binding, memory to spare,
 * and five gigabytes of weights loading off disk in seven seconds. Healthy
 * hardware and unusable inference is the shape of throttling, not of a slow
 * GPU, and nothing in the extension could tell the two apart because every
 * measurement it had was taken in the same hidden document.
 *
 * So this runs the identical prompt here, in the panel, which is visible.
 * Two numbers from one machine and one model: if the visible one is many
 * times quicker, the offscreen document is the problem and the model belongs
 * somewhere else. If they match, the machine is simply slow and no amount of
 * moving it will help.
 *
 * Loaded on demand, because building an engine costs memory and nobody wants
 * that for opening a panel.
 */
export async function benchHere(modelId, onProgress) {
  const { CreateMLCEngine } = await import("../offscreen/vendor/web-llm.js");
  const engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (r) => onProgress && onProgress(String((r && r.text) || "")),
  });
  const began = Date.now();
  const reply = await Promise.race([
    engine.chat.completions.create({
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      temperature: 0,
      max_tokens: 12,
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("twelve tokens did not finish in 90s, even here")), 90000)),
  ]);
  const ms = Date.now() - began;
  const u = (reply && reply.usage) || {};
  const x = u.extra || {};
  // Handed back straight away. This is a measurement, not a second planner,
  // and leaving it loaded would put two models on the GPU - which is its own
  // way of making everything slow.
  try { if (engine && engine.unload) await engine.unload(); } catch (e) { /* going anyway */ }
  return {
    ms,
    replyTokens: u.completion_tokens ?? null,
    decodePerS: x.decode_tokens_per_s ?? null,
    firstTokenS: x.time_to_first_token_s ?? null,
  };
}
