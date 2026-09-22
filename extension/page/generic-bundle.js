/* ============================================================================
 * generic-controls.js - paste into the DevTools console on ANY page.
 *
 *   window.WC       generic DOM primitives, identical to the WC block in
 *                    every other file here. Keep them in sync.
 *   window.GENERIC  a manifest that needs no site-specific code at all: it
 *                    reads the live page and acts on it by selector, instead
 *                    of through named per-site functions like USGS.setParameter.
 *
 * This is the "no manifest yet" tier. web-controls.js / site-controls.js /
 * noaa-controls.js / forecastpoints-controls.js are all hand-written for one
 * specific page, which is what makes them reliable, and what makes them not
 * generalize. GENERIC trades some of that reliability for working on a page
 * nobody has looked at yet: instead of GENERIC.setParameter('discharge'), you
 * (or an LLM) call GENERIC.inventory() to see what's on the page, then
 * GENERIC.click(selector) / GENERIC.selectOption(selector, value) / etc.
 * against the exact selectors it just printed.
 *
 * After pasting, try:
 *   GENERIC.inventory()             // every control on the page, deduplicated
 *   GENERIC.mapInfo()               // is there a map, can it be driven
 *   GENERIC.click('#some-button')
 *   GENERIC.selectOption('#basemap-select', 'satellite')
 * ========================================================================== */
