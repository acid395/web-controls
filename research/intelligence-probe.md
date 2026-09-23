# Is the model doing something rules cannot?

Thirty instructions, in six tiers. Run each one twice: plain, then again with
`baseline:` in front of it. The prefix forces the keyword scorer and skips
the model, so the pair is the same request on the same page decided two ways.

Record four things per run: whether the right control was reached, which
planner answered (the card's `source` / `plannedBy`), the `took` and `model`
seconds, and - when it fails - the `it replied:` line.

The claim the paper can make is only as wide as the tier where the two
columns separate. Tier 0 is the control group: if the baseline matches the
model there, that is expected and says nothing either way.

## Tier 0 - named word for word (both should succeed)

These name a control exactly. No interpretation is required, and the
extension answers them without waking the model at all. Their job is to
establish that the page is operable and the harness is working.

| # | page | instruction |
|---|------|-------------|
| 1 | USGS site page | `click 30 days` |
| 2 | USGS site page | `click revisions` |
| 3 | NOAA | `click rivers-at-a-glance` |
| 4 | drought.gov | `click soil moisture` |
| 5 | drought.gov | `select alaska` |

## Tier 1 - paraphrase (no word in common with the label)

The scorer matches words against labels, so a request sharing none of the
control's words is outside what it can reach except through a hand-built
synonym table. This is the tier the whole argument rests on.

| # | page | instruction | the control meant |
|---|------|-------------|-------------------|
| 6 | USGS | `show me the last month of data` | 30 days |
| 7 | USGS | `zoom out to a whole year` | 1 year |
| 8 | USGS | `switch the axis to a logarithmic scale` | Log |
| 9 | USGS | `plot the height of the water` | Graph Gage height |
| 10 | USGS | `what corrections have been made to this record` | Revisions |
| 11 | NOAA | `where is flooding expected` | Flood Hazard Outlook |
| 12 | NOAA | `what are the forecasters saying today` | National Hydrologic Discussion |
| 13 | drought.gov | `how dry is the ground` | Soil Moisture |
| 14 | drought.gov | `what did droughts look like centuries ago` | Paleoclimate |

## Tier 2 - domain knowledge

These need hydrology, not vocabulary: that discharge is flow measured in
cubic feet per second, that stage and gage height are the same quantity,
that SWE is snow water equivalent. A synonym table can encode any one of
these; the question is whether the model has them without being told.

| # | page | instruction | the control meant |
|---|------|-------------|-------------------|
| 15 | USGS | `graph the cfs` | Graph Discharge |
| 16 | USGS | `show the stage` | Graph Gage height |
| 17 | USGS | `compare against the same period last year` | Data for same time span in prior year |
| 18 | NOAA | `show me SWE` | Snow Water Equivalent |
| 19 | NOAA | `how much rain has already fallen` | Past Precipitation Estimates |

## Tier 3 - inference from what the page currently shows

The right answer depends on the page's present state, so no fixed mapping
from words to controls can produce it. Set the page up first as noted.

| # | page | set up first | instruction |
|----|------|--------------|-------------|
| 20 | USGS | select 7 days | `show me a longer span than that` |
| 21 | USGS | select Log | `put the scale back to normal` |
| 22 | USGS | tick Gage height only | `add discharge to the same graph` |
| 23 | drought.gov | select Alaska | `now do the same for Arizona` |

## Tier 4 - chaining: act, read, then decide

Two or three steps where the later ones depend on what the earlier ones
revealed. A single-shot matcher cannot do these by construction.

| # | page | instruction |
|----|------|-------------|
| 24 | USGS | `click related links and then open the water year summary` |
| 25 | USGS | `show 30 days and plot the discharge` |
| 26 | NOAA | `open the layers panel and turn on the precipitation layer` |
| 27 | drought.gov | `search for soil moisture and open the first result` |

## Tier 5 - knowing when it cannot

A planner that presses its best guess on every request is not intelligent,
it is indiscriminate. These have no answer on the page, and the right
outcome is to say so and touch nothing.

| # | page | instruction |
|----|------|-------------|
| 28 | USGS | `enable the tidal predictions layer` |
| 29 | NOAA | `click the submarine tracker` |
| 30 | drought.gov | `book me a flight to Denver` |

## Reading the result

- **Tier 0 equal, tiers 1-2 apart.** The strongest result available: the
  model reaches controls the rules cannot, on pages nobody wrote code for.
- **Tiers 1-2 also equal.** Either the synonym table is carrying it - check
  whether the baseline's hits are the words in `env-vocab.js` - or the
  paraphrases are too close to the labels and need rewriting.
- **Tier 3 or 4 working at all** is worth more than a percentage point
  anywhere else: neither is reachable by matching, so a single success is a
  difference in kind rather than degree.
- **Tier 5 failing** is the finding that matters most, whichever planner
  fails it. An action taken on somebody's page in answer to a request it
  could not understand is the error this whole design exists to prevent.

Note what the model replied on every failure. Eight or nine times out of ten
so far the reply has been sensible and the fault has been in resolving it to
the page - which is a finding about where the difficulty lives, and is
itself worth writing down.
