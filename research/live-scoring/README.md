# Scoring against real pages

The prompt set the extension and the widget are judged on, and the saved pages
it is checked against offline.

    node capture.js                          # refresh pages/ from the live sites
    node build-bench-set.js --site=usgs      # offline pass for one site, as JSON

`submission-set.js` is the source: 250 prompts, 50 for each of five sites
(USGS monitoring location, Drought Monitor, NOAA water, weather.gov,
drought.gov), each tagged action, explain, action+explain or multistep.
`build-bench-set.js` runs every prompt through the extension's own answering
path against the page saved in `pages/`, with no model, and writes the result
into `extension/lib/bench-prompts.js` - the frozen copy a live run is scored
against.

## What the offline column means

`offline: true` says the page's own matching, with no model at all, pressed the
right control (or, for an explain prompt, found text to read). It is a floor,
not a score: a live run with a model is what decides PASS or FAIL. A prompt
that flips between two runs of the offline pass after a change is the thing to
look at - the change touched how that request is read.

## Other files

- `pages/` - the five sites as captured, also read by the test suites.
- `feeds/usgs.json` - the data a USGS chart downloaded, for the chart-data tests.
- `DATA-ANSWERS.md` - how answers are worked out from a chart's own data.
