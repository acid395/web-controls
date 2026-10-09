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
  /** The model a first-time visitor gets. Default "Llama-3.2-3B-Instruct-q4f16_1-MLC". */
  model?: string;
  /** What the panel's model picker offers. */
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
  /** Picks a model, remembered for this site; swapped in now if one is loaded. */
  setModel(id: string): Promise<void>;
  modelStatus(): ModelStatus;
  /** The page as the agent sees it. */
  inventory(): unknown;
  unmount(): void;
}

/** Mounts the widget. There is one per page: a second call returns the first. */
export function mount(options?: WidgetOptions): Widget;
export const version: string;
declare const WebControls: { mount: typeof mount; version: string };
export default WebControls;
