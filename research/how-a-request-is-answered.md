# How a request is answered, and why that kept changing

The request handler has twenty-one places that can answer. Six of them answer
anything on the pages anyone has tested. The rest are tiers from before the
model existed, still sitting in the chain.

That is the reason fixing one thing kept breaking another. Every fix was an
insertion into a long ordered chain, and an insertion changes precedence for
everything below it. The ordering was implicit: nobody, including whoever
wrote it, could say what it was without running it.

It is now written down here and enforced in the suite, under "Which rung
answers what, pinned". A change that moves a request from one rung to another
fails there and has to be argued for, rather than turning up three cards
later on a live page.

## The order, and the reason for each

**1. Settings and the self-test.** `use 3b`, `diagnose`. Asking a planner how
to change planners is absurd on its face, and `diagnose` is what somebody
types when nothing works - it must not wait on the component it reports on.
This used to sit below the model: `use 3b` took thirty seconds and crashed.

**2. The page, where the request names something on it beyond doubt.** A
control named word for word, a value that one list offers, a span said in
words, any of those typed badly. No decision is spent, because there is
nothing to decide: `click 30 days`, `select alaska`, `click a month`, `click
30 dyas`. One control only - two is a choice, and a choice belongs to the
model.

**3. The model.** Everything that needs reading a sentence: paraphrase,
ambiguity, more than one clause, anything the page does not plainly name. It
chooses from controls derived from the page, narrowed by an embedder where
one is available, and it can act, read what changed, and decide again.

**4. Nothing here clearly does that.** Where the model was asked and could not
place the request, the scorer does not get to press its best guess. It ranks
words against labels; it does not understand a request, and on phrasing the
model could not place, its best candidate is where every wrong action on a
live page came from - HUC-06 for HUC-08, Ada County for Alaska, Augusta for a
date in August.

Under `baseline:` the scorer runs anyway, on purpose, so the two can be
measured on the same pages. With no model available at all it also runs,
because a tool that does nothing is worse than a tool that falls back.

## What is deliberately not in the fast rungs

**Presses, mostly.** The fast rung takes switches and values. A press has
nuances it does not know - a fragment carrying a view does something, a bare
"#" does not - so a named link goes the slower way on a crowded page. A known
cost, recorded rather than left to be rediscovered.

**Anything ambiguous.** Two controls answering to one name, two lists
offering one value, a request whose words are all common to the page: each
goes to the model rather than being guessed at.

## The rule the rungs share

The request decides the state. The model decides the control. The control's
own before and after decides what happened - not the page signature, which
shifts for a re-render or a clock. Four kinds of control wanted that rule
separately before it was written once: checkboxes, radios, disclosures, and
toggles whose labels name an action rather than a state.
