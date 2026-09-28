# What it can be told to do, site by site

120 actions across 5 sites, every one of them run.

Each action is derived from that page's own controls, so the coverage is the
site's rather than ours.

**This is one half of the measurement, and the lesser half.** The model is
switched off for all of it, so what is reported here is the grounding layer
alone - deterministic, and re-runnable by anyone with the repo. It is not the
system: the thing that ships decides with a model loaded, and a component
measured on its own does not stand in for that. A separate hand-written set
of a hundred prompts, frozen in `extension/lib/bench-prompts.js`, is what
runs live in Chrome with the model on - see `LIVE-BENCH.md`. These
enumerated actions and that set are different lists on purpose: this one
covers every control a page has, which is breadth; that one is written so
no prompt names its target, which is the only way to ask whether anything
understands. Put the two columns beside
each other; neither replaces the other.

What this half does establish is a floor. A row that lands here lands with any
model or none, so model size only decides the rows this layer cannot reach.

## What this is not

**Nothing here touched a live website.** Every row is replayed against a
static HTML snapshot in jsdom - the files in `pages/`, captured by
`capture.js` on the date below. The extension itself was not running in a
browser: `background.js` is loaded into a Node vm with the `chrome.*` APIs
stubbed. The https URLs in this file set the document's location so route
matching resolves; they are not fetched.

That gap is not cosmetic, and it has hidden real bugs. jsdom reports the
same fake rectangle for every element, so anything judged on layout behaves
differently here than in Chrome; the harness never answers a message sent to
the side panel, so a test that looks like it exercises the panel is
exercising the fallback; and a page that builds itself in JavaScript is
captured only as far as the capture waited. This measures the logic against
a snapshot. It is not evidence about any site today.

Snapshots captured: **2026-09-26 01:06 UTC**. Table generated: **2026-09-26**.

| site | route | actions | land |
|---|---|---|---|
| waterdata.usgs.gov (a monitoring location) | SITE | 28 | 25/28 (89%) |
| water.noaa.gov (National Water Prediction Service) | NOAA | 22 | 21/22 (95%) |
| droughtmonitor.unl.edu | GENERIC | 24 | 24/24 (100%) |
| weather.gov | GENERIC | 23 | 23/23 (100%) |
| airnow.gov | GENERIC | 23 | 22/23 (96%) |
| **all five** | | **120** | **115/120 (96%)** |

`SITE` and `NOAA` are hand-written manifests. `GENERIC` means no code in this
repo was written for that site at all - the controls are read out of the
page's own DOM at run time rather than from anything written in advance.

## waterdata.usgs.gov (a monitoring location)

Route `SITE` - 25 of 28 land with no model.

