/** Options for {@link mount}. Every one is optional. */
export interface WidgetOptions {
  /** Header text, and the launcher button's label. Default "Ask this page". */
  title?: string;
  /** Placeholder for the input box. */
  placeholder?: string;
  /** Example prompts shown before the first ask. */
  suggestions?: string[];
  /** Which corner the launcher sits in. Default "bottom-right". */
  position?: "bottom-right" | "bottom-left";
  /** Follow the OS ("auto"), or force one. Default "auto". */
  theme?: "auto" | "light" | "dark";
  /** Any CSS color, for the launcher and the accents. */
  accent?: string;
  /**
   * The page's real address, when it is served through a proxy (the mini
   * browser): the agent then routes on this host, with the path after it.
   */
  pageUrl?: string;
  /** The model a first-time visitor gets. Default "Qwen3-4B-q4f16_1-MLC". Any WebLLM model id. */
  model?: string;
  /** What the panel's model picker offers. An id the widget's list does not know is shown under its id. */
  models?: string[];
  /** Start the model download when the panel opens, instead of waiting for "Load model". Default false. */
  autoLoad?: boolean;
  /** false: never load a model; only the page's own controls and the no-model shortcuts. Default true. */
  useModel?: boolean;
  /** Also load the 1 GB embedder that narrows large pages by meaning. Default false. */
  meaning?: boolean;
  /** Run the model in a Web Worker so it never blocks the app's UI. Default true. */
  worker?: boolean;
  /** Load WebLLM from this URL instead of the copy that ships with the package. */
  webllmUrl?: string;
  /** Ctrl/Cmd+Shift+Space toggles the panel. Default true. */
  hotkey?: boolean;
  /** localStorage key the history is kept under. Default "web-controls". */
  storageKey?: string;
  /**
   * Work on the page in this frame instead of this page. The agent, the
   * model and the panel stay here, so a press that leaves the framed page
   * does not end the ask. The framed page must carry web-controls-page.js
   * and be same-origin, which the mini browser's proxy arranges.
   */
  frame?: HTMLIFrameElement;
  /** Log every ask and its result to the console. Default false. */
  debug?: boolean;
}

/** A card, as the panel draws it. */
export interface AskResult {
  ok?: boolean;
  error?: string;
  hint?: string;
  display?: {
    title?: string;
    subtitle?: string;
    answer?: string;
    stats?: { label: string; value: string }[];
    rows?: { name: string; value: string; meta?: string }[];
    caveat?: string;
    note?: string;
    source?: string;
  };
  [key: string]: unknown;
}

export interface ModelStatus {
  ready: boolean;
  loading: boolean;
  /** 0 to 1 while downloading. */
  fraction: number | null;
  model: string | null;
  progress: string | null;
  /** "a worker" or "the page". */
  where: string | null;
  error: string | null;
  hasGpu: boolean;
  /** What the browser said about the GPU, when it could be asked. */
  gpu: unknown;
}

export interface Widget {
  version: string;
  open(): void;
  close(): void;
  toggle(): void;
  /** Opens the panel and runs a request; resolves with the card it shows. */
  ask(instruction: string): Promise<AskResult>;
  /** Starts the model download. Progress shows in the panel. */
  loadModel(): Promise<void>;
  /** Stops the request in progress, as the Stop button does. */
  cancel(): Promise<unknown>;
  /** Picks a model, remembered for this site; swapped in now if one is loaded. */
  setModel(id: string): Promise<void>;
  modelStatus(): ModelStatus;
  /** The page as the agent sees it; a promise when the page is in a frame. */
  inventory(): unknown;
  unmount(): void;
}

/** Mounts the widget. There is one per page: a second call returns the first. */
export function mount(options?: WidgetOptions): Widget;

/** The model a first-time visitor gets. */
export const defaultModel: string;
export const version: string;
declare const WebControls: { mount: typeof mount; defaultModel: string; version: string };
export default WebControls;
