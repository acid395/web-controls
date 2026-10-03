/* submission-set.js - the hundred prompts, hand-written, one file.
 *
 * Two kinds of thing, and combinations of them. Nothing else.
 *
 *   action          one visible change: a click, a toggle, a tab, a menu,
 *                   a search, a choice from a list
 *   explain         a question answered from data the page carries
 *   action+explain  do something, then explain what it brought up
 *   multistep       two or three actions in order
 *
 * The previous set mixed in paraphrase puzzles, refusals and conditions,
 * which measure something real but not what this set is for: whether the
 * extension operates these sites and reads them.
 *
 * Built from what the live runs taught. A chain whose first step leaves the
 * page fails if its second step is not on the page it lands on, so every
 * multistep prompt here either stays on one page or uses controls every page
 * of the site carries - the top menus - for the steps after it leaves.
 * \`later: true\` marks those: only the first step is checked against the
 * captured starting page, because the rest happen somewhere else.
 *
 * And explaining needs something to explain. droughtmonitor's map and
 * water.noaa.gov's are images and canvases, and weather.gov's front page
 * carries almost no text - so explain prompts there ask about what those
 * pages do write down (dates, legends, the alert list, the discussion), and
 * the richer questions come after a step that opens a page with the data.
 *
 * `steps` are the controls each prompt should reach, in order. `explain`
 * says an answer in prose is expected as well.
 *
 * Five sites: airnow.gov would not load when the set was first written.
 *
 * build-bench-set.js runs every prompt against the captured page with the
 * model off and writes extension/lib/bench-prompts.js from the result.
 */
