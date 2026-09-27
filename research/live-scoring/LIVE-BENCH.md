# Running the live benchmark

The offline table in `ACTIONS.md` measures the grounding layer against
captured HTML with the model off. That is a component, not the system. This
is the same 120 prompts run the way the thing actually ships: live, in
Chrome, with a model loaded and deciding.

Both halves matter and neither replaces the other. Offline is deterministic
and re-runnable by anyone with the repo; live is the real claim but depends
on a machine, a model and a website on a given day.

## Why the prompt set is frozen

`extension/lib/bench-prompts.js` holds the exact instructions
`research/live-scoring/actions.js` runs offline, generated from that run and
not hand-edited. If the live run used a different list - or a list somebody
retyped - the difference between the two results would include the
difference in what was asked, and the comparison would measure nothing.

Each entry also records what the offline pass did with it, so a live result
can be read row by row against it rather than only in total.

## Three runs, and only two say anything about intelligence

    bench          the frozen set, as shipped     what a user gets
    bench hard     prompts that name nothing      does anything understand
    bench model    the hard set, model forced     does the model itself

The frozen set is every control's own label - which is exactly what the
grounding layer is built to catch. A live run of it on droughtmonitor sent
three prompts out of twenty-four to the model. That is a fine measurement of
the fast path and close to useless as evidence about intelligence, which is
the claim this project actually makes.

So the hard set shares no word with the control it should reach. "Compare
this week with last week" for Compare Two Weeks; "where do I download the
shapefiles" for GIS Data; "show the whole lower 48" for Continental U.S.,
which needs to know what the lower 48 is. A test refuses to let a
paraphrase contain its own target, and another checks every target is a
control the page really has, because a case that cannot be scored is not a
case.

Run `bench hard` and `bench model` on the same page. The first lets the
vocabulary and the meaning layer answer what they can; the second puts
`model:` in front of every prompt so nothing else can. The second column is
the model's own score. The gap between them is what the grounding layer
contributes - and if the second column is poor, no amount of work on the
first makes the system intelligent, it only makes it quick.

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

    waterdata.usgs.gov/monitoring-location/01646500/   28 prompts
    water.noaa.gov                                     22
    droughtmonitor.unl.edu/CurrentMap.aspx             24
    weather.gov                                        23
    airnow.gov                                         23

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
- **A refusal can be right.** Nine of the 120 ask for something no page
  carries; for those, landing means refusing. Counting them as failures
  would understate, counting a wrong press as success would overstate.
- **The offline column is jsdom.** It has no layout engine and does not run
  a page's own scripts as Chrome does. It measures logic, not rendering.
