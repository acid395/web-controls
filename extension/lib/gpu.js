/* gpu.js - what this machine's WebGPU adapter can and cannot do, in one
 * place.
 *
 * Lived only in the offscreen document, so any diagnostic asking about the
 * graphics card - the "graphics card" and "model fits this machine" lines in
 * diagnose, the remedy on a failed decision, the hint on a slow one - had
 * nothing to say whenever the panel was the one running the model. That is
 * the common case now: the panel hosts the engine while it is open, and
 * everything about that redesign points at the panel being asked first.
 * Asking it "can you answer" and never "what are you running on" was half
 * the question.
 *
 * Pure aside from the browser APIs it reads, so it is shared rather than
 * duplicated: the offscreen document imports it as a module, the panel
 * loads it as a plain script, same as lib/models.js and lib/step-prompt.js.
 */
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
      deviceMemoryGB: (typeof navigator.deviceMemory === "number") ? navigator.deviceMemory : null,
      cores: (typeof navigator.hardwareConcurrency === "number") ? navigator.hardwareConcurrency : null,
      // Which Chrome. An Intel build running translated on an Apple GPU
      // drives Metal, and drives it badly - tens of times slower - and every
      // Mac Chrome says "Intel Mac OS X" in its user agent whatever it was
      // actually built for, so the string cannot answer this. This can.
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

globalThis.WC_DESCRIBE_GPU = describeGpu;
