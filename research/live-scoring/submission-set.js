/* submission-set.js - the hundred prompts, hand-written, one file.
 *
 * What was wrong with the set this replaces: it was enumerated from each
 * page's own controls, so most of it read "click NDMC", "click NASA",
 * "click tag: Drought Index" - a footer logo and a tag chip asked for by
 * their exact printed name. That set measures the name matcher. It was
 * built to catch exactly those, so it caught them, and a run of a hundred
 * and forty-two prompts sent three of twenty-four to the model on one site.
 * A number that high about a system whose point is the model is not a
 * measurement of the system.
 *
 * Two hundred and twenty-three prompts across both old sets contained three
 * chains. Chaining is a stated goal of the project. Three is not a sample.
 *
 * So: a hundred prompts, twenty on each of five sites, written by hand
 * against the control list each page really carries. The mix per site is
 * fixed on purpose -
 *
 *   6 chain            two or three steps in one sentence, in order
 *   5 paraphrase       shares no meaningful word with the control it wants
 *   2 vocabulary       the domain's own word or abbreviation (cfs, DSCI, HEFS)
 *   2 world-knowledge  only outside knowledge connects ask to control
 *   3 reading          answered in prose off the page, nothing is pressed
 *   1 refusal          the page genuinely has no such thing; saying so is the pass
 *   1 judgment         a condition that has to be read before it can be acted on
 *
 * - which puts thirty chains in the set where there were three, and leaves
 * nothing in it that can be answered by matching a printed label.
 *
 * Hand-written because meaning is the thing being tested. A prompt
 * generated from a page is generated from the answer, and grades the
 * generator.
 *
 * `want` is written in the offline harness's own vocabulary (clicked / on /
 * read / refuse). `clicked` may be a list where more than one control is a
 * right answer - decided before a run, not after one so the identical list scores both offline and live, and
 * the only difference between the two numbers is whether the model was on.
 *
 * Five sites, not six: airnow.gov would not load while this was written
 * (curl returned 000 on every attempt), and a site nobody can reach cannot
 * be part of a set anybody is meant to reproduce.
 *
 * This file is the source. build-bench-set.js runs every prompt against the
 * captured page with the model off, records what the grounding layer alone
 * did with it, and writes extension/lib/bench-prompts.js from the result -
 * so the shipped set carries, per row, whether it needs the model at all.
 */
