/* frame/agent.js - runs inside every page the viewer shows.
 *
 * The server puts it first in <head> (see server.js, which also hands it
 * WC_SHELL_ORIGIN, WC_PROXY_HOST and WCProxyUrl). Three jobs:
 *
 *   1. Keep the site inside the proxy. Its requests and navigations to its
 *      own or other sites are pointed at their proxied addresses, so it
 *      neither breaks on CORS nor escapes the frame.
 *   2. Tell the viewer where the page is (the real URL) and when it changes.
 *   3. Carry out commands from the viewer: a command is data,
 *      { action: "select", option: "Alaska" }, and the reply is
 *      { message, details? }.
 *
 * The executor follows the same ideas as the extension's WC/GENERIC layer -
 * find a control by what a person would call it, then operate it the way a
 * person would - written small, for this app alone.
 */
window.__wcFrame = true;
const urls = WCProxyUrl.create(WC_PROXY_HOST, location.protocol);

// --- 1. staying inside the proxy -----------------------------------------

// The proxied address for any http(s) URL that is not one already, or null
// when it should be left alone.
function route(url) {
  let abs;
  try { abs = new URL(url, document.baseURI); } catch (e) { return null; }
  if (!/^https?:$/.test(abs.protocol) || abs.origin === WC_SHELL_ORIGIN || urls.isProxy(abs.href)) return null;
  return urls.toProxy(abs.href);
}

const nativeFetch = window.fetch;
if (nativeFetch) {
  window.fetch = function (input, init) {
    try {
      if (typeof Request !== "undefined" && input instanceof Request) {
        const to = route(input.url);
        if (to) input = new Request(to, input);
      } else {
        const to = route(String(input));
        if (to) input = to;
      }
    } catch (e) { /* sent as the page wrote it */ }
    return nativeFetch.call(window, input, init);
  };
}

const nativeOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  try { const to = route(String(url)); if (to) url = to; } catch (e) { /* as written */ }
  return nativeOpen.call(this, method, url, ...rest);
};

// Scripts from services that check the asking site's address (see
// REFERRER_CHECKED) go through the proxy. Google Maps adds its scripts by
// setting src on a new <script>, one after another, so the setter is where
// to catch them; the <script> tags already in the page's HTML are rewritten
// by the server.
const CHECKED_HOSTS = new Set(WCProxyUrl.REFERRER_CHECKED);
const viaProxyIfChecked = (value) => {
  try {
    const u = new URL(String(value), document.baseURI);
    return (CHECKED_HOSTS.has(u.hostname) && urls.toProxy(u.href)) || value;
  } catch (e) { return value; }
};
const scriptSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
if (scriptSrc && scriptSrc.set) {
  Object.defineProperty(HTMLScriptElement.prototype, "src", {
    ...scriptSrc,
    set(value) { scriptSrc.set.call(this, viaProxyIfChecked(value)); },
  });
}
const nativeSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  if (this instanceof HTMLScriptElement && String(name).toLowerCase() === "src") value = viaProxyIfChecked(value);
  return nativeSetAttribute.call(this, name, value);
};

// A form's POST body is lost if its navigation is redirected afterwards, so
// its action is pointed at the proxy before it is sent.
const fixForm = (form) => {
  if (!form || form.tagName !== "FORM") return;
  const to = route(form.action);
  if (to) form.setAttribute("action", to);
};
window.addEventListener("submit", (e) => fixForm(e.target), true);
const nativeSubmit = HTMLFormElement.prototype.submit;
HTMLFormElement.prototype.submit = function () { fixForm(this); return nativeSubmit.call(this); };

// Links and scripted navigations (location.href = ...) that would leave the
// proxy. The Navigation API sees all of them; where it is missing, clicks on
// links are the common case and are caught below.
if (window.navigation && typeof window.navigation.addEventListener === "function") {
  window.navigation.addEventListener("navigate", (e) => {
    if (!e.cancelable || e.downloadRequest != null || e.formData) return;
    const to = route(e.destination.url);
    if (!to) return;
    e.preventDefault();
    location.assign(to);
  });
}

