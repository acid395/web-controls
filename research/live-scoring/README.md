# Scoring against real pages

Both scorers run the extension's own answering path against real federal
pages, captured once and kept on disk, so a run is repeatable and costs
nothing. The model is stubbed: what is being measured is whether a request
reaches the right control, not how well a 1.5B writes English.

    node capture.js            # refresh pages/ from the live sites
    node score.js              # 44 hand-written requests, 3 sites
    node generate.js           # derive cases from pages/ into generated.json
    node score-generated.js    # score them, broken down by kind

## Two sets, because they answer different questions

**Hand-written** (`score.js`) asks whether the thing works the way a person
would ask for it: vague phrasing, domain words the page never uses, requests
that should be refused. Its cases are judgement calls, which is the point and
also the limit - I wrote both the request and the expectation, so it cannot
tell me about a kind of request I did not think of.

**Generated** (`generate.js`) takes the other side. It reads each page's own
controls and derives a request per control, so the coverage is the page's,
not mine, across five kinds:

| kind   | what it asks                                   |
|--------|------------------------------------------------|
| named  | the control by its exact label                 |
| typed  | the same, with characters transposed           |
| span   | a time span by a phrase the page does not use  |
| absent | something the page has no control for          |
| value  | an option inside a dropdown                    |

Only controls whose label belongs to them alone become cases. airnow carries
both a link and a radio called "Interactive Map", and waterdata a "Go to
Explore USGS Water Data" beside an "Explore USGS Water Data"; for those there
is no right answer to assert, and a benchmark that asserts one is measuring
its own confusion. Ambiguity is a real case and belongs to the hand-written
set, where the expectation can say what should happen - which here is that it
goes to the model rather than being guessed at.

## Where it stands

    hand-written   42/44  95%
    generated      69/69  100%  (named 52, typed 4, span 3, absent 8, value 2)

The split that matters is by route, not by kind:

    SITE      19/19  hand-written manifest
    NOAA       8/8   hand-written manifest
    GENERIC   42/42  no site-specific code anywhere in this repo

Six of the eight pages - drought.gov, earthquake.usgs.gov, airnow.gov,
weather.gov, ncei.noaa.gov and waterdata's nwis/rt - have nothing written for
them. GENERIC reads their live DOM and derives the control list on the spot.
The other two, a waterdata monitoring location and water.noaa.gov, have
manifests, and they have them because those pages hold controls the DOM does
not honestly describe: canvas-rendered maps, panels that apply a change
through script rather than a form.

Keeping the majority of the measurement on GENERIC is deliberate. A score
taken mostly on manifested pages would say only that the manifests work,
which was never in doubt and is not the claim.

Read the 100% for what it is. The generated set asks only what it can mark,
and every exclusion above - shared names, overlapping names - takes away a
case the system found hard. What it does establish is a floor: on eight real
federal pages there is no control the system cannot reach by its own name, no
name it cannot reach through a transposition, and nothing it invents when the
page offers nothing. Those were all failing at some point this month, and
this is what stops them failing again quietly. It says nothing about vague
phrasing or chained requests, which is the hand-written set's job and where
the two remaining misses live.

Both of those are real. On usgs, "enable the tidal predictions layer" is
refused - the layer is there, behind a panel the refusal does not look into.
On drought, "open the paleoclimate page" reaches the model and the model
presses a link with no text.
