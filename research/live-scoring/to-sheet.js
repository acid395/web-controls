/* to-sheet.js - a live run, as rows for the tracking sheet.
 *
 * What goes in the sheet must come out of a run. A status somebody read off
 * a card and retyped is one nobody can re-derive, and three figures in this
 * project were wrong for exactly that reason: an offline 68% that was a
 * broken checker, a "too large for this machine" that was warm-up, and a
 * "cannot run" the diagnostic itself caused.
 *
 * Live runs only. The offline snapshot numbers are useful while developing
 * and misleading in a shared record - on droughtmonitor the same actions
 * scored 100% against a snapshot and a third of that in a browser, because
 * jsdom applies no stylesheet and every hidden menu is wide open there.
 * Two conditions in one column get totalled as one number.
 *
 *   node research/live-scoring/to-sheet.js ~/Downloads/web-controls-bench-*.json > rows.tsv
 *
 * TSV, which pastes into Sheets as columns with no import step.
 */
const fs = require("fs");

const COLS = ["Site", "Action", "Status", "Notes"];

// PASS or FAIL and nothing else. A column that sometimes says
// "unverifiable" is totalled as a pass by whoever adds it up, so anything
// unconfirmed is FAIL with the reason beside it - wrong in the
// conservative direction, which is the only safe one.
function rowsFrom(run) {
  return (run.rows || []).map((r) => {
    const m = r.metrics || {};
    const notes = [
      m.ok ? null : String(m.error || "no reason given").slice(0, 90),
      m.plannedBy === "model" ? "model decided" : null,
      m.tookMs != null && m.tookMs > 4000 ? `${(m.tookMs / 1000).toFixed(0)}s` : null,
    ].filter(Boolean).join("; ");
    return {
      Site: r.site || run.site,
      Action: r.say,
      Status: m.ok ? "PASS" : "FAIL",
      Notes: notes,
    };
  });
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node to-sheet.js <bench-run.json> [more.json ...] > rows.tsv");
  process.exit(1);
}
const out = [];
for (const f of files) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { console.error(`skipping ${f}: ${(e && e.message) || e}`); continue; }
  if (Array.isArray(parsed)) {
    console.error(`skipping ${f}: that is an offline run, which does not belong in the sheet`);
    continue;
  }
  if (!parsed || !parsed.rows) { console.error(`skipping ${f}: not a run this understands`); continue; }
  out.push(...rowsFrom(parsed));
}
const esc = (v) => String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ");
console.log(COLS.join("\t"));
for (const r of out) console.log(COLS.map((c) => esc(r[c])).join("\t"));
const pass = out.filter((r) => r.Status === "PASS").length;
console.error(`${out.length} rows, ${pass} PASS, ${out.length - pass} FAIL`);