// New tabs and windows, and links aimed at the viewer itself (_top), open in
// the frame instead: a page outside it is a page the agent cannot reach.
window.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.composedPath().find((n) => n && (n.tagName === "A" || n.tagName === "AREA") && n.href);
  if (!a || a.hasAttribute("download")) return;
  const target = (a.getAttribute("target") || "").toLowerCase();
  const leaves = target && target !== "_self";
  const to = route(a.href);
  if (!leaves && !(to && !window.navigation)) return;
  const dest = to || a.href;
  if (!/^https?:/i.test(dest)) return;
  e.preventDefault();
  location.assign(dest);
});

const nativeWindowOpen = window.open;
window.open = function (url, ...rest) {
  if (url) {
    const to = route(String(url)) || (() => { try { return new URL(url, document.baseURI).href; } catch (e) { return null; } })();
    if (to && /^https?:/.test(to)) { location.assign(to); return null; }
  }
  return nativeWindowOpen.call(window, url, ...rest);
};

// --- 2. telling the viewer where we are -----------------------------------

// Only the page directly inside the viewer reports. The site's own iframes
// get this script too, and stay quiet.
const isViewerFrame = window.parent !== window && window.parent === window.top;
const post = (msg) => {
  if (isViewerFrame) window.parent.postMessage({ source: "wc-frame", ...msg }, WC_SHELL_ORIGIN);
};
const report = (status) => post({ type: "page", url: urls.toReal(location.href), title: document.title, status });

report(document.readyState === "loading" ? "loading" : "complete");
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => report("complete"), { once: true });
window.addEventListener("load", () => report("complete"));
for (const name of ["pushState", "replaceState"]) {
  const original = history[name];
  history[name] = function (...args) {
    const out = original.apply(this, args);
    try { report("complete"); } catch (e) { /* never break the site's router */ }
    return out;
  };
}
window.addEventListener("popstate", () => report("complete"));
window.addEventListener("hashchange", () => report("complete"));
window.addEventListener("pagehide", () => post({ type: "leaving" }));

// --- 3. the executor ------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UI_ATTR = "data-wc-viewer";

const norm = (s) => String(s || "").toLowerCase()
  .replace(/[‘’]/g, "'")
  .replace(/[^a-z0-9%'.\-\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const clip = (s, n = 80) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// How well a control's name answers what the person said, 0-100. Whole
// words only: "all" is not in "Valley".
function score(label, query) {
  const a = norm(label);
  const b = norm(query);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const aw = ` ${a} `;
  const bw = ` ${b} `;
  if (aw.startsWith(bw)) return 85 - Math.min(25, (a.length - b.length) / 3);
  if (aw.includes(bw)) return 70 - Math.min(25, (a.length - b.length) / 6);
  if (bw.includes(aw) && a.length >= 3) return 55 - Math.min(20, (b.length - a.length) / 3);
  // A word begun: "Alask" for "Alaska".
  if (b.length >= 4 && a.startsWith(b)) return 45 - Math.min(15, (a.length - b.length) / 3);
  const have = new Set(a.split(" "));
  const want = b.split(" ").filter((t) => t.length > 1);
  if (!want.length) return 0;
  const hits = want.filter((t) => have.has(t)).length;
  return hits ? Math.round(45 * hits / Math.max(want.length, have.size)) : 0;
}

// Every element matching a selector, open shadow roots included.
function all(selector) {
  const out = [];
  const visit = (root) => {
    out.push(...root.querySelectorAll(selector));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.shadowRoot) visit(n.shadowRoot);
  };
  visit(document);
  return out.filter((el) => !el.closest(`[${UI_ATTR}]`));
}

function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}
// Styled checkboxes and radios hide the input itself and show its label.
const reachable = (el) => visible(el) || [...(el.labels || [])].some(visible);

const textOf = (el) => clip(el.innerText || el.textContent || "", 120);