(() => {
  /* ---------- Layer 1: generic primitives ---------- */

  // querySelectorAll that also searches inside open shadow roots
  // A same-origin iframe is part of the page in every sense that matters:
  // government dashboards embed their map, their table and their filters
  // that way constantly, and none of it was reachable. Cross-origin frames
  // are a different document the browser will not open, and are skipped.
  const sameOriginDoc = (frame) => {
    try {
      const doc = frame.contentDocument;
      return doc && doc.documentElement ? doc : null;
    } catch (e) { return null; }   // cross-origin: not ours to read
  };

  const deepQueryAll = (sel, root = document) => {
    const out = [];
    const visit = (node) => {
      node.querySelectorAll(sel).forEach((el) => out.push(el));
      node.querySelectorAll("*").forEach((el) => el.shadowRoot && visit(el.shadowRoot));
      node.querySelectorAll("iframe, frame").forEach((f) => {
        const doc = sameOriginDoc(f);
        if (doc) visit(doc);
      });
    };
    visit(root);
    return out;
  };

  // A selector inside a frame cannot be queried from the top document, so it
  // is written as "<frame> >>> <inner>" and resolved by hopping in. The same
  // string therefore identifies a control wherever it lives.
  const FRAME_SEP = " >>> ";
  const deepQuery = (sel, root) => {
    if (typeof sel === "string" && sel.includes(FRAME_SEP)) {
      const [frameSel, ...rest] = sel.split(FRAME_SEP);
      const frame = deepQueryAll(frameSel, root)[0];
      const doc = frame && sameOriginDoc(frame);
      return doc ? deepQuery(rest.join(FRAME_SEP), doc) : null;
    }
    return deepQueryAll(sel, root)[0] || null;
  };

  // Where an element lives, as a selector prefix.
  const framePrefixOf = (el) => {
    const doc = el.ownerDocument;
    if (!doc || doc === document) return "";
    const frame = doc.defaultView && doc.defaultView.frameElement;
    if (!frame) return "";
    return cssPath(frame) + FRAME_SEP;
  };

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  let ariaIndex = null;
  let labelForIndex = null, labelForRoot = null;

  // Reads the text that identifies a control, original case, whitespace
  // collapsed. Same order every file uses, including inventory-controls.js's
  // label() function: aria-label, then aria-labelledby, then a <label>
  // association, then a wrapping <label>, then placeholder/title/name, then
  // plain text content. Keep this order the same everywhere.
  const rawLabelOf = (el) => {
    if (!el) return "";
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const root = el.getRootNode();
      const txt = labelledBy
        .split(/\s+/)
        .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
        .filter(Boolean)
        .map((n) => n.textContent)
        .join(" ");
      if (clean(txt)) return clean(txt);
    }
    if (el.labels && el.labels[0]) return clean(el.labels[0].textContent);
    if (el.id) {
      // Indexed once per pass. This was a document scan for every control
      // carrying an id, which on a page of several hundred is several
      // hundred sweeps of the whole document to find one <label for>.
      const root = el.getRootNode();
      if (!labelForIndex || labelForRoot !== root) {
        labelForIndex = new Map();
        labelForRoot = root;
        const labels = (root.querySelectorAll ? root.querySelectorAll("label[for]") : []);
        for (const l of labels) {
          const target = l.getAttribute("for");
          if (target && !labelForIndex.has(target)) labelForIndex.set(target, l);
        }
      }
      const forLabel = labelForIndex.get(el.id);
      if (forLabel) return clean(forLabel.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) return clean(shortText(wrap));
    // A <select>'s own text is every option run together - "AlabamaAlaska
    // ArizonaArkansasCalifornia..." - which is not a name for anything. It
    // was becoming the label, so the card for "select alaska" read "choose
    // alabamaalaskaarizona", and worse, the model was shown that string in
    // place of a dropdown it could have recognised. Its options are already
    // reported separately, so the name has to come from around it: the row
    // it sits in with its own text taken out, then the author's own
    // shorthand, and only then a generic word, which at least says what
    // kind of thing it is.
    if ((el.tagName || "").toLowerCase() === "select") {
      const own = clean(el.textContent);
      const around = clean(rowText(el));
      const outside = own && around.includes(own) ? clean(around.split(own).join(" ")) : around;
      const shorthand = clean(el.name || el.id || "")
        .replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
      return clean(el.placeholder || el.title || outside || shorthand) || "dropdown";
    }
    return clean(el.placeholder || el.title || rowText(el) || el.name || shortText(el) || "");
  };

  // What the row this control sits in is called. water.noaa.gov puts a bare
  // checkbox beside the button that names the layer, so the checkbox has no
  // label of its own and fell back to its name attribute - "fi". Scored on
  // that, "enable flood inundation" could never reach it, and the only thing
  // left to match was the button, which opens the panel rather than
  // switching the layer on. Author shorthand is shorthand: the row's own
  // words are what a person would call it.
  //
  // Bounded hard. A row is a few words; anything longer is a container, and
  // a container's text is not a label.
  const rowText = (el) => {
    if (!el || !/^(input|select|textarea)$/i.test(el.tagName || "")) return "";
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

    // The thing beside it, before the thing around it. Snow Water Equivalent
    // sits in a row of its own and was named correctly from the row; Flood
    // Inundation sits in a row that also holds the panel's prose, so the
    // row's text ran past any sane limit and the checkbox fell back to its
    // name attribute - "fi" - and stayed unreachable while its neighbours
    // worked. The label is right next to it either way.
    for (const dir of ["previousElementSibling", "nextElementSibling"]) {
      let sib = el[dir];
      for (let seen = 0; sib && seen < 3; seen++, sib = sib[dir]) {
        if (/^(input|select|textarea)$/i.test(sib.tagName || "")) break;  // the next control along
        const t = clean(shortText(sib));
        if (t && t.length <= 60) return t;
      }
    }
    for (let n = el.parentElement, up = 0; n && up < 3; n = n.parentElement, up++) {
      const t = clean(shortText(n));
      if (t && t.length <= 60) return t;
    }
    return "";
  };

  // A label is a few words. textContent on a container builds the whole
  // subtree's text - on a page like cdec.water.ca.gov that is most of the
  // document, rebuilt and whitespace-collapsed once per candidate control,
  // which is what turned reading that page into a hang rather than a pause.
  // Nothing downstream keeps more than 80 characters of it anyway.
  const shortText = (el) => {
    if (!el) return "";
    let out = "";
    for (const node of el.childNodes) {
      out += node.nodeType === 3 ? (node.nodeValue || "") : (node.textContent || "");
      if (out.length > 200) break;
    }
    return out.slice(0, 200);
  };
  // Matching form: lowercased and collapsed. Everything in this file that
  // compares labels (pickRadio, clickByText, ...) uses this, not rawLabelOf.
  const labelOf = (el) => norm(rawLabelOf(el));

  // React-safe value setter. Bypasses React's own tracking of the value.
  const setNativeValue = (el, value) => {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
      el instanceof HTMLSelectElement ? HTMLSelectElement.prototype :
      HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  };

  // Full pointer and mouse sequence, then a real click. React fires its own
  // onChange from that click's default action.
  const realClick = (elOrSel) => {
    pageTouched();
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`realClick: not found: ${elOrSel}`);
    // Guarded so a click is testable outside a real browser: jsdom has no
    // scrollIntoView, and without this every click threw there rather than
    // being exercised.
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "center" });
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
    return el;
  };

  const fill = (elOrSel, text) => {
    pageTouched();
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`fill: not found: ${elOrSel}`);
    el.focus();
    setNativeValue(el, text);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: text.slice(-1) || "a" }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: text.slice(-1) || "a" }));
    return el;
  };

  const setSelect = (elOrSel, valueOrText) => {
    pageTouched();
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el || el.tagName !== "SELECT") throw new Error(`setSelect: not a <select>: ${elOrSel}`);
    const opt = [...el.options].find(
      (o) => o.value === valueOrText || norm(o.text) === norm(valueOrText)
    );
    if (!opt) throw new Error(`setSelect: no option "${valueOrText}" in [${[...el.options].map((o) => o.value)}]`);
    setNativeValue(el, opt.value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return opt.value;
  };

  const setChecked = (elOrSel, on = true) => {
    pageTouched();
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`setChecked: not found: ${elOrSel}`);
    if (!!el.checked !== !!on) realClick(el);
    return el.checked;
  };

  // Picks a radio inside a name-group by value, then exact label, then
  // partial label. Falls back to checking every radio with no name
  // attribute at all if the named group is empty. Some frameworks (seen on
  // water.noaa.gov) render an exclusive set of radios without a shared
  // name, and handle the exclusivity themselves in JS instead of relying on
  // the browser's native grouping. In that fallback groupName is unused,
  // since there's no real group to search within, so pass anything.
  const pickRadio = (groupName, valueOrLabel) => {
    let radios = deepQueryAll(`input[type=radio][name="${CSS.escape(groupName)}"]`);
    if (!radios.length) radios = deepQueryAll("input[type=radio]:not([name])");
    if (!radios.length) throw new Error(`pickRadio: no radio group "${groupName}"`);
    const want = norm(valueOrLabel);
    const hit =
      radios.find((r) => r.value === valueOrLabel) ||
      radios.find((r) => labelOf(r) === want) ||
      radios.find((r) => labelOf(r).includes(want));
    if (!hit) throw new Error(`pickRadio: "${valueOrLabel}" not in [${radios.map((r) => r.value)}]`);
    // Its own before and after, not a bare value. Without them a caller
    // cannot tell "this was already the selected one" from "the click never
    // landed", and it has to guess - which is how "select huc-8 subbasin"
    // ended up selecting HUC-06: HUC-08 was already on, the pick reported
    // nothing, that read as a dead end, and the loop moved to the next
    // radio in the group and reported the wrong basin as the answer.
    const was = !!hit.checked;
    if (!was) realClick(hit);
    const now = !!hit.checked;
    // Reported as the page writes it. labelOf is the normalised form used
    // for comparing, and a card headed "huc-08 subbasin" is the page's own
    // control in somebody else's spelling.
    return { control: rawLabelOf(hit) || hit.value, value: hit.value, was, now, itChanged: was !== now };
  };

  // Clicks the first button, link, or role=button whose text or aria-label
  // matches. Strips all whitespace from both sides first, because some
  // sites split a label across several <span> tags with no space between
  // them, so it renders as e.g. "Customizefilters".
  const clickByText = (text, { tags = ["button", "a", "[role=button]", "summary"] } = {}) => {
    const squash = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
    const t = squash(text);
    const el = deepQueryAll(tags.join(",")).find((e) => {
      const l = squash(e.getAttribute("aria-label") || e.textContent);
      return l === t || l.includes(t);
    });
    if (!el) throw new Error(`clickByText: "${text}" not found`);
    return realClick(el);
  };

  // Exact match, whitespace collapsed to single spaces. Use this when two
  // controls differ only by a space that clickByText's whitespace-stripping
  // would erase, for example "changetime span" (a panel toggle) versus
  // "change time span" (the apply button inside that panel).
  const clickExact = (text, { tags = ["button", "a", "[role=button]", "summary"] } = {}) => {
    const t = norm(text);
    const el = deepQueryAll(tags.join(",")).find(
      (e) => norm(e.textContent) === t || norm(e.getAttribute("aria-label")) === t
    );
    if (!el) throw new Error(`clickExact: "${text}" not found`);
    return realClick(el);
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fnOrSel, { timeout = 8000, interval = 150 } = {}) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = typeof fnOrSel === "string" ? deepQuery(fnOrSel) : fnOrSel();
      if (v) return v;
      await wait(interval);
    }
    throw new Error(`waitFor: timed out after ${timeout}ms`);
  };

  const WC = {
    deepQuery, deepQueryAll, rawLabelOf, labelOf, norm,
    setNativeValue, realClick, fill, setSelect, setChecked, pickRadio, clickByText, clickExact,
    wait, waitFor,
  };

  /* ============================================================================
   * Layer 2: GENERIC - a manifest for a page nobody has mapped yet.
   *
   * inventory() is the same walk-and-dedupe logic as inventory-controls.js,
   * kept in sync with it, but returned as data instead of printed as a
   * table, and every row carries a selector so a caller (human or LLM) can
   * act on it immediately with the functions below.
   * ========================================================================== */

  // SHOW_ELEMENT filters what nextNode() returns, but not currentNode, which
  // starts as the root - and for a shadow tree that root is a ShadowRoot, not
  // an Element. Yielding it handed callers a node with no getAttribute and no
  // tagName, so inventory() threw on the first page with a shadow DOM it met:
  // "Cannot read properties of undefined (reading 'toLowerCase')", then
  // "el.getAttribute is not a function". The page was full of controls and
  // reported itself unreadable.
  //
  // USGS state pages are built this way, so this was every one of them.
  function* walk(root) {
    // The root's own document, not the top one: walking into a frame hands
    // this a node from another document, and a cross-document TreeWalker
    // yields nothing at all.
    const doc = root.ownerDocument || document;
    const tw = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n = tw.currentNode;
    while (n) {
      if (n.nodeType === 1) yield n;
      if (n.shadowRoot) yield* walk(n.shadowRoot);
      if (n.tagName === "IFRAME" || n.tagName === "FRAME") {
        const doc = sameOriginDoc(n);
        if (doc) yield* walk(doc.documentElement);
      }
      n = tw.nextNode();
    }
  }

  // getComputedStyle is the most expensive thing this file does, and the
  // ancestor and sibling walks below ask for the same elements over and over.
  // Reset at the start of each pass, because opening a panel is precisely the
  // thing that changes the answers - a cache that outlived a pass would keep
  // reporting a revealed control as hidden.
  let visCache = null;
  const freshPass = () => { visCache = new WeakMap(); };
  // Anything that touches the page throws the cache away. Opening a panel is
  // the whole reason to ask again, and a cache that survived a click reported
  // every revealed control as still hidden - which is the opposite of what
  // the disclosure work is for. Speed inside a pass, never across an action.
  const pageTouched = () => { visCache = null; ariaIndex = null; labelForIndex = null; };
  const isVisible = (el) => {
    if (!el) return false;
    if (visCache && visCache.has(el)) return visCache.get(el);
    const r = el.getBoundingClientRect();
    let out;
    if (!r.width && !r.height) out = false;
    else {
      const s = getComputedStyle(el);
      out = s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
    }
    if (visCache) visCache.set(el, out);
    return out;
  };

  const reactProps = (el) => {
    const k = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    return k ? el[k] : null;
  };
  // Misses Svelte (and some other frameworks): they compile a bound click
  // handler into a plain addEventListener call, which leaves neither an
  // onclick attribute nor a React-style prop marker on the element. Found
  // live on water.noaa.gov: a set of search-result rows were invisible to
  // both checks below. getEventListeners is a real fix for that specific
  // case, but it only exists in the DevTools console's own command-line API,
  // not in a page's own JS or a real extension's injected code, so it's used
  // when available and skipped otherwise rather than relied on.
  const hasJsHandler = (el) => {
    if (el.hasAttribute("onclick")) return true;
    const p = reactProps(el);
    if (p && (p.onClick || p.onChange || p.onInput)) return true;
    try {
      if (typeof getEventListeners === "function") {
        const ev = getEventListeners(el);
        if (ev && (ev.click || ev.pointerdown || ev.mousedown)) return true;
      }
    } catch (e) { /* not running in a console that provides it */ }
    return false;
  };
  // Weaker, framework-agnostic fallback that works everywhere, including a
  // real extension where getEventListeners isn't available at all: anything
  // styled to look clickable probably is, even if nothing above caught its
  // handler. Trades some false positives (decorative hover styles) for
  // catching handlers no attribute or prop inspection can see. Excludes SVG
  // graphics primitives: found live on water.noaa.gov that an icon's <svg>/
  // <path>/<line> inherit "pointer" from their already-captured clickable
  // parent button, so counting them too just duplicates that one real
  // control under three more entries instead of finding anything new.
  // tagName exists on Elements and on nothing else. Walking shadow roots and
  // parent chains turns up ShadowRoot and Document nodes, which have none, so
  // an unguarded tagOf(el) threw "Cannot read properties of
  // undefined (reading 'toLowerCase')" out of inventory() - and the whole
  // page then read as unreadable, on a page full of controls.
  const tagOf = (el) => String((el && el.tagName) || "").toLowerCase();

  const GRAPHIC_TAGS = new Set(["svg", "path", "line", "circle", "rect", "polygon", "polyline", "g", "ellipse", "use"]);
  const looksClickable = (el) => {
    if (GRAPHIC_TAGS.has(tagOf(el))) return false;
    try { return getComputedStyle(el).cursor === "pointer"; } catch (e) { return false; }
  };

  const cssPath = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let s = tagOf(cur);
      if (cur.classList.length) s += "." + [...cur.classList].map((c) => CSS.escape(c)).join(".");
      const p = cur.parentNode;
      if (p && p.firstElementChild) {
        // Walked, not materialised. Spreading an HTMLCollection copies it and
        // touches every member, and a page with a few thousand siblings then
        // pays that once per element per ancestor - which is what made
        // cdec.water.ca.gov, whose markup puts 3,508 children under one
        // parent, impossible to read at all rather than merely slow.
        //
        // Capped as well: past a few hundred siblings the index is no longer
        // a useful identifier anyway. That is the same list whose reflow made
        // positional selectors go stale, and labels re-resolve at click time
        // now, so a selector that stops short is the cheaper mistake.
        let index = 0, same = 0, capped = false;
        for (let sib = p.firstElementChild; sib; sib = sib.nextElementSibling) {
          if (sib.tagName === cur.tagName) {
            same++;
            if (sib === cur) index = same;
          }
          if (same > 300) { capped = true; break; }
        }
        if (same > 1 && index && !capped) s += `:nth-of-type(${index})`;
      }
      parts.unshift(s);
      cur = p instanceof ShadowRoot ? p.host : p;
    }
    return parts.join(" > ");
  };

  // normalize dynamic bits so repeated rows share a signature, the same
  // dedup trick as inventory-controls.js: without it, a page with 40
  // repeated site-list rows produces 40 near-identical entries instead of
  // one pattern with a count, which wastes an LLM's context just as badly
  // as it wastes a human's screen. The final catch-all only strips runs of
  // 3+ digits (site ids, most numeric codes), not shorter ones: found live
  // on drought.gov that stripping every digit collapsed a 1-10 rating-scale
  // survey's radio buttons ("2".."9") into one signature, since they all
  // normalized to the same bare "#" with nothing else to tell them apart,
  // silently hiding 7 real, distinct options behind a single entry.
  const sigNorm = (s) => (s || "")
    .replace(/USGS-?\d+/g, "#ID")
    .replace(/\d{4}-\d{2}-\d{2}/g, "#DATE")
    .replace(/\d{3,}/g, "#")
    .trim();

  const TAGS = ["select", "input", "textarea", "button", "a", "summary", "details"];
  const ROLES = ["button", "link", "combobox", "listbox", "option", "tab", "checkbox",
    "radio", "switch", "menuitem", "menuitemcheckbox", "slider", "searchbox", "spinbutton"];

  // What has to be opened before a control can be used.
  //
  // inventory() skips anything invisible, so the checkboxes inside a closed
  // Layers panel do not exist as far as this extension is concerned. "Enable
  // the flood layer" then fails while a hand-written noaaToggleFloodCategory
  // succeeds - not because the manifest knows the site better, but because
  // it opens the panel first. That is the only difference, and it is worth
  // generalising rather than writing per site.
  //
  // Returns the element that reveals a hidden control, found the ways pages
  // actually express it: aria-controls pointing at the hidden container, a
  // <summary> owning a closed <details>, or the nearest preceding control
  // marked aria-expanded="false".
  function disclosureFor(el) {
    let hiddenAncestor = null;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (!isVisible(n)) hiddenAncestor = n;
    }
    if (!hiddenAncestor) return null;

    const id = hiddenAncestor.id;
    if (id) {
      // Indexed once per pass. This was a full-document scan for every
      // hidden control, so a page of hidden menu items cost one sweep each.
      if (!ariaIndex) {
        ariaIndex = new Map();
        for (const opener of deepQueryAll("[aria-controls]")) {
          for (const target of String(opener.getAttribute("aria-controls") || "").split(/\s+/)) {
            if (target && !ariaIndex.has(target)) ariaIndex.set(target, opener);
          }
        }
      }
      const byAria = ariaIndex.get(id);
      if (byAria && isVisible(byAria)) return byAria;
    }
    if (hiddenAncestor.tagName === "DETAILS" || hiddenAncestor.closest) {
      const details = hiddenAncestor.tagName === "DETAILS" ? hiddenAncestor : hiddenAncestor.closest("details");
      if (details && !details.open) {
        const summary = details.querySelector("summary");
        if (summary) return summary;
      }
    }
    // The nearest thing above it that says it opens something.
    // Bounded. cdec.water.ca.gov has a div with 3,508 children, and walking
    // every one of them for every hidden control - asking the browser for a
    // computed style each time - is what turned reading that page into a
    // hang. A control's opener sits beside it, not three thousand elements
    // away.
    let prev = hiddenAncestor.previousElementSibling;
    for (let seen = 0; prev && seen < 40; seen++) {
      if (prev.getAttribute && prev.getAttribute("aria-expanded") === "false" && isVisible(prev)) return prev;
      prev = prev.previousElementSibling;
    }
    const parent = hiddenAncestor.parentElement;
    if (parent) {
      const toggler = [...parent.querySelectorAll('[aria-expanded="false"], button, summary')]
        .slice(0, 40)
        .find((t) => isVisible(t) && !t.contains(el));
      if (toggler) return toggler;
    }
    return null;
  }

  function inventory({ includeHidden = false } = {}) {
    freshPass();
    ariaIndex = null; labelForIndex = null;
    const seen = new Set();
    const all = [];
    for (const el of walk(document.documentElement)) {
      const tag = tagOf(el);
      const role = el.getAttribute("role");
      const tabbable = el.getAttribute("tabindex") !== null && el.tabIndex >= 0;
      // Real signals (a native interactive tag, an ARIA role, a tab stop, or
      // an actual handler) vs. cursor:pointer alone. Found live on
      // water.noaa.gov: clicking a cursor:pointer-only <ul> did nothing,
      // because the real handler was on a child button inside it, not the
      // <ul> itself, so that fallback's catches get marked low confidence
      // rather than presented the same as a real button or role=button.
      const strong = TAGS.includes(tag) || (role && ROLES.includes(role)) || tabbable || hasJsHandler(el);
      const weak = !strong && looksClickable(el);
      if (!(strong || weak)) continue;
      if (seen.has(el)) continue;
      // A link wrapping an icon and a caption is one control, not three.
      // <a><i class="fa-facebook"></i><span>Facebook</span></a> was recorded
      // as an anchor, a span and an italic, all labelled Facebook, all
      // offered as separate tools - so the list was padded with duplicates
      // of whatever a site wraps its links in, and the same click was on
      // offer three times over. Walk order is outside-in, so the element
      // that owns the label has already been taken by the time its
      // decoration is reached.
      // Never a real control. A <select> reads as all of its option texts run
      // together, which is exactly what the div wrapping it reads as - so
      // water.noaa.gov's basemap select was dropped into its own wrapper and
      // "set the basemap to satellite" had nothing to set. Decoration can be
      // folded into the thing it decorates; a control cannot.
      const isRealControl = TAGS.includes(tag) || (role && ROLES.includes(role));
      let nestedDuplicate = false;
      if (!isRealControl) {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (seen.has(a) && norm(rawLabelOf(a)) === norm(rawLabelOf(el))) { nestedDuplicate = true; break; }
        }
      }
      if (nestedDuplicate) continue;
      // A control behind a closed panel is still a control. Recorded with
      // what would have to be opened first, so using it can open it.
      const shown = isVisible(el);
      if (!shown && !includeHidden) continue;
      const opener = shown ? null : disclosureFor(el);
      if (!shown && !opener) continue;   // hidden with no way in is not usable
      seen.add(el);

      // And the other way round: a container whose whole text is one control
      // inside it is that control's wrapper, not a second control.
      if (!TAGS.includes(tag) && !(role && ROLES.includes(role))) {
        let wrapsOne = false;
        try {
          const inner = el.querySelectorAll(TAGS.join(","));
          if (inner.length === 1 && norm(rawLabelOf(inner[0])) === norm(rawLabelOf(el))) wrapsOne = true;
        } catch (e) { /* exotic markup; keep the container */ }
        if (wrapsOne) continue;
      }

      const lab = rawLabelOf(el);
      // Does this thing open a panel, and is that panel already open? An
      // accordion titled "Flood Inundation" matches the words better than the
      // checkbox inside it ever will - it carries both of them, where the
      // checkbox is labelled only "INUNDATION" - so it won every time and all
      // it does is open and shut the panel. Once the panel is open, pressing
      // the title again is the one thing certain not to help.
      const expandedAttr = el.getAttribute && el.getAttribute("aria-expanded");
      const looksLikeTitle = tag === "summary"
        || /accordion-title/i.test(String(el.className || ""))
        || /^uk-accordion-\d+$/.test(String(el.id || ""));
      let expanded;
      if (expandedAttr === "true") expanded = true;
      else if (expandedAttr === "false") expanded = false;
      else if (looksLikeTitle && el.closest) {
        const holder = el.closest("li, details, .uk-accordion > *");
        if (holder) {
          expanded = !!(holder.open
            || (holder.classList && holder.classList.contains("uk-open")));
        }
      }
      const rec = {
        kind: role || tag, tag, type: el.type || "", label: lab.slice(0, 80),
        name: el.name || "", id: el.id || "", value: (el.value ?? "").toString().slice(0, 60),
        checked: (el.type === "checkbox" || el.type === "radio") ? !!el.checked : undefined,
        selector: framePrefixOf(el) + cssPath(el),
        confidence: weak ? "low" : "high",
        // Offered as usable, a disabled control is a lie: acting on it does
        // nothing and the card reports success. Recorded, not offered.
        disabled: el.disabled ? true : undefined,
        // Hidden behind something that can be opened. Carried through so a
        // caller can open it rather than report the control missing.
        hidden: shown ? undefined : true,
        // Where pressing this would take you. The same headline appears six
        // times on nasa.gov - a carousel, a latest-news list, a featured
        // block - none nested inside another, all leading to one article. As
        // separate candidates they tie forever and the page looks ambiguous
        // when there is no choice to make. Taken from the nearest enclosing
        // link, so the paragraph inside a card carries the card's target.
        goesTo: (() => {
          try {
            const a = el.matches("a[href]") ? el : (el.closest && el.closest("a[href]"));
            const href = a && a.getAttribute("href");
            return href && !/^#$|^javascript:/i.test(href) ? href : undefined;
          } catch (e) { return undefined; }
        })(),
        opensPanel: (looksLikeTitle || expandedAttr !== null) ? true : undefined,
        expanded,
        revealedBy: opener ? cssPath(opener) : undefined,
        revealedByLabel: opener ? rawLabelOf(opener).slice(0, 40) : undefined,
      };
      if (tag === "select") rec.options = [...el.options].map((o) => ({ value: o.value, text: o.text.trim() }));

      // A custom segmented control. water.noaa.gov offers its basemaps as a
      // div whose four children read Topographic, Satellite, Dark and Light,
      // with the handler compiled onto them by Svelte where nothing here can
      // see it - so the children were never controls and the container was
      // one control labelled "Topographic Satellite Dark Light". Asking for
      // the satellite basemap matched that label and had nowhere to go.
      //
      // Children that are short, distinct and childless are the options of
      // the thing that holds them, whatever the markup calls it.
      if (!rec.options && !TAGS.includes(tag) && el.children && el.children.length >= 2
          && el.children.length <= 12) {
        const kids = [...el.children].map((k) => ({
          text: rawLabelOf(k).replace(/\s+/g, " ").trim(), el: k,
        })).filter((k) => k.text && k.text.length <= 24 && k.el.children.length <= 1);
        const distinct = new Set(kids.map((k) => k.text.toLowerCase()));
        if (kids.length >= 2 && distinct.size === kids.length
            && kids.map((k) => k.text).join(" ") === lab.replace(/\s+/g, " ").trim()) {
          rec.childOptions = kids.map((k) => ({ text: k.text, selector: framePrefixOf(k.el) + cssPath(k.el) }));
        }
      }
      rec._sig = [rec.kind, rec.type, sigNorm(lab), rec.name].join("|");
      all.push(rec);
    }

    const bySig = new Map();
    for (const r of all) {
      if (!bySig.has(r._sig)) bySig.set(r._sig, []);
      bySig.get(r._sig).push(r);
    }
    const groups = [...bySig.values()].map((rows) => {
      const r = rows[0];
      const { _sig, ...rest } = r;
      return { ...rest, count: rows.length };
    });

    return { url: location.href, controlCount: all.length, patternCount: groups.length, controls: groups };
  }

  // duck-typed map-instance hunt, same signatures as map-probe.js
  function mapInfo() {
    const domHints = {
      "Leaflet": ".leaflet-container",
      "Mapbox GL": ".mapboxgl-canvas",
      "MapLibre GL": ".maplibregl-canvas",
      "OpenLayers": ".ol-viewport",
      "Esri ArcGIS": "[class*='esri-']",
      "Google Maps": ".gm-style",
    };
    const libraries = Object.keys(domHints).filter((name) => deepQueryAll(domHints[name]).length > 0);
    const domMarkers = deepQueryAll(".leaflet-marker-icon, .leaflet-interactive").length;

    const instanceSigns = [
      { lib: "Leaflet", keys: ["getCenter", "getZoom", "eachLayer", "setView"] },
      { lib: "Mapbox/MapLibre GL", keys: ["getCenter", "getZoom", "queryRenderedFeatures", "getStyle"] },
      { lib: "OpenLayers", keys: ["getView", "getLayers", "forEachFeatureAtPixel", "renderSync"] },
      { lib: "Esri MapView/SceneView", keys: ["hitTest", "goTo", "toScreen", "toMap"] },
      { lib: "Google Maps", keys: ["getBounds", "panTo", "setZoom", "getDiv"] },
    ];
    const looksLike = (obj, keys) => {
      try { return obj && typeof obj === "object" && keys.every((k) => typeof obj[k] === "function"); }
      catch (e) { return false; }
    };
    let instanceFoundFor = null;
    let scanned = 0;
    const seen = new Set();
    const scan = (obj, depth) => {
      if (instanceFoundFor || scanned++ > 80000 || depth > 6 || obj == null) return;
      if (typeof obj !== "object" && typeof obj !== "function") return;
      if (seen.has(obj)) return;
      seen.add(obj);
      for (const sig of instanceSigns) {
        if (looksLike(obj, sig.keys)) { instanceFoundFor = sig.lib; return; }
      }
      if (obj instanceof Node || obj instanceof Window) return;
      let keys = [];
      try { keys = Object.getOwnPropertyNames(obj); } catch (e) { return; }
      for (const k of keys) {
        if (["self", "window", "top", "parent", "frames", "globalThis"].includes(k)) continue;
        let v;
        try { v = obj[k]; } catch (e) { continue; }
        scan(v, depth + 1);
      }
    };
    scan(window, 0);

    return { libraries, domMarkerCount: domMarkers, jsInstanceReachable: instanceFoundFor,
      driveable: domMarkers > 0 ? "dom" : instanceFoundFor ? "js-api" : libraries.length ? "no" : "no-map-found" };
  }

  /* ============================================================================
   * Feed capture - the data behind a chart that cannot be read.
   *
   * readPage() can read an SVG chart's labels, but a canvas chart is painted
   * pixels with nothing to extract, and the same is true of every canvas map
   * (see mapInfo). The data is not absent though - the page fetched it, drew
   * it, and threw the elements away. Intercepting fetch and XMLHttpRequest
   * catches it on the way in.
   *
   * The interceptor itself lives in page/feed-capture.js and runs at
   * document_start, because a chart requests its series during page load: an
   * interceptor installed when someone asks a question arrives too late to
   * see it. These two functions only read what it collected.
   *
   * Responses are cloned, capped, and only kept for data-looking URLs -
   * recording every image and analytics beacon would be noise, and holding
   * whole response bodies for a long-lived page would be a memory leak.
   * ========================================================================== */
  const FEED_URL_RE = /(\/api\/|\/rest\/|\/ogcapi\/|nwis|nwps|waterservices|waterdata|gridpoints|geoserver|\bwfs\b|\bwms\b|query\?|\.json(\?|$)|\.geojson(\?|$)|\.csv(\?|$)|observations|forecast|gauges?\/)/i;
  const FEED_LIMIT = 40;          // most recent N requests
  const FEED_BODY_CAP = 200000;   // characters kept per response

  // Everything captured so far. `parsed` is the decoded JSON where the body
  // was JSON, since that is the part worth reading.
  function capturedFeeds({ includeBodies = false } = {}) {
    const store = window.__wcFeedCapture;
    if (!store) {
      return { installed: false, count: 0, feeds: [],
        note: "feed capture is not installed on this page - enable the site and reload it" };
    }
    const feeds = store.feeds.map((f) => {
      let parsed = null;
      if (f.body && !f.truncated && /json/i.test(f.contentType || "")) {
        try { parsed = JSON.parse(f.body); } catch (e) { parsed = null; }
      }
      const out = { url: f.url, method: f.method, status: f.status, at: f.at, bytes: f.bytes, truncated: f.truncated };
      if (includeBodies) out.body = f.body;
      if (parsed) out.keys = Array.isArray(parsed) ? [`array[${parsed.length}]`] : Object.keys(parsed).slice(0, 12);
      return out;
    });
    return {
      installed: true, installedAt: store.installedAt, count: feeds.length, feeds,
      note: feeds.length ? undefined
        : "capture is installed but this page has requested nothing since - reload the page to catch the data it loads at startup",
    };
  }

  /* ==========================================================================
   * capturedSeries() - the numbers behind a chart, from the page's own data.
   *
   * A chart is a picture of a series the page already downloaded. Reading
   * the picture is guesswork; reading the request behind it is not. Asked
   * for the humidity on a page plotting humidity, this extension answered
   * from a weather station eleven miles away, because readPage() sees
   * tables and labelled text and a canvas is neither.
   *
   * So: walk the captured JSON, find arrays of numbers, and name them by
   * where they were found. A field called humidity inside an array of
   * readings is a humidity series whatever the site calls its endpoint,
   * which is the only way this works on a site nobody has looked at.
   * ========================================================================== */
  const NUMERIC_KEY = /^(value|val|v|y|reading|amount|measurement|data)$/i;

  function capturedSeries({ limit = 24 } = {}) {
    const store = window.__wcFeedCapture;
    if (!store) return { installed: false, series: [], note: "feed capture is not installed on this page" };

    const series = [];
    const add = (name, values, sample) => {
      const nums = values.filter((n) => typeof n === "number" && Number.isFinite(n));
      if (nums.length < 3 || series.length >= limit) return;
      series.push({
        name: String(name).slice(0, 60),
        count: nums.length,
        first: nums[0], last: nums[nums.length - 1],
        min: Math.min(...nums), max: Math.max(...nums),
        mean: Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3)),
        values: nums.slice(0, 500),
        sample: sample === undefined ? undefined : String(sample).slice(0, 40),
      });
    };

    const walk = (node, path, depth) => {
      if (!node || depth > 6 || series.length >= limit) return;
      if (Array.isArray(node)) {
        if (node.length >= 3 && node.every((x) => typeof x === "number")) {
          add(path || "values", node);
          return;
        }
        // An array of readings: every numeric field in it is its own series.
        const objects = node.filter((x) => x && typeof x === "object" && !Array.isArray(x));
        if (objects.length >= 3) {
          const keys = new Set();
          for (const o of objects.slice(0, 50)) for (const k of Object.keys(o)) keys.add(k);
          for (const k of keys) {
            const vals = objects.map((o) => (o[k] && typeof o[k] === "object" ? o[k].value : o[k]));
            const named = NUMERIC_KEY.test(k) && path ? path : (path ? `${path}.${k}` : k);
            add(named, vals, objects[0] && objects[0][k]);
          }
          return;
        }
        for (let i = 0; i < Math.min(node.length, 8); i++) walk(node[i], path, depth + 1);
        return;
      }
      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          walk(v, path ? `${path}.${k}` : k, depth + 1);
        }
      }
    };

    for (const f of store.feeds) {
      if (!f.body || f.truncated || !/json/i.test(f.contentType || "")) continue;
      let parsed;
      try { parsed = JSON.parse(f.body); } catch (e) { continue; }
      const from = (() => { try { return new URL(f.url).pathname.split("/").filter(Boolean).pop() || "feed"; }
        catch (e) { return "feed"; } })();
      walk(parsed, "", 0);
      for (const sr of series) if (!sr.from) sr.from = from;
    }
    return { installed: true, count: series.length, series };
  }

  // One captured response in full, by URL substring - for actually reading
  // the series behind a chart rather than just listing what was fetched.
  function capturedFeed(match) {
    const store = window.__wcFeedCapture;
    if (!store) return { found: false, note: "feed capture is not installed on this page" };
    const needle = String(match || "").toLowerCase();
    const hit = [...store.feeds].reverse().find((f) => f.url.toLowerCase().includes(needle));
    if (!hit) return { found: false, note: `nothing captured whose URL contains "${match}"` };
    let parsed = null;
    try { parsed = JSON.parse(hit.body); } catch (e) { /* not JSON, body stands */ }
    return { found: true, url: hit.url, status: hit.status, at: hit.at, truncated: hit.truncated, parsed, body: parsed ? undefined : hit.body };
  }

  /* ============================================================================
   * readPage() - the data on the page, as opposed to inventory()'s controls.
   *
   * inventory() answers "what can I click here"; this answers "what does this
   * page say". Both read the live DOM at the moment they're called - nothing
   * is cached or precomputed.
   *
   * Four kinds of thing are worth extracting, in descending order of how
   * reliably they carry meaning:
   *   tables      - already structured, so they survive extraction intact
   *   pairs       - a label next to a value (dl/dt/dd, th+td, .label/.value)
   *   readouts    - a number with a unit sitting in its own element
   *   chartText   - SVG text and aria-labels, which is the only part of a
   *                 chart that exists as readable DOM
   *
   * A canvas chart yields nothing here, by construction: it is painted
   * pixels with no elements to read. That is a real limit, not an oversight
   * - see mapInfo() for the same problem with maps. The honest fix for those
   * is the data the page itself fetched, not the picture it drew.
   * ========================================================================== */

  // "12.4 ft", "-3.2 °C", "1,234 cfs", "45%"
  const NUMBER_UNIT = /(-?[\d,]+\.?\d*)\s*(°?[a-zA-Z%/]{1,12}\b)?/;

  const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

  function readTables(limit = 6) {
    const out = [];
    for (const table of deepQueryAll("table").slice(0, limit)) {
      if (!isVisible(table)) continue;
      const rows = [...table.rows].slice(0, 25);
      if (rows.length < 2) continue;
      const cells = (r) => [...r.cells].map((c) => textOf(c).slice(0, 60));

      // Requiring <th> was too strict: plenty of real tables mark up their
      // header row with <td>, and without column names a lookup has nothing
      // to match a day against - every day then reads the same cell, which
      // looks like a correct answer to the wrong question. So fall back to
      // shape: a first row that is mostly words, above rows that are mostly
      // numbers, is a header whatever tag it uses.
      const isNumeric = (t) => /^[^a-zA-Z]*-?[\d,.]+[^a-zA-Z]*$/.test(t) && /\d/.test(t);
      const firstRow = rows[0].cells.length ? cells(rows[0]) : [];
      const taggedHeader = [...rows[0].cells].some((c) => c.tagName === "TH");
      const bodyRows = rows.slice(1);
      const bodyHasNumbers = bodyRows.some((r) => cells(r).slice(1).some(isNumeric));
      const firstRowIsWords = firstRow.length > 1 && firstRow.slice(1).filter(Boolean).every((t) => !isNumeric(t));
      const header = firstRow.length && (taggedHeader || (firstRowIsWords && bodyHasNumbers))
        ? firstRow : null;
      out.push({
        caption: table.caption ? textOf(table.caption).slice(0, 80) : null,
        columns: header,
        rows: (header ? rows.slice(1) : rows).map(cells),
        totalRows: table.rows.length,
      });
    }
    return out;
  }

  function readPairs(limit = 40) {
    const pairs = [];
    // definition lists
    for (const dl of deepQueryAll("dl")) {
      const kids = [...dl.children];
      for (let i = 0; i < kids.length - 1; i++) {
        if (kids[i].tagName === "DT" && kids[i + 1].tagName === "DD") {
          pairs.push({ label: textOf(kids[i]).slice(0, 60), value: textOf(kids[i + 1]).slice(0, 60) });
        }
      }
    }
    // two-cell rows, the usual shape of a "current conditions" table
    for (const tr of deepQueryAll("tr")) {
      if (tr.cells && tr.cells.length === 2) {
        const label = textOf(tr.cells[0]), value = textOf(tr.cells[1]);
        if (label && value && label.length < 60) pairs.push({ label: label.slice(0, 60), value: value.slice(0, 60) });
      }
    }
    return pairs.slice(0, limit);
  }

  function readReadouts(limit = 40) {
    const out = [];
    const seen = new Set();
    for (const el of deepQueryAll("[class*=value], [class*=reading], [class*=stat], [class*=metric], [data-value], output")) {
      if (!isVisible(el)) continue;
      const text = textOf(el);
      if (!text || text.length > 40 || !/\d/.test(text)) continue;
      const key = text + "|" + (el.className || "");
      if (seen.has(key)) continue;
      seen.add(key);
      const m = text.match(NUMBER_UNIT);
      out.push({
        text,
        value: m ? Number(m[1].replace(/,/g, "")) : null,
        unit: m && m[2] ? m[2] : null,
        label: (el.getAttribute("aria-label") || rawLabelOf(el) || "").slice(0, 60) || null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // The readable part of a chart. SVG charts label their axes and often
  // their points; canvas charts have none of this, which is the difference
  // between a chart this can read and one it cannot.
  function readChartText(limit = 60) {
    const svgs = deepQueryAll("svg").filter(isVisible);
    const labelled = [];
    for (const svg of svgs.slice(0, 4)) {
      const texts = [...svg.querySelectorAll("text")].map(textOf).filter(Boolean);
      const aria = [...svg.querySelectorAll("[aria-label]")]
        .map((e) => e.getAttribute("aria-label")).filter((a) => a && /\d/.test(a));
      const titles = [...svg.querySelectorAll("title")].map(textOf).filter(Boolean);
      if (texts.length || aria.length || titles.length) {
        labelled.push({
          labels: texts.slice(0, limit),
          points: aria.slice(0, limit),
          titles: titles.slice(0, 12),
        });
      }
    }
    return {
      svgCharts: labelled,
      canvasCount: deepQueryAll("canvas").filter(isVisible).length,
    };
  }

  // Values written as one run of text - "High: 81°F", "Low 68 °F", "Humidity
   // 52%" - which is how a forecast page states most of what it shows. These
   // are invisible to readPairs(), which needs two elements, and to
   // readReadouts(), which needs a class or attribute to recognise. Without
   // them a page can display a number plainly and still look empty.
  function readLabelledNumbers(limit = 80) {
    const out = [];
    const seen = new Set();
    for (const el of deepQueryAll("p, span, div, li, dd, dt, td, th, strong, b, h3, h4, h5, h6")) {
      if (!isVisible(el)) continue;
      // Leaves only. A wrapper's textContent is its children concatenated,
      // which yields runs like "TodayHigh: 83 °F" alongside the "High: 83 °F"
      // it already contains - duplicated, and uglier to show.
      if (el.children.length > 1) continue;
      const text = textOf(el);
      if (!text || text.length > 70 || !/\d/.test(text)) continue;
      if (!/[a-zA-Z]/.test(text)) continue; // a bare number says nothing
      if (seen.has(text)) continue;
      seen.add(text);
      const m = text.match(/(-?[\d,]+\.?\d*)\s*(°\s?[CF]|°|%|[a-zA-Z/]{1,8})?/);
      out.push({
        text,
        value: m ? Number(m[1].replace(/,/g, "")) : null,
        unit: m && m[2] ? m[2].replace(/\s+/g, "") : null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /* ============================================================================
   * hoverSeries() - the data a chart only reveals on hover.
   *
   * A chart's numbers frequently exist nowhere in the DOM until a pointer
   * moves over it, at which point the library writes a tooltip. That is true
   * of canvas charts especially, where there is otherwise nothing to read at
   * all. Moving a synthetic pointer across the plot and collecting what
   * appears recovers the series.
   *
   * This is a genuine last resort, not a preferred path. It samples rather
   * than enumerates, so it can miss points between samples; it depends on the
   * library rendering a tooltip into the DOM at all (some draw it into the
   * canvas, where it stays unreadable); and it moves the pointer, which on a
   * map can pan or highlight. Feed capture is better whenever the underlying
   * request was seen, since that is the real series rather than a reading of
   * the picture.
   * ========================================================================== */
  const TOOLTIP_SELECTOR = [
    '[role=tooltip]', '.tooltip', '[class*="tooltip"]', '[class*="Tooltip"]',
    '[class*="popup"]', '[class*="Popup"]', '[class*="hover"]', '[id*="tooltip"]',
  ].join(",");

  const tooltipTexts = () => deepQueryAll(TOOLTIP_SELECTOR)
    .filter((el) => isVisible(el))
    .map((el) => textOf(el))
    .filter((t) => t && t.length < 300);

  async function hoverSeries({ selector, samples = 24, settle = 60 } = {}) {
    const target = selector
      ? deepQuery(selector)
      : deepQueryAll("canvas, svg").filter(isVisible).sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return (rb.width * rb.height) - (ra.width * ra.height);
        })[0];
    if (!target) return { found: false, note: "no chart or canvas on this page to hover over" };

    const box = target.getBoundingClientRect();
    if (!box.width || !box.height) return { found: false, note: "the chart has no size on screen" };

    const before = new Set(tooltipTexts());
    const seen = new Map(); // text -> the x fraction it first appeared at
    const y = box.top + box.height / 2;

    for (let i = 0; i < samples; i++) {
      const fraction = samples === 1 ? 0.5 : i / (samples - 1);
      const x = box.left + box.width * fraction;
      for (const type of ["pointermove", "mousemove"]) {
        // Both, because libraries listen for one or the other and there is
        // no reliable way to know which.
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, view: window,
        }));
      }
      await wait(settle);
      for (const text of tooltipTexts()) {
        if (before.has(text) || seen.has(text)) continue;
        seen.set(text, Math.round(fraction * 100) / 100);
      }
    }

    // Leave the pointer off the chart so the tooltip does not linger.
    target.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));

    const points = [...seen.entries()].map(([text, at]) => ({ text, at }));
    return {
      found: points.length > 0,
      element: tagOf(target),
      samples,
      points,
      note: points.length
        ? "read by hovering across the chart - sampled, so points between samples may be missing"
        : "hovering produced no tooltip. The chart may draw its tooltip into the canvas itself, where it cannot be read - try pageFeeds() for the data it fetched instead",
    };
  }

  /* ============================================================================
   * mapFeatures() - the data behind map markers.
   *
   * map-probe established the hard part years of testing keeps confirming: a
   * canvas map has no per-marker DOM, so markers cannot be found, clicked or
   * hovered by selector. Hovering pixels blindly is worse than useless on a
   * map, because a stray pointer pans it.
   *
   * What does sometimes exist is the library's own instance, reachable off
   * window, holding the features it drew. Asking it directly is exact where
   * hovering is guesswork. Leaflet and OpenLayers keep layers of features;
   * Mapbox and MapLibre can be queried for rendered features. When no
   * instance is reachable the honest answer is that the data is pixels, and
   * the request the page made (pageFeeds) is the only way to it.
   * ========================================================================== */
  function mapFeatures({ limit = 60 } = {}) {
    const info = mapInfo();
    const out = [];

    // DOM markers first: when they exist this is exact and cheap.
    const domMarkers = deepQueryAll('[class*="marker"], [class*="Marker"], .leaflet-marker-icon, [role="button"][aria-label]')
      .filter(isVisible)
      .map((el) => ({
        label: (el.getAttribute("aria-label") || el.getAttribute("title") || textOf(el) || "").slice(0, 120),
        selector: cssPath(el),
      }))
      .filter((m) => m.label);
    if (domMarkers.length) {
      return { source: "dom", libraries: info.libraries, count: domMarkers.length,
        features: domMarkers.slice(0, limit),
        note: "these markers are real elements, so they can also be clicked by selector" };
    }

    // Otherwise the library's own instance, if it is reachable.
    const seen = new Set();
    const collect = (obj, depth) => {
      if (!obj || depth > 5 || out.length >= limit || seen.has(obj)) return;
      if (typeof obj !== "object") return;
      seen.add(obj);

      // Leaflet: eachLayer walks everything added to the map.
      if (typeof obj.eachLayer === "function") {
        try {
          obj.eachLayer((layer) => {
            if (out.length >= limit) return;
            const latlng = typeof layer.getLatLng === "function" ? layer.getLatLng() : null;
            const popup = typeof layer.getPopup === "function" && layer.getPopup();
            const text = popup && typeof popup.getContent === "function" ? popup.getContent() : null;
            if (latlng || text) {
              out.push({
                lat: latlng ? latlng.lat : null, lon: latlng ? latlng.lng : null,
                label: typeof text === "string" ? text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : null,
                properties: layer.feature && layer.feature.properties ? layer.feature.properties : undefined,
              });
            }
          });
        } catch (e) { /* not a Leaflet map after all */ }
      }

      // OpenLayers: layers carry sources carrying features.
      if (typeof obj.getLayers === "function") {
        try {
          obj.getLayers().forEach((layer) => {
            const source = typeof layer.getSource === "function" ? layer.getSource() : null;
            if (source && typeof source.getFeatures === "function") {
              for (const f of source.getFeatures()) {
                if (out.length >= limit) break;
                const props = typeof f.getProperties === "function" ? f.getProperties() : {};
                delete props.geometry;
                out.push({ properties: props, label: (props.name || props.title || props.label || "") || null });
              }
            }
          });
        } catch (e) { /* not an OpenLayers map */ }
      }

      // Mapbox / MapLibre: ask for what is currently rendered.
      if (typeof obj.queryRenderedFeatures === "function") {
        try {
          for (const f of obj.queryRenderedFeatures()) {
            if (out.length >= limit) break;
            out.push({ properties: f.properties || {}, label: (f.properties && (f.properties.name || f.properties.title)) || null,
              lat: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[1] : null,
              lon: f.geometry && f.geometry.coordinates ? f.geometry.coordinates[0] : null });
          }
        } catch (e) { /* not queryable right now */ }
      }
    };

    for (const key of Object.keys(window)) {
      if (out.length >= limit) break;
      let value;
      try { value = window[key]; } catch (e) { continue; } // some globals throw on access
      collect(value, 0);
    }

    if (out.length) {
      return { source: "js-instance", libraries: info.libraries, count: out.length, features: out.slice(0, limit),
        note: "read from the map library's own instance, which is exact - hovering pixels would not be" };
    }
    return {
      source: "none", libraries: info.libraries, count: 0, features: [],
      driveable: info.driveable,
      note: info.libraries.length
        ? "this map draws its features to a canvas and exposes no reachable instance, so there is nothing to read from the page - use pageFeeds() for the data it fetched"
        : "no map found on this page",
    };
  }

  /* ============================================================================
   * readUrl() - another page of the same site, without leaving this one.
   *
   * "I am on Idaho and I want Alaska" is a fair thing to ask, and navigating
   * there to answer it would lose the page in front of you. Fetching the
   * other page and running the same extraction over it answers without
   * moving.
   *
   * The limit is real and worth stating: this reads the HTML the server
   * sends. A page that renders its content in JavaScript - which many
   * dashboards do - arrives here nearly empty, and no amount of parsing
   * recovers what was never in the document. For those, the page's own data
   * request (pageFeeds) or the agency API is the way. Same-origin only, since
   * that is what the page is allowed to fetch.
   * ========================================================================== */
  async function readUrl(url) {
    let target;
    try { target = new URL(url, location.href); } catch (e) { throw new Error(`"${url}" is not a URL`); }
    if (target.origin !== location.origin) {
      throw new Error(`can only read pages on ${location.origin} from here - ${target.origin} is a different site`);
    }

    const res = await fetch(target.href, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`${target.pathname} returned ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    // The same extraction as readPage, over a parsed document rather than the
    // live one. Visibility cannot be judged here - nothing is laid out - so
    // structure is used instead of geometry.
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
    const tables = [...doc.querySelectorAll("table")].slice(0, 8).map((table) => {
      const rows = [...table.rows].slice(0, 30);
      const cells = (r) => [...r.cells].map((c) => text(c).slice(0, 60));
      const header = rows.length && [...rows[0].cells].some((c) => c.tagName === "TH") ? cells(rows[0]) : null;
      return {
        caption: table.caption ? text(table.caption).slice(0, 80) : null,
        columns: header,
        rows: (header ? rows.slice(1) : rows).map(cells),
        totalRows: table.rows.length,
      };
    }).filter((t) => t.rows.length);

    const pairs = [];
    for (const dl of doc.querySelectorAll("dl")) {
      const kids = [...dl.children];
      for (let i = 0; i < kids.length - 1; i++) {
        if (kids[i].tagName === "DT" && kids[i + 1].tagName === "DD") {
          pairs.push({ label: text(kids[i]).slice(0, 60), value: text(kids[i + 1]).slice(0, 60) });
        }
      }
    }
    for (const tr of doc.querySelectorAll("tr")) {
      if (tr.cells && tr.cells.length === 2) {
        const label = text(tr.cells[0]), value = text(tr.cells[1]);
        if (label && value && label.length < 60) pairs.push({ label: label.slice(0, 60), value: value.slice(0, 60) });
      }
    }

    const labelledNumbers = [];
    const seen = new Set();
    for (const el of doc.querySelectorAll("p, span, div, li, dd, dt, td, th, strong, b, h3, h4, h5, h6")) {
      if (el.children.length > 1) continue;
      const t = text(el);
      if (!t || t.length > 70 || !/\d/.test(t) || !/[a-zA-Z]/.test(t) || seen.has(t)) continue;
      seen.add(t);
      const m = t.match(/(-?[\d,]+\.?\d*)\s*(°\s?[CF]|°|%|[a-zA-Z/]{1,8})?/);
      labelledNumbers.push({ text: t, value: m ? Number(m[1].replace(/,/g, "")) : null, unit: m && m[2] ? m[2].replace(/\s+/g, "") : null });
      if (labelledNumbers.length >= 80) break;
    }

    const bodyText = text(doc.body || doc.documentElement).length;
    return {
      url: target.href,
      title: doc.title,
      headings: [...doc.querySelectorAll("h1, h2")].map(text).filter(Boolean).slice(0, 12),
      tables, pairs, labelledNumbers,
      readouts: [],
      chart: { svgCharts: [], canvasCount: doc.querySelectorAll("canvas").length },
      note: (!tables.length && !pairs.length && !labelledNumbers.length)
        ? (bodyText < 2000
          ? "this page arrived nearly empty, which means it builds its content in JavaScript - the server HTML has nothing to read"
          : "no tables, labelled pairs or numbers found in this page's HTML")
        : undefined,
    };
  }

  // Links on this page, so a caller can find the other page worth reading.
  /* ==========================================================================
   * searchTargets() - the site's own search, as a URL.
   *
   * Following links only reaches what the site chose to link. A data portal
   * mostly does not link its data: CDEC has a gauge on the Smith River and
   * no page anywhere that says so, because you are expected to search for
   * it. Link-walking cannot get there, and neither could anything else here.
   *
   * A GET form is a URL with blanks in it. Reading that off the form means a
   * search can be *fetched* rather than submitted - the page in front of the
   * person does not move, several queries can be tried, and a bad guess
   * costs one request. A POST form cannot be done this way and is reported
   * as such rather than silently skipped.
   * ========================================================================== */
  function searchTargets() {
    const out = [];
    for (const form of deepQueryAll("form")) {
      const method = String(form.getAttribute("method") || "get").toLowerCase();
      const field = [...form.elements].find((el) => {
        const type = String(el.type || "").toLowerCase();
        return el.name && (type === "search" || type === "text");
      });
      if (!field) continue;
      let action;
      try { action = new URL(form.getAttribute("action") || location.href, location.href); }
      catch (e) { continue; }
      if (action.origin !== location.origin) continue;
      // A form whose action is an API endpoint is driven by the page's own
      // script, not by the browser navigating to it. CDEC's site search
      // posts to /api/sitecore/Search/Search, which answers XHR and returns
      // 404 to a form submission - so submitting it took the person off
      // their page and onto an error. Worth knowing before offering to.
      const navigable = !/\/api\/|\/ajax\/|\.json($|\?)|\/rest\//i.test(action.pathname + action.search);
      out.push({
        label: (rawLabelOf(field) || form.getAttribute("aria-label") || "search").slice(0, 60),
        field: field.name,
        url: action.href,
        method,
        navigable,
        // Whatever else the form carries - a portal's search often needs
        // half a dozen hidden fields to return anything at all.
        extra: [...form.elements]
          .filter((el) => {
            if (!el.name || el === field || !el.value) return false;
            const type = String(el.type || "").toLowerCase();
            if (!["hidden", "checkbox", "radio", "select-one"].includes(type)) return false;
            // .checked is false on a hidden input, not undefined, so testing
            // it for every type silently dropped every hidden field - and a
            // portal's search needs them: CDEC's station search carries a
            // dozen and returns nothing without them.
            if (type === "checkbox" || type === "radio") return !!el.checked;
            return true;
          })
          .slice(0, 12)
          .map((el) => [el.name, el.value]),
      });
      if (out.length >= 4) break;
    }
    return { url: location.href, count: out.length, targets: out };
  }

  // The URL a search would go to, without going to it.
  function searchUrl(query, target) {
    const t = target || (searchTargets().targets || [])[0];
    if (!t) throw new Error("this page has no search form that can be read as a URL");
    if (t.method !== "get") throw new Error(`"${t.label}" submits by ${t.method}, which cannot be turned into a URL`);
    const u = new URL(t.url);
    for (const [k, v] of t.extra || []) u.searchParams.set(k, v);
    u.searchParams.set(t.field, query);
    return { url: u.href, via: t.label };
  }

  function pageLinks({ limit = 120 } = {}) {
    const out = [];
    const seen = new Set();
    for (const a of deepQueryAll("a[href]")) {
      let href;
      try { href = new URL(a.getAttribute("href"), location.href); } catch (e) { continue; }
      if (href.origin !== location.origin) continue;
      if (seen.has(href.href)) continue;
      seen.add(href.href);
      const label = textOf(a).slice(0, 80) || a.getAttribute("aria-label") || a.getAttribute("title") || "";
      if (!label) continue;
      out.push({ label, url: href.href });
      if (out.length >= limit) break;
    }
    return { url: location.href, count: out.length, links: out };
  }

  /* ============================================================================
   * settle() and pageSignature() - telling a real change from a no-op.
   *
   * An action that silently did nothing looks exactly like one that worked:
   * both return without error. That is the same shape as every other bug this
   * project has produced - plausible, and wrong. Comparing a compact snapshot
   * of the page's control states before and after makes the difference
   * visible.
   *
   * Timing matters as much as the comparison. Most of these actions are
   * asynchronous - a click triggers a fetch, a re-render, an animation - so a
   * snapshot taken immediately afterwards catches the old state and reports a
   * working action as a no-op. settle() waits for the DOM to stop changing
   * first, with a ceiling so a page that mutates constantly (a live clock, a
   * ticker) cannot hang the caller.
   * ========================================================================== */
  function settle({ quiet = 220, timeout = 2500 } = {}) {
    return new Promise((resolve) => {
      let lastChange = Date.now();
      let mutations = 0;
      const observer = new MutationObserver((records) => {
        mutations += records.length;
        lastChange = Date.now();
      });
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true,
      });
      const started = Date.now();
      const tick = () => {
        const idleFor = Date.now() - lastChange;
        if (idleFor >= quiet || Date.now() - started >= timeout) {
          observer.disconnect();
          resolve({ mutations, waitedMs: Date.now() - started, timedOut: Date.now() - started >= timeout });
          return;
        }
        setTimeout(tick, 60);
      };
      setTimeout(tick, 60);
    });
  }

  // A compact record of what every control is currently set to. Deliberately
  // values only - positions and text move for reasons unrelated to the action
  // (lazy images, ads, a clock), and would report a change on every call.
  function pageSignature({ limit = 400 } = {}) {
    const state = {};
    let n = 0;
    for (const el of deepQueryAll("input, select, textarea, [role=radio], [role=checkbox], [aria-pressed], [aria-selected], [aria-expanded]")) {
      if (n >= limit) break;
      if (!isVisible(el)) continue;
      const key = cssPath(el);
      if (!key) continue;
      const tag = tagOf(el);
      let value;
      if (tag === "select") value = el.value;
      else if (el.type === "checkbox" || el.type === "radio") value = !!el.checked;
      else if (tag === "input" || tag === "textarea") value = String(el.value || "").slice(0, 80);
      else {
        value = el.getAttribute("aria-pressed") || el.getAttribute("aria-selected") || el.getAttribute("aria-expanded");
      }
      if (value === undefined || value === null) continue;
      // The label travels with the value. Without it a diff can only report
      // raw selectors - "div.map-app-container > div.uk-card..." - which says
      // nothing about what actually changed.
      state[key] = { value, label: rawLabelOf(el).slice(0, 60) || null, tag };
      n++;
    }
    return { url: location.href, title: document.title, controls: state, count: n };
  }

  // What actually changed between two snapshots, in terms a person can read.
  function signatureDiff(before, after) {
    const changes = [];
    const seen = new Set();
    const valueOf = (entry) => (entry && typeof entry === "object" ? entry.value : entry);
    const labelOfEntry = (entry) => (entry && typeof entry === "object" ? entry.label : null);

    for (const [key, entry] of Object.entries(after.controls || {})) {
      seen.add(key);
      const prior = (before.controls || {})[key];
      if (prior === undefined) {
        changes.push({ selector: key, label: labelOfEntry(entry), appeared: true, now: valueOf(entry) });
        continue;
      }
      if (String(valueOf(prior)) !== String(valueOf(entry))) {
        changes.push({ selector: key, label: labelOfEntry(entry) || labelOfEntry(prior), was: valueOf(prior), now: valueOf(entry) });
      }
    }
    for (const [key, entry] of Object.entries(before.controls || {})) {
      if (!seen.has(key)) changes.push({ selector: key, label: labelOfEntry(entry), disappeared: true, was: valueOf(entry) });
    }

    // A fragment change is the same document with a different view - most map
    // pages write their centre and zoom there. Reporting it as "page moved
    // to <long url>" is both ugly and wrong.
    const stripHash = (u) => String(u || "").split("#")[0];
    const hashOnly = before.url !== after.url && stripHash(before.url) === stripHash(after.url);

    // An empty fragment is not a view. Clicking <a href="#"> - which is how
    // half the web writes a button that does nothing on its own - appends a
    // bare "#" and nothing else, and counting that as a change made every
    // dead link report that the page responded. A map writing its centre
    // and zoom into the fragment still counts; "#" alone does not.
    // Written wrong the first time: it compared whether each url had a
    // fragment, which is true of both before and after, so the test never
    // fired. What matters is only whether the fragment it landed on is
    // empty - "#" carries no view, and a map writing "#@=-83,43,5" does.
    const cosmeticHash = hashOnly && !String(after.url).split("#")[1];

    return {
      changed: changes.length > 0 || (before.url !== after.url && !cosmeticHash),
      navigated: before.url !== after.url && !hashOnly ? { from: before.url, to: after.url } : undefined,
      viewChanged: (hashOnly && !cosmeticHash) || undefined,
      changes: changes.slice(0, 20),
      changeCount: changes.length,
    };
  }

  /* ============================================================================
   * submit() - typing is not searching.
   *
   * fill() types and stops. Every hand-written manifest that wraps a search
   * box adds Enter itself (see NOAA.search), because typing alone leaves the
   * text sitting in the box and nothing else happening - and the value did
   * change, so a verification check calls it a success. A search that looks
   * performed and was not is the worst outcome available.
   *
   * Three routes, because sites differ: the Enter key, the form's own submit,
   * and an adjacent submit button. Enter first, since that is what a person
   * would press and what search widgets almost always listen for.
   * ========================================================================== */
  function submit(elOrSel) {
    const el = typeof elOrSel === "string" ? deepQuery(elOrSel) : elOrSel;
    if (!el) throw new Error(`submit: not found: ${elOrSel}`);

    // A <select> that navigates on change has already done the work by the
    // time this runs - a state picker wired to location.href is exactly this
    // shape. Submitting as well either double-navigates or cancels the
    // navigation already in flight.
    // A dropdown is its own case. Some navigate on change and have already
    // done the work; some need the Go button beside them. None of them want
    // form.requestSubmit(), which on a page that wraps its controls in a form
    // for styling reloads everything and throws the page's state away. So a
    // select follows through only via an explicit button, or not at all.
    if (el.tagName === "SELECT") {
      const inline = String(el.getAttribute("onchange") || "") + String(el.getAttribute("onblur") || "");
      if (/location|navigate|\.submit\(|href/i.test(inline)) return { submitted: "change" };
      const near = el.form || el.closest("form") || el.parentElement || document;
      const go = near.querySelector('button[type=submit], input[type=submit], button[class*="go"], [aria-label*="Go"]')
        || [...near.querySelectorAll("button, input[type=button], a[role=button]")]
             .find((b) => /^(go|apply|view|submit|show)\b/i.test((b.textContent || b.value || "").trim()));
      if (go) { realClick(go); return { submitted: "button" }; }
      return { submitted: "change only - this dropdown has no go button" };
    }
    el.focus();

    const enter = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 };
    el.dispatchEvent(new KeyboardEvent("keydown", enter));
    el.dispatchEvent(new KeyboardEvent("keypress", enter));
    el.dispatchEvent(new KeyboardEvent("keyup", enter));

    // A form may ignore a synthetic Enter, so ask it directly.
    const form = el.form || el.closest("form");
    if (form) {
      try {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
        return { submitted: "form" };
      } catch (e) { /* a framework may intercept; the button below is next */ }
    }

    // Otherwise a submit button beside it, which is how many search widgets
    // are actually built.
    const scope = form || el.parentElement || document;
    const button = scope.querySelector('button[type=submit], input[type=submit], button[class*="search"], [aria-label*="earch"][role=button]');
    if (button) { realClick(button); return { submitted: "button" }; }

    return { submitted: "enter" };
  }

  /* ============================================================================
   * The small operations everything else assumed were possible.
   *
   * waitFor already existed in the WC layer but was never exposed, so a
   * sequence's second step acted on whatever happened to exist when it ran -
   * settle() waits for the page to stop changing, which is not the same as
   * waiting for a particular thing to appear. readControl fills the other
   * obvious hole: nothing could read a single control's current value, so
   * "what is selected" worked on USGS (getState) and nowhere else.
   * ========================================================================== */

  // Waits for a selector to appear, which is what a sequence needs between a
  // click that opens a panel and an action inside it.
  async function waitForSelector(selector, { timeout = 5000 } = {}) {
    const started = Date.now();
    try {
      const el = await waitFor(selector, { timeout });
      return { found: true, selector, waitedMs: Date.now() - started, label: rawLabelOf(el).slice(0, 60) || null };
    } catch (e) {
      return { found: false, selector, waitedMs: Date.now() - started,
        note: `"${selector}" did not appear within ${timeout}ms - the action that should create it may not have run` };
    }
  }

  // One control's current state, in the same vocabulary inventory() uses.
  function readControl(selector) {
    const el = deepQuery(selector);
    if (!el) return { found: false, selector, note: `no element matches ${selector}` };
    const tag = tagOf(el);
    const out = {
      found: true, selector, tag,
      type: el.type || null,
      label: rawLabelOf(el).slice(0, 80) || null,
      disabled: !!el.disabled,
      visible: isVisible(el),
    };
    if (tag === "select") {
      out.value = el.value;
      out.selectedText = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text.trim() : null;
      out.options = [...el.options].slice(0, 30).map((o) => ({ value: o.value, text: o.text.trim(), selected: o.selected }));
    } else if (el.type === "checkbox" || el.type === "radio") {
      out.checked = !!el.checked;
      out.value = el.value;
    } else if (tag === "input" || tag === "textarea") {
      out.value = String(el.value || "").slice(0, 200);
    } else {
      out.text = textOf(el).slice(0, 200);
      for (const attr of ["aria-pressed", "aria-expanded", "aria-selected", "aria-checked"]) {
        const v = el.getAttribute(attr);
        if (v !== null) out[attr] = v;
      }
    }
    return out;
  }

  // Puts controls back the way they were, from the change list signatureDiff
  // produced. Only possible at all because verification records the previous
  // value - before that there was nothing to revert to.
  function restore(changes) {
    const results = [];
    for (const change of changes || []) {
      if (!change || !change.selector || change.was === undefined) continue;
      const el = deepQuery(change.selector);
      if (!el) { results.push({ selector: change.selector, ok: false, why: "no longer on the page" }); continue; }
      try {
        const tag = tagOf(el);
        if (tag === "select") setSelect(el, String(change.was));
        else if (el.type === "checkbox" || el.type === "radio") setChecked(el, change.was === true || change.was === "true");
        else if (tag === "input" || tag === "textarea") fill(el, String(change.was));
        else { results.push({ selector: change.selector, ok: false, why: "not a settable control" }); continue; }
        results.push({ selector: change.selector, ok: true, restoredTo: change.was });
      } catch (e) {
        results.push({ selector: change.selector, ok: false, why: String((e && e.message) || e) });
      }
    }
    return { restored: results.filter((r) => r.ok).length, attempted: results.length, results };
  }

  // Leaving the page is easy; coming back was not possible at all.
  function goBack() {
    const from = location.href;
    history.back();
    return { from, note: "asked the browser to go back - the page may take a moment" };
  }

  // realClick scrolls what it clicks into view, but nothing else did, so
  // reading a control below the fold was unreliable.
  function scrollToElement(selector) {
    const el = deepQuery(selector);
    if (!el) return { found: false, selector };
    el.scrollIntoView({ block: "center", inline: "center" });
    return { found: true, selector, label: rawLabelOf(el).slice(0, 60) || null };
  }

  /* ==========================================================================
   * WebMCP: tools the page declares about itself.
   *
   * Everything else in this file infers what a page can do by looking at it -
   * reading labels, guessing which control a sentence meant, then checking
   * afterwards whether anything moved. That is a reconstruction, and it is
   * wrong whenever the markup is unusual.
   *
   * A page that registers modelContext tools has stated what it can
   * do, in its own words, with real parameter schemas. There is nothing to
   * infer and nothing to verify by diffing - it is the difference between
   * reading a menu and guessing at the kitchen. So when a page offers them,
   * they come first and the scraping never runs.
   *
   * The API is young: a W3C Community Group report, shipping natively in
   * Edge 147 and behind an origin trial in Chrome 149, absent everywhere
   * else. Every function here reports that plainly instead of failing.
   *
   * Reading them back is the awkward part. registerTool() is designed for the
   * browser to consume, and no enumeration surface is guaranteed to exist for
   * page script - so several are probed, and anything this extension
   * registered itself is kept in a local registry that is always readable.
   * ========================================================================== */
  const MCP_REGISTRY = (window.__wcMcpRegistry = window.__wcMcpRegistry || []);

  // The API moved. It began on navigator and now lives on document -
  // navigator.modelContext still works but logs a deprecation warning on
  // every single access, which on a page this extension touches repeatedly
  // fills the extension's error list with noise and buries anything real.
  //
  // document first, navigator as the fallback, so both drafts work and the
  // newer one is never the thing that warns.
  const mcpApi = () => {
    if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
    if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext;
    return null;
  };
  const mcpApiName = () =>
    (typeof document !== "undefined" && document.modelContext) ? "document.modelContext" : "navigator.modelContext";

  // A tool's shape differs slightly between the drafts, so it is normalised
  // to one thing before anyone upstream has to reason about it.
  // Chrome hands inputSchema back as a JSON string, not an object - confirmed
  // live, where `typeof inputSchema` came back "string". Everything upstream
  // reads schema.properties to decide what arguments a tool takes, and on a
  // string that is undefined: a site's own tools would have looked like they
  // took no arguments at all, and been called with none.
  const parseSchema = (raw) => {
    if (!raw) return null;
    if (typeof raw !== "string") return raw;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };
  const normaliseTool = (t, origin) => ({
    name: String(t.name || ""),
    description: String(t.description || ""),
    inputSchema: parseSchema(t.inputSchema) || parseSchema(t.parameters)
      || { type: "object", properties: {} },
    declaredBy: origin,
  });

  // Chrome ships no modelContext, so registerTool had nowhere to go and every
  // tool this page derived stayed private to the extension. The standard
  // shape costs almost nothing to provide: a registry, a way to list it and a
  // way to call it. Installing it means the tools become available through
  // the documented surface rather than through a bridge only this extension
  // knows about - so anything else running on the page can drive the site
  // too, and this extension stops being a special case.
  //
  // A polyfill, not native support, and it never displaces a real one: if the
  // browser or the site already provides modelContext, this leaves it alone.
  function mcpInstall() {
    if (mcpApi()) return { installed: false, why: "the page already has one", api: mcpApiName() };
    if (typeof document === "undefined") return { installed: false, why: "no document" };
    const context = {
      // Written to the same registry the extension already keeps, so the two
      // views can never disagree about what this page offers.
      registerTool(def) {
        if (!def || !def.name) throw new Error("registerTool needs a name");
        const at = MCP_REGISTRY.findIndex((t) => t.name === def.name);
        if (at >= 0) MCP_REGISTRY[at] = def; else MCP_REGISTRY.push(def);
        try {
          window.dispatchEvent(new CustomEvent("modelcontexttoolregistered",
            { detail: { name: def.name } }));
        } catch (e) { /* CustomEvent unavailable in odd embeddings */ }
        return { name: def.name };
      },
      unregisterTool(name) {
        const at = MCP_REGISTRY.findIndex((t) => t.name === name);
        if (at >= 0) MCP_REGISTRY.splice(at, 1);
        return at >= 0;
      },
      // Both spellings: the drafts disagree and a consumer may try either.
      getTools: () => MCP_REGISTRY.map((t) => normaliseTool(t, t.declaredBy || "extension")),
      listTools: () => MCP_REGISTRY.map((t) => normaliseTool(t, t.declaredBy || "extension")),
      // Chrome's implementation names this executeTool and takes arguments as
      // a JSON string. A consumer written against the real thing has to work
      // here unchanged, or the polyfill is a trap rather than a stand-in - so
      // both names are offered and both argument shapes accepted.
      async executeTool(name, args) {
        return context.callTool(name, typeof args === "string"
          ? (args ? JSON.parse(args) : {}) : (args || {}));
      },
      async callTool(name, args) {
        const tool = MCP_REGISTRY.find((t) => t.name === name);
        if (!tool) throw new Error(`no tool named "${name}" on this page`);
        const run = tool.execute || tool.run || tool.callback;
        if (typeof run !== "function") throw new Error(`"${name}" has no implementation`);
        return run(typeof args === "string" ? (args ? JSON.parse(args) : {}) : (args || {}));
      },
    };
    try {
      Object.defineProperty(document, "modelContext", {
        value: context, writable: false, configurable: true, enumerable: false,
      });
    } catch (e) {
      try { document.modelContext = context; } catch (e2) { return { installed: false, why: String(e2) }; }
    }
    return { installed: true, api: "document.modelContext", polyfill: true };
  }

  async function mcpInfo() {
    const api = mcpApi();
    if (!api) {
      return { available: false, tools: 0,
        note: "this browser has no modelContext API - needs Edge 147+, or Chrome 146+ with chrome://flags/#enable-webmcp-testing" };
    }
    const found = await mcpTools();
    return {
      available: true,
      canRegister: typeof api.registerTool === "function",
      readableFrom: found.readFrom,
      tools: found.tools.length,
      note: found.tools.length
        ? "this page declares its own tools; they are preferred over reading the page"
        : `${mcpApiName()} exists but this page has registered nothing`,
    };
  }

  // Async because the real one is. Chrome's getTools() returns a promise, and
  // this checked Array.isArray on it the instant it was called - never true
  // of a promise - so every read fell through to the local registry. With the
  // flag on and a genuine API present, "read from local registry" was what
  // came back, and "declared by this site: 0" was an artifact of never having
  // looked rather than a fact about the site.
  async function mcpTools() {
    const api = mcpApi();
    if (!api) return { available: false, readFrom: null, tools: [] };

    // Whatever this draft exposes, in decreasing order of officialness.
    for (const [key, how] of [["getTools", "call"], ["listTools", "call"], ["tools", "value"]]) {
      try {
        const got = how === "call" ? (typeof api[key] === "function" ? await api[key]() : null) : await api[key];
        if (Array.isArray(got) && got.length) {
          // Provenance matters downstream. Tools this extension registered
          // come back from the browser's own list looking exactly like the
          // page's, and preferring those over reading the page would mean
          // calling ourselves through a longer pipe.
          const mine = new Set(MCP_REGISTRY.map((t) => t.name));
          return { available: true, readFrom: `${mcpApiName()}.${key}`,
            tools: got.map((t) => normaliseTool(t, mine.has(t.name) ? "extension" : "page")) };
        }
      } catch (e) { /* try the next one */ }
    }
    // Nothing readable from the API: fall back to what we registered here.
    return {
      available: true,
      readFrom: MCP_REGISTRY.length ? "local registry" : null,
      tools: MCP_REGISTRY.map((t) => normaliseTool(t, t.declaredBy || "extension")),
    };
  }

  async function mcpCall(name, args) {
    const api = mcpApi();
    if (!api) throw new Error("this browser has no modelContext API");

    // A tool we registered can be run directly - no round trip through an API
    // that may not expose invocation to page script at all.
    const mine = MCP_REGISTRY.find((t) => t.name === name);
    if (mine && typeof mine.execute === "function") {
      return { ranVia: "local registry", result: await mine.execute(args || {}) };
    }
    // executeTool first, and with a JSON string: that is what Chrome's own
    // implementation takes behind chrome://flags/#enable-webmcp-testing. We
    // probed only callTool/invokeTool/invoke and passed an object, so against
    // the real API this threw "no way to call" on a page that was in fact
    // fully capable - a failure that could only ever show up on the one
    // browser configuration nobody here had tried.
    if (typeof api.executeTool === "function") {
      const out = await api.executeTool(name, JSON.stringify(args || {}));
      return { ranVia: `${mcpApiName()}.executeTool`, result: out };
    }
    for (const key of ["callTool", "invokeTool", "invoke"]) {
      if (typeof api[key] === "function") {
        return { ranVia: `${mcpApiName()}.${key}`, result: await api[key](name, args || {}) };
      }
    }
    throw new Error(`${mcpApiName()} offers no way to call "${name}" from page script`);
  }

  // The other direction: hand this page's verified controls to any agent that
  // speaks WebMCP, whether or not the site ever writes a line of code for it.
  function mcpRegister(tools) {
    const api = mcpApi();
    if (!api || typeof api.registerTool !== "function") {
      return { registered: 0, note: `this browser has no ${mcpApiName()}.registerTool` };
    }
    const names = [];
    for (const t of tools || []) {
      const target = ["USGS", "SITE", "NOAA", "FCP", "GENERIC"]
        .map((n) => window[n]).find((m) => m && typeof m[t.fn] === "function");
      if (!target) continue;
      const def = {
        name: t.name,
        description: t.description || "",
        inputSchema: t.parameters || { type: "object", properties: {} },
        execute: async (args) => target[t.fn](...(t.argOrder || []).map((k) => (args || {})[k])),
      };
      try {
        api.registerTool(def);
        def.declaredBy = "extension";
        MCP_REGISTRY.push(def);
        names.push(t.name);
      } catch (e) { /* a duplicate or a rejected schema - skip it, report the rest */ }
    }
    return { registered: names.length, names, note: names.length ? "" : "nothing could be registered" };
  }

  // Turning what is on the page into tools an agent can actually call.
  //
  // Publishing the extension's own primitives - click(selector), fill(selector,
  // text) - hands an agent half a toolbox it cannot use: it has to fetch an
  // inventory, read a wall of CSS, and construct a selector before it can do
  // anything. That is the same blind-selector problem this project spent its
  // time removing from its own planner, handed straight to somebody else.
  //
  // So each control becomes its own tool, named and described from its own
  // label, with the selector captured in the closure and absent from the
  // schema. An agent sees "select30DayPrecipitation" and calls it. Nothing to
  // discover, nothing to construct, nothing to get wrong.
  // Named verb-first, for two reasons. An agent choosing between tools reads
  // the name before anything else, and "choose" says more about what will
  // happen than the label alone does. And a label like "30-Day Precipitation"
  // cannot start an identifier - a verb in front solves that without a
  // meaningless "control" prefix.
  const VERB_FOR = { select: "choose", checkbox: "toggle", radio: "choose", textarea: "type" };
  const verbFor = (c) => {
    const kind = String(c.kind || "").toLowerCase();
    const type = String(c.type || "").toLowerCase();
    if (VERB_FOR[kind] || VERB_FOR[type]) return VERB_FOR[kind] || VERB_FOR[type];
    if (c.options && c.options.length) return "choose";
    if (["text", "search", "email", "url", "number", "tel"].includes(type)) return type === "search" ? "search" : "type";
    return "click";
  };
  const toolName = (label, verb) => {
    const words = String(label || "control").replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).slice(0, 5);
    const camel = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
    return (verb || "use") + camel;
  };

  // What calling it needs, expressed as a schema rather than assumed. A
  // dropdown's options become an enum, so an agent cannot invent a value the
  // page does not offer.
  const schemaFor = (c) => {
    const kind = String(c.kind || "").toLowerCase();
    const type = String(c.type || "").toLowerCase();
    if (kind === "select" || (c.options && c.options.length)) {
      const values = (c.options || []).map((o) => o.text || o.value).filter(Boolean).slice(0, 60);
      return { type: "object", properties: { value: { type: "string", enum: values, description: "which option to choose" } }, required: ["value"] };
    }
    if (type === "checkbox" || kind === "checkbox") {
      return { type: "object", properties: { on: { type: "boolean", description: "true to tick, false to untick" } }, required: ["on"] };
    }
    if (["text", "search", "email", "url", "number", "tel", "textarea"].includes(type) || kind === "textarea") {
      return { type: "object", properties: {
        text: { type: "string", description: "what to type" },
        submit: { type: "boolean", description: "press enter / the go button afterwards" },
      }, required: ["text"] };
    }
    return { type: "object", properties: {} };
  };

  const runnerFor = (c) => {
    const kind = String(c.kind || "").toLowerCase();
    const type = String(c.type || "").toLowerCase();
    const sel = c.selector;

    // A control behind a closed panel is reached by opening the panel. The
    // hand-written NOAA tools always did this - noaaSetBasemap is documented
    // as only working after noaaOpenLayers - and it is the entire reason
    // "enable precipitation estimate" worked while "enable the flood layer"
    // did not. Doing it here makes that true for any site.
    // A selector captured while the page was being read stops pointing at the
    // same control the moment the list it indexes into reflows - and opening
    // the panel is exactly that. "div.row:nth-of-type(3)" was Flood
    // Inundation when it was read and Precipitation Estimate by the time the
    // click landed, so the wrong layer switched on and the card reported "the
    // page responded", which was true and useless. The label is what the
    // instruction was matched against, so the label is what has to still be
    // there when the click lands. An id is stable; a position is not.
    const wanted = norm(c.label || "");
    const labelFits = (el) => {
      if (!el) return false;
      if (!wanted) return true;
      const got = norm(rawLabelOf(el));
      return !!got && (got === wanted || got.includes(wanted) || wanted.includes(got));
    };
    const resolve = () => {
      const direct = deepQuery(sel);
      if (labelFits(direct)) return direct;
      const again = deepQueryAll("input, select, textarea, button, a, label, li, [role]")
        .find((el) => norm(rawLabelOf(el)) === wanted && isVisible(el));
      return again || direct;
    };
    // Said out loud rather than guessed at: if what we are about to act on is
    // not what was named, that belongs on the card, not in the success line.
    const named = (el) => ({
      control: (rawLabelOf(el) || "").slice(0, 60) || sel,
      // Where it actually landed. A caller that has just pressed a panel
      // open needs to exclude the door when it looks again, and the label
      // cannot do that job: on this site the accordion titled "Flood
      // Inundation" reveals a layer checkbox of exactly the same name, so
      // dropping by label deletes the answer along with the door.
      at: (el && cssPath(el)) || sel,
      wrongOne: wanted && !labelFits(el) ? (c.label || "") : undefined,
    });

    const reveal = async () => {
      if (!c.revealedBy) return;
      const opener = deepQuery(c.revealedBy);
      if (!opener) return;
      const target = deepQuery(sel);
      if (target && isVisible(target)) return;   // already open
      realClick(opener);
      await settle({ quietMs: 120, timeoutMs: 1500 });
    };
    if (kind === "select" || (c.options && c.options.length)) {
      return async ({ value }) => {
        await reveal();
        const el = resolve();
        const was = el ? el.value : null;
        const chosen = setSelect(el || sel, value);
        return { ...named(el), was, now: chosen,
          itChanged: was !== chosen, then: submit(el || sel) };
      };
    }
    if (type === "checkbox" || kind === "checkbox" || type === "radio") {
      return async ({ on }) => {
        await reveal();
        // The control itself, before and after. Verification asks whether
        // the page changed, and a page where the wrong layer switched on
        // answers yes - "Flood Inundation · the page responded" was reported
        // while precipitation estimate was what actually moved. Only the
        // named control's own state can tell those apart.
        const el = resolve();
        const was = el ? !!el.checked : null;
        const now = setChecked(el || sel, on !== false);
        return {
          ...named(el),
          was, now, itChanged: was !== null && was !== now,
          openedFirst: !!c.revealedBy,
        };
      };
    }
    if (["text", "search", "email", "url", "number", "tel", "textarea"].includes(type) || kind === "textarea") {
      return async ({ text, submit: go }) => {
        await reveal();
        const el = resolve();
        fill(el || sel, text);
        return { ...named(el), filled: text,
          submitted: go === false ? null : submit(el || sel) };
      };
    }
    return async () => {
      await reveal();
      // A layer row is clicked, not ticked, so this is the branch the NOAA
      // toggles take - and it reported only which tag it hit. Where the row
      // owns a checkbox, that checkbox's own before and after is the only
      // thing that distinguishes "Flood Inundation went on" from "something
      // went on while Flood Inundation was asked for".
      const el = resolve();
      const box = el && el.matches && (el.matches("input[type=checkbox]") ? el
        : (el.querySelector && el.querySelector("input[type=checkbox]"))
          || (el.closest && el.closest("label, li, [role=row]")
              && el.closest("label, li, [role=row]").querySelector("input[type=checkbox]")));
      const was = box ? !!box.checked : null;
      const hit = realClick(el || sel);
      const now = box ? !!box.checked : null;
      return {
        ...named(el),
        was, now, how: "click",
        ...(was === null ? {} : { itChanged: was !== now }),
        clicked: String((hit && hit.tagName) || "").toLowerCase(),
        openedFirst: !!c.revealedBy,
      };
    };
  };

  // Reading is half of what an agent needs, and it is the half nothing else
  // here publishes. Without these it can drive the page but never find out
  // what the page now says.
  // A point on a map is a thing you can click, and it was the one kind this
  // never offered. mapFeatures() could read them; nothing turned them into
  // tools, so "click on st johns river" had nowhere to go even when the
  // marker was a real element sitting in the DOM.
  //
  // Two cases. A DOM marker - Leaflet's usual output - has a selector and is
  // clicked like anything else. A feature that exists only inside the map
  // library's own instance has no element, so it is opened through the
  // library: its popup, or failing that the map panned to it.
  // Things that look like they open something.
  //
  // A closed panel whose contents are display:none can be read where it
  // stands. A panel built with {#if open} does not exist at all - Svelte,
  // React and the rest remove it from the document - and no amount of
  // visibility handling finds what was never rendered. water.noaa.gov is
  // built this way: its layer checkboxes are absent until the Layers button
  // is pressed, which is why a hand-written noaaOpenLayers existed and why
  // nothing generic ever reached them.
  //
  // The only way in is to press the thing and look again.
  function disclosures({ limit = 6, match = "" } = {}) {
    freshPass();
    ariaIndex = null;
    const out = [];
    const seen = new Set();
    const NAMES = /\b(layer|layers|menu|filter|filters|options|settings|more|panel|legend|tools|expand|show)\b/i;

    // A panel named after its own subject. water.noaa.gov puts each layer
    // group behind a UIkit accordion whose title is the domain term itself -
    // "Flood Inundation", "National Snow Analysis" - so a list of generic
    // words like "layers" or "menu" never matched one, and the header got
    // clicked as though it were the layer. It is a door, not the room.
    const wantWords = String(match || "").toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    const relatedTo = (label) => {
      const l = (label || "").toLowerCase();
      return !!l && wantWords.some((w) => l.includes(w));
    };
    const isAccordion = (el) => {
      try {
        if (el.matches(".uk-accordion-title, [class*='accordion-title'], [id^='uk-accordion']")) return true;
        const li = el.closest && el.closest("li, .uk-accordion > *, [class*='accordion']");
        return !!(li && li.querySelector && li.querySelector("[class*='accordion-content']"));
      } catch (e) { return false; }
    };

    for (const el of deepQueryAll('[aria-expanded="false"], [aria-haspopup], summary, button, [role="button"],'
      + ' .uk-accordion-title, [class*="accordion-title"], [id^="uk-accordion"], a[href="#"]')) {
      if (seen.has(el) || !isVisible(el)) continue;
      const label = rawLabelOf(el);
      const expanded = el.getAttribute && el.getAttribute("aria-expanded");
      const accordion = isAccordion(el);
      const says = expanded === "false" || (el.getAttribute && el.getAttribute("aria-haspopup"))
        || tagOf(el) === "summary" || accordion;
      const related = relatedTo(label);
      if (!says && !related && !(label && NAMES.test(label))) continue;
      seen.add(el);
      out.push({
        label: (label || tagOf(el)).slice(0, 60),
        selector: cssPath(el),
        // A stated one is worth trying before a guess from its wording.
        stated: !!says,
        // But one named after what was actually asked for beats both: on a
        // page of forty panels, the three tried at random are never the one.
        related,
        // Named for holding controls rather than for its own subject -
        // "Layers", "Filters", "Options". Worth opening for anything,
        // where "Shortcuts" or "Forecasts and Outlooks" is worth opening
        // only if the instruction mentions it.
        generic: !!(label && NAMES.test(label)),
      });
    }
    const rank = (d) => (d.related ? 2 : 0) + (d.stated ? 1 : 0);
    return {
      count: out.length,
      disclosures: out.sort((a, b) => rank(b) - rank(a)).slice(0, limit),
    };
  }

  // Press it, wait, and say what appeared.
  async function openDisclosure(selector) {
    const el = deepQuery(selector);
    if (!el) throw new Error(`no such control: ${selector}`);
    const before = inventory({ includeHidden: true }).controlCount;
    realClick(el);
    await settle({ quietMs: 150, timeoutMs: 2000 });
    const after = inventory({ includeHidden: true });
    return {
      opened: rawLabelOf(el).slice(0, 60) || selector,
      controlsBefore: before, controlsAfter: after.controlCount,
      appeared: after.controlCount - before,
    };
  }

  // The points on a map that has no points to click.
  //
  // USGS draws its national dashboard to a canvas, so mapFeatures() finds a
  // toggle button and nothing else - there is no marker element for Salmon
  // River because there is no element at all. But the map is drawn from a
  // feed, and that feed is captured: CurrentConditions carries SiteName,
  // SiteNumber, Latitude and Longitude for every gauge on the screen.
  //
  // So a named point is reachable even where clicking one is not. Nothing
  // here knows anything about USGS: it looks for records carrying a name and
  // a coordinate pair, whatever a given site happens to call those fields.
  const NAME_KEYS = /^(sitename|name|label|title|station_?nm|monitoringlocationname|camname|placename|stationname|description)$/i;
  const LAT_KEYS = /^(lat|latitude|y|dec_lat_va)$/i;
  const LON_KEYS = /^(lon|lng|long|longitude|x|dec_long_va)$/i;
  const ID_KEYS = /^(sitenumber|siteid|id|site_no|nwisid|gaugeid|code)$/i;

  function capturedPoints({ limit = 4000 } = {}) {
    const out = [];
    const seen = new Set();
    const consider = (o) => {
      if (!o || typeof o !== "object" || Array.isArray(o)) return;
      let name = null, lat = null, lon = null, ident = null;
      for (const [k, v] of Object.entries(o)) {
        if (v === null || typeof v === "object") continue;
        if (name === null && NAME_KEYS.test(k) && String(v).trim().length > 2) name = String(v).trim();
        else if (lat === null && LAT_KEYS.test(k) && isFinite(Number(v))) lat = Number(v);
        else if (lon === null && LON_KEYS.test(k) && isFinite(Number(v))) lon = Number(v);
        else if (ident === null && ID_KEYS.test(k)) ident = String(v);
      }
      if (!name || lat === null || lon === null) return;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
      const key = `${name}|${lat}|${lon}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name: name.slice(0, 90), lat, lon, id: ident || undefined });
    };
    const walk = (node, depth) => {
      if (out.length >= limit || depth > 6 || !node || typeof node !== "object") return;
      if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
      consider(node);
      for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, depth + 1);
    };
    // Bodies are kept to a size, so a big feed arrives cut off mid-object and
    // will not parse - which is every feed worth reading here: the USGS
    // dashboard's gauge list is far past the limit. Where the JSON is whole,
    // walk it; where it is truncated, read the text, which does not care
    // that the last record is missing its closing brace.
    const fromText = (text) => {
      const re = /"([A-Za-z_]*(?:name|title|label|nm)[A-Za-z_]*)"\s*:\s*"([^"\\]{3,90})"/gi;
      let m;
      while ((m = re.exec(text)) && out.length < limit) {
        const name = m[2].trim();
        if (!name || /^https?:/i.test(name)) continue;
        const window = text.slice(Math.max(0, m.index - 400), m.index + 400);
        const lat = window.match(/"(?:lat|latitude|dec_lat_va)"\s*:\s*"?(-?\d{1,3}\.\d+)"?/i);
        const lon = window.match(/"(?:lon|lng|long|longitude|dec_long_va)"\s*:\s*"?(-?\d{1,3}\.\d+)"?/i);
        if (!lat || !lon) continue;
        const la = Number(lat[1]), lo = Number(lon[1]);
        if (Math.abs(la) > 90 || Math.abs(lo) > 180) continue;
        const key = `${name}|${la}|${lo}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const id = window.match(/"(?:siteNumber|site_no|siteId|nwisId|id)"\s*:\s*"?([A-Za-z0-9_-]{3,24})"?/i);
        out.push({ name: name.slice(0, 90), lat: la, lon: lo, id: id ? id[1] : undefined });
      }
    };
    for (const feed of (capturedFeeds({ includeBodies: true }).feeds || [])) {
      const body = feed.body;
      if (typeof body === "string") {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { /* truncated */ }
        if (parsed) walk(parsed, 0); else fromText(body);
      } else if (body && typeof body === "object") walk(body, 0);
      if (out.length >= limit) break;
    }
    return { count: out.length, points: out };
  }

  // The one whose name was asked for. Scored rather than matched exactly,
  // because a gauge is written "SALMON RIVER AT WHITE BIRD ID" and nobody
  // types that.
  function findCapturedPoint(wanted) {
    const words = norm(wanted).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (!words.length) return null;
    let best = null, bestScore = 0;
    for (const p of capturedPoints().points) {
      const hay = norm(p.name);
      let score = 0;
      for (const w of words) if (hay.includes(w)) score += 1;
      if (score === words.length) score += 2;          // every word named
      if (score > bestScore) { best = p; bestScore = score; }
    }
    return bestScore >= words.length ? best : null;
  }

  function mapFeatureOpen(index) {
    const found = mapFeatures({ limit: 200 });
    const feature = (found.features || [])[index];
    if (!feature) throw new Error(`no map feature at ${index} (this map has ${(found.features || []).length})`);
    if (feature.selector) {
      const el = deepQuery(feature.selector);
      if (el) { realClick(el); return { clicked: feature.label, via: "marker" }; }
    }
    // No element: ask the map itself.
    const info = mapInfo();
    const map = info.instance || (window.L && window.L.__wcMap) || null;
    if (map && feature.lat != null && typeof map.setView === "function") {
      map.setView([feature.lat, feature.lon], Math.max(map.getZoom ? map.getZoom() : 8, 10));
      if (typeof map.openPopup === "function" && feature.popup) map.openPopup(feature.popup);
      return { movedTo: feature.label || `${feature.lat}, ${feature.lon}`, via: "map instance" };
    }
    throw new Error(`"${feature.label || "that point"}" is drawn by the map, not placed in the page, and this map exposes no way to open it`);
  }

  // Reach a point the map drew rather than placed. Pans the map where the
  // page exposes an instance, and reports the point either way - a name, a
  // coordinate and whatever the feed called its id is an answer even when
  // nothing can be pressed, which on a canvas map is the usual case.
  function openCapturedPoint(name) {
    const point = findCapturedPoint(name);
    if (!point) return { found: false, asked: name };
    const info = mapInfo();
    const map = info.instance || (window.L && window.L.__wcMap) || null;
    let moved = false;
    try {
      if (map && typeof map.setView === "function") {
        map.setView([point.lat, point.lon], Math.max(map.getZoom ? map.getZoom() : 8, 10));
        moved = true;
      } else if (map && typeof map.flyTo === "function") {
        map.flyTo({ center: [point.lon, point.lat], zoom: 10 }); moved = true;
      } else if (map && typeof map.setCenter === "function") {
        map.setCenter([point.lon, point.lat]); moved = true;
      }
    } catch (e) { /* a map that will not move is still a point worth reporting */ }
    return { found: true, ...point, movedMap: moved };
  }

  const READERS = [
    { name: "readThisPage", description: "Read what this page currently shows: its tables, labelled values, readouts and headings, as structured data.", run: () => readPage() },
    { name: "listPageControls", description: "List every control on this page with its label and kind - useful for deciding what to do next.", run: () => inventory() },
    { name: "listPageDataRequests", description: "List the data requests this page has made, which is where a chart's real numbers come from when the chart is a canvas.", run: () => capturedFeeds() },
    { name: "findMapPoint", description: "Find a named point on this page's map - a gauge, station or site - by name, using the data the map itself was drawn from. Works where the map is a canvas and its points cannot be clicked.", run: () => capturedPoints({ limit: 40 }) },
    { name: "readMapPoints", description: "Read the points on this page's map - their names, coordinates and data - whether they are real elements or drawn by the map library.", run: () => mapFeatures() },
  ];

  // The descriptors, built without touching navigator/document.modelContext.
  //
  // Registration needs that API and most browsers do not have it yet, but the
  // descriptors are useful with or without it: they are what a model should be
  // choosing between. Deriving them separately means a local model gets named,
  // schema'd tools on any browser, and registration becomes the extra step it
  // actually is rather than a precondition.
  const PAGE_TOOLS = new Map();

  // The cap used to be 40, applied in DOM order - so on a federal site whose
  // header carries fifty branding links, every real control was cut before
  // anything looked at it, and "click national hydrologic discussion" found
  // only the banner. Descriptors are cheap objects; the caps that matter are
  // the model's list, which agentTools ranks before trimming, and
  // registration, which stays small on purpose.
  function pageToolDescriptors({ max = 250 } = {}) {
    PAGE_TOOLS.clear();
    const out = [];
    const add = (name, description, inputSchema, execute) => {
      if (PAGE_TOOLS.has(name)) return;
      PAGE_TOOLS.set(name, { name, description, inputSchema, execute });
      out.push({ name, description, inputSchema });
    };

    for (const r of READERS) {
      add(r.name, r.description, { type: "object", properties: {} }, async () => r.run());
    }
    // Hidden controls included: a checkbox behind a closed panel is a
    // control an agent should be able to use, and its runner opens the
    // panel first. Visible ones still come first, since a page usually
    // means what it is showing.
    const inv = inventory({ includeHidden: true });
    const usable = (inv.controls || [])
      // Disabled is not a tool. Offering one means an agent calls it, the
      // click lands on nothing, and the result reports success - the exact
      // shape of wrong answer this project keeps removing.
      .filter((c) => c.label && c.selector && c.confidence !== "low" && !c.disabled)
      .sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0))
      .slice(0, max);
    for (const c of usable) {
      add(toolName(c.label, verbFor(c)),
        `${c.label} - ${c.kind || "control"} on this page`.slice(0, 160),
        schemaFor(c), runnerFor(c));
    }
    // Each named point on the map, as its own tool. Same shape as a control:
    // named after itself, no selector in the schema, runner knows how to
    // reach it.
    let points = [];
    try { points = (mapFeatures({ limit: 40 }).features || []).filter((f) => f.label); }
    catch (e) { points = []; }
    points.slice(0, 20).forEach((f, i) => {
      const index = (mapFeatures({ limit: 40 }).features || []).indexOf(f);
      add(toolName(f.label, "open"),
        `${String(f.label).slice(0, 80)} - a point on this page's map`,
        { type: "object", properties: {} },
        async () => mapFeatureOpen(index === -1 ? i : index));
    });

    return { tools: out, fromControls: usable.length, mapPoints: points.length, url: location.href };
  }

  // Run one by name. The selector never left this file, so a caller - model
  // or agent - names the thing it wants and nothing else.
  // A real implementation may hand back the MCP content envelope rather than
  // whatever the tool returned. The runners report a control's own before and
  // after, and verification depends on those fields surviving the trip.
  const unwrapMcp = (out) => {
    if (!out || typeof out !== "object" || !Array.isArray(out.content)) return out;
    const text = out.content.map((c) => c && c.text).filter(Boolean).join("\n");
    if (!text) return out;
    try { return JSON.parse(text); } catch (e) { return { text }; }
  };

  async function pageToolCall(name, args) {
    if (!PAGE_TOOLS.size) pageToolDescriptors();
    const tool = PAGE_TOOLS.get(name);
    if (!tool) {
      throw new Error(`no tool named "${name}" on this page (have: ${[...PAGE_TOOLS.keys()].slice(0, 8).join(", ")}...)`);
    }

    // Drive the page through the documented interface rather than around it.
    // The tools were published to modelContext and then never used: every
    // action went down a private path, so the protocol was a claim we made
    // rather than one we relied on, and a fault in the published tools would
    // have surfaced in somebody else's agent instead of in our own testing.
    // Going through it means our own driving is the proof that anyone else's
    // works.
    //
    // Never at the cost of the action itself. If the API is missing, has not
    // been given this tool, or throws, the direct call still happens - a
    // protocol that cannot be relied on is not a reason to fail a click.
    const api = mcpApi();
    if (api && typeof api.executeTool === "function"
        && MCP_REGISTRY.some((t) => t.name === name)) {
      try {
        const out = unwrapMcp(await api.executeTool(name, JSON.stringify(args || {})));
        if (out && typeof out === "object") return { ...out, ranVia: `${mcpApiName()}.executeTool` };
        return out;
      } catch (e) { /* fall through to the direct call */ }
    }
    return tool.execute(args || {});
  }

  // Everything the page offers, not the first forty. The cap was borrowed
  // from what a model can be shown at once, which is a different thing
  // entirely: a registry is not a prompt, and an agent reading this page
  // should see what the page can do rather than an arbitrary slice of it.
  // Live on water.noaa.gov that slice was 91 of 160, and only 91 because
  // several passes each added another forty.
  function mcpPublishControls({ max = 250 } = {}) {
    // Provide the surface if nothing else does. Without this, every derived
    // tool stayed private to the extension on every browser that ships no
    // modelContext - which is all of them but Edge.
    const installed = mcpInstall();
    const api = mcpApi();
    if (!api || typeof api.registerTool !== "function") {
      return { registered: 0, note: `this browser has no ${mcpApiName()}.registerTool` };
    }
    const taken = new Set(MCP_REGISTRY.map((t) => t.name));
    const names = [];
    const add = (def) => {
      if (taken.has(def.name)) return;
      try {
        def.declaredBy = "extension";
        api.registerTool(def);
        // The registry belongs to registerTool. Where that is the polyfill
        // it has already recorded this - pushing again put every tool in
        // twice, which a cap of forty kept small enough never to notice:
        // 105 tools published, 210 listed back.
        if (!MCP_REGISTRY.some((t) => t.name === def.name)) MCP_REGISTRY.push(def);
        taken.add(def.name);
        names.push(def.name);
      } catch (e) { /* duplicate or rejected schema - keep going */ }
    };

    // Same descriptors the model is offered, so the two can never drift.
    // Built at full size, not at the publishing cap: pageToolDescriptors
    // clears and rebuilds the callable set, so asking it for 40 tools here
    // deleted the other 210 - "click archive" stopped existing the moment
    // publishing began to succeed. What gets registered is capped; what the
    // page can do is not.
    const built = pageToolDescriptors();
    for (const d of built.tools.slice(0, max)) {
      const impl = PAGE_TOOLS.get(d.name);
      add({ name: d.name, description: d.description, inputSchema: d.inputSchema, execute: impl.execute });
    }
    return {
      registered: names.length, names, fromControls: built.fromControls,
      via: mcpApiName(),
      polyfilled: !!(installed && installed.installed),
      note: installed && installed.installed
        ? "this browser ships no modelContext, so the standard surface was provided"
        : "",
    };
  }

  function readPage() {
    const chart = readChartText();
    const tables = readTables();
    const pairs = readPairs();
    const readouts = readReadouts();
    // A bounded sample of the page's own text. Some pages state their subject
    // in prose rather than a heading - "0 miles N of Hermantown, MN" - and
    // without this there is no way to tell such a page is about that place.
    const bodyText = textOf(document.body || document.documentElement).slice(0, 4000);

    return {
      url: location.href,
      title: document.title,
      text: bodyText,
      headings: deepQueryAll("h1, h2").filter(isVisible).map(textOf).filter(Boolean).slice(0, 12),
      tables,
      pairs,
      readouts,
      labelledNumbers: readLabelledNumbers(),
      chart,
      // Said plainly, because "found nothing" and "the data is painted onto a
      // canvas and cannot be read from the DOM at all" are different answers.
      note: !tables.length && !pairs.length && !readouts.length && !chart.svgCharts.length && chart.canvasCount
        ? `no readable data in the DOM - this page draws to ${chart.canvasCount} canvas element(s), whose contents are pixels, not elements`
        : undefined,
    };
  }

  const GENERIC = {
    inventory,
    readPage,
    submit,
    waitForSelector,
    readControl,
    restore,
    goBack,
    scrollToElement,
    settle,
    pageSignature,
    signatureDiff,
    hoverSeries,
    mapFeatures,
    readUrl,
    pageLinks,
    capturedFeeds,
    capturedFeed,
    mapInfo,
    // What was clicked, in words. realClick hands back the element because
    // callers inside this file use it; nothing outside can receive one.
    click: (selector) => {
      // A click was the one primitive with nothing to report, which is why
      // "it worked and there was nothing left to change" and "it silently
      // failed" reached the caller as the same observation - and why three
      // separate reports blamed the model for actions it had got right.
      //
      // A link or a plain button genuinely has no state, and this does not
      // invent one for them. But a disclosure, a toggle button, a tab and a
      // details element all carry theirs on the element being clicked, and
      // that is most of what a government site is built from.
      // aria-expanded first, and marked, because opening a thing is not the
      // same as doing the thing. A press that expands an accordion changes
      // the page and reports its own state honestly, and a caller reading
      // only "it changed" would call the job done having switched nothing
      // on - which is how "click flood inundation" reports success while
      // the layer stays off, three levels down inside the panel it opened.
      const STATEFUL = ["aria-expanded", "aria-pressed", "aria-selected", "aria-checked"];
      const isDoor = (n) => !!(n && n.getAttribute
        && (n.getAttribute("aria-expanded") !== null
          || String(n.tagName || "").toLowerCase() === "summary"));
      const stateOf = (n) => {
        if (!n || !n.getAttribute) return undefined;
        for (const a of STATEFUL) {
          const v = n.getAttribute(a);
          if (v !== null && v !== undefined) return v;
        }
        const tag = String(n.tagName || "").toLowerCase();
        if (tag === "details") return String(!!n.open);
        // The state of a <details> lives on the parent, while the thing
        // anyone clicks is its <summary>.
        if (tag === "summary" && n.parentElement
          && String(n.parentElement.tagName || "").toLowerCase() === "details") {
          return String(!!n.parentElement.open);
        }
        if ((n.type === "checkbox" || n.type === "radio") && typeof n.checked === "boolean") {
          return String(n.checked);
        }
        return undefined;
      };
      const before = typeof selector === "string" ? deepQuery(selector) : selector;
      const was = stateOf(before);
      const el = realClick(before || selector);
      const now = stateOf(before);
      return {
        clicked: String(el.tagName || "").toLowerCase(),
        label: String(el.textContent || el.value || "").trim().slice(0, 80) || undefined,
        ...(was === undefined ? {} : {
          control: rawLabelOf(before) || undefined,
          was, now, itChanged: was !== now, how: "click",
          // Said out loud so a caller need not infer it from the attribute.
          ...(isDoor(before) ? { opened: was !== now } : {}),
        }),
      };
    },
    clickText: (text) => clickByText(text),
    fill: (selector, text) => fill(selector, text),
    selectOption: (selector, valueOrText) => setSelect(selector, valueOrText),
    mcpInfo, mcpTools, mcpCall, mcpRegister, mcpPublishControls, capturedSeries,
    disclosures, openDisclosure,
    pageTools: pageToolDescriptors, pageToolCall, searchTargets, searchUrl,
    capturedPoints, findCapturedPoint, openCapturedPoint,
    mcpInstall,
    check: (selector, on = true) => setChecked(selector, on),
    pickRadio: (nameOrAnything, valueOrLabel) => pickRadio(nameOrAnything, valueOrLabel),
  };

  window.WC = WC;
  window.GENERIC = GENERIC;
  console.log("%cLoaded  window.WC  +  window.GENERIC  (no manifest needed)", "color:green;font-weight:bold");
  console.log([
    "GENERIC tools:",
    "  inventory()                          every control on the page, deduplicated, with selectors",
    "  mapInfo()                             is there a map, and can it be driven",
    "  click(selector)  /  clickText('Download')",
    "  fill(selector, 'text')",
    "  selectOption(selector, 'value or visible text')",
    "  check(selector, true|false)",
    "  pickRadio(nameOrAnything, 'value or label')",
  ].join("\n"));
})();