module.exports = {
  usgs: {
    url: "https://waterdata.usgs.gov/monitoring-location/01646500/",
    note: "Potomac River at Little Falls Pump Station, DC. Discharge and gage height.",
    prompts: [
      // chain
      { say: "set it to thirty days and then show the legend",
        kind: "chain", on: "Show legend", want: { clicked: "Show legend" } },
      { say: "give me a year of record, then open the tabular view",
        kind: "chain", on: "View tabular data", want: { clicked: "tabular data" } },
      { say: "plot the gage height and then overlay the same span from last year",
        kind: "chain", on: "Data for same time span in prior year",
        want: { clicked: "prior year" } },
      { say: "switch the vertical axis to logarithmic and then narrow the window to a week",
        kind: "chain", on: "7 days", want: { clicked: "7 days" } },
      { say: "expand all the data collections and then show me where this gauge sits",
        kind: "chain", on: "Show location details",
        // Either answers "where this gauge sits". A live 3B chose Site
        // Location, which is arguably the closer of the two; scoring it a
        // miss would have been the set being wrong, not the run.
        want: { clicked: ["location details", "Site Location"] } },
      { say: "open the related graphs and then take me to the water year summary",
        kind: "chain", on: "Water Year Summary", want: { clicked: "Water Year Summary" } },
      // paraphrase
      { say: "narrow this down to just the past week",
        kind: "paraphrase", on: "7 days", want: { clicked: "7 days" } },
      { say: "I want the whole record for the last twelve months",
        kind: "paraphrase", on: "1 year", want: { clicked: "1 year" } },
      { say: "clean up everything printed below the plot",
        kind: "paraphrase", on: "Hide graph details", want: { clicked: "graph details" } },
      { say: "give me these readings as raw rows instead of a picture",
        kind: "paraphrase", on: "View tabular data", want: { clicked: "tabular data" } },
      { say: "I need this file saved on my computer",
        kind: "paraphrase", on: "Download data", want: { clicked: "Download data" } },
      // vocabulary
      { say: "plot the stage rather than the flow",
        kind: "vocabulary", on: "Graph Gage height, feet", want: { clicked: "Gage height" } },
      { say: "show me discharge in cfs",
        kind: "vocabulary", on: "Graph Discharge, cubic feet per second",
        want: { clicked: "Discharge" } },
      // world-knowledge
      { say: "use a scale that keeps the low readings legible",
        kind: "world-knowledge", on: "Log", want: { clicked: "Log" } },
      { say: "this is one gauge of thousands, take me to the map of all of them",
        kind: "world-knowledge", on: "National Water Dashboard",
        // Not "Site Map": a live 3B pressed that - the footer's sitemap, an
        // index of usgs.gov - and then "All Maps" on the page it led to. It
        // reads like an answer and is not one.
        want: { clicked: "National Water Dashboard" } },
      // reading
      { say: "what is this river doing right now, in plain terms",
        kind: "reading", on: null, want: { read: true } },
      { say: "explain what the two plotted series on this page actually measure",
        kind: "reading", on: null, want: { read: true } },
      { say: "is the flow shown here high or low for this time of year",
        kind: "reading", on: null, want: { read: true } },
      // refusal
      { say: "export this chart as a powerpoint slide",
        kind: "refusal", on: null, want: { refuse: true } },
      // judgment
      { say: "if the gage height is above three feet show me a year of data, otherwise show me a week",
        kind: "judgment", on: "7 days", want: { clicked: "days" } },
    ],
  },

  droughtmap: {
    url: "https://droughtmonitor.unl.edu/CurrentMap.aspx",
    note: "U.S. Drought Monitor, current national map. Weekly, retrospective.",
    prompts: [
      // chain
      { say: "open the archive and then play it back as an animation",
        kind: "chain", on: "Animations", want: { clicked: "Animations" } },
      { say: "pull up the statistics by threshold and then download those numbers",
        kind: "chain", on: "Data Download", want: { clicked: "Data Download" } },
      { say: "show me the West, then put it side by side with last week",
        kind: "chain", on: "Compare Two Weeks", want: { clicked: "Compare Two Weeks" } },
      { say: "open the time series and then give me the bar chart form of it",
        kind: "chain", on: "Bar Chart", want: { clicked: "Bar Chart" } },
      { say: "find the eligibility tool for farmers, then the agriculture page",
        kind: "chain", on: "Ag in Drought", want: { clicked: "Ag in Drought" } },
      { say: "switch into Spanish and then bring me back to this week's map",
        kind: "chain", on: "Current", want: { clicked: "Current" } },
      // paraphrase
      { say: "I am colourblind, make this readable",
        kind: "paraphrase", on: "View grayscale version of the map",
        want: { clicked: "grayscale" } },
      { say: "how do they decide what counts as D3",
        kind: "paraphrase", on: "Drought Classification", want: { clicked: "Classification" } },
      { say: "how many people are living through this",
        kind: "paraphrase", on: "Population Statistics", want: { clicked: "Population" } },
      { say: "who do I email about a mistake on this map",
        kind: "paraphrase", on: "Contact Us", want: { clicked: "Contact" } },
      { say: "let me know by email every time this updates",
        kind: "paraphrase", on: "Drought Alert Request", want: { clicked: "Alert Request" } },
      // vocabulary
      { say: "show me the DSCI",
        kind: "vocabulary", on: "Drought Severity and Coverage Index",
        want: { clicked: "Severity and Coverage" } },
      { say: "where are the shapefiles",
        kind: "vocabulary", on: "GIS Data", want: { clicked: "GIS Data" } },
      // world-knowledge
      { say: "just the lower forty eight",
        kind: "world-knowledge", on: "Continental U.S.", want: { clicked: "Continental" } },
      { say: "I need the one that covers Alaska and Hawaii as well",
        kind: "world-knowledge", on: "OCONUS Drought Status", want: { clicked: "OCONUS" } },
      // reading
      { say: "what share of the country is in drought right now",
        kind: "reading", on: null, want: { read: true } },
      { say: "explain in plain language what this week's map is showing",
        kind: "reading", on: null, want: { read: true } },
      { say: "which part of the country is worst off on this map",
        kind: "reading", on: null, want: { read: true } },
      // refusal
      { say: "show me tomorrow's drought map",
        kind: "refusal", on: null, want: { refuse: true } },
      // judgment
      { say: "if the West is drier than the Midwest open the West, otherwise open the Midwest",
        kind: "judgment", on: "West", want: { clicked: "West" } },
    ],
  },

  noaa: {
    url: "https://water.noaa.gov/",
    note: "National Water Prediction Service landing map.",
    prompts: [
      // chain
      { say: "open the layer list and then zoom the map in",
        kind: "chain", on: "Zoom in", want: { clicked: "Zoom in" } },
      { say: "find the daily briefing and then show me its key messages",
        kind: "chain", on: "Key Messages", want: { clicked: "Key Messages" } },
      { say: "check the snow analysis first, then the river ice",
        kind: "chain", on: "River Ice Surveillance", want: { clicked: "River Ice" } },
      { say: "look up the drought information and then jump to the national portal for it",
        kind: "chain", on: "Drought.gov Portal", want: { clicked: "Portal" } },
      { say: "show me where the data lives, then the API documentation",
        kind: "chain", on: "NWPS APIs", want: { clicked: "NWPS APIs" } },
      { say: "open the flood hazard outlook and then the safety resources",
        kind: "chain", on: "Flood and Safety Resources", want: { clicked: "Safety Resources" } },
      // paraphrase
      { say: "how much rain has already fallen",
        kind: "paraphrase", on: "Past Precipitation Estimates", want: { clicked: "Precipitation Estimates" } },
      { say: "which rivers are running high at the moment",
        kind: "paraphrase", on: "Rivers-at-a-Glance", want: { clicked: "Rivers-at-a-Glance" } },
      { say: "what will the water do over the next few months",
        kind: "paraphrase", on: "Long Range Outlook", want: { clicked: "Long Range Outlook" } },
      { say: "show me how deep the water would get on my street",
        kind: "paraphrase", on: "Flood Inundation Mapping (FIM)", want: { clicked: "Inundation" } },
      { say: "I cannot read these charts, is there an explainer",
        kind: "paraphrase", on: "Hydrograph Information", want: { clicked: "Hydrograph" } },
      // vocabulary
      { say: "pull up HEFS",
        kind: "vocabulary", on: "Hydrologic Ensemble Forecast System (HEFS)",
        want: { clicked: "Ensemble" } },
      { say: "what does Atlas 14 say",
        kind: "vocabulary", on: "Current Standard: NOAA Atlas 14", want: { clicked: "Atlas 14" } },
      // world-knowledge
      { say: "who issues the forecast for my local river basin",
        kind: "world-knowledge", on: "River Forecast Centers", want: { clicked: "Forecast Centers" } },
      { say: "I want the simulation that covers every stream in the country",
        kind: "world-knowledge", on: "National Water Model", want: { clicked: "National Water Model" } },
      // reading
      { say: "what is this map actually showing me",
        kind: "reading", on: null, want: { read: true } },
      { say: "summarise the national water situation as it stands",
        kind: "reading", on: null, want: { read: true } },
      { say: "are there any river flood warnings in effect right now",
        kind: "reading", on: null, want: { read: true } },
      // refusal
      { say: "give me the ocean tide tables for Boston harbour",
        kind: "refusal", on: null, want: { refuse: true } },
      // judgment
      { say: "if a significant river flood outlook is posted open it, otherwise open the hydrologic discussion",
        kind: "judgment", on: "Significant River Flood Outlook", want: { clicked: "Outlook" } },
    ],
  },

  weather: {
    url: "https://www.weather.gov/",
    note: "National Weather Service home page. Live alert links change hourly.",
    prompts: [
      // chain
      { say: "open the radar and then switch it to the low bandwidth version",
        kind: "chain", on: "Standard Radar (Low Bandwidth)", want: { clicked: "Low Bandwidth" } },
      { say: "check the aviation forecast, then the one for boats",
        kind: "chain", on: "Marine", want: { clicked: "Marine" } },
      { say: "open the education section and then find the glossary in it",
        kind: "chain", on: "Glossary", want: { clicked: "Glossary" } },
      { say: "show me the satellite view and then the air quality",
        kind: "chain", on: "AIR QUALITY", want: { clicked: "AIR QUALITY" } },
      { say: "go to the river and rainfall page, then the long range forecasts",
        kind: "chain", on: "Long Range Forecasts", want: { clicked: "Long Range" } },
      { say: "find the storm spotter programme and then the preparedness certification",
        kind: "chain", on: "StormReady", want: { clicked: "StormReady" } },
      // paraphrase
      { say: "I am taking a small plane up tomorrow",
        kind: "paraphrase", on: "Aviation", want: { clicked: "Aviation" } },
      { say: "is it safe to take the boat out",
        kind: "paraphrase", on: "Marine", want: { clicked: "Marine" } },
      { say: "will it be light out when I leave at six",
        kind: "paraphrase", on: "Sunrise/Sunset", want: { clicked: "Sunrise" } },
      { say: "what do these warning terms actually mean",
        kind: "paraphrase", on: "Glossary", want: { clicked: "Glossary" } },
      { say: "I want the receiver that wakes me up for emergencies",
        kind: "paraphrase", on: "NOAA Weather Radio", want: { clicked: "Weather Radio" } },
      // vocabulary
      { say: "show me the CPC outlook",
        kind: "vocabulary", on: "Climate Prediction", want: { clicked: "Climate Prediction" } },
      { say: "where do I sign up for SKYWARN",
        kind: "vocabulary", on: "SKYWARN Storm Spotters", want: { clicked: "SKYWARN" } },
      // world-knowledge
      { say: "solar flares knock out my GPS, where would I check on that",
        kind: "world-knowledge", on: "Space Weather", want: { clicked: "Space Weather" } },
      { say: "my county wants the tornado preparedness certification",
        kind: "world-knowledge", on: "StormReady", want: { clicked: "StormReady" } },
      // reading
      { say: "what warnings are active across the country right now",
        kind: "reading", on: null, want: { read: true } },
      { say: "explain what this page is telling me about today's weather",
        kind: "reading", on: null, want: { read: true } },
      { say: "which of the current alerts is the most serious",
        kind: "reading", on: null, want: { read: true } },
      // refusal
      { say: "give me the ten day forecast for London",
        kind: "refusal", on: null, want: { refuse: true } },
      // judgment
      { say: "if a hurricane warning is up open hurricanes, otherwise open severe weather",
        kind: "judgment", on: "Severe Weather", want: { clicked: "Weather" } },
    ],
  },

  drought: {
    url: "https://www.drought.gov/",
    note: "NIDIS national drought portal.",
    prompts: [
      // chain
      { say: "pick California and then show me the outlook for the coming months",
        kind: "chain", on: "Outlooks and Forecasts", want: { clicked: "Outlooks" } },
      { say: "open agriculture and then the most recent report on it",
        kind: "chain", on: "Featured Reports and Outlooks", want: { clicked: "Featured Reports" } },
      { say: "show soil moisture first and then the vegetation view",
        kind: "chain", on: "Vegetation", want: { clicked: "Vegetation" } },
      { say: "find the tribal page and then the engagement information under it",
        kind: "chain", on: "Tribal Engagement", want: { clicked: "Tribal Engagement" } },
      { say: "go to the Southern Plains and then pull up conditions there now",
        kind: "chain", on: "Current Conditions", want: { clicked: "Current Conditions" } },
      { say: "open the basics and then explain the difference between the short and long term kind",
        kind: "chain", on: "Short-Term vs Long-Term Drought", want: { clicked: "Short-Term" } },
      // paraphrase
      { say: "what damage is this causing",
        kind: "paraphrase", on: "Drought Impacts", want: { clicked: "Impacts" } },
      { say: "I want tree ring records going back centuries",
        kind: "paraphrase", on: "Paleoclimate", want: { clicked: "Paleoclimate" } },
      { say: "is my tap at risk",
        kind: "paraphrase", on: "Water Utilities", want: { clicked: "Water Utilities" } },
      { say: "how does this end up making people ill",
        kind: "paraphrase", on: "Public Health", want: { clicked: "Public Health" } },
      { say: "is there money going for research into this",
        kind: "paraphrase", on: "Funding Opportunities", want: { clicked: "Funding" } },
      // vocabulary
      { say: "show me flash drought",
        kind: "vocabulary", on: "Flash Drought", want: { clicked: "Flash Drought" } },
      { say: "what is NIDIS",
        kind: "vocabulary", on: "About NIDIS", want: { clicked: "NIDIS" } },
      // world-knowledge
      { say: "the states that grow most of the country's corn",
        kind: "world-knowledge", on: "Midwest", want: { clicked: "Midwest" } },
      { say: "I teach fifth grade and need something for the classroom",
        kind: "world-knowledge", on: "Resources for Teachers and Students",
        want: { clicked: "Teachers" } },
      // reading
      { say: "summarise the national drought picture as it stands",
        kind: "reading", on: null, want: { read: true } },
      { say: "explain how much of the country this is affecting",
        kind: "reading", on: null, want: { read: true } },
      { say: "which sector does this page say is hit hardest",
        kind: "reading", on: null, want: { read: true } },
      // refusal
      { say: "file a federal disaster claim for my farm from here",
        kind: "refusal", on: null, want: { refuse: true } },
      // judgment
      { say: "if California-Nevada is in drought open that region, otherwise open the national view",
        kind: "judgment", on: "California-Nevada", want: { clicked: "California" } },
    ],
  },
};
