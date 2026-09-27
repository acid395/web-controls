/* to-sheet.js - run output, as rows for the tracking sheet.
 *
 * The sheet is the shared record of what works, so what goes in it must
 * come out of a run rather than out of somebody reading cards and typing.
 * A status transcribed by hand is a status nobody can re-derive, and three
 * of the numbers in this project turned out wrong precisely because they
 * were read off a screen rather than off a measurement.
 *
 * Takes either shape:
 *   the offline enumerator's JSON   (research/live-scoring/act-<site>.json)
 *   the live bench's JSON           (web-controls-bench-<mode>-<site>-<date>.json)
 *
 *   node research/live-scoring/to-sheet.js run1.json run2.json > rows.tsv
 *
 * Emits TSV, which pastes into Google Sheets as columns without an import
 * step. Status is PASS or FAIL and nothing else, because a sheet column
 * that sometimes says "unverifiable" gets counted as a pass by whoever
 * totals it; anything that could not be confirmed is FAIL with the reason
 * beside it, which is the conservative direction.
 */
const fs = require("fs");

const COLS = ["Site", "Action", "Kind", "Should reach", "Status", "Why",
  "Decided by", "Took (s)", "Model", "Condition", "Version"];

function fromOffline(rows, file) {
  return rows.map((r) => ({
    Site: r.site,
    Action: r.say,
    Kind: r.kind,
    "Should reach": r.on,
    Status: r.ok ? "PASS" : "FAIL",
    Why: r.ok ? "" : String(r.why || ""),
    "Decided by": "grounding layer (no model)",
    "Took (s)": "",
    Model: "none",
    Condition: "offline snapshot, jsdom, model off",
    Version: "",
  }));
}

function fromLive(run) {
  const cond = `live in Chrome, ${run.mode === "model" ? "model forced" : run.mode === "hard"
    ? "hard set" : "shipped set"}`;
  return (run.rows || []).map((r) => {
    const m = r.metrics || {};
    return {
      Site: r.site || run.site,
      Action: r.say,
      Kind: r.kind,
      "Should reach": r.on,
      Status: m.ok ? "PASS" : "FAIL",
      Why: m.ok ? "" : String(m.error || "").slice(0, 120),
      "Decided by": m.plannedBy ? `${m.plannedBy}${m.decidedIn ? ` (${m.decidedIn})` : ""}` : "",
      "Took (s)": m.tookMs != null ? (m.tookMs / 1000).toFixed(1) : "",
      Model: run.model || "",
      Condition: cond,
      Version: run.extensionVersion || "",
    };
  });
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node to-sheet.js <run.json> [more.json ...] > rows.tsv");
  process.exit(1);
}
const out = [];
for (const f of files) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { console.error(`skipping ${f}: ${(e && e.message) || e}`); continue; }
  if (Array.isArray(parsed)) out.push(...fromOffline(parsed, f));
  else if (parsed && parsed.rows) out.push(...fromLive(parsed));
  else console.error(`skipping ${f}: not a run this understands`);
}
const esc = (v) => String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ");
console.log(COLS.join("\t"));
for (const r of out) console.log(COLS.map((c) => esc(r[c])).join("\t"));
console.error(`${out.length} rows, ${out.filter((r) => r.Status === "PASS").length} PASS`);