| what you type | what it acts on | kind | lands |
|---|---|---|---|
| `click 7 days` | 7 days | Turn something on | yes |
| `click 30 days` | 30 days | Turn something on | yes |
| `click 1 year` | 1 year | Turn something on | yes |
| `click Linear` | Linear | Turn something on | no - ran |
| `click Select data to graph on second y-axis` | Select data to graph on second y-axis | Turn something on | yes |
| `click Graph Discharge, cubic feet per second` | Graph Discharge, cubic feet per second | Turn something on | yes |
| `click Menu` | Menu | Press a named control | yes |
| `click survey` | survey | Press a named control | yes |
| `click Dismiss site alert` | Dismiss site alert | Press a named control | yes |
| `click provisional` | provisional | Press a named control | yes |
| `click Expand all data collections` | Expand all data collections | Press a named control | yes |
| `click Site Location` | Site Location | Press a named control | no - nothing pressed |
| `click Zoom in` | Zoom in | Press a named control | yes |
| `click Hide legend` | Hide legend | Press a named control | yes |
| `click USGS - Federal Priority Streamgages` | USGS - Federal Priority Streamgages | Press a named control | yes |
| `click Legal` | Legal | Press a named control | yes |
| `click Site Map` | Site Map | Press a named control | yes |
| `click USGS Github` | USGS Github | Press a named control | yes |
| `click DOI Inspector General` | DOI Inspector General | Press a named control | yes |
| `click No Fear Act` | No Fear Act | Press a named control | yes |
| `click Exapnd all data collections` | Expand all data collections | The same thing, misspelt | yes |
| `click USGS - Feedral Priority Streamgages` | USGS - Federal Priority Streamgages | The same thing, misspelt | yes |
| `click DOI Inpsector General` | DOI Inspector General | The same thing, misspelt | yes |
| `could you please click Menu for me` | Menu | The same thing, asked politely | yes |
| `could you please click Hide legend for me` | Hide legend | The same thing, asked politely | yes |
| `explain this data` | (the page's own values) | Ask about the data | yes |
| `what does this page show` | (the page's own values) | Ask about the data | yes |
| `click the tidal predictions calibrator` | (nothing - should refuse) | Ask for what is not there | no - refused |

## water.noaa.gov (National Water Prediction Service)

Route `NOAA` - 21 of 22 land with no model.

| what you type | what it acts on | kind | lands |
|---|---|---|---|
| `click here` | here | Press a named control | yes |
| `click Rivers-at-a-Glance` | Rivers-at-a-Glance | Press a named control | yes |
| `click Categorical FIM List` | Categorical FIM List | Press a named control | yes |
| `click Long Range Outlook` | Long Range Outlook | Press a named control | yes |
| `click Key Messages` | Key Messages | Press a named control | yes |
| `click Significant River Flood Outlook` | Significant River Flood Outlook | Press a named control | yes |
| `click River Ice Surveillance` | River Ice Surveillance | Press a named control | yes |
| `click NWPS APIs` | NWPS APIs | Press a named control | yes |
| `click Future Study: Modernizing PMP` | Future Study: Modernizing PMP | Press a named control | yes |
| `click Short-term Probabilistic Guidance Product` | Short-term Probabilistic Guidance Product | Press a named control | yes |
| `click Weather Forecast Offices` | Weather Forecast Offices | Press a named control | yes |
| `click NWPS Release Notes` | NWPS Release Notes | Press a named control | yes |
| `click NWPS User Guide` | NWPS User Guide | Press a named control | yes |
| `click GitHub link` | GitHub link | Press a named control | yes |
| `click Singificant River Flood Outlook` | Significant River Flood Outlook | The same thing, misspelt | yes |
| `click Wetaher Forecast Offices` | Weather Forecast Offices | The same thing, misspelt | yes |
| `could you please click here for me` | here | The same thing, asked politely | yes |
| `could you please click Weather Forecast Offices for me` | Weather Forecast Offices | The same thing, asked politely | yes |
| `select National Hydromet Discussion September 24, 2026` | selector -> National Hydromet Discussion September 24, 2026 | Choose a value from a list | yes |
| `explain this data` | (the page's own values) | Ask about the data | yes |
| `what does this page show` | (the page's own values) | Ask about the data | yes |
| `click the tidal predictions calibrator` | (nothing - should refuse) | Ask for what is not there | no - refused |

## droughtmonitor.unl.edu

Route `GENERIC` - 24 of 24 land with no model.

| what you type | what it acts on | kind | lands |
|---|---|---|---|
| `click View grayscale version of the map` | View grayscale version of the map | Turn something on | yes |
| `click U.S. Drought Monitor` | U.S. Drought Monitor | Press a named control | yes |
| `click Map Archive` | Map Archive | Press a named control | yes |
| `click Map Viewer` | Map Viewer | Press a named control | yes |
| `click Custom Map Request` | Custom Map Request | Press a named control | yes |
| `click Bar Chart` | Bar Chart | Press a named control | yes |
| `click Statistics by Threshold` | Statistics by Threshold | Press a named control | yes |
| `click AOI Values` | AOI Values | Press a named control | yes |
| `click What is the USDM?` | What is the USDM? | Press a named control | yes |
| `click Drought Classification` | Drought Classification | Press a named control | yes |
| `click Drought Alert Request` | Drought Alert Request | Press a named control | yes |
| `click Media Kit` | Media Kit | Press a named control | yes |
| `click Ag in Drought` | Ag in Drought | Press a named control | yes |
| `click David Mocko` | David Mocko | Press a named control | yes |
| `click Continental U.S.` | Continental U.S. | Press a named control | yes |
| `click U.S. Druoght Monitor` | U.S. Drought Monitor | The same thing, misspelt | yes |
| `click Druoght Severity and Coverage Index` | Drought Severity and Coverage Index | The same thing, misspelt | yes |
| `click Pouplation Statistics` | Population Statistics | The same thing, misspelt | yes |
| `click Cotninental U.S.` | Continental U.S. | The same thing, misspelt | yes |
| `could you please click U.S. Drought Monitor for me` | U.S. Drought Monitor | The same thing, asked politely | yes |
| `could you please click Population Statistics for me` | Population Statistics | The same thing, asked politely | yes |
| `explain this data` | (the page's own values) | Ask about the data | yes |
| `what does this page show` | (the page's own values) | Ask about the data | yes |
| `click the tidal predictions calibrator` | (nothing - should refuse) | Ask for what is not there | yes |

## weather.gov

Route `GENERIC` - 23 of 23 land with no model.

| what you type | what it acts on | kind | lands |
|---|---|---|---|
| `click Remember Me` | Remember Me | Turn something on | yes |
| `click HOME` | HOME | Press a named control | yes |
| `click Hurricanes` | Hurricanes | Press a named control | yes |
| `click Climate Prediction` | Climate Prediction | Press a named control | yes |
| `click Certified Weather Data` | Certified Weather Data | Press a named control | yes |
| `click Brochures` | Brochures | Press a named control | yes |
| `click GIS Data Portal` | GIS Data Portal | Press a named control | yes |
| `click StormReady` | StormReady | Press a named control | yes |
| `click NEWS` | NEWS | Press a named control | yes |
| `click Glossary` | Glossary | Press a named control | yes |
| `click RIVERS, LAKES, RAINFALL` | RIVERS, LAKES, RAINFALL | Press a named control | yes |
| `click Puerto Rico/Virgin Islands` | Puerto Rico/Virgin Islands | Press a named control | yes |
| `click Red Flag Warning` | Red Flag Warning | Press a named control | yes |
| `click High Surf Advisory` | High Surf Advisory | Press a named control | yes |
| `click Beach Hazards Statement` | Beach Hazards Statement | Press a named control | yes |
| `click Weather-Ready Naiton` | Weather-Ready Nation | The same thing, misspelt | yes |
| `click Naitonal Centers` | National Centers | The same thing, misspelt | yes |
| `could you please click HOME for me` | HOME | The same thing, asked politely | yes |
| `could you please click National Centers for me` | National Centers | The same thing, asked politely | yes |
| `search potomac` | Enter Your City, ST or ZIP Code | Search the site | yes |
| `explain this data` | (the page's own values) | Ask about the data | yes |
| `what does this page show` | (the page's own values) | Ask about the data | yes |
| `click the tidal predictions calibrator` | (nothing - should refuse) | Ask for what is not there | yes |

## airnow.gov

Route `GENERIC` - 22 of 23 land with no model.

| what you type | what it acts on | kind | lands |
|---|---|---|---|
| `click How to use this site` | How to use this site | Press a named control | yes |
| `click Announcements` | Announcements | Press a named control | yes |
| `click Using the Air Quality Index` | Using the Air Quality Index | Press a named control | yes |
| `click Air Quality and Health` | Air Quality and Health | Press a named control | yes |
| `click Asthma and Heart Disease` | Asthma and Heart Disease | Press a named control | yes |
| `click More Information` | More Information | Press a named control | yes |
| `click Information by state` | Information by state | Press a named control | yes |
| `click By Monitor` | By Monitor | Press a named control | yes |
| `click Developers/API` | Developers/API | Press a named control | yes |
| `click Information for:` | Information for: | Press a named control | yes |
| `click Mexico` | Mexico | Press a named control | yes |
| `click Web Cameras` | Web Cameras | Press a named control | yes |
| `click Recursos en español` | Recursos en español | Press a named control | yes |
| `click Fire & Smoke Map` | Fire & Smoke Map | Press a named control | yes |
| `click Your Helath` | Your Health | The same thing, misspelt | yes |
| `click AiDrata` | AirData | The same thing, misspelt | yes |
| `click Web Caemras` | Web Cameras | The same thing, misspelt | yes |
| `could you please click How to use this site for me` | How to use this site | The same thing, asked politely | yes |
| `could you please click AirCompare for me` | AirCompare | The same thing, asked politely | yes |
| `search potomac` | ZIP Code, City, or State | Search the site | yes |
| `explain this data` | (the page's own values) | Ask about the data | yes |
| `what does this page show` | (the page's own values) | Ask about the data | yes |
| `click the tidal predictions calibrator` | (nothing - should refuse) | Ask for what is not there | no - refused |

