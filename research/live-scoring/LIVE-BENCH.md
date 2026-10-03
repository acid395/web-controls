# Running the live benchmark

The offline table in `ACTIONS.md` measures the grounding layer against
captured HTML with the model off. That is a component, not the system. This
is the same 100 prompts run the way the thing actually ships: live, in
Chrome, with a model loaded and deciding.

Both halves matter and neither replaces the other. Offline is deterministic
and re-runnable by anyone with the repo; live is the real claim but depends
on a machine, a model and a website on a given day.

## What is in the set

100 prompts, five sites, twenty each, hand-written against the controls and
data each page really carries. Two kinds of thing, and their combinations:

    action          one visible change: a click, toggle, tab, menu, search,
                    or a choice from a list                            35
    explain         a question answered from data the page carries      23
    action+explain  do something, then explain what it brought up      21
    multistep       two or three actions in order                      21

Nothing else - no paraphrase puzzles, refusals or conditions. Those measure
something real, but not what this set is for: whether the extension operates
these sites and reads them.

What the earlier live runs taught is built in. A chain whose first step
opens a new page fails if its next control is not on that page, so every
multistep prompt either stays on one page or continues with controls every
page of the site carries - the top menus. And explaining needs something to
explain: droughtmonitor's and water.noaa.gov's maps are an image and a
canvas, and weather.gov's front page carries almost no text, so explain
prompts there ask about what those pages do write down, and the richer
questions follow a step that opens a page with the data on it.

## Why the prompt set is frozen

`research/live-scoring/submission-set.js` is the hand-written source.
`build-bench-set.js` runs every prompt against the captured page with the
model off and writes `extension/lib/bench-prompts.js` from the result, so
each shipped row carries what the grounding layer alone did with that exact
prompt. Edit the source, not the generated file.

That `offline` flag is the number worth reading first: it is the share of
the set that has no answer at all without a model, and therefore the reason
to believe a live figure measures the system rather than the matcher.

If the live run used a different list - or one somebody retyped - the
difference between the two results would include the difference in what was
asked, and the comparison would measure nothing.

## Two runs

    bench          all twenty for this site
    bench hard     the combinations only       multistep, action+explain

`hard` is a filter over the one set, not a second list, so the two runs
cannot drift apart and a row means the same thing in either.

Tests check that every step on the starting page is a control that page
really has, that every multistep prompt has at least two steps, and that
the set holds only these four kinds - because a case that cannot be
scored is not a case.

Both are run the way somebody would actually type them. Neither forces a
path, because what matters is whether the request is answered, not which
part of the system answered it.

## What to do

One site per run, about 15-25 minutes each depending on the model.

1. Load the unpacked extension and open the side panel.
2. Choose the model in the picker and **wait for "is ready"**. A run started
   while it is still loading measures the download; `bench` refuses to start
   in that state rather than record it.
3. Navigate to one of the five sites below.
4. Type `bench` in the ask box.

It reloads the page before every prompt - half of these press links, and
without the reset each row would be measured against whatever page the
previous one navigated to. When it finishes it saves
`web-controls-bench-<site>-<date>.json`.

    waterdata.usgs.gov/monitoring-location/01646500/   20 prompts
    droughtmonitor.unl.edu/CurrentMap.aspx             20
    water.noaa.gov                                     20
    weather.gov                                        20
    drought.gov                                        20

airnow.gov was in the set and is not any more: it would not load while this
was written - curl returned 000 on every attempt - and a site nobody can
reach cannot be part of something meant to be reproduced.

Run the same site on more than one model if you want the comparison that
matters most - the same prompts on a 3B and an 8B, on the same machine, is
the one measurement nobody in this project has yet.

## What comes out

Per run: the extension version, the model id, the temperature (fixed at 0 in
`panel-model.js`, recorded rather than asserted), the GPU as the adapter
reports it, the user agent, and when it started.

Per prompt: what was asked, whether it landed, which path answered
(`plannedBy`), where the decision happened (panel or the hidden document),
total milliseconds, the model turn in milliseconds, prompt and reply tokens
with prefill and decode rates, the route, the page URL, and what the offline
pass did with the same prompt.

Nothing is transcribed from a card. A figure read off a screenshot is not
something a reader can re-derive.

## Known threats to validity

Say these in the paper rather than hoping nobody asks.

- **The sites change.** These are live government pages; a control renamed
  next month changes the result. The offline snapshots in `pages/` are dated
  and pinned, which is the point of keeping both halves.
- **One machine is one machine.** Throughput depends on the GPU, the Chrome
  build, and whether the panel is visible - Chrome throttles hidden
  documents by roughly eighty times on the machine that measured it. The
  recorded GPU and user agent are what make a number comparable to another.
- **The model is not deterministic across builds.** Temperature is 0, but a
  different WebLLM version or quantisation is a different system.
- **The data changes.** Alerts, forecasts and drought numbers are live; an
  explain prompt is judged on whether the answer matches what the page said
  that day, which is why every run keeps the answer it gave.
- **The offline column is jsdom.** It has no layout engine and applies no
  stylesheet, so a CSS-hidden menu is wide open there and every element
  reports the same fake rectangle. A browser is strictly harder. Read that
  column as a floor, not a forecast: on droughtmonitor the same actions
  scored 100% against the snapshot and a third of that in Chrome.
- **A multistep row needs reading, not just totalling.** Each one lists its
  steps in order, and whether all of them happened - not only the last -
  is judged from the recorded card. That is why the sheet has a MAYBE
  column: a run that reached the end by a different route, or did most of
  the steps, is not the same as one that did nothing.
