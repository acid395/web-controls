/* score.js - does the agent see what a person sees?
 *
 * For every captured page: the interactive elements a person would name
 * (buttons, links, fields, lists, switches, tabs, menu items, anything with a
 * click handler or a tab stop), and how many of them the inventory carries
 * with a sensible name. Two numbers per page, and the misses listed, so a
 * gap is fixed against the corpus rather than against the site it bit on.
 *
 *   node research/perception/score.js            # every page in pages/ and ../live-scoring/pages/
 *   node research/perception/score.js ncei-cag   # one page, with its misses
 */
const fs = require("fs");
const path = require("path");
const { loadPage } = require("../../extension/test/harness.js");

const DIRS = [path.join(__dirname, "pages"), path.join(__dirname, "..", "live-scoring", "pages")];
const only = process.argv[2];
const ROLES = /^(?:button|link|tab|menuitem|menuitemradio|menuitemcheckbox|option|checkbox|radio|switch|combobox|slider|listbox|searchbox|textbox|spinbutton)$/i;

function expectedIn(w) {
  const doc = w.document;
  const hiddenHere = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute("hidden") || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute("style") || "")) return true;
      if (/^(?:template|script|style|noscript|head)$/i.test(n.tagName)) return true;
      if (n.getAttribute("aria-hidden") === "true") return true;
    }
    return false;
  };
  const out = [];
  for (const el of doc.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const interactive = tag === "button" || tag === "select" || tag === "textarea" || tag === "summary"
      || (tag === "a" && el.hasAttribute("href") && !/^javascript:void/i.test(el.getAttribute("href") || ""))
      || (tag === "input" && type !== "hidden")
      || ROLES.test(role) || el.hasAttribute("onclick")
      || (el.hasAttribute("tabindex") && Number(el.getAttribute("tabindex")) >= 0 && tag !== "body" && tag !== "html");
    if (!interactive || hiddenHere(el)) continue;
    out.push(el);
  }
  return out;
}

function badLabel(c) {
  const l = String(c.label || "").trim();
  if (!l) return "no name";
  if (l.length > 80) return "too long to be a name";
  if (!/[a-z0-9]/i.test(l)) return "no words";
  const glued = (c.options || []).map((o) => String(o.text || "").trim()).join("");
  if (glued && l.replace(/\s+/g, "") === glued.replace(/\s+/g, "")) return "its options run together";
  return null;
}

function scorePage(file) {
  const html = fs.readFileSync(file, "utf8");
  const m = html.match(/<!-- captured [^ ]+ from (\S+) -->/);
  const url = (m && m[1]) || "https://example.gov/";
  const w = loadPage(html, { url });
  if (!w) return null;
  const inv = w.GENERIC.inventory({ includeHidden: true });
  const seen = new Map();
  let unresolved = 0;
  let collisions = 0;
  for (const c of inv.controls) {
    const sel = String(c.selector || "").split(" >>> ").pop();
    let el = null;
    try { el = w.document.querySelector(sel); } catch (e) { /* unselectable */ }
    if (!el) { unresolved++; continue; }
    // Two controls whose selectors land on one element: the agent would
    // press the wrong one for whichever it meant.
    if (seen.has(el)) collisions++;
    seen.set(el, c);
  }
  // A repeat of a listed control - the mobile copy of the search button,
  // "PDF" under each of three menus - is seen, as the same thing again.
  const byLabel = new Map();
  const kindOf = (el) => { const t = el.tagName.toLowerCase(); const r = (el.getAttribute("role") || "").toLowerCase(); return r || t; };
  for (const c of inv.controls) { const k = String(c.label || "").replace(/\s+/g, " ").trim().toLowerCase(); if (k) byLabel.set(`${String(c.kind || "").toLowerCase()}|${k}`, c); }
  let repeats = 0;
  // A run the inventory folded into one entry with a count covers the run:
  // the members share a parent, a tag and a class with the one listed.
  for (const c of inv.controls) {
    if (!(c.count > 1)) continue;
    const el = [...seen.entries()].find(([, v]) => v === c);
    const rep = el && el[0];
    if (!rep || !rep.parentElement) continue;
    for (const sib of rep.parentElement.children) {
      if (sib !== rep && sib.tagName === rep.tagName && String(sib.className) === String(rep.className) && !seen.has(sib)) seen.set(sib, c);
    }
  }
  const expected = expectedIn(w);
  const misses = [];
  const bad = [];
  let covered = 0;
  for (const el of expected) {
    let c = seen.get(el);
    if (!c) {
      // A wrapper the inventory folded, or the real control inside a wrapper it listed.
      for (let n = el.parentElement, d = 0; n && d < 3 && !c; n = n.parentElement, d++) c = seen.get(n);
      if (!c) { const inner = [...el.querySelectorAll("*")].find((k) => seen.has(k)); if (inner) c = seen.get(inner); }
    }
    if (!c) {
      const own = (el.textContent || "").replace(/\s+/g, " ").trim();
      const text = (el.getAttribute("aria-label") || (/[a-z0-9]/i.test(own) ? own : "") || el.getAttribute("value") || el.getAttribute("title") || own).replace(/\s+/g, " ").trim().toLowerCase();
      const same = text && (byLabel.get(`${kindOf(el)}|${text}`) || byLabel.get(`a|${text}`) || byLabel.get(`button|${text}`));
      if (same) { repeats++; covered++; continue; }
      misses.push({ el });
      continue;
    }
    covered++;
    const why = badLabel(c);
    if (why) bad.push({ el, c, why });
  }
  const describe = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("value") || "").replace(/\s+/g, " ").trim().slice(0, 40)}"`;
  return { name: path.basename(file, ".html"), expected: expected.length, covered, named: covered - bad.length, unresolved, collisions, repeats,
    misses: misses.slice(0, 14).map((m) => describe(m.el)),
    bad: bad.slice(0, 12).map((b) => `${describe(b.el)} -> "${String(b.c.label).slice(0, 40)}" (${b.why})`) };
}

const files = DIRS.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".html")).map((f) => path.join(d, f)) : []))
  .filter((f) => !only || path.basename(f, ".html") === only);
const rows = [];
for (const f of files) {
  const r = scorePage(f);
  if (!r) { console.log(`${path.basename(f)}: could not load`); continue; }
  rows.push(r);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  console.log(`${r.name.padEnd(22)} seen ${String(pct(r.covered, r.expected)).padStart(3)}%  named ${String(pct(r.named, r.expected)).padStart(3)}%  of ${r.expected}${r.unresolved ? `  (${r.unresolved} selectors resolve to nothing)` : ""}${r.collisions ? `  (${r.collisions} selector collisions)` : ""}${r.repeats ? `  (${r.repeats} repeats of listed controls)` : ""}`);
  if (only || process.env.VERBOSE) {
    for (const m of r.misses) console.log(`   missing: ${m}`);
    for (const b of r.bad) console.log(`   badly named: ${b}`);
  }
}
if (rows.length > 1) {
  const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
  console.log(`\nall pages: seen ${Math.round((100 * sum("covered")) / sum("expected"))}%, named ${Math.round((100 * sum("named")) / sum("expected"))}% of ${sum("expected")} interactive elements`);
}
