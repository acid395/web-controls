# Answering from the data behind a chart

Measured 2026-10-09 on the live USGS monitoring location for the Potomac River at Little Falls (`https://waterdata.usgs.gov/monitoring-location/01646500/`), with Llama 3.2 3B running in a Web Worker in headless Chrome on an 8 GB Apple M-series Mac. The widget build was injected at document start, so its feed capture saw the page's own requests.

## Why

Explanation questions were the weakest part of the 100-prompt live run: 5 of 23 passed. Some of the failures were questions about a chart's numbers. The agent already recorded the data a page fetches, but four faults kept that data from reaching the model:

1. The chart's data on this page is one 885 KB response: seven days of gage height at fifteen-minute intervals. Capture kept 200,000 characters of each response, and a truncated response is never parsed.
2. USGS writes each value as text (`"value": "2.84"`). The reader only accepted real numbers.
3. The time, unit and approval status recorded beside each value were discarded. Those are the fields that answer "when", "in what" and "is it provisional".
4. The few summary lines that survived were appended after the page text, and the result was cut to 2,200 characters, so on a page with real text they never reached the model.

A fifth fault turned up during the live run. The page requests its flood stages from a relative URL, `/flood-stage/01646500/`, which the capture pattern only matches once the host is restored, so they were never recorded.

## What changed

- **Capture:** keeps responses up to 4 MB, within a 24 MB total that evicts the oldest first. It resolves relative and `URL`-object requests to absolute addresses, and skips images.
- **Series:** values written as text are read. Each series carries its unit, a quantity guessed from the unit, its latest approval status, and the times of its latest, highest and lowest readings. Map configuration and identifier columns are excluded.
- **Facts:** small JSON responses such as the flood stages are flattened. The distance from the latest reading to each stage is worked out.
- **Placement:** the data goes ahead of the page text, ranked by what the question names.
- **Direct answers:** when the question names what the series measures, or asks about flood stage and the page fetched its stages, the answer is written from the data without asking the model. The card says so.
- **Question detection:** questions opening on a preposition ("at what gage height…") are recognised as questions instead of commands.

## Result

Graded against what the page itself downloaded during each run: latest 2.71 ft, Provisional; high 2.91 ft on Oct 3; change −0.13 to −0.14 ft over the week; minor flood stage 10 ft.

| Question | Before | After |
|---|---|---|
| What is the latest gage height reading and when was it taken | 2.71 ft, no time (partial) | 2.71 ft, taken Oct 9, 3:50 PM (Provisional) |
| Is the latest reading provisional or approved | Provisional | Provisional |
| What was the highest gage height in the last week and when | **2.72 ft (wrong)** | 2.91 ft, at Oct 3, 12:20 PM |
| How much has the gage height changed over the past week | **0.01 ft (wrong)** | Fell 0.14 ft, from 2.85 to 2.71 |
| How far is the river below flood stage | **2.71 ft (wrong)** | 7.29 ft below minor flood stage (10 ft) |
| At what gage height does this location reach minor flood stage | **Clicked a control (wrong)** | 10 ft |

Before: 1 of 6 correct and 1 partial. After: 6 of 6 correct. Five of the six now come from the data in under half a second, instead of 15–25 seconds of model time.

Two intermediate attempts are worth recording. Giving the 3B more facts made it worse: it answered "2.71 ft", the first number in the block, to most questions. Even a worked answer sentence placed first was copied wrongly on the two flood-stage questions. Small models restate a sentence unreliably, so where the agent can work the answer out exactly, it gives it directly.

## Scope

This fixes questions about the numbers a page fetched for its charts. On this benchmark's five front pages, only the USGS monitoring location loads such data; weather.gov and the Drought Monitor's current-map page load none. Most of the other explanation failures in the live run were about reading text, such as legends and discussions, and this change does not address them.

## Reproducing

`research/live-scoring/feeds/usgs.json` holds the page's recorded requests. The extension's test suite answers these questions against that file.