// What a person would call this control.
function labelOf(el) {
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(textOf).join(" ");
    if (t.trim()) return clip(t);
  }
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return clip(aria);
  if (el.labels && el.labels.length) {
    const t = [...el.labels].map((l) => {
      const copy = l.cloneNode(true);
      copy.querySelectorAll("select, option, input, textarea").forEach((n) => n.remove());
      return copy.textContent;
    }).join(" ");
    if (t.trim()) return clip(t);
  }
  const tag = el.tagName;
  if (tag === "INPUT" && /^(submit|button|reset)$/i.test(el.type) && el.value) return clip(el.value);
  if (tag !== "SELECT" && tag !== "INPUT" && tag !== "TEXTAREA") {
    const t = textOf(el);
    if (t) return t;
    const img = el.querySelector("img[alt], svg title");
    if (img) return clip(img.getAttribute("alt") || img.textContent);
  }
  for (const attr of ["placeholder", "title", "name", "id"]) {
    const v = el.getAttribute(attr);
    if (v && v.trim()) return clip(v.replace(/[_-]+/g, " "));
  }
  // "State: [select]" - the text written just before it.
  const prev = el.previousElementSibling;
  if (prev && textOf(prev)) return clip(textOf(prev), 60);
  const parentText = el.parentElement ? textOf(el.parentElement).replace(textOf(el), "") : "";
  return clip(parentText, 60);
}

function best(candidates, query, labelFn = labelOf, min = 35) {
  let top = null;
  for (const el of candidates) {
    const s = score(labelFn(el), query);
    if (s >= min && (!top || s > top.score)) top = { el, score: s };
  }
  return top;
}

function nearMisses(candidates, query, n = 5) {
  return candidates.map((el) => ({ label: labelOf(el), s: score(labelOf(el), query) }))
    .filter((x) => x.label && x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.label);
}

function highlight(el) {
  try {
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.setAttribute(UI_ATTR, "");
    Object.assign(box.style, {
      position: "fixed", left: `${r.left - 4}px`, top: `${r.top - 4}px`,
      width: `${r.width + 8}px`, height: `${r.height + 8}px`,
      border: "3px solid #1a6fd1", borderRadius: "6px", background: "rgba(26,111,209,.12)",
      pointerEvents: "none", zIndex: "2147483647", transition: "opacity .4s",
    });
    document.documentElement.appendChild(box);
    setTimeout(() => { box.style.opacity = "0"; }, 1100);
    setTimeout(() => box.remove(), 1600);
  } catch (e) { /* only a cue */ }
}

async function show(el) {
  el.scrollIntoView({ block: "center", inline: "nearest" });
  await sleep(120);
  highlight(el);
}

// The events a real mouse makes, then the click itself, which is what runs
// a link's or button's default action.
//
// Aimed where a mouse would land: the topmost element at the centre, when
// that is inside the one meant. Events bubble up, never down, so a widget
// listening on an inner element (a dropdown's label span) never heard a
// mousedown sent to its outer box.
function realClick(el) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  let target = el;
  try {
    const root = el.getRootNode();
    const top = (root.elementFromPoint ? root.elementFromPoint(x, y) : null) || document.elementFromPoint(x, y);
    if (top && top !== el && el.contains(top)) target = top;
  } catch (e) { /* the element itself, then */ }
  const at = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: x, clientY: y };
  const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
  const P = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  target.dispatchEvent(new P("pointerover", pointer));
  target.dispatchEvent(new MouseEvent("mouseover", at));
  target.dispatchEvent(new P("pointerdown", pointer));
  target.dispatchEvent(new MouseEvent("mousedown", at));
  if (typeof el.focus === "function") el.focus({ preventScroll: true });
  target.dispatchEvent(new P("pointerup", pointer));
  target.dispatchEvent(new MouseEvent("mouseup", at));
  if (typeof target.click === "function") target.click();
  else target.dispatchEvent(new MouseEvent("click", at));
}

// Through the prototype's setter, so frameworks that watch the property
// (React's controlled inputs) see the change.
function setNativeValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype
    : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

function key(el, name) {
  const init = { key: name, code: name, keyCode: name === "Enter" ? 13 : name === "Escape" ? 27 : 0, bubbles: true, cancelable: true, composed: true };
  const down = new KeyboardEvent("keydown", init);
  el.dispatchEvent(down);
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return !down.defaultPrevented;
}

