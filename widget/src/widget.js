/* widget.js - WebControls.mount(), and the script tag that calls it.
 *
 * One agent per page. background.js keeps its state in module-level
 * bindings - the history, the doors opened this ask, the model status
 * cache - so a second copy beside the first would be two agents arguing
 * over one page. mount() returns the existing one instead.
 */
const DEFAULTS = {
  title: "Ask this page",
  placeholder: "Ask a question or say what to do…",
  position: "bottom-right",
  theme: "auto",
  accent: null,
  suggestions: [],
  // Off by default: a visitor has not agreed to a download by opening the
  // page, or even by opening the widget. The panel offers a button.
  autoLoad: false,
  // The smallest model that chains steps reliably in the extension's runs.
  // Sites with a technical audience can offer the 8B in `models`.
  model: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  models: [
    "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    "Llama-3.1-8B-Instruct-q4f16_1-MLC",
  ],
  // false = never load a model; only the page's own controls and the
  // shortcuts that need no model are used.
  useModel: true,
  meaning: false,
  worker: true,
  webllmUrl: null,
  hotkey: true,
  storageKey: "web-controls",
  // The agent logs every ask and its result. Useful while wiring the widget
  // in; noise in somebody's production console, so off unless asked for.
  debug: false,
};

let mounted = null;

function mount(userOptions = {}) {
  if (mounted) return mounted;
  const options = { ...DEFAULTS, ...userOptions };
  if (!options.models || !options.models.length) options.models = null;
  else if (!options.models.includes(options.model)) options.models = [options.model, ...options.models];
  // A URL the site gave wins. Otherwise the module build's own loaders,
  // which a bundler can follow, or the file beside the script tag's src.
  const loaders = options.webllmUrl ? urlLoaders(options.webllmUrl)
    : (WC_LOADERS || urlLoaders(new URL("web-llm.js", WC_SCRIPT_URL).href));

  let ui = null;
  let agent = null;
  // The site's own manifest, where background.js has one for this URL and
  // it is not loaded yet. Checked on every call rather than once, because
  // an app that routes client-side can move between them.
  const ensureNamed = () => {
    const route = agent && agent.routeFor(location.href);
    if (route && route.global !== "GENERIC" && !window[route.global] && WC_NAMED_BUNDLES[route.global]) {
      WC_NAMED_BUNDLES[route.global]();
    }
  };
  // `_modelHost` is for tests: the same interface, decisions scripted.
  const modelHost = options._modelHost || createModelHost({
    ...loaders,
    useWorker: options.worker !== false,
    allowEmbed: !!options.meaning,
  });
  const shim = createChromeShim({
    modelHost,
    storageKey: options.storageKey,
    onBroadcast: (m) => { if (ui) ui.progress(m); },
    beforeCall: ensureNamed,
  });

  // The model the site chose, unless the visitor has since picked another
  // from the panel.
  shim.storage.get("llmModelId").then(({ llmModelId }) => {
    const allowed = !options.models || options.models.includes(llmModelId);
    if (!llmModelId || !allowed) shim.storage.set({ llmModelId: options.model });
  });
  shim.storage.set({ localModelEnabled: options.useModel !== false });

  globalThis.__wcQuiet = !options.debug;
  agent = bootAgent(shim.chrome);

  ui = createWidgetUI({ send: shim.send, modelHost, storage: shim.storage, options });

  mounted = {
    version: globalThis.WC_WIDGET_VERSION,
    open: ui.open,
    close: ui.close,
    toggle: ui.toggle,
    // Programmatic asks, for a site that wants its own buttons to drive the
    // same agent: resolves with the card the panel shows.
    ask: async (instruction) => {
      ui.open();
      return ui.ask(instruction);
    },
    loadModel: ui.loadModel,
    // The same as choosing it in the panel: remembered for this site, and
    // swapped in now if a model is already loaded or loading.
    setModel: async (id) => {
      if (options.models && !options.models.includes(id)) {
        throw new Error(`${id} is not one of this widget's models: ${options.models.join(", ")}`);
      }
      await shim.storage.set({ llmModelId: id });
      const s = modelHost.status();
      if (s.ready || s.loading) await ui.loadModel();
    },
    modelStatus: () => modelHost.status(),
    // The page as the agent sees it, for a developer checking what their
    // markup exposes.
    inventory: () => (window.GENERIC ? window.GENERIC.inventory() : null),
    // Gone, and mountable again. Leaving `mounted` set meant the next mount()
    // handed back this one, with its panel already removed from the page.
    unmount: () => {
      ui.destroy();
      modelHost.release();
      if (mounted === api) mounted = null;
    },
  };
  const api = mounted;
  return mounted;
}

// From a script tag's data attributes. data-suggestions is "|"-separated,
// since a sentence is likely to hold a comma.
function optionsFromScript(script) {
  if (!script || !script.dataset) return {};
  const d = script.dataset;
  const out = {};
  if (d.title) out.title = d.title;
  if (d.placeholder) out.placeholder = d.placeholder;
  if (d.position) out.position = d.position;
  if (d.theme) out.theme = d.theme;
  if (d.accent) out.accent = d.accent;
  if (d.model) out.model = d.model;
  if (d.models) out.models = d.models.split(",").map((s) => s.trim()).filter(Boolean);
  if (d.suggestions) out.suggestions = d.suggestions.split("|").map((s) => s.trim()).filter(Boolean);
  if (d.autoLoad != null) out.autoLoad = d.autoLoad !== "false";
  if (d.useModel === "false") out.useModel = false;
  if (d.meaning != null) out.meaning = d.meaning !== "false";
  if (d.worker === "false") out.worker = false;
  if (d.webllm) out.webllmUrl = d.webllm;
  if (d.hotkey === "false") out.hotkey = false;
  if (d.debug != null) out.debug = d.debug !== "false";
  return out;
}
