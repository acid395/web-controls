/* bench-hard.js - prompts that cannot be answered by matching a name.
 *
 * The frozen set in bench-prompts.js is every control's own label, which is
 * exactly what the grounding layer is built to catch - so a run of it
 * measures the fast path and says almost nothing about whether the model
 * works. On droughtmonitor, three of twenty-four prompts reached the model
 * at all.
 *
 * Not one prompt here shares a word with the control it should reach. Every
 * one needs the request understood rather than matched: a paraphrase, the
 * domain's own word for a thing, something only world knowledge connects
 * (the lower 48 is the continental US), or two steps in one sentence.
 *
 * Hand-written on purpose. Meaning is the thing being tested, so it cannot
 * be generated from the page without generating the answer with it.
 *
 * kinds: paraphrase | vocabulary | world-knowledge | chain
 */
globalThis.WC_BENCH_HARD = {
 "droughtmap": {
  "url": "https://droughtmonitor.unl.edu/CurrentMap.aspx",
  "prompts": [
   {
    "say": "compare this week with last week",
    "target": "Compare Two Weeks",
    "kind": "paraphrase"
   },
   {
    "say": "show me the older maps",
    "target": "Map Archive",
    "kind": "paraphrase"
   },
   {
    "say": "I want the raw numbers in a table",
    "target": "Data Tables",
    "kind": "paraphrase"
   },
   {
    "say": "where do I download the shapefiles",
    "target": "GIS Data",
    "kind": "vocabulary"
   },
   {
    "say": "show the map without colour",
    "target": "View grayscale version of the map",
    "kind": "paraphrase"
   },
   {
    "say": "how do I get in touch",
    "target": "Contact Us",
    "kind": "paraphrase"
   },
   {
    "say": "explain what the categories mean",
    "target": "Drought Classification",
    "kind": "paraphrase"
   },
   {
    "say": "show it as a graph over time",
    "target": "Time Series",
    "kind": "paraphrase"
   },
   {
    "say": "how many people are affected",
    "target": "Population Statistics",
    "kind": "paraphrase"
   },
   {
    "say": "I want this in Spanish",
    "target": "En Español",
    "kind": "paraphrase"
   },
   {
    "say": "make an animation of it",
    "target": "Animations",
    "kind": "paraphrase"
   },
   {
    "say": "sign me up for alerts",
    "target": "Drought Alert Request",
    "kind": "paraphrase"
   },
   {
    "say": "show the whole lower 48",
    "target": "Continental U.S.",
    "kind": "world-knowledge"
   },
   {
    "say": "what is the effect on farming",
    "target": "Ag in Drought",
    "kind": "paraphrase"
   },
   {
    "say": "let me build my own map",
    "target": "Custom Map Request",
    "kind": "paraphrase"
   },
   {
    "say": "open maps and then compare two weeks",
    "target": "Compare Two Weeks",
    "kind": "chain"
   },
   {
    "say": "go to data then show the tables",
    "target": "Data Tables",
    "kind": "chain"
   }
  ]
 },
 "usgs": {
  "url": "https://waterdata.usgs.gov/monitoring-location/01646500/",
  "prompts": [
   {
    "say": "show me the water level",
    "target": "Gage height",
    "kind": "vocabulary"
   },
   {
    "say": "plot a month of data",
    "target": "30 days",
    "kind": "paraphrase"
   },
   {
    "say": "switch to a logarithmic scale",
    "target": "Log",
    "kind": "vocabulary"
   },
   {
    "say": "I want the numbers not the picture",
    "target": "Viewtabular data",
    "kind": "paraphrase"
   },
   {
    "say": "let me save this data",
    "target": "Downloaddata",
    "kind": "paraphrase"
   },
   {
    "say": "notify me when the river rises",
    "target": "WaterAlert",
    "kind": "paraphrase"
   },
   {
    "say": "show the chart key",
    "target": "Show legend",
    "kind": "vocabulary"
   },
   {
    "say": "take me to the old version of this page",
    "target": "Legacy real-time page",
    "kind": "paraphrase"
   },
   {
    "say": "what other charts are there",
    "target": "Viewrelated graphs",
    "kind": "paraphrase"
   },
   {
    "say": "give me a full year",
    "target": "1 year",
    "kind": "paraphrase"
   },
   {
    "say": "hide the extra detail",
    "target": "Hide graph details",
    "kind": "paraphrase"
   },
   {
    "say": "show a week of readings",
    "target": "7 days",
    "kind": "paraphrase"
   },
   {
    "say": "show a month and then switch to log",
    "target": "Log",
    "kind": "chain"
   }
  ]
 },
 "noaa": {
  "url": "https://water.noaa.gov/",
  "prompts": [
   {
    "say": "how much rain has already fallen",
    "target": "Past Precipitation Estimates",
    "kind": "paraphrase"
   },
   {
    "say": "what are the rivers doing right now",
    "target": "Rivers-at-a-Glance",
    "kind": "paraphrase"
   },
   {
    "say": "what is the outlook further ahead",
    "target": "Long Range Outlook",
    "kind": "paraphrase"
   },
   {
    "say": "the main points for today",
    "target": "Key Messages",
    "kind": "paraphrase"
   },
   {
    "say": "how much snow is there",
    "target": "National Snow Analysis",
    "kind": "paraphrase"
   },
   {
    "say": "where is it too dry",
    "target": "Drought",
    "kind": "paraphrase"
   },
   {
    "say": "I am a developer, where are the endpoints",
    "target": "NWPS APIs",
    "kind": "paraphrase"
   },
   {
    "say": "where might it flood",
    "target": "Flood Inundation Mapping",
    "kind": "paraphrase"
   },
   {
    "say": "how do I read a hydrograph",
    "target": "Hydrograph Information",
    "kind": "paraphrase"
   },
   {
    "say": "who runs this",
    "target": "Office of Water Prediction",
    "kind": "paraphrase"
   },
   {
    "say": "is there ice on the rivers",
    "target": "River Ice Surveillance",
    "kind": "paraphrase"
   },
   {
    "say": "how to stay safe in a flood",
    "target": "Flood and Safety Resources",
    "kind": "paraphrase"
   }
  ]
 },
 "weather": {
  "url": "https://www.weather.gov/",
  "prompts": [
   {
    "say": "what happened yesterday",
    "target": "PAST WEATHER",
    "kind": "paraphrase"
   },
   {
    "say": "when does the sun come up",
    "target": "Sunrise/Sunset",
    "kind": "paraphrase"
   },
   {
    "say": "is there a hurricane coming",
    "target": "Hurricanes",
    "kind": "paraphrase"
   },
   {
    "say": "conditions for flying",
    "target": "Aviation",
    "kind": "paraphrase"
   },
   {
    "say": "conditions at sea",
    "target": "Marine",
    "kind": "paraphrase"
   },
   {
    "say": "what do these terms mean",
    "target": "Glossary",
    "kind": "paraphrase"
   },
   {
    "say": "I want to work here",
    "target": "Careers",
    "kind": "paraphrase"
   },
   {
    "say": "wildfire conditions",
    "target": "Fire Weather",
    "kind": "paraphrase"
   },
   {
    "say": "how do I reach someone",
    "target": "Contact Us",
    "kind": "paraphrase"
   },
   {
    "say": "weather months from now",
    "target": "Long Range Forecasts",
    "kind": "paraphrase"
   },
   {
    "say": "alerts on my phone",
    "target": "Wireless Emergency Alerts",
    "kind": "paraphrase"
   },
   {
    "say": "storm spotter training",
    "target": "SKYWARN Storm Spotters",
    "kind": "paraphrase"
   }
  ]
 },
 "airnow": {
  "url": "https://www.airnow.gov/",
  "prompts": [
   {
    "say": "is the air bad today",
    "target": "Air Quality Index (AQI)",
    "kind": "paraphrase"
   },
   {
    "say": "smoke from wildfires",
    "target": "Fire and Smoke Map",
    "kind": "paraphrase"
   },
   {
    "say": "I have asthma, what should I know",
    "target": "Asthma and Heart Disease",
    "kind": "paraphrase"
   },
   {
    "say": "air quality where I live",
    "target": "Information by state",
    "kind": "paraphrase"
   },
   {
    "say": "historical readings",
    "target": "Past Data",
    "kind": "paraphrase"
   },
   {
    "say": "how is the number worked out",
    "target": "AQI Basics",
    "kind": "paraphrase"
   },
   {
    "say": "I want the raw feed for an app",
    "target": "Developers/API",
    "kind": "paraphrase"
   },
   {
    "say": "something for my classroom",
    "target": "School Resources",
    "kind": "paraphrase"
   },
   {
    "say": "how do I reach someone",
    "target": "Contact Us",
    "kind": "paraphrase"
   },
   {
    "say": "what can I do to help",
    "target": "What You Can Do",
    "kind": "paraphrase"
   },
   {
    "say": "is there an app",
    "target": "AirNow Mobile App",
    "kind": "paraphrase"
   },
   {
    "say": "the pollutant that forms on hot sunny days",
    "target": "Ozone",
    "kind": "world-knowledge"
   }
  ]
 },
 "drought": {
  "url": "https://www.drought.gov/",
  "prompts": [
   {
    "say": "how dry is it right now",
    "target": "Current Conditions",
    "kind": "paraphrase"
   },
   {
    "say": "what is expected in the months ahead",
    "target": "Outlooks and Forecasts",
    "kind": "paraphrase"
   },
   {
    "say": "how far back do the records go",
    "target": "Paleoclimate",
    "kind": "world-knowledge"
   },
   {
    "say": "effects on growing crops",
    "target": "Agriculture",
    "kind": "paraphrase"
   },
   {
    "say": "how wet is the ground",
    "target": "Soil Moisture",
    "kind": "paraphrase"
   },
   {
    "say": "is there enough in the reservoirs",
    "target": "Water Supply",
    "kind": "paraphrase"
   },
   {
    "say": "risk of things burning",
    "target": "Wildfire Management",
    "kind": "paraphrase"
   },
   {
    "say": "how are the plants doing",
    "target": "Vegetation",
    "kind": "paraphrase"
   },
   {
    "say": "effects on people's wellbeing",
    "target": "Public Health",
    "kind": "paraphrase"
   },
   {
    "say": "not enough snow in the mountains",
    "target": "Snow Drought",
    "kind": "paraphrase"
   },
   {
    "say": "narrow it to one state",
    "target": "Select a State",
    "kind": "paraphrase"
   },
   {
    "say": "what does drought mean",
    "target": "Drought Basics",
    "kind": "paraphrase"
   },
   {
    "say": "a drought that comes on suddenly",
    "target": "Flash Drought",
    "kind": "paraphrase"
   },
   {
    "say": "impact on shipping and barges",
    "target": "Navigation and Transportation",
    "kind": "paraphrase"
   },
   {
    "say": "papers and studies",
    "target": "All Documents and Reports",
    "kind": "paraphrase"
   }
  ]
 }
};