const CLICKABLE = [
  "a[href]", "button", "input[type=button]", "input[type=submit]", "input[type=reset]", "input[type=image]",
  "summary", "[role=button]", "[role=link]", "[role=tab]", "[role=menuitem]", "[role=menuitemcheckbox]",
  "[role=menuitemradio]", "[role=option]", "[role=switch]", "[role=treeitem]", "[onclick]",
].join(",");
const TEXT_FIELDS = "input:not([type]), input[type=text], input[type=search], input[type=email], input[type=number], input[type=tel], input[type=url], input[type=date], input[type=password], textarea, [contenteditable=''], [contenteditable=true], [role=textbox], [role=searchbox], [role=combobox]:not(select)";
const CHECKABLE = "input[type=checkbox], input[type=radio], [role=checkbox], [role=switch], [role=radio], [role=menuitemcheckbox]";

const clickables = () => all(CLICKABLE).filter(visible);
const selects = () => all("select").filter((s) => visible(s) && !s.disabled);
const textFields = () => all(TEXT_FIELDS).filter((el) => visible(el) && !el.disabled && !el.readOnly);
const checkables = () => all(CHECKABLE).filter((el) => reachable(el) && !el.disabled);

// Last resort: any visible text on the page, clicked where it is written.
// Plenty of sites put a click handler on a plain <div>.
function byWrittenText(query, min = 70) {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let top = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest(`[${UI_ATTR}], script, style, noscript`)) continue;
    const s = score(n.textContent, query);
    if (s >= min && (!top || s > top.score) && visible(el)) top = { el, score: s };
  }
  return top;
}

async function doClick({ target }) {
  if (!target) throw new Error("Click what?");
  const found = best(clickables(), target) || byWrittenText(target);
  if (!found) {
    const near = nearMisses(clickables(), target);
    throw new Error(`Couldn't find "${target}" to click.${near.length ? ` Closest: ${near.map((n) => `"${n}"`).join(", ")}.` : ""}`);
  }
  const label = labelOf(found.el) || textOf(found.el);
  await show(found.el);
  realClick(found.el);
  await sleep(300);
  return { message: `Clicked "${label}".` };
}

function chooseOption(sel, opt) {
  sel.focus({ preventScroll: true });
  if (sel.multiple) {
    opt.selected = true;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    setNativeValue(sel, opt.value);
  }
}

// Options inside custom dropdowns, once they are open.
const OPTION_LIKE = "[role=option], [role=menuitem], [role=menuitemradio], [role=treeitem], li, [role=listbox] *";

// Type-ahead pickers ("Select a state" search boxes): type the option, then
// choose it from the suggestions that appear.
async function typeAhead(option, control) {
  let inputs = all("input[role=combobox], input[aria-autocomplete], input[list], [role=combobox] input, input[type=search]")
    .filter((el) => visible(el) && !el.disabled && !el.readOnly);
  if (control) {
    inputs = inputs.map((el) => ({ el, s: score(labelOf(el), control) })).filter((x) => x.s >= 30)
      .sort((a, b) => b.s - a.s).map((x) => x.el);
  }
  for (const input of inputs.slice(0, 3)) {
    const before = new Set(all(OPTION_LIKE).filter(visible));
    await show(input);
    realClick(input);
    setNativeValue(input, option);
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: option.slice(-1) }));
    await sleep(600);
    const owned = [input.getAttribute("aria-controls"), input.getAttribute("aria-owns")].filter(Boolean)
      .map((id) => document.getElementById(id)).filter(Boolean);
    const shown = all(OPTION_LIKE).filter((el) => visible(el) && (!before.has(el) || owned.some((o) => o.contains(el))));
    const hit = best(shown, option, labelOf, 60);
    if (hit) {
      realClick(hit.el);
      await sleep(400);
      return { message: `Selected "${labelOf(hit.el)}" in "${labelOf(input) || "the search box"}".` };
    }
    // A <datalist> has no elements to click; its value is the choice.
    if (input.list && [...input.list.options].some((o) => score(o.value, option) >= 85)) {
      key(input, "Enter");
      return { message: `Entered "${option}" in "${labelOf(input)}".` };
    }
    setNativeValue(input, "");
    key(input, "Escape");
  }
  return null;
}

