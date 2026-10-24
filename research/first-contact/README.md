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
| 2 | CDC WONDER, IEM ASOS download, NOAA PFDS | 1.95.0 (one-call planner) | Llama 3.2 3B, window on screen | 10/30: WONDER 5/10, IEM 5/10, PFDS 0/10 (the page defines a global `Map`; the widget crashed at boot) |
| 3 | CoCoRaHS daily reports, CDC FluView, NCEI CDO search | 1.96.0 | Llama 3.2 3B, window on screen | 9/30: CoCoRaHS 3/10, FluView 4/10, CDO 2/10 - explains 5/9, acts 3/15, chains 0/6 |
| 4 | USACE Water Management locations | 1.99.6 | Llama 3.2 3B, extension bench, user machine | 7/19 pass, 1 maybe (actions 3/8, chains 2/5, do-and-tell 0/2, questions 2/4); 9 of the 11 failures were one gap - forty identical per-row "List View" links folded into one |
| 4 | Reclamation RISE catalog | 1.99.7 | Llama 3.2 3B, extension bench, user machine | 7/20 pass, 3 maybe (actions 4/6, chains 2/7, do-and-tell 1/3, questions 0/4) |
| 4 | National Inventory of Dams | 1.99.7 | Llama 3.2 3B, extension bench, user machine | 5/19 pass, 3 maybe (actions 4/9, chains 0/4, do-and-tell 0/2, questions 1/4) |
| 4 | all three | 1.99.6-1.99.7 | Llama 3.2 3B | 19/58 pass (33%), 7 maybe |
| 5 | NCEI Climate at a Glance | 1.99.6 (Chrome still had the old build loaded) | Llama 3.2 3B, extension bench, user machine | 9/15 (actions 6/7, chains 2/3, do-and-tell 0/1, questions 1/4) |
| 5 | TWDB Water Data for Texas reservoirs | 1.99.6 | Llama 3.2 3B, extension bench, user machine | 8/15 pass, 1 maybe (actions 7/9, chains 1/1, do-and-tell 0/1, questions 0/4); "how full is abilene" ran against a Google Docs tab |
| 5 | both | 1.99.6 | Llama 3.2 3B | 17/30 pass (57%), 1 maybe |
| 6 | NOAA NDBC station 46026 | 1.99.11 | Llama 3.2 3B, extension bench, user machine | 10/15 pass, 4 maybe (actions 6/9, chains 1/1, do-and-tell 1/1, questions 4/5) |
| 6 | Colorado DWR stations | 1.99.11 | Llama 3.2 3B, extension bench, user machine | 8/15 pass, 1 maybe (actions 6/9, chains 0/1, do-and-tell 0/1, questions 2/4); two cards named a control by its label after the press, rescored as passes after checking the page |
| 6 | both | 1.99.11 | Llama 3.2 3B | 18/30 pass (60%), 5 maybe |
| 7 | EPA How's My Waterway (Boulder, CO) | 1.99.13 | Llama 3.2 3B, extension bench, user machine | 4/15 pass, 2 maybe |
| 7 | Water Quality Portal | 1.99.13 | Llama 3.2 3B, extension bench, user machine | 5/15 pass, 6 maybe |
| 7 | both | 1.99.13 | Llama 3.2 3B | 9/30 pass (30%), 8 maybe |
| 8 | NCEI Storm Events Database, decide plan | 1.99.16 | Llama 3.2 3B, extension bench, user machine | 7/15 pass, 5 maybe |
| 8 | NCEI Storm Events Database, decide choice | 1.99.16 | Llama 3.2 3B, extension bench, user machine | 5/15 pass, 2 maybe; after a menu opened, choice offered the whole page again and opened sibling menus |
| 8 | EPA ECHO facility search, decide plan | 1.99.17 | Llama 3.2 3B, extension bench, user machine | 5/15 pass, 4 maybe |
| 8 | EPA ECHO facility search, decide choice | 1.99.17 | Llama 3.2 3B, extension bench, user machine | 6/15 pass, 5 maybe; choice decisions 6-13 s against 20-80 s planned |
| 8 | both sites | 1.99.16-1.99.17 | Llama 3.2 3B | plan 12/30 (40%), 9 maybe; choice 11/30 (37%), 7 maybe |
| 9 | NOAA NOHRSC National Snow Analyses | 1.99.19 | choice mode, once with Llama 3.2 3B and once with Qwen3 4B, extension bench, user machine | pending: 15 prompts, frozen 2026-10-24 before any run |

Two rows above were re-scored from the recorded answers after four checks
turned out to carry a doubled backslash in their regular expressions (the
IEM request-limit answer "1000" and the CDO cart answer "0 items" had been
marked FAIL by broken checks). The TSVs keep the original marks.

Round 1 sites are retired: the naming fixes in 1.94.0 were written with
their pages open. USACE Water Management is retired after 1.99.7 (repeated per-row controls are named for their row). NDBC and Colorado DWR are retired after 1.99.12 (list choice named by option and list, search pressed after a choice, state said last, pager totals and controls, split grid headers, identifiers searched bare). Climate at a Glance and Water Data for Texas are retired after 1.99.9 (table cells read by row and column, start and end ranges, the CSV link on screen over a hidden one, search boxes typed into only when asked). RISE and NID are retired after 1.99.8 (unasked plan steps left alone, the first result taken from what a search added, named filter boxes ticked, pickers that are buttons opened, typing into a button sent to its form's box, and acronyms and stated counts read off the page). Round 3 sites are retired after 1.96.0 (the shortlist no longer offers
page-leaving links as padding, a plan may search only when asked to, and a
plan is no longer than the request). Round 2 sites are retired the same way after 1.95.0:
the fixes that followed (built-ins taken from a clean source, lists named
by what they hold, an instant match yielding to the planner when words are
left over, a second choice adding to a multi-select) were written with
their failures in view.

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
