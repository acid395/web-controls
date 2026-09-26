/* The models this extension will plan with, in one place.
 *
 * This list used to live in four: the offscreen document decided which ids
 * were acceptable, the panel's HTML listed the options, and background.js
 * held both the "use 3b" aliases and the display names. Adding a model meant
 * finding all four, and missing the first one - the acceptance check - made
 * the choice silently do nothing, because an id it did not recognise fell
 * back to the default without a word. A picker that quietly ignores you is
 * worse than no picker.
 *
 * vram is what WebLLM itself reports as required, not an estimate. A machine
 * with less than that will fail to load rather than run slowly, so it is the
 * number worth showing.
 *
 * Loaded as a plain script by the service worker and the panel, and imported
 * for its side effect by the offscreen module. Everything reads WC_MODELS.
 */
globalThis.WC_MODELS = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 1B",
    vramMB: 879,
    aliases: ["1b", "llama1b", "llama321b"],
    note: "quickest, and wrong about which control most often",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen2.5 1.5B",
    vramMB: 1630,
    aliases: ["qwen", "15b", "qwen15b", "qwen2515b"],
    note: "small and quick",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 3B",
    vramMB: 2264,
    aliases: ["3b", "llama3b", "llama323b"],
    note: "better at choosing; has crashed Chrome on smaller GPUs",
  },
  {
    id: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    name: "Qwen2.5 7B",
    vramMB: 5107,
    aliases: ["7b", "qwen7b", "qwen257b"],
    note: "needs a large GPU to itself",
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    name: "Llama 3.1 8B",
    vramMB: 5001,
    aliases: ["8b", "llama8b", "llama318b"],
    note: "the default - best at chaining several steps",
    default: true,
  },
  {
    id: "Qwen3-8B-q4f16_1-MLC",
    name: "Qwen3 8B",
    vramMB: 5696,
    aliases: ["qwen3", "qwen38b"],
    note: "newer than the Llama of the same size",
  },
  {
    // Ran a four-step instruction end to end on waterdata.usgs.gov that the
    // 1.5B got three quarters of the way through. The largest here that is
    // still a plausible thing to run beside a heavy page.
    id: "Qwen3.5-9B-q4f16_1-MLC",
    name: "Qwen3.5 9B",
    vramMB: 6433,
    aliases: ["9b", "qwen35", "qwen359b"],
    note: "chains several steps where the small ones lose the thread",
  },
];

globalThis.WC_DEFAULT_MODEL =
  (globalThis.WC_MODELS.find((m) => m.default) || globalThis.WC_MODELS[0]).id;

globalThis.WC_MODEL_VRAM = function (id) {
  const hit = globalThis.WC_MODELS.find((m) => m.id === id);
  return hit ? hit.vramMB : 0;
};

globalThis.WC_MODEL_IDS = globalThis.WC_MODELS.map((m) => m.id);

// The name a person reads. An id nobody registered still gets something
// legible rather than the raw string with its quantisation suffix.
globalThis.WC_MODEL_NAME = function (id) {
  const s = String(id || "");
  const hit = globalThis.WC_MODELS.find((m) => m.id === s);
  if (hit) return hit.name;
  return s.replace(/-q4f(16|32)_1.*$/i, "").replace(/-MLC$/i, "").replace(/-/g, " ")
    || "the local model";
};

// "use 8b", "use the 8b model", "use llama 3.1 8b". Matching is on the
// squashed string so spacing and punctuation cannot matter, and the longest
// alias wins so "15b" is not swallowed by "1b" sitting inside it.
globalThis.WC_MODEL_BY_WORDS = function (words) {
  const want = String(words || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!want) return null;
  let best = null;
  for (const m of globalThis.WC_MODELS) {
    for (const a of [...m.aliases, m.id.toLowerCase().replace(/[^a-z0-9]/g, "")]) {
      if (want === a || want.endsWith(a) || want.startsWith(a)) {
        if (!best || a.length > best.alias.length) best = { model: m, alias: a };
      }
    }
  }
  return best ? best.model : null;
};

globalThis.WC_MODEL_SIZE = function (m) {
  return m.vramMB >= 1024 ? `~${(m.vramMB / 1024).toFixed(1)}GB` : `~${m.vramMB}MB`;
};

/* Whether a model can run here, and which one can.
 *
 * "Works on every computer" and "the model you pick is the model you get"
 * pull in opposite directions the moment a five-gigabyte model is chosen on
 * a machine that cannot hold it. Silently loading a smaller one honours the
 * first and breaks the second, and that is what an earlier version of this
 * did - a ladder that demoted the 8B without a word, so a card credited an
 * answer to a model that had never been loaded.
 *
 * The rule here is: never substitute, always say. A choice is carried out
 * whatever the machine looks like, and if it fails, the failure names the
 * largest model that would have fitted. The only time this picks for
 * somebody is the first run, before anybody has chosen.
 *
 * Deliberately conservative about what it claims to know. navigator's memory
 * figure is rounded to a power of two and capped at 8, so it cannot tell a
 * 32GB workstation from an 8GB laptop - it can only tell 4GB from 8GB, and
 * that is the distinction that decides whether five gigabytes of weights
 * will page. Where it says nothing, this says nothing either.
 */
globalThis.WC_MODEL_FITS = function (id, gpu) {
  const need = globalThis.WC_MODEL_VRAM(id);
  if (!need || !gpu || gpu.ok === false) return { fits: true, why: null };
  if (gpu.software) {
    return { fits: false,
      why: "Chrome is drawing on the CPU here, so every model runs about ten times slow" };
  }
  // The weights are one allocation as far as the adapter is concerned, and
  // a binding smaller than the model is a load that fails outright rather
  // than one that runs slowly.
  const binding = Math.min(gpu.maxStorageMB || Infinity, gpu.maxBufferMB || Infinity);
  if (Number.isFinite(binding) && binding > 0 && need > binding) {
    return { fits: false,
      why: `this GPU will not hand out more than ${binding}MB at once and this model needs ${need}MB` };
  }
  // Weights plus the runtime plus the page. Below about 1.6x the weights,
  // loading succeeds and then pages - which is the slowness that gets
  // blamed on the model.
  const ram = (gpu.deviceMemoryGB || 0) * 1024;
  if (ram > 0 && need * 1.6 > ram) {
    return { fits: false,
      why: `this machine reports about ${gpu.deviceMemoryGB}GB and this model needs ${need}MB of it` };
  }
  return { fits: true, why: null };
};

// The largest that fits, for naming a remedy - never for substituting one.
globalThis.WC_BIGGEST_THAT_FITS = function (gpu) {
  const ordered = [...globalThis.WC_MODELS].sort((a, b) => b.vramMB - a.vramMB);
  for (const m of ordered) {
    if (globalThis.WC_MODEL_FITS(m.id, gpu).fits) return m;
  }
  return ordered[ordered.length - 1];
};