async function doSelect({ option, control, whole, noClick }) {
  if (!option) throw new Error("Select what?");

  // Native <select>s: every option of every one, the named control favoured.
  let pick = null;
  for (const sel of selects()) {
    const controlScore = control ? score(labelOf(sel), control) : 0;
    if (control && controlScore < 30) continue;
    for (const opt of sel.options) {
      if (opt.disabled) continue;
      const s = Math.max(score(opt.textContent, option), score(opt.value, option) - 10);
      const total = s + controlScore / 2;
      if (s >= 45 && (!pick || total > pick.total)) pick = { sel, opt, total };
    }
  }
  if (pick) {
    await show(pick.sel);
    chooseOption(pick.sel, pick.opt);
    await sleep(250);
    return { message: `Selected "${clip(pick.opt.textContent)}" in "${labelOf(pick.sel) || "the dropdown"}".` };
  }

  // Radio buttons and ARIA options already on screen.
  const choices = [
    ...all("input[type=radio]").filter((el) => reachable(el) && !el.disabled),
    ...all("[role=option], [role=radio], [role=menuitemradio], [role=tab]").filter(visible),
  ];
  const direct = best(choices, option, labelOf, 60);
  if (direct) {
    const el = direct.el;
    const hit = visible(el) ? el : [...(el.labels || [])].find(visible) || el;
    await show(hit);
    realClick(hit);
    await sleep(250);
    return { message: `Selected "${labelOf(el)}".` };
  }

  // Type-ahead pickers.
  const typed = await typeAhead(option, control);
  if (typed) return typed;

  // Custom dropdowns: open each likely one, look for the option, close it
  // again if it is not there. Menus and expanders only when the person named
  // which one: opening every one on the page to look is too much.
  let boxes;
  if (control) {
    boxes = all("[role=combobox], [aria-haspopup], button[aria-expanded=false], summary").filter(visible)
      .map((el) => ({ el, s: score(labelOf(el), control) })).filter((x) => x.s >= 30)
      .sort((a, b) => b.s - a.s).map((x) => x.el);
  } else {
    boxes = all("[role=combobox]:not(input), [aria-haspopup=listbox]").filter(visible);
  }
  for (const box of boxes.slice(0, 6)) {
    const before = new Set(all(OPTION_LIKE).filter(visible));
    await show(box);
    realClick(box);
    await sleep(400);
    const opened = all(OPTION_LIKE).filter((el) => visible(el) && !before.has(el));
    const hit = best(opened, option, labelOf, 60);
    if (hit) {
      await show(hit.el);
      realClick(hit.el);
      await sleep(300);
      return { message: `Selected "${labelOf(hit.el)}" from "${labelOf(box)}".` };
    }
    key(box, "Escape");
    if (box.getAttribute("aria-expanded") === "true") realClick(box);
    await sleep(150);
  }

  // "select Gage height in feet": the "in ..." was part of the option.
  if (control && whole && whole !== option) return doSelect({ option: whole, noClick });

  // A list of links or buttons is a choice too.
  if (noClick) throw new Error(`Couldn't find an option "${option}"${control ? ` in "${control}"` : ""}.`);
  try {
    const out = await doClick({ target: option });
    return out;
  } catch (e) {
    throw new Error(`Couldn't find an option "${option}"${control ? ` in "${control}"` : ""}.`);
  }
}

function pickField(field) {
  const fields = textFields();
  if (!fields.length) throw new Error("There's no text field on this page.");
  if (field) {
    const found = best(fields, field, labelOf, 30);
    if (found) return found.el;
    if (!/^search$/i.test(field)) {
      throw new Error(`Couldn't find a "${field}" field. Fields here: ${fields.slice(0, 6).map((f) => `"${labelOf(f)}"`).join(", ")}.`);
    }
  }
  const active = document.activeElement;
  if (active && fields.includes(active)) return active;
  const search = fields.find((f) => f.type === "search" || f.getAttribute("role") === "searchbox"
    || /search|query|\bq\b|find/i.test(`${f.name} ${f.id} ${f.placeholder || ""} ${f.getAttribute("aria-label") || ""}`));
  return search || fields[0];
}

