# Running the live benchmark

The offline table in `ACTIONS.md` measures the grounding layer against
captured HTML with the model off. That is a component, not the system. This
is the same 100 prompts run the way the thing actually ships: live, in
Chrome, with a model loaded and deciding.

Both halves matter and neither replaces the other. Offline is deterministic
and re-runnable by anyone with the repo; live is the real claim but depends
on a machine, a model and a website on a given day.

## What is in the set, and why it was rewritten

100 prompts, five sites, twenty each, hand-written against the control list
every page really carries.

The set this replaces was enumerated from the pages themselves, so most of
it read `click NDMC`, `click NASA`, `click tag: Drought Index` - a footer
logo or a tag chip asked for by its exact printed name. That is what the
name matcher exists to catch, so it caught it: a run of twenty-four such
prompts on droughtmonitor sent three to the model. A set that answers
itself without a model says nothing about a system whose point is the
model.

It also held three chains in two hundred and twenty-three prompts. Chaining
is a stated goal of the project; three is not a sample. The mix is now
fixed per site:

    6  chain            two or three steps in one sentence, in order
    5  paraphrase       shares no meaningful word with the control it wants
    2  vocabulary       the domain's own word or abbreviation - cfs, DSCI, HEFS
    2  world-knowledge  only outside knowledge connects the ask to the control
    3  reading          answered in prose off the page; nothing is pressed
    1  refusal          the page has no such thing; saying so is the pass
    1  judgment         a condition to read before it can be acted on

Thirty chains, and nothing answerable by typing a label back.

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

    bench          all twenty for this site    what a user gets
    bench hard     the subset naming nothing   chain, paraphrase,
                                               world-knowledge, judgment

`hard` is a filter over the one set, not a second list, so the two runs
cannot drift apart and a row means the same thing in either. Reading and
refusal sit outside it deliberately: they are not harder versions of
pressing a control but a different question - can it answer off the page,
can it decline - and totalling them into one "hard" percentage would blur
two things worth reading separately.

A test refuses to let a paraphrase contain its own target, another checks
every target is a control the page really has, and a third checks every
`want` is checkable against that page - because a case that cannot be
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
- **A refusal can be right.** Five of the 100 ask for something no page
  carries; for those, landing means refusing. Counting them as failures
  would understate, counting a wrong press as success would overstate.
- **The offline column is jsdom.** It has no layout engine and applies no
  stylesheet, so a CSS-hidden menu is wide open there and every element
  reports the same fake rectangle. A browser is strictly harder. Read that
  column as a floor, not a forecast: on droughtmonitor the same actions
  scored 100% against the snapshot and a third of that in Chrome.
- **A chain scores on `ok`, which is coarse.** A row reporting success did
  something; that its steps happened in the right order deserves a human
  eye on the recorded card rather than only the total. Every chain records
  the control its last step should reach, so this is checkable.
