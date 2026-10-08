/* widget-test.js - the built widget, in a page, the way a site would load it.
 *
 *   node widget/test/widget-test.js      (after node widget/scripts/build.js)
 *
 * What is new here is the plumbing, not the agent: the agent is
 * background.js unchanged and has its own suite. So these check the joins -
 * that it mounts from a script tag, that the page the agent sees does not
 * include the widget, that an ask reaches the page and comes back as a
 * card, that the model is asked through the in-page host, that history
 * survives a reload.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require(path.join(__dirname, "..", "..", "extension", "test", "node_modules", "jsdom"));

const DIST = path.join(__dirname, "..", "dist", "web-controls-widget.js");
const built = fs.readFileSync(DIST, "utf8");

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
};

const APP = `<!doctype html><html><head><title>Reservoir app</title></head><body>
  <nav><a href="/about">About</a></nav>
  <main>
    <h1>Lake Mead storage</h1>
    <div role="tablist">
      <button role="tab" aria-selected="true" id="t-sum">Summary</button>
      <button role="tab" aria-selected="false" id="t-rep">Monthly reports</button>
    </div>
    <label for="units">Units</label>
    <select id="units"><option>Acre-feet</option><option>Cubic meters</option></select>
    <label><input type="checkbox" id="avg"> Show 30-year average</label>
    <p>Storage is 9.1 million acre-feet, 35% of capacity, as of October 1.</p>
  </main>
</body></html>`;

function page({ storage } = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => { if (process.env.WC_DEBUG) console.error("jsdom:", e.message, e.detail && e.detail.stack ? e.detail.stack.split("\n").slice(0, 4).join("\n") : ""); });
  const dom = new JSDOM(APP, { url: "https://reservoirs.example.org/lake-mead", runScripts: "dangerously",
    pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  // jsdom lays nothing out. The same stub the extension's harness uses:
  // everything measures something, unless an ancestor hides it.
  w.Element.prototype.getBoundingClientRect = function () {
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) {
      if ((n.style && n.style.display === "none") || n.hasAttribute("hidden")) {
        return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      }
    }
    return { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 };
  };
  if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  // The root is closed, which is the point - so the test keeps its own
  // handle on it, the one thing a page script could not do.
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, init);
    w.__widgetRoot = root;
    return root;
  };
  return w;
}

// Resolves once the document has finished parsing, which is when a tag
// that mounts itself does so.
async function load(w, data = {}) {
  const s = w.document.createElement("script");
  for (const [k, v] of Object.entries(data)) s.dataset[k] = v;
  s.textContent = built;
  w.document.body.appendChild(s);
  if (w.document.readyState === "loading") {
    await new Promise((r) => w.document.addEventListener("DOMContentLoaded", r, { once: true }));
  }
  await new Promise((r) => setTimeout(r, 0));
}

const flat = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();

(async () => {
  console.log("mounting");
  {
    const w = page();
    await load(w, { title: "Ask the reservoir", suggestions: "show the monthly reports|what is the storage" });
    check("it mounts itself from its script tag", !!(w.WebControls && w.document.querySelector("[data-web-controls-widget]")));
    const host = w.document.querySelector("[data-web-controls-widget]");
    check("and its root is closed to the page", host && host.shadowRoot === null);
    const root = w.__widgetRoot;
    const launcher = root && root.querySelector(".launcher");
    check("a launcher button is drawn", !!launcher && launcher.getAttribute("aria-label") === "Open Ask the reservoir");
    launcher.click();
    await new Promise((r) => setTimeout(r, 50));
    check("clicking it opens the panel", !root.querySelector(".panel").hidden);
    check("and offers the site's suggestions", [...root.querySelectorAll(".ex")].map((b) => b.textContent)
      .join("|") === "show the monthly reports|what is the storage");
    const inv = w.GENERIC.inventory();
    const labels = inv.controls.map((c) => flat(c.label));
    check("the agent sees the page's controls", labels.some((l) => l.includes("monthly reports")), labels.join(" | "));
    check("and none of the widget's", !labels.some((l) => /^(ask|load model|clear|open ask the reservoir)$/.test(l)),
      labels.join(" | "));
    check("a second mount returns the first", w.WebControls.mount() === w.WebControls.mount());
  }

  console.log("asking, with no model");
  {
    const w = page();
    await load(w);
    const wc = w.WebControls.mount();
    const pressed = [];
    w.document.getElementById("t-rep").addEventListener("click", () => pressed.push("reports"));
    const res = await wc.ask("show the monthly reports");
    check("a request the page names is carried out", pressed.includes("reports"), JSON.stringify(res).slice(0, 300));
    check("and comes back as a card", !!(res && (res.display || res.error)));
    const cards = w.__widgetRoot.querySelectorAll(".card");
    check("which the panel draws", cards.length >= 1 && !w.__widgetRoot.querySelector(".card.running"));
    const stored = JSON.parse(w.localStorage.getItem("web-controls") || "{}");
    const hist = Object.values(stored).find((v) => Array.isArray(v) && v.some((e) => e && e.instruction));
    check("the ask is kept in the page's storage", !!hist && hist.some((e) => e.instruction === "show the monthly reports"));

    // Reload: a new page, the same storage.
    const w2 = page({ storage: { "web-controls": w.localStorage.getItem("web-controls") } });
    await load(w2);
    const wc2 = w2.WebControls.mount();
    wc2.open();
    await new Promise((r) => setTimeout(r, 100));
    const echoes = [...w2.__widgetRoot.querySelectorAll(".echo, .past-q")].map((n) => n.textContent);
    check("and is still there after the page reloads", echoes.includes("show the monthly reports"), echoes.join(" | "));
  }

  console.log("asking, with a model");
  {
    const w = page();
    // The same interface as the in-page host, its decisions scripted: the
    // model, asked to choose, picks the checkbox by name.
    const asked = [];
    const fakeHost = {
      ready: true,
      status() { return { ready: true, loading: false, model: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
        progress: null, fraction: 1, hasGpu: true, gpu: null, where: "a test" }; },
      async step(model, prompt) {
        asked.push({ model, prompt });
        return { text: JSON.stringify({ why: "the average line", name: "Show 30-year average", do: "check", on: true }),
          ms: 5, cost: {} };
      },
      async embed() { throw new Error("off"); },
      async release() {},
      load() {},
    };
    const s = w.document.createElement("script");
    s.dataset.manual = "";
    s.textContent = built;
    w.document.body.appendChild(s);
    const wc = w.WebControls.mount({ _modelHost: fakeHost });
    const res = await wc.ask("overlay the long-term normal on the chart");
    const box = w.document.getElementById("avg");
    check("the model is asked through the page's own host", asked.length >= 1, JSON.stringify(res).slice(0, 300));
    check("with the model the site chose", asked.every((a) => a.model === "Llama-3.2-3B-Instruct-q4f16_1-MLC"));
    check("its decision is carried out on the page", box.checked === true, JSON.stringify(res).slice(0, 400));
  }

  console.log("a site the extension has a manifest for");
  {
    // water.noaa.gov, as captured for the extension's benchmarks. The
    // extension routes it to the hand-written NOAA manifest; so must this,
    // or the two are not being compared on the same agent.
    const html = fs.readFileSync(path.join(__dirname, "..", "..", "research", "live-scoring", "pages", "noaa.html"), "utf8");
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", () => {});
    const w = new JSDOM(html, { url: "https://water.noaa.gov/", runScripts: "outside-only",
      pretendToBeVisual: true, virtualConsole }).window;
    w.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    check("nothing is loaded for it before it is needed", !w.NOAA);
    w.eval(built);
    const wc = w.WebControls.mount();
    await wc.ask("open the resources menu");
    check("the NOAA manifest is loaded once the agent reaches into the page",
      !!(w.NOAA && typeof w.NOAA.mapNote === "function"));
  }

  console.log("routing");
  {
    const w = page();
    await load(w);
    w.WebControls.mount();
    w.history.pushState({}, "", "/lake-mead/reports");
    check("a client-side route change does not break the page", w.location.pathname === "/lake-mead/reports");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