async function doType({ text, field, submit }) {
  if (text == null || text === "") throw new Error("Type what?");
  const el = pickField(field);
  await show(el);
  el.focus({ preventScroll: true });
  if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  } else {
    setNativeValue(el, text);
  }
  let note = `Typed "${text}" into "${labelOf(el) || "the field"}".`;
  if (submit) {
    await sleep(150);
    const go = key(el, "Enter");
    if (go && el.form) {
      fixForm(el.form);
      if (typeof el.form.requestSubmit === "function") el.form.requestSubmit(); else el.form.submit();
    } else if (go) {
      // No form: the button beside it.
      const scope = el.closest("[role=search], header, nav, div") || document;
      const btn = [...scope.querySelectorAll("button, input[type=submit], [role=button]")]
        .find((b) => visible(b) && /search|go|submit|find|apply/i.test(`${labelOf(b)} ${b.className}`));
      if (btn) realClick(btn);
    }
    note += " Submitted.";
    await sleep(400);
  }
  return { message: note };
}

const isChecked = (el) => (el.tagName === "INPUT" ? el.checked : el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true");

async function doCheck({ label, on }) {
  if (!label) throw new Error("Check what?");
  const found = best(checkables(), label, labelOf, 40);
  if (!found) {
    const near = nearMisses(checkables(), label);
    throw new Error(`Couldn't find a checkbox "${label}".${near.length ? ` Closest: ${near.map((n) => `"${n}"`).join(", ")}.` : ""}`);
  }
  const el = found.el;
  const name = labelOf(el);
  if (on != null && isChecked(el) === on) return { message: `"${name}" is already ${on ? "on" : "off"}.` };
  const hit = visible(el) ? el : [...(el.labels || [])].find(visible) || el;
  await show(hit);
  realClick(hit);
  await sleep(250);
  return { message: `${isChecked(el) ? "Checked" : "Unchecked"} "${name}".` };
}

// "set State to Alaska": whichever kind of control the name belongs to.
async function doSet({ control, value }) {
  const pool = [...selects(), ...textFields(), ...checkables()];
  const found = best(pool, control, labelOf, 40);
  // Not a native control: a custom dropdown of that name, but never just
  // anything on the page called `value`.
  if (!found) {
    try { return await doSelect({ option: value, control, noClick: true }); } catch (e) {
      const near = nearMisses(pool, control);
      throw new Error(`Couldn't find a control called "${control}".${near.length ? ` Closest: ${near.map((n) => `"${n}"`).join(", ")}.` : ""}`);
    }
  }
  const el = found.el;
  if (el.tagName === "SELECT") return doSelect({ option: value, control: labelOf(el) });
  if (el.matches(CHECKABLE)) {
    const on = !/^(off|no|false|unchecked|disabled|hide|hidden)$/i.test(String(value).trim());
    return doCheck({ label: labelOf(el), on });
  }
  return doType({ text: value, field: labelOf(el) });
}

function scroller() {
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollHeight > doc.clientHeight + 10 && getComputedStyle(document.body || doc).overflowY !== "hidden") return doc;
  // Apps that scroll an inner panel rather than the page.
  let top = doc;
  let area = 0;
  for (const el of all("*")) {
    if (el.scrollHeight <= el.clientHeight + 10) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== "auto" && oy !== "scroll") continue;
    const a = el.clientWidth * el.clientHeight;
    if (a > area) { area = a; top = el; }
  }
  return top;
}

async function doFind({ text }) {
  const headings = all("h1, h2, h3, h4, h5, h6, [role=heading], legend, caption, th, label").filter(visible);
  const found = best(headings, text, textOf, 45) || best(clickables(), text, labelOf, 60) || byWrittenText(text, 45);
  if (!found) throw new Error(`Couldn't find "${text}" on this page.`);
  await show(found.el);
  return { message: `Found "${textOf(found.el)}".` };
}

async function doScroll({ to }) {
  const el = scroller();
  const page = el.clientHeight * 0.8;
  if (to === "top") el.scrollTo({ top: 0, behavior: "smooth" });
  else if (to === "bottom") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  else if (to === "up") el.scrollBy({ top: -page, behavior: "smooth" });
  else if (to === "down" || !to) el.scrollBy({ top: page, behavior: "smooth" });
  else return doFind({ text: to });
  await sleep(350);
  return { message: `Scrolled ${to === "top" || to === "bottom" ? `to the ${to}` : to || "down"}.` };
}