module.exports = {
  usgs: {
    url: "https://waterdata.usgs.gov/monitoring-location/01646500/",
    note: "Potomac River at Little Falls Pump Station, DC. Gage height, discharge and water quality.",
    prompts: [
      { say: "switch the graph to show the last 30 days", kind: "action", steps: ["30 days"] },
      { say: "change the graph to a logarithmic scale", kind: "action", steps: ["Log"] },
      { say: "graph the discharge instead of the gage height", kind: "action",
        steps: ["Graph Discharge, cubic feet per second"] },
      { say: "show the turbidity on the graph", kind: "action",
        steps: ["Graph Turbidity, water, unfiltered"] },
      { say: "open the table of data values", kind: "action", steps: ["View tabular data"] },
      { say: "switch the location map to satellite imagery", kind: "action", steps: ["Imagery"] },
      { say: "set the time span to the last 14 days", kind: "action",
        steps: ["Change time span", "Days before today"] },

      { say: "what is the latest gage height reading and when was it taken", kind: "explain", explain: true },
      { say: "explain what this monitoring location measures", kind: "explain", explain: true },
      { say: "how far back does the discharge record go", kind: "explain", explain: true },
      { say: "summarize how the water level has changed over the past week", kind: "explain", explain: true },
      { say: "is the latest reading provisional or approved, and what does that mean", kind: "explain", explain: true },

      { say: "switch to the 1 year view and describe the overall trend in gage height",
        kind: "action+explain", steps: ["1 year"], explain: true },
      { say: "graph the discharge and tell me the most recent flow value",
        kind: "action+explain", steps: ["Graph Discharge, cubic feet per second"], explain: true },
      { say: "turn on last year's data for comparison and explain how this year differs",
        kind: "action+explain", steps: ["Data for same time span in prior year"], explain: true },
      { say: "open the tabular data and tell me the highest value in it",
        kind: "action+explain", steps: ["View tabular data"], explain: true },

      { say: "graph the discharge, switch to 30 days, and put it on a log scale", kind: "multistep",
        steps: ["Graph Discharge, cubic feet per second", "30 days", "Log"] },
      { say: "change the time span to 1 year, then show the legend", kind: "multistep",
        steps: ["1 year", "Show legend"] },
      { say: "expand all the data collections, then show the location details", kind: "multistep",
        steps: ["Expand all data collections", "Show location details"] },
      { say: "zoom in on the location map and switch it to imagery", kind: "multistep",
        steps: ["Zoom in", "Imagery"] },
    ],
  },

  droughtmap: {
    url: "https://droughtmonitor.unl.edu/CurrentMap.aspx",
    note: "U.S. Drought Monitor, current national map. Weekly; the map is an image.",
    prompts: [
      { say: "show the previous week's drought map", kind: "action", steps: ["Previous Map"] },
      { say: "switch the map to grayscale", kind: "action", steps: ["View grayscale version of the map"] },
      { say: "open the list of regions", kind: "action", steps: ["Regions"] },
      { say: "show the drought map for the Southeast", kind: "action", steps: ["Southeast"] },
      { say: "open the map archive", kind: "action", steps: ["Map Archive"] },
      { say: "go to the time series data", kind: "action", steps: ["Time Series"] },
      { say: "open the compare two weeks tool", kind: "action", steps: ["Compare Two Weeks"] },

      { say: "when was this drought map released and what date is the data valid for", kind: "explain", explain: true },
      { say: "explain what the D0 through D4 categories on the legend mean", kind: "explain", explain: true },
      { say: "explain what this map shows and how to read it", kind: "explain", explain: true },
      { say: "how many people are in drought right now", kind: "explain", explain: true },
      { say: "what time of day is the new map released each week", kind: "explain", explain: true },

      { say: "show the previous week's map and tell me what date that map is valid for",
        kind: "action+explain", steps: ["Previous Map"], explain: true },
      { say: "open the West regional map and explain what it shows",
        kind: "action+explain", steps: ["West"], explain: true },
      { say: "go to the summary page and summarize this week's drought conditions",
        kind: "action+explain", steps: ["Summary"], explain: true },
      { say: "open the statistics by threshold page and explain what the numbers represent",
        kind: "action+explain", steps: ["Statistics by Threshold"], explain: true },

      { say: "open the map archive, then play the animation", kind: "multistep",
        steps: ["Map Archive", "Animations"], later: true },
      { say: "open the regions list and choose the Midwest", kind: "multistep",
        steps: ["Regions", "Midwest"] },
      { say: "switch to grayscale, then show the previous week's map", kind: "multistep",
        steps: ["View grayscale version of the map", "Previous Map"] },
      { say: "go to the data tables, then open the time series", kind: "multistep",
        steps: ["Data Tables", "Time Series"], later: true },
    ],
  },

  noaa: {
    url: "https://water.noaa.gov/",
    note: "National Water Prediction Service landing map. The map is a canvas.",
    prompts: [
      { say: "zoom in on the map", kind: "action", steps: ["Zoom in"] },
      { say: "zoom out on the map", kind: "action", steps: ["Zoom out"] },
      { say: "open the map layers panel", kind: "action", steps: ["View Layers"] },
      { say: "search the map for Sacramento", kind: "action", steps: ["Search Locaction"] },
      { say: "open the shortcuts menu", kind: "action", steps: ["Shortcuts"] },
      { say: "open the forecasts and outlooks menu", kind: "action", steps: ["Forecasts and Outlooks"] },
      { say: "go to the rivers at a glance page", kind: "action", steps: ["Rivers-at-a-Glance"] },

      { say: "explain what this map shows", kind: "explain", explain: true },
      { say: "what do the flood categories in the map legend mean", kind: "explain", explain: true },
      { say: "what date is the latest hydrologic discussion from", kind: "explain", explain: true },
      { say: "what is the update notice at the top of the page about", kind: "explain", explain: true },
      { say: "what does the national hydrologic discussion say today", kind: "explain", explain: true },

      { say: "open the hydrologic discussion in full page view and summarize it",
        kind: "action+explain", steps: ["View full page"], explain: true },
      { say: "open the map layers panel and tell me which layers are available",
        kind: "action+explain", steps: ["View Layers"], explain: true },
      { say: "go to the NWPS FAQ and explain what NWPS is",
        kind: "action+explain", steps: ["NWPS FAQ"], explain: true },
      { say: "open the national hydrologic discussion and summarize the main concerns",
        kind: "action+explain", steps: ["National Hydrologic Discussion"], explain: true },

      { say: "zoom in twice, then open the layers panel", kind: "multistep",
        steps: ["Zoom in", "Zoom in", "View Layers"] },
      { say: "search for St. Louis, then zoom in", kind: "multistep",
        steps: ["Search Locaction", "Zoom in"] },
      { say: "open the forecasts and outlooks menu, then go to the long range outlook", kind: "multistep",
        steps: ["Forecasts and Outlooks", "Long Range Outlook"] },
      { say: "open the data and APIs menu, then go to the NWPS APIs page", kind: "multistep",
        steps: ["Data and APIs", "NWPS APIs"] },
    ],
  },

  weather: {
    url: "https://www.weather.gov/",
    note: "National Weather Service home page. The front page is mostly an image; alerts change hourly.",
    prompts: [
      { say: "enter 20001 in the local forecast box and get the forecast", kind: "action",
        steps: ["Enter Your City, ST or ZIP Code"] },
      { say: "open the active alerts", kind: "action", steps: ["ACTIVE ALERTS"] },
      { say: "show the national radar", kind: "action", steps: ["RADAR"] },
      { say: "open the satellite imagery", kind: "action", steps: ["SATELLITE"] },
      { say: "show the warnings for Texas", kind: "action", steps: ["Warnings By State"] },
      { say: "search the weather service site for heat safety", kind: "action", steps: ["Search For"] },
      { say: "open the marine forecasts", kind: "action", steps: ["Marine"] },

      { say: "which warnings and advisories are listed on the hazards map right now", kind: "explain", explain: true },
      { say: "what does the map on the front page show", kind: "explain", explain: true },
      { say: "which of the listed alerts is the most severe", kind: "explain", explain: true },

      { say: "get the forecast for ZIP code 10001 and summarize the next two days",
        kind: "action+explain", steps: ["Enter Your City, ST or ZIP Code"], explain: true },
      { say: "open the active alerts and tell me which states have flood warnings",
        kind: "action+explain", steps: ["ACTIVE ALERTS"], explain: true },
      { say: "open the first warning listed on the hazards map and summarize it",
        kind: "action+explain", steps: ["Warning"], explain: true },
      { say: "show the warnings for Florida and summarize what is in effect",
        kind: "action+explain", steps: ["Warnings By State"], explain: true },
      { say: "search the site for wind chill and summarize the top result",
        kind: "action+explain", steps: ["Search For"], explain: true },

      { say: "open the forecast menu and then go to aviation", kind: "multistep",
        steps: ["FORECAST", "Aviation"] },
      { say: "type 60601 into the forecast box, get the forecast, then open the hourly weather graph",
        kind: "multistep", steps: ["Enter Your City, ST or ZIP Code", "Hourly Weather Forecast"], later: true },
      { say: "pick Colorado in the warnings by state list and press go", kind: "multistep",
        steps: ["Warnings By State", "Warnings By State"] },
      { say: "open the safety menu, then go to the NOAA Weather Radio page", kind: "multistep",
        steps: ["SAFETY", "NOAA Weather Radio"] },
      { say: "search the site for flood safety, then open the first result", kind: "multistep",
        steps: ["Search For", "the first result"], later: true },
    ],
  },

  drought: {
    url: "https://www.drought.gov/",
    note: "NIDIS national drought portal. Carries a D0-D4 percentage table.",
    prompts: [
      { say: "switch the map to the 30-day precipitation view", kind: "action", steps: ["30-Day Precipitation"] },
      { say: "show the 30-day temperature map", kind: "action", steps: ["30-Day Temperature"] },
      { say: "select Colorado from the state list", kind: "action", steps: ["Select a State"] },
      { say: "open the data and maps menu", kind: "action", steps: ["Data and Maps"] },
      { say: "search the site for snow drought", kind: "action", steps: ["Open Search Bar"] },
      { say: "hide the abnormally dry areas on the map", kind: "action", steps: ["D0 - Abnormally Dry"] },
      { say: "go to the agriculture sector page", kind: "action", steps: ["Agriculture"] },

      { say: "what percentage of the country is in drought right now", kind: "explain", explain: true },
      { say: "how much of the U.S. is in extreme or exceptional drought", kind: "explain", explain: true },
      { say: "explain what the D0 through D4 categories in the map legend mean", kind: "explain", explain: true },
      { say: "which regions have recent drought status updates, and when were they published", kind: "explain", explain: true },
      { say: "which drought category covers the largest share of the country", kind: "explain", explain: true },

      { say: "switch to the 30-day precipitation map and explain what its legend shows",
        kind: "action+explain", steps: ["30-Day Precipitation"], explain: true },
      { say: "pick Texas from the state list and summarize its current drought conditions",
        kind: "action+explain", steps: ["Select a State"], explain: true },
      { say: "open the latest drought status update and summarize it",
        kind: "action+explain", steps: ["Drought Status Update"], explain: true },
      { say: "look up Denver, CO in the neighborhood drought search and tell me the drought level there",
        kind: "action+explain", steps: ["How is drought affecting your neighborhood?"], explain: true },

      { say: "show the 30-day temperature map, then switch back to the U.S. Drought Monitor map", kind: "multistep",
        steps: ["30-Day Temperature", "U.S. Drought Monitor"] },
      { say: "open the by sector menu, then go to water utilities", kind: "multistep",
        steps: ["By Sector", "Water Utilities"] },
      { say: "search the site for flash drought, then open the first result", kind: "multistep",
        steps: ["Open Search Bar", "the first result"], later: true },
      { say: "open the research and learn menu and go to drought basics", kind: "multistep",
        steps: ["Research and Learn", "Drought Basics"] },
    ],
  },
};
