/* Control inventory v2. Works on any web page.
 * Paste into the DevTools console on the live page.
 * Collapses repeated list/row controls into single patterns with a count.
 *   window.__controls -> every control found
 *   window.__groups   -> collapsed distinct patterns
 * Also copies a summary JSON to the clipboard.
 */
(() => {
  // walk DOM including shadow roots
  function* walk(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let n = tw.currentNode;
    while (n) { yield n; if (n.shadowRoot) yield* walk(n.shadowRoot); n = tw.nextNode(); }
  }

  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  const rprops = (el) => {
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
  const jsHandler = (el) => {
    if (el.hasAttribute("onclick")) return true;
    const p = rprops(el);
    if (p && (p.onClick || p.onChange || p.onInput)) return true;
    try {
      if (typeof getEventListeners === "function") {
        const ev = getEventListeners(el);
        if (ev && (ev.click || ev.pointerdown || ev.mousedown)) return true;
      }
    } catch (e) { /* not running in a console that provides it */ }
    return false;
  };
  // Weaker, framework-agnostic fallback that works everywhere: anything
  // styled to look clickable probably is, even if nothing above caught its
  // handler. Trades some false positives (decorative hover styles) for
  // catching handlers no attribute or prop inspection can see. Excludes SVG
  // graphics primitives: found live on water.noaa.gov that an icon's <svg>/
  // <path>/<line> inherit "pointer" from their already-captured clickable
  // parent button, so counting them too just duplicates that one real
  // control under three more entries instead of finding anything new.
  const GRAPHIC_TAGS = new Set(["svg", "path", "line", "circle", "rect", "polygon", "polyline", "g", "ellipse", "use"]);
  const looksClickable = (el) => {
    if (GRAPHIC_TAGS.has(el.tagName.toLowerCase())) return false;
    try { return getComputedStyle(el).cursor === "pointer"; } catch (e) { return false; }
  };

  // Same extraction order as WC.rawLabelOf in web-controls.js and the other
  // manifest files. Keep them all in sync, so a control reads the same
  // whether you're discovering it here or scripting it there. This one keeps
  // original case and caps the length for a readable console.table; WC's
  // version lowercases it instead, for matching.
  function label(el) {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const a = el.getAttribute("aria-label");
    if (a) return clean(a);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const root = el.getRootNode();
      const t = lb.split(/\s+/)
        .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
        .filter(Boolean).map((n) => n.textContent).join(" ");
      if (clean(t)) return clean(t);
    }
    if (el.labels && el.labels[0]) return clean(el.labels[0].textContent);
    if (el.id) {
      const root = el.getRootNode();
      const l = root.querySelector && root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return clean(l.textContent);
    }
    const w = el.closest("label");
    if (w) return clean(w.textContent);
    return clean(el.placeholder || el.title || el.name || el.textContent || "").slice(0, 80);
  }

  function cssPath(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let s = cur.tagName.toLowerCase();
      if (cur.classList.length) s += "." + [...cur.classList].map((c) => CSS.escape(c)).join(".");
      const p = cur.parentNode;
      if (p && p.children) {
        const sib = [...p.children].filter((c) => c.tagName === cur.tagName);
        if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(cur) + 1})`;
      }
      parts.unshift(s);
      cur = p instanceof ShadowRoot ? p.host : p;
    }
    return parts.join(" > ");
  }

  // normalize dynamic bits so repeated rows share a signature. Only strips
  // runs of 3+ digits (site ids, most numeric codes) in the final catch-all,
  // not shorter ones: found live on drought.gov that stripping every digit
  // collapsed a 1-10 rating-scale survey's radio buttons ("2".."9") into one
  // signature, since they all normalized to the same bare "#" with nothing
  // else to tell them apart, silently hiding 7 real, distinct options.
  const norm = (s) => (s || "")
    .replace(/USGS-?\d+/g, "#ID")
    .replace(/\d{4}-\d{2}-\d{2}/g, "#DATE")
    .replace(/\d{3,}/g, "#")
    .trim();

  const TAGS = ["select", "input", "textarea", "button", "a", "summary", "details"];
  const ROLES = ["button", "link", "combobox", "listbox", "option", "tab", "checkbox",
    "radio", "switch", "menuitem", "menuitemcheckbox", "slider", "searchbox", "spinbutton"];

  const seen = new Set();
  const all = [];
  for (const el of walk(document.documentElement)) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const tabbable = el.getAttribute("tabindex") !== null && el.tabIndex >= 0;
    if (!(TAGS.includes(tag) || (role && ROLES.includes(role)) || tabbable || jsHandler(el) || looksClickable(el))) continue;
    if (seen.has(el) || !vis(el)) continue;
    seen.add(el);

    const lab = label(el);
    const rec = {
      kind: role || tag, tag, type: el.type || "", label: lab,
      name: el.name || "", id: el.id || "", value: (el.value ?? "").toString().slice(0, 60),
      checked: (el.type === "checkbox" || el.type === "radio") ? !!el.checked : "",
      inShadow: el.getRootNode() instanceof ShadowRoot, selector: cssPath(el),
      href: tag === "a" ? (el.getAttribute("href") || "(js)") : "",
      dateLike: el.type === "date" || /date|calendar|mm\/dd|yyyy|time period|day range/i.test(lab + " " + el.name + " " + el.id) || undefined,
    };
    if (tag === "select") rec.options = [...el.options].map((o) => ({ value: o.value, text: o.text.trim(), selected: o.selected }));
    rec._sig = [rec.kind, rec.type, norm(lab), rec.name, norm(rec.href)].join("|");
    all.push(rec);
  }

  // collapse by signature
  const bySig = new Map();
  for (const r of all) {
    if (!bySig.has(r._sig)) bySig.set(r._sig, []);
    bySig.get(r._sig).push(r);
  }
  const groups = [...bySig.values()].map((rows) => {
    const r = rows[0];
    return {
      count: rows.length, kind: r.kind, tag: r.tag, type: r.type, label: r.label,
      name: r.name, dateLike: r.dateLike || "", sampleSelector: r.selector, sampleHref: r.href,
    };
  }).sort((a, b) => a.count - b.count);

  window.__controls = all;
  window.__groups = groups;

  const pageControls = groups.filter((g) => g.count <= 3);
  const repeated = groups.filter((g) => g.count > 3);

  console.log(`%c${all.length} controls  ->  ${groups.length} distinct patterns`, "font-weight:bold;font-size:13px");
  console.log("%cPAGE-LEVEL controls (appear <=3x)", "font-weight:bold;color:#06c");
  console.table(pageControls);
  console.log("%cREPEATED list/row controls (collapsed, count = how many)", "font-weight:bold;color:#06c");
  console.table(repeated);

  // radio / checkbox groups
  const rg = {};
  all.forEach((r) => {
    if ((r.type === "radio" || r.type === "checkbox") && r.name) {
      (rg[r.name] ||= []).push({ label: r.label, value: r.value, checked: r.checked, selector: r.selector });
    }
  });
  Object.entries(rg).forEach(([name, opts]) => {
    if (opts.length > 12) { console.log(`radio/checkbox group "${name}": ${opts.length} options (list-like, skipped)`); return; }
    console.log(`%cgroup "${name}"`, "font-weight:bold;color:#690");
    console.table(opts);
  });

  all.forEach((r) => {
    if (r.options) { console.log(`%cSELECT ${r.label || r.name}`, "font-weight:bold;color:#690"); console.table(r.options); }
  });

  try {
    copy(JSON.stringify({ pageControls, repeated, radioGroups: rg }, null, 2));
    console.log("%cSummary JSON copied to clipboard.", "color:green");
  } catch (e) {
    console.log("copy() blocked. Read window.__groups manually.");
  }
  return groups;
})();