function tableRows(table, max = 6) {
  return [...table.rows].slice(0, max).map((r) => [...r.cells].slice(0, 8).map((c) => clip(c.innerText || c.textContent, 40)));
}

function doRead() {
  const main = document.querySelector("main, [role=main], article") || document.body;
  const headings = all("h1, h2, h3").filter(visible).slice(0, 15).map((h) => ({ level: Number(h.tagName[1]), text: textOf(h) }));
  const tables = all("table").filter((t) => visible(t) && t.rows.length > 1).slice(0, 3).map((t) => ({
    caption: t.caption ? textOf(t.caption) : "",
    rows: tableRows(t),
    totalRows: t.rows.length,
  }));
  const text = clip(main ? main.innerText || main.textContent : "", 1200);
  return {
    message: `${document.title || "This page"}: ${headings.length} headings, ${tables.length} table${tables.length === 1 ? "" : "s"}.`,
    details: { kind: "read", title: document.title, url: urls.toReal(location.href), headings, tables, text },
  };
}

function doInventory() {
  const uniq = (xs) => [...new Set(xs.filter(Boolean))];
  const dropdowns = selects().map((s) => ({
    label: labelOf(s) || "(unnamed)",
    selected: s.selectedOptions[0] ? clip(s.selectedOptions[0].textContent, 40) : "",
    options: [...s.options].slice(0, 12).map((o) => clip(o.textContent, 40)),
    count: s.options.length,
  }));
  const fields = uniq(textFields().map(labelOf));
  const checks = checkables().map((c) => ({ label: labelOf(c), checked: isChecked(c) })).filter((c) => c.label).slice(0, 40);
  const clickable = clickables();
  const buttons = uniq(clickable.filter((el) => !el.matches("a[href]")).map(labelOf)).slice(0, 50);
  const links = uniq(clickable.filter((el) => el.matches("a[href]")).map(labelOf)).slice(0, 50);
  const total = dropdowns.length + fields.length + checks.length + buttons.length + links.length;
  return {
    message: `${total} controls on this page.`,
    details: { kind: "inventory", dropdowns, fields, checks, buttons, links },
  };
}

// No verb anyone recognised: try the reading most likely to be meant.
async function doAuto({ text }) {
  for (const sel of selects()) {
    for (const opt of sel.options) {
      if (score(opt.textContent, text) >= 85) return doSelect({ option: text });
    }
  }
  if (best(clickables(), text, labelOf, 60)) return doClick({ target: text });
  if (best(checkables(), text, labelOf, 70)) return doCheck({ label: text, on: null });
  if (byWrittenText(text, 85)) return doClick({ target: text });
  throw new Error(`I didn't understand "${text}". Try "help" for what I can do.`);
}

const ACTIONS = {
  ping: async () => ({ message: "ready" }),
  click: doClick,
  select: doSelect,
  type: doType,
  check: doCheck,
  set: doSet,
  scroll: doScroll,
  find: doFind,
  read: async () => doRead(),
  inventory: async () => doInventory(),
  auto: doAuto,
  back: async () => { history.back(); return { message: "Going back." }; },
  forward: async () => { history.forward(); return { message: "Going forward." }; },
  reload: async () => { setTimeout(() => location.reload(), 50); return { message: "Reloading." }; },
};

if (isViewerFrame) {
  window.addEventListener("message", async (e) => {
    if (e.source !== window.parent || e.origin !== WC_SHELL_ORIGIN) return;
    const m = e.data;
    if (!m || m.source !== "wc-shell" || m.type !== "run") return;
    const fn = ACTIONS[m.command && m.command.action];
    try {
      if (!fn) throw new Error(`Unknown action "${m.command && m.command.action}".`);
      const result = await fn(m.command);
      post({ type: "result", id: m.id, ok: true, result });
    } catch (err) {
      post({ type: "result", id: m.id, ok: false, error: String((err && err.message) || err) });
    }
  });
}
