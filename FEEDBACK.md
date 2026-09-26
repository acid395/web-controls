# Trying this out, and what would help to hear

This is a Chrome extension that tries to make old US government
environmental sites operable in plain English — clicking their controls,
working their dropdowns, following their links — **without any change to the
sites themselves**. A small language model runs locally in your browser,
reads whatever controls the page actually has, and decides what to press.

The claim worth testing is narrow, so it is worth stating plainly: *a ~1GB
model running on your own machine can operate a site nobody wrote any code
for.* Six of the eight sites it is measured on have no site-specific code
anywhere in the repo.

## Setting it up

You need Chrome and a GPU that supports WebGPU. The default model is Llama
3.1 8B, about 5GB, downloaded once and cached after that.

**Check `diagnose` before timing anything.** Type it in the ask box and read
the `model speed` line: twelve tokens in, twelve out, with no page involved.
Two machines running this same build measured 20-40 tokens a second and 0.1 -
a difference of two orders of magnitude, on a model that loaded perfectly and
reported ready on both. The slow one was an Apple laptop where every other
check passed. If yours reads under a token a second, the 8B cannot run there
and nothing about the instruction will change that; say `use 3b` or
`use qwen`.

Nothing switches models for you. An earlier build did, silently, and a card
then credited an answer to a model that had never been loaded - so the model
you pick is the model you get, always. What the extension will do is tell
you: `diagnose` has a **`model fits this machine`** line that weighs the
model you chose against the memory and the GPU limits this machine reports,
and where it does not fit, it names the largest one that does.

1. `chrome://extensions` → turn on **Developer mode** (top right).
2. **Load unpacked** → choose the `extension/` folder.
3. Open the extension, turn on **Enable the local model for Ask**, and wait
   for it to finish loading. A bar under the model picker shows how far
   through it is, and says **"<model> is ready"** when it finishes — that
   is the moment to start timing. A first-run download is not inference.
4. Go to a site. On one it has not seen, press **Enable on this site** once.
5. Type an instruction and press **Ask**.

Sites it has been measured on: `waterdata.usgs.gov`, `water.noaa.gov`,
`drought.gov`, `earthquake.usgs.gov`, `airnow.gov`, `weather.gov`,
`ncei.noaa.gov`. Anything else is genuinely untested, and those are the most
interesting reports.

## Three ways to ask, and why you want all three

| Prefix | What it does |
|---|---|
| *(none)* | Fast paths first, model when they do not fit. What a user gets. |
| `model:` | Forces the model to plan. Slower, and the real subject. |
| `baseline:` | Forces a keyword scorer. The thing the model is compared against. |

Running the same words all three ways is the single most useful thing you can
do. `model: click gage height` and `baseline: click gage height` disagreeing
is a result either way.

`use 1b`, `use qwen`, `use 3b` in the ask box switch which model plans. The 3B
chooses best and has crashed Chrome on smaller GPUs.

## Worth trying, roughly in order of difficulty

- `click gage height` — one control, named exactly.
- `select Alaska` — a dropdown, by its value rather than its name.
- `click huc-8 subbasin` — the page writes it "HUC-08".
- `click a month` — the page offers "30 days". Nothing matches word for word.
- `show legend` / `hide map` — a toggle, where getting the direction backwards
  is as wrong as not finding it.
- `change map to satellite` — a control that is not a form control.
- `click about and then click nwps user guide` — two steps, the second only
  reachable after the first.
- `click view monitoring location for the second location` — on a search
  results page, one of several links wearing the same name, picked by
  position. `the last one` and `the 3rd` work the same way.
- `explain this data` / `what is the discharge here` - a question, not an
  instruction. These read the page and answer in prose; the answer appears
  in full on the card rather than squeezed into its heading. Nothing gets
  pressed, on any model.
- **Type it badly on purpose.** `clik compair two weks`, `shwo teh legend`,
  `could you please click on 30 days for me`, `switch to a logarithmic
  scale`, `show the chart key`, `download the shapefiles`. Typos, courtesy,
  and the domain's own words for a thing are all handled without the model
  now - so if one of these waits for a decision or presses the wrong thing,
  that is a bug worth reporting and not a limitation.
- **Where it is still weak, and known:** a request whose difficulty is in
  words no vocabulary accounts for - "the layer with the longest name",
  "if X then Y", "what is going on here" - goes to the model, and a small
  model often will not get it. Anything not in English relies entirely on
  the model. Both are honest gaps, not regressions.
- Then your own. Vague, domain-specific, badly typed, several steps: that is
  where it is weakest and where we know least.

## What is already known — no need to report

- **It is slow.** One decision is 15–35s on modest hardware. The model is
  essentially all of it; the page work is milliseconds.
- **Compound instructions are the weak spot.** Single named controls are
  reliable; "do X then Y then summarise" often is not.
- **Maps drawn on canvas** cannot be clicked. The extension says so instead
  of pretending.
- Sometimes a card reads *"the local model planned nothing here, so this is
  the keyword baseline"*. That means the model was asked, answered, and its
  answer could not be used. Its raw reply is printed on the card — that reply
  is the most useful thing you can paste into a report.

## What would actually help

A report is most useful with:

1. **The exact words you typed** and the **URL**.
2. **The whole card**, not a summary of it. It carries which path answered
   (`plannedBy`), how long it took, and the model's raw reply when there was
   one.
3. **What you expected to happen** — often the disagreement is about what the
   right answer was, not whether the code worked.

Two failures are worth separating, because they are not equally bad:

- It did nothing, or refused. Annoying, honest, low priority.
- **It said it did something and did not**, or did the wrong thing
  confidently. That is the serious one. Report those first.

## If you want to check the numbers yourself

```
node extension/test/run-tests.js       # 1216 tests, no network
node research/live-scoring/score.js    # 44 hand-written asks on saved pages
node research/live-scoring/generate.js && node research/live-scoring/score-generated.js
```

Currently 42/44 hand-written and 69/69 generated. `research/live-scoring/README.md`
explains what those two sets measure and, importantly, what the 69/69 does not
mean.
