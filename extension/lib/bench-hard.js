/* bench-hard.js - prompts that cannot be answered by matching a name.
 *
 * The frozen set in bench-prompts.js is every control's own label, which is
 * exactly what the grounding layer is built to catch - so a run of it
 * measures the fast path and says almost nothing about whether the model
 * works. On droughtmonitor, three of twenty-four prompts reached the model
 * at all.
 *
 * Not one prompt here shares a word with the control it should reach. Every
 * one needs the request understood rather than matched: a paraphrase, the
 * domain's own word for a thing, something only world knowledge connects
 * (the lower 48 is the continental US), or two steps in one sentence.
 *
 * Hand-written on purpose. Meaning is the thing being tested, so it cannot
 * be generated from the page without generating the answer with it.
 *
 * kinds: paraphrase | vocabulary | world-knowledge | chain
 */
globalThis.WC_BENCH_HARD = {
 "droughtmap": {
  "url": "https://droughtmonitor.unl.edu/CurrentMap.aspx",
  "prompts": [
   {
    "say": "compare this week with last week",
    "target": "Compare Two Weeks",
    "kind": "paraphrase"
   },
   {
    "say": "show me the older maps",
    "target": "Map Archive",
    "kind": "paraphrase"
   },
   {
    "say": "I want the raw numbers in a table",
    "target": "Data Tables",
    "kind": "paraphrase"
   },
   {
    "say": "where do I download the shapefiles",
    "target": "GIS Data",
    "kind": "vocabulary"
   },
   {
    "say": "show the map without colour",
    "target": "View grayscale version of the map",
    "kind": "paraphrase"
   },
   {
    "say": "how do I get in touch",
    "target": "Contact Us",
    "kind": "paraphrase"
   },
   {
    "say": "explain what the categories mean",
    "target": "Drought Classification",
    "kind": "paraphrase"
   },
   {
    "say": "show it as a graph over time",
    "target": "Time Series",
    "kind": "paraphrase"
   },
   {
    "say": "how many people are affected",
    "target": "Population Statistics",
    "kind": "paraphrase"
   },
   {
    "say": "I want this in Spanish",
    "target": "En Español",
    "kind": "paraphrase"
   },
   {
    "say": "make an animation of it",
    "target": "Animations",
    "kind": "paraphrase"
   },
   {
    "say": "sign me up for alerts",
    "target": "Drought Alert Request",
    "kind": "paraphrase"
   },
   {
    "say": "show the whole lower 48",
    "target": "Continental U.S.",
    "kind": "world-knowledge"
   },
   {
    "say": "what is the effect on farming",
    "target": "Ag in Drought",
    "kind": "paraphrase"
   },
   {
    "say": "let me build my own map",
    "target": "Custom Map Request",
    "kind": "paraphrase"
   },
   {
    "say": "open maps and then compare two weeks",
    "target": "Compare Two Weeks",
    "kind": "chain"
   },
   {
    "say": "go to data then show the tables",
    "target": "Data Tables",
    "kind": "chain"
   }
  ]
 },
 "usgs": {
  "url": "https://waterdata.usgs.gov/monitoring-location/01646500/",
  "prompts": [
   {
    "say": "show me the water level",
    "target": "Gage height",
    "kind": "vocabulary"
   },
   {
    "say": "plot a month of data",
    "target": "30 days",
    "kind": "paraphrase"
   },
   {
    "say": "switch to a logarithmic scale",
    "target": "Log",
    "kind": "vocabulary"
   },
   {
    "say": "I want the numbers not the picture",
    "target": "Viewtabular data",
    "kind": "paraphrase"
   },
   {
    "say": "let me save this data",
    "target": "Downloaddata",
    "kind": "paraphrase"
   },
   {
    "say": "notify me when the river rises",
    "target": "WaterAlert",
    "kind": "paraphrase"
   },
   {
    "say": "show the chart key",
    "target": "Show legend",
    "kind": "vocabulary"
   },
   {
    "say": "take me to the old version of this page",
    "target": "Legacy real-time page",
    "kind": "paraphrase"
   },
   {
    "say": "what other charts are there",
    "target": "Viewrelated graphs",
    "kind": "paraphrase"
   },
   {
    "say": "give me a full year",
    "target": "1 year",
    "kind": "paraphrase"
   },
   {
    "say": "hide the extra detail",
    "target": "Hide graph details",
    "kind": "paraphrase"
   },
   {
    "say": "show a week of readings",
    "target": "7 days",
    "kind": "paraphrase"
   },
   {
    "say": "show a month and then switch to log",
    "target": "Log",
    "kind": "chain"
   }
  ]
 }
};
