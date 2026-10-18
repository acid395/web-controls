# First-contact gate

The number that says whether the agent works on a site nobody tuned it for.

Rules, in order of importance:

1. A site is used once. Its prompts and checks are written from screenshots
   before the agent runs on it, and the score is recorded before any change
   is made for it. Once a change is written with that site's failures in
   view, the site is retired from the gate - it measures the fix from then
   on, not the agent.
2. Pass or fail is judged on the page's state after the ask (the dropdown's
   value, the box that is ticked, the URL), or on the card holding the
   figure the page shows. Never on the card's wording.
3. Each release reports the gate on three fresh sites, model on, alongside
   the model it ran with.

```
LOOK=1 node gate.js sites/x.json        screenshot, text and form markup, to write prompts and checks from
BASELINE=1 node gate.js sites/x.json    every check on the untouched page; any PASS is a bad check
node gate.js sites/a.json sites/b.json  the run (PROFILE=<Chrome profile with the model cached>)
MODEL_ID=Llama-3.1-8B-Instruct-q4f16_1-MLC node gate.js ...
MODEL=0 node gate.js ...                page layer alone
```

`run-*.tsv` files are the record: one row per prompt with what the agent said.

## Rounds

| round | sites | build | model | result |
|---|---|---|---|---|
| 1 | NASS Quick Stats, EIA Electricity Data Browser, PRISM Explorer | 1.93.0 | off | 4/30 |
| 1 | same | 1.93.0 | Llama 3.2 3B, Chrome window off-screen | 7/20 on NASS + EIA; not valid, see below |
| 1 | same | 1.94.0 | Llama 3.2 3B, window on screen | 7/15 (NASS 4/10, EIA 3/5; stopped to build the planner) |
| 2 | CDC WONDER, IEM ASOS download, NOAA PFDS | 1.95.0 (one-call planner) | Llama 3.2 3B, window on screen | (running) |

Round 1 sites are retired: the naming fixes in 1.94.0 were written with
their pages open.

## The window has to be on screen

Chrome throttles GPU work for a window it considers hidden, and a window
parked off-screen counts. Measured inside the NASS page on the 8GB Mac,
one 2,555-token prompt:

| model | window | load | prompt | prefill | decode |
|---|---|---|---|---|---|
| Llama 3.2 3B | off-screen | 7 s | 676 s | 58 tok/s | 0.5 tok/s |
| Llama 3.2 3B | on screen | 4 s | 64 s | 42 tok/s | 5 tok/s |
| Llama 3.1 8B | on screen | 27 s | 682 s | 16 tok/s | 0.03 tok/s |

So every model-on run with the window off-screen measured a model that
could not finish a turn, and the 8B pages on 8GB even with the window on
screen: its numbers come from a machine that holds it. A page-sized
prompt costs the 3B about a minute here, which is why the planner has to
work from a shortlist of controls, not the whole page.