/* ---------- bridge: lets the extension call this page's manifest functions ----------
 * This file runs in the page's own JS context (the "MAIN world"), so it can see
 * window.GENERIC above, but it has no access to chrome.* APIs. It talks out via
 * postMessage; a content script in the isolated world relays that to the extension
 * background script. Function lookup walks every manifest global present, so
 * injecting a named manifest and GENERIC together works.
 */
// Replace, do not skip. A boolean guard meant a tab that was already open
// kept the bridge from whichever build first touched it: reloading the
// extension replaced window.GENERIC but left the old listener in place, so
// any fix to the bridge itself silently did not apply until the page was
// reloaded too. That is invisible from the outside and looks exactly like a
// fix that did not work.
if (window.__wcPageBridge) {
  window.removeEventListener("message", window.__wcPageBridge);
}
{
  window.__wcPageBridgeInstalled = true;

  // postMessage structured-clones its payload, and a DOM node cannot be
  // cloned. click() returns the element it clicked, so a click that worked
  // perfectly came back as "HTMLAnchorElement object could not be cloned" -
  // an action reported as a failure after it had already happened, which is
  // the one error people retry until they break something.
  //
  // Guarded here rather than at each call site so nothing a manifest returns,
  // now or later, can fail on the way home.
  const describeNode = (n) => ({
    element: String(n.tagName || "node").toLowerCase(),
    text: String(n.textContent || "").trim().slice(0, 80) || undefined,
    id: n.id || undefined,
    href: n.href || undefined,
  });
  const postable = (v) => {
    if (v == null || typeof v !== "object") return v;
    if (typeof Node !== "undefined" && v instanceof Node) return describeNode(v);
    try {
      if (typeof structuredClone === "function") structuredClone(v);
      return v;
    } catch (e) {
      if (Array.isArray(v)) return v.map(postable);
      const out = {};
      for (const k of Object.keys(v)) { try { out[k] = postable(v[k]); } catch (e2) { out[k] = String(v[k]); } }
      return out;
    }
  };
  window.__wcPageBridge = async (e) => {
    if (e.source !== window) return;
    if (!e.data || e.data.channel !== "web-controls-req") return;
    const { id, fn, args } = e.data;
    try {
      // Named manifests first: a hand-written, verified implementation beats
      // GENERIC's selector-driven fallback whenever both expose the same name.
      const names = ["USGS", "SITE", "NOAA", "FCP", "GENERIC"];
      const owner = names
        .map((n) => window[n])
        .find((t) => t && typeof t[fn] === "function");
      if (!owner) throw new Error(`${fn} is not a function on any manifest loaded here (tried ${names.join(", ")})`);
      const result = await owner[fn](...(args || []));
      window.postMessage({ channel: "web-controls-res", id, ok: true, result: postable(result) }, "*");
    } catch (err) {
      window.postMessage({ channel: "web-controls-res", id, ok: false, error: String((err && err.message) || err) }, "*");
    }
  };
  window.addEventListener("message", window.__wcPageBridge);
}
