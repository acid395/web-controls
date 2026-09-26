# Scoring against real pages

Both scorers run the extension's own answering path against real federal
pages, captured once and kept on disk, so a run is repeatable and costs
nothing. The model is stubbed: what is being measured is whether a request
reaches the right control, not how well a 1.5B writes English.

    node capture.js            # refresh pages/ from the live sites
    node score.js              # 44 hand-written requests, 3 sites
    node generate.js           # derive cases from pages/ into generated.json
    node score-generated.js    # score them, broken down by kind
    node by-site.js            # the same cases, as a per-site table
    node chains.js             # how many links of a multi-step instruction run

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

## Two more views of the same cases

**By site** (`by-site.js`) is the generated set again, laid out as the table
a paper needs: one row per site, one column per kind of action, and the
route beside each - so it is visible which rows have no site-specific code
behind them. Asked for twice before it existed; a single percentage across
nine sites was never a result anybody could use.

**Chains** (`chains.js`) measures depth rather than accuracy. Eleven
instructions of two to five links, each link naming a control on the page
word for word, run page-only and then with a planner. What it reports is how
many links were carried out and where a chain stopped. All thirty-four links
run with no model at all, which is worth knowing on a machine that cannot
hold one; what still needs a model is a link that paraphrases, or one that
only exists after the previous link has navigated.

## Where it stands

    hand-written   42/44  95%
    generated      78/78  100%  (named 59, typed 5, span 3, absent 9, value 2)
    by site        74/78  95%   (same cases, no model at all)
    chains         34/34  links carried out, with and without a planner
    badly phrased  14/19  (was 6/19), no model at all

Badly phrased is the newest of these and the least flattering, which is why
it is worth keeping. Nineteen requests written the way people write them -
typos, the domain's own synonyms, courtesy, vagueness, a chain, and two in
Spanish - run with no model at all:

    typo      5/5    was 3/5    clcik 30 dayz · shwo teh legend · clik compair two weks
    synonym   4/4    was 1/4    the chart key · download the shapefiles · a logarithmic scale
    polite    2/2    was 1/2    could you please click on 30 days for me
    complex   2/2    was 1/2    open maps then map archive then data then time series
    vague     1/4    was 0/4    I want to see a longer period
    spanish   0/2    was 0/2    muestra el nivel del agua

The last two rows are the honest limit of a grounding layer. A request whose
difficulty is in words no vocabulary accounts for - a superlative, a
condition, "what is going on here" - needs a model, and anything not in
English needs a multilingual one. Both refuse cleanly rather than pressing
something, which is the behaviour that matters when they cannot be answered.

The split that matters is by route, not by kind:

    SITE      19/19  hand-written manifest
    NOAA       8/8   hand-written manifest
    GENERIC   51/51  no site-specific code anywhere in this repo

Seven of the nine pages - drought.gov, droughtmonitor.unl.edu,
earthquake.usgs.gov, airnow.gov, weather.gov, ncei.noaa.gov and waterdata's
nwis/rt - have nothing written for them. GENERIC reads their live DOM and
derives the control list on the spot. The other two, a waterdata monitoring
location and water.noaa.gov, have manifests, and they have them because those
pages hold controls the DOM does not honestly describe: canvas-rendered maps,
panels that apply a change through script rather than a form.

Keeping the majority of the measurement on GENERIC is deliberate. A score
taken mostly on manifested pages would say only that the manifests work,
which was never in doubt and is not the claim.

The generated set and the by-site table are the same 78 cases judged two
ways, and the four they disagree on are worth understanding. `score-generated`
lets a stub model answer, and a model refuses a request for something absent
before anything is pressed. `by-site` runs with no model, and there the
fallback looks for the thing by opening one panel named for holding controls
- "Show legend", "WDFN tools and data" - before giving up. One press, once,
for a control that was never there. That is the honest cost of having no
model, on four of nine sites, and it is reported rather than scored around.

Read the 100% for what it is. The generated set asks only what it can mark,
and every exclusion above - shared names, overlapping names - takes away a
case the system found hard. What it does establish is a floor: on nine real
federal pages there is no control the system cannot reach by its own name, no
name it cannot reach through a transposition, and nothing it invents when the
page offers nothing. It says nothing about vague phrasing or chained
requests, which is the hand-written set's job and where the two remaining
misses live.

Both of those are real. On usgs, "enable the tidal predictions layer" is
refused - the layer is there, behind a panel the refusal does not look into.
On drought, "open the paleoclimate page" reaches the model and the model
presses a link with no text.
