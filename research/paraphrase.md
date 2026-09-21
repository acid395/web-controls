# Robustness to phrasing

The action matrices generate each instruction from the control's own label and
then check that it reaches that control. That measures self-consistency, not
usability: nobody types a label back at a page word for word.

This sweep keeps the same six sites and rewrites each instruction the ways
people actually shorten and vary them. The transformations are fixed,
domain-general, and were not adjusted afterwards - tuning them to raise the
number would defeat the exercise.

| phrasing | resolved | + asked, with the wanted control offered |
|---|---|---|
| verbatim | 107/107 (100%) | 100% |
| lowercased | 107/107 (100%) | 100% |
| politely ("can you please … for me") | 107/107 (100%) | 100% |
| filler dropped ("layer", "data", "page") | 103/106 (97%) | 100% |
| a synonym swapped | 101/107 (94%) | 98% |
| last two words | 88/101 (87%) | 96% |
| first two words | 77/107 (72%) | 93% |
| **total** | **690/742 (93%)** | **729/742 (98%)** |

Two columns because a shortened name is often genuinely ambiguous: "National
Water" names both the National Water Dashboard and the National Water
Availability Assessment on the same USGS page. Asking which was meant, with
the right one among the options, is the correct answer to that - not a miss.

Fragments beginning on a conjunction ("and Maps", "& Regulations") are skipped:
that is the generator misfiring, not a way anyone asks for anything.

## What it found

`ENV_VOCAB` has carried the domain's synonyms from the start - discharge is
streamflow is flow is cfs, gage height is stage - and nothing that matched a
control ever consulted it. A page saying "Discharge" was unreachable to anyone
who said "flow". Wired in, ranked below a literal match so a page using the
word you typed still wins.

Multi-word names are looked for whole rather than split, because splitting
would make "water" alone stand for water temperature.

## What it did not fix

"Rain" does not reach "Precipitation": the vocabulary lists precipitation,
precip and rainfall. Adding "rain" would make this sweep score better, and the
sweep is the thing that invented "rain" as the paraphrase - so it was left
alone. A vocabulary should be extended from how people actually write in, not
from a generator's guesses.

The 13 remaining misses are mostly truncations that name something incomplete:
"Apply for", "Data and", "Recreation &".
