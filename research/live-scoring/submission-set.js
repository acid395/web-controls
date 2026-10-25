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
      { say: "where exactly is this gauge located, according to the page", kind: "explain", explain: true },
      { say: "is the latest reading provisional or approved, and what does that mean", kind: "explain", explain: true },

      { say: "show the daily data types and tell me how far back the daily record goes",
        kind: "action+explain", steps: ["Show these data types"], explain: true },
      { say: "graph the discharge and tell me the most recent flow value",
        kind: "action+explain", steps: ["Graph Discharge, cubic feet per second"], explain: true },
      { say: "graph the water temperature from the multiparameter sonde and tell me the latest temperature",
        kind: "action+explain", steps: ["Graph Temperature, water, degrees Celsius From m"], explain: true },
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
      { say: "according to this week's drought summary, what weather pattern continued over the past week", kind: "explain", explain: true },
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
      { say: "according to the national hydrologic discussion, where is coastal flooding expected", kind: "explain", explain: true },
      { say: "what date is the latest hydrologic discussion from", kind: "explain", explain: true },
      { say: "what is the update notice at the top of the page about", kind: "explain", explain: true },
      { say: "what does the national hydrologic discussion say today", kind: "explain", explain: true },

      { say: "open the hydrologic discussion in full page view and summarize it",
        kind: "action+explain", steps: ["View full page"], explain: true },
      { say: "go to the office of water prediction page and tell me where its offices are located",
        kind: "action+explain", steps: ["Office of Water Prediction"], explain: true },
      { say: "go to the hydrograph information page and explain what moderate flooding means",
        kind: "action+explain", steps: ["Hydrograph Information"], explain: true },
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
      { say: "open the space weather prediction center", kind: "action", steps: ["Space Weather"] },
      { say: "search the weather service site for heat safety", kind: "action", steps: ["Search For"] },
      { say: "open the marine forecasts", kind: "action", steps: ["Marine"] },

      { say: "which warnings and advisories are listed on the hazards map right now", kind: "explain", explain: true },
      { say: "what does the map on the front page show", kind: "explain", explain: true },
      { say: "which of the listed alerts is the most severe", kind: "explain", explain: true },

      { say: "get the forecast for ZIP code 10001 and summarize the next two days",
        kind: "action+explain", steps: ["Enter Your City, ST or ZIP Code"], explain: true },
      { say: "open the active alerts and tell me which states currently have alerts in effect",
        kind: "action+explain", steps: ["ACTIVE ALERTS"], explain: true },
      { say: "open the first warning listed on the hazards map and summarize it",
        kind: "action+explain", steps: ["Warning"], explain: true },
      { say: "open the StormReady page and explain what the StormReady program is about",
        kind: "action+explain", steps: ["StormReady"], explain: true },
      { say: "search the site for wind chill and summarize the top result",
        kind: "action+explain", steps: ["Search For"], explain: true },

      { say: "open the forecast menu and then go to aviation", kind: "multistep",
        steps: ["FORECAST", "Aviation"] },
      { say: "type 60601 into the forecast box, get the forecast, then open the hourly weather graph",
        kind: "multistep", steps: ["Enter Your City, ST or ZIP Code", "Hourly Weather Forecast"], later: true },
      { say: "open the information menu, then go to Wireless Emergency Alerts", kind: "multistep",
        steps: ["INFORMATION", "Wireless Emergency Alerts"] },
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

/* The second thirty, per site - fifty each.
 *
 * Same four kinds and the same rule: every control a prompt names is one the
 * page really carries. First steps are checked against the captured starting
 * page by the tests; a step after the first that happens on another page
 * (`later: true`) was checked against that page fetched live when this was
 * written - the West regional map's Full Summary and View More Statistics,
 * the Map Archive's map-type list, weather.gov's Marine, Safety, SKYWARN,
 * Education and Fire Weather pages, drought.gov's Agriculture, Water
 * Utilities, Current Conditions and California-Nevada pages. Explain prompts
 * ask about what those pages write down: the gauge's location note and its
 * data-type table, the drought summary's regional sections, the hydrograph
 * page's flood stage definitions, the hazards legend, the D0-D4 table.
 *
 * Left out on purpose: weather.gov's warnings-by-state list (on the page one
 * run and not the next) and water.noaa.gov's Long Range Outlook (it renders
 * no text a reader can be given).
 */
const MORE = {
  usgs: [
    { say: "switch the graph to show the last 7 days", kind: "action", steps: ["7 days"] },
    { say: "graph the pH from the multiparameter sonde", kind: "action", steps: ["Graph pH, water, unfiltered"] },
    { say: "graph the dissolved oxygen", kind: "action", steps: ["Graph Dissolved oxygen, water, unfiltered"] },
    { say: "plot the specific conductance", kind: "action", steps: ["Graph Specific conductance"] },
    { say: "graph the stream water level elevation above NAVD 1988", kind: "action",
      steps: ["Graph Stream water level elevation above NAVD 1988"] },
    { say: "show the nitrate plus nitrite readings on the graph", kind: "action", steps: ["Graph Nitrate plus nitrite"] },
    { say: "switch the graph back to a linear scale", kind: "action", steps: ["Linear"] },
    { say: "show the field measurements on the graph", kind: "action", steps: ["Field measurements"] },
    { say: "open the download data panel", kind: "action", steps: ["Download data"] },
    { say: "turn on the hydro layer on the location map", kind: "action", steps: ["Hydro"] },

    { say: "what is the date range of the turbidity record at this gauge", kind: "explain", explain: true },
    { say: "how many continuous data types are available at this location", kind: "explain", explain: true },
    { say: "how far back do the peak measurements go", kind: "explain", explain: true },
    { say: "which data types at this gauge have been discontinued", kind: "explain", explain: true },
    { say: "what is the datum of this gage, according to the page", kind: "explain", explain: true },
    { say: "which reservoirs affect low flow at this site, according to the page", kind: "explain", explain: true },
    { say: "what does the page say about turbidity values above 1,000 FNU", kind: "explain", explain: true },

    { say: "graph the specific conductance and tell me the latest value",
      kind: "action+explain", steps: ["Graph Specific conductance"], explain: true },
    { say: "graph the dissolved oxygen and tell me the most recent reading",
      kind: "action+explain", steps: ["Graph Dissolved oxygen, water, unfiltered"], explain: true },
    { say: "switch to the 30 days view and tell me the date range shown",
      kind: "action+explain", steps: ["30 days"], explain: true },
    { say: "open the related graphs and tell me what the combined location graph does",
      kind: "action+explain", steps: ["View related graphs"], explain: true },
    { say: "show the location details and tell me what county this gauge is in",
      kind: "action+explain", steps: ["Show location details"], explain: true },
    { say: "expand all the data collections and tell me how many discrete sample data types there are",
      kind: "action+explain", steps: ["Expand all data collections"], explain: true },
    { say: "graph the turbidity and tell me the latest value",
      kind: "action+explain", steps: ["Graph Turbidity"], explain: true },

    { say: "graph the turbidity, switch to 1 year, and show the legend", kind: "multistep",
      steps: ["Graph Turbidity", "1 year", "Show legend"] },
    { say: "switch the location map to imagery and turn on the hydro layer", kind: "multistep",
      steps: ["Imagery", "Hydro"] },
    { say: "graph the stream water level elevation, then turn on last year's data for comparison", kind: "multistep",
      steps: ["Graph Stream water level elevation above NAVD 1988", "Data for same time span in prior year"] },
    { say: "hide today's statistics, then hide the graph details", kind: "multistep",
      steps: ["Hide today's statistics", "Hide graph details"] },
    { say: "show the daily data types, then show the peak measurements", kind: "multistep",
      steps: ["Show these data types (Daily data)", "Show these data types (Peak measurements)"] },
    { say: "zoom out on the location map, then switch it back to USGS Topo", kind: "multistep",
      steps: ["Zoom out", "USGS Topo"] },
  ],

  droughtmap: [
    { say: "show the drought map for the High Plains", kind: "action", steps: ["High Plains"] },
    { say: "open the Pacific regional map", kind: "action", steps: ["Pacific"] },
    { say: "show the map for the continental U.S.", kind: "action", steps: ["Continental U.S."] },
    { say: "open the comparison slider", kind: "action", steps: ["Comparison Slider"] },
    { say: "go to the weeks in drought page", kind: "action", steps: ["Weeks in Drought"] },
    { say: "open the drought severity and coverage index", kind: "action", steps: ["Drought Severity and Coverage Index"] },
    { say: "go to the drought outlooks", kind: "action", steps: ["Outlooks"] },
    { say: "open the map in Spanish", kind: "action", steps: ["En Español"] },
    { say: "open the custom map request page", kind: "action", steps: ["Custom Map Request"] },
    { say: "go to the population statistics page", kind: "action", steps: ["Population Statistics"] },

    { say: "who authored this week's drought map", kind: "explain", explain: true },
    { say: "what file formats can this map be downloaded in", kind: "explain", explain: true },
    { say: "which regions can I view separate drought maps for", kind: "explain", explain: true },
    { say: "what formats is the written drought summary available in", kind: "explain", explain: true },
    { say: "which organizations produce the U.S. Drought Monitor, according to this page", kind: "explain", explain: true },
    { say: "what is the difference between D0 and D1 according to the legend", kind: "explain", explain: true },
    { say: "how do I report drought conditions where I live, according to this page", kind: "explain", explain: true },

    { say: "go to the drought classification page and explain how D2 is defined",
      kind: "action+explain", steps: ["Drought Classification"], explain: true },
    { say: "open the West regional map and tell me who authored it",
      kind: "action+explain", steps: ["West"], explain: true },
    { say: "go to the drought summary and tell me what it says about the High Plains",
      kind: "action+explain", steps: ["Drought Summary"], explain: true },
    { say: "go to the drought summary and tell me what the looking ahead section says",
      kind: "action+explain", steps: ["Drought Summary"], explain: true },
    { say: "open the outlooks page and tell me which outlook maps it shows",
      kind: "action+explain", steps: ["Outlooks"], explain: true },
    { say: "open the what is the USDM page and explain what the U.S. Drought Monitor is",
      kind: "action+explain", steps: ["What is the USDM?"], explain: true },
    { say: "open the Southeast regional map and tell me what its statistics show",
      kind: "action+explain", steps: ["Southeast"], explain: true },

    { say: "open the West regional map, then open its full summary", kind: "multistep",
      steps: ["West", "Full Summary"], later: true },
    { say: "go to the data tables and set the area type to state", kind: "multistep",
      steps: ["Data Tables", "State"], later: true },
    { say: "open the map archive and change the map type to legend only", kind: "multistep",
      steps: ["Map Archive", "Legend Only"], later: true },
    { say: "switch to grayscale, then open the regions list", kind: "multistep",
      steps: ["View grayscale version of the map", "Regions"] },
    { say: "go to the conditions and outlooks page, then open the weekly drought indices", kind: "multistep",
      steps: ["Conditions & Outlooks", "Weekly Drought Indices"], later: true },
    { say: "open the High Plains regional map, then view more statistics", kind: "multistep",
      steps: ["High Plains", "View More Statistics"], later: true },
  ],

  noaa: [
    { say: "open the drought menu", kind: "action", steps: ["Drought"] },
    { say: "open the resources menu", kind: "action", steps: ["Resources"] },
    { say: "go to the past precipitation estimates", kind: "action", steps: ["Past Precipitation Estimates"] },
    { say: "open the flood inundation mapping page", kind: "action", steps: ["Flood Inundation Mapping (FIM)"] },
    { say: "go to the hydrologic ensemble forecast system page", kind: "action",
      steps: ["Hydrologic Ensemble Forecast System (HEFS)"] },
    { say: "open the organization menu", kind: "action", steps: ["Organization"] },
    { say: "go to the river forecast centers page", kind: "action", steps: ["River Forecast Centers"] },
    { say: "open the national water model page", kind: "action", steps: ["National Water Model"] },
    { say: "search the map for Denver", kind: "action", steps: ["Search"] },
    { say: "open the about menu", kind: "action", steps: ["About"] },

    { say: "which hydrologic discussions are available on this page", kind: "explain", explain: true },
    { say: "what flood hazard outlook archives does this page link to", kind: "explain", explain: true },
    { say: "what precipitation frequency standards does this site list", kind: "explain", explain: true },
    { say: "what organization runs this website", kind: "explain", explain: true },
    { say: "what flood safety campaign about driving does this page link to", kind: "explain", explain: true },
    { say: "what documentation does this site offer for new users", kind: "explain", explain: true },
    { say: "which basemap sources are credited on this map", kind: "explain", explain: true },

    { say: "go to the hydrograph information page and explain what action stage means",
      kind: "action+explain", steps: ["Hydrograph Information"], explain: true },
    { say: "open the hydrograph information page and explain the difference between minor and major flooding",
      kind: "action+explain", steps: ["Hydrograph Information"], explain: true },
    { say: "open the national water model page and tell me what the model forecasts",
      kind: "action+explain", steps: ["National Water Model"], explain: true },
    { say: "go to the office of water prediction page and tell me its mission",
      kind: "action+explain", steps: ["Office of Water Prediction"], explain: true },
    { say: "open the national water center page and tell me about the building",
      kind: "action+explain", steps: ["National Water Center"], explain: true },
    { say: "open the NWPS release notes and tell me what the latest version changed",
      kind: "action+explain", steps: ["NWPS Release Notes"], explain: true },
    { say: "go to the categorical FIM list and tell me what it lists",
      kind: "action+explain", steps: ["Categorical FIM List"], explain: true },

    { say: "open the drought menu, then go to the CPC drought information", kind: "multistep",
      steps: ["Drought", "CPC Drought Information"] },
    { say: "open the resources menu, then go to hydrograph information", kind: "multistep",
      steps: ["Resources", "Hydrograph Information"] },
    { say: "open the organization menu, then go to the weather forecast offices", kind: "multistep",
      steps: ["Organization", "Weather Forecast Offices"] },
    { say: "zoom out twice, then open the layers panel", kind: "multistep",
      steps: ["Zoom out", "Zoom out", "View Layers"] },
    { say: "open the about menu, then go to the NWPS user guide", kind: "multistep",
      steps: ["About", "NWPS User Guide"] },
    { say: "open the shortcuts menu, then go to the partner FIM location list", kind: "multistep",
      steps: ["Shortcuts", "Partner FIM Location List"] },
  ],

  weather: [
    { say: "open the fire weather page", kind: "action", steps: ["Fire Weather"] },
    { say: "go to the hurricanes page", kind: "action", steps: ["Hurricanes"] },
    { say: "open the forecast maps", kind: "action", steps: ["FORECAST MAPS"] },
    { say: "show the enhanced radar", kind: "action", steps: ["Enhanced Radar"] },
    { say: "go to the air quality page", kind: "action", steps: ["AIR QUALITY"] },
    { say: "open the current conditions", kind: "action", steps: ["CURRENT"] },
    { say: "go to the weather glossary", kind: "action", steps: ["Glossary"] },
    { say: "open the Guam forecast page", kind: "action", steps: ["Guam"] },
    { say: "go to the SKYWARN storm spotters page", kind: "action", steps: ["SKYWARN Storm Spotters"] },
    { say: "open the past weather page", kind: "action", steps: ["PAST WEATHER"] },

    { say: "which tropical alerts are listed on the hazards map right now", kind: "explain", explain: true },
    { say: "what heat-related alerts are listed on the hazards map", kind: "explain", explain: true },
    { say: "which marine alerts are on the hazards map right now", kind: "explain", explain: true },
    { say: "what does the headline story on the front page say", kind: "explain", explain: true },
    { say: "which U.S. territories have their own forecast pages linked here", kind: "explain", explain: true },
    { say: "what kinds of radar views does this page offer", kind: "explain", explain: true },
    { say: "which flood-related alerts are listed on the hazards map", kind: "explain", explain: true },

    { say: "open the marine page and tell me what kinds of marine forecasts it offers",
      kind: "action+explain", steps: ["Marine"], explain: true },
    { say: "go to the safety page and tell me which hazards it covers",
      kind: "action+explain", steps: ["SAFETY"], explain: true },
    { say: "open the SKYWARN page and explain what storm spotters do",
      kind: "action+explain", steps: ["SKYWARN Storm Spotters"], explain: true },
    { say: "go to the fire weather page and tell me which fire outlooks it links to",
      kind: "action+explain", steps: ["Fire Weather"], explain: true },
    { say: "open the daily briefing and tell me which outlooks it includes",
      kind: "action+explain", steps: ["Daily Briefing"], explain: true },
    { say: "go to the education page and tell me what JetStream is",
      kind: "action+explain", steps: ["EDUCATION"], explain: true },
    { say: "open the NOAA weather radio page and explain what it is",
      kind: "action+explain", steps: ["NOAA Weather Radio"], explain: true },

    { say: "open the marine page, then go to the offshore forecasts", kind: "multistep",
      steps: ["Marine", "Offshore Forecasts"], later: true },
    { say: "go to the safety page, then open the lightning safety page", kind: "multistep",
      steps: ["SAFETY", "Lightning"], later: true },
    { say: "open the SKYWARN page, then find a class in my area", kind: "multistep",
      steps: ["SKYWARN Storm Spotters", "Find a class in your area"], later: true },
    { say: "go to the education page, then open JetStream", kind: "multistep",
      steps: ["EDUCATION", "JetStream"], later: true },
    { say: "open the fire weather page, then go to the spot forecasts", kind: "multistep",
      steps: ["Fire Weather", "Spot Forecasts"], later: true },
    { say: "open the marine page, then go to the point forecasts", kind: "multistep",
      steps: ["Marine", "Point Forecasts"], later: true },
  ],

  drought: [
    { say: "show state lines on the map", kind: "action", steps: ["Show State Lines"] },
    { say: "turn on county lines on the map", kind: "action", steps: ["Show County Lines"] },
    { say: "jump the map to Alaska", kind: "action", steps: ["Jump to Alaska"] },
    { say: "jump the map to Hawaii", kind: "action", steps: ["Jump to Hawaii"] },
    { say: "open the news and events menu", kind: "action", steps: ["News and Events"] },
    { say: "go to the fire topic page", kind: "action", steps: ["Fire"] },
    { say: "open the by location menu", kind: "action", steps: ["By Location"] },
    { say: "go to the regional drought status updates", kind: "action", steps: ["Regional Drought Status Updates"] },
    { say: "open the energy sector page", kind: "action", steps: ["Energy"] },
    { say: "show the map description", kind: "action", steps: ["Show Map Description"] },

    { say: "what percentage of the country is in severe drought right now", kind: "explain", explain: true },
    { say: "how much of the U.S. is abnormally dry right now", kind: "explain", explain: true },
    { say: "what upcoming drought events or webinars are listed on this page", kind: "explain", explain: true },
    { say: "what is NIDIS, according to this page", kind: "explain", explain: true },
    { say: "which agencies partner on this portal, according to the page", kind: "explain", explain: true },
    { say: "what are the latest news stories on this page", kind: "explain", explain: true },
    { say: "what is the combined percentage of the U.S. in severe, extreme, or exceptional drought", kind: "explain", explain: true },

    { say: "go to the current conditions page and tell me how drought changed over the last week",
      kind: "action+explain", steps: ["Current Conditions"], explain: true },
    { say: "open the agriculture page and tell me how drought affects crops",
      kind: "action+explain", steps: ["Agriculture"], explain: true },
    { say: "go to the flash drought page and explain what causes flash drought",
      kind: "action+explain", steps: ["Flash Drought"], explain: true },
    { say: "open the water utilities page and tell me how drought affects water utilities",
      kind: "action+explain", steps: ["Water Utilities"], explain: true },
    { say: "go to the California-Nevada region and tell me who the regional contact is",
      kind: "action+explain", steps: ["California-Nevada"], explain: true },
    { say: "open the drought basics page and explain the types of drought",
      kind: "action+explain", steps: ["Drought Basics"], explain: true },
    { say: "go to the short-term vs long-term drought page and explain the difference",
      kind: "action+explain", steps: ["Short-Term vs Long-Term Drought"], explain: true },

    { say: "open the agriculture page, then go to the crop moisture index", kind: "multistep",
      steps: ["Agriculture", "Crop Moisture Index (CMI)"], later: true },
    { say: "go to the water utilities page, then open the reservoir storage dashboard", kind: "multistep",
      steps: ["Water Utilities", "Reservoir Storage Dashboard"], later: true },
    { say: "go to the current conditions page, then show the 4-week change", kind: "multistep",
      steps: ["Current Conditions", "4-Week Change"], later: true },
    { say: "show state lines and county lines on the map", kind: "multistep",
      steps: ["Show State Lines", "Show County Lines"] },
    { say: "open the California-Nevada region page, then open the latest drought update", kind: "multistep",
      steps: ["California-Nevada", "Latest Drought Update"], later: true },
    { say: "jump the map to Puerto Rico, then back to the continental U.S.", kind: "multistep",
      steps: ["Jump to Puerto Rico", "Jump to CONUS"] },
  ],
};
for (const [site, extra] of Object.entries(MORE)) module.exports[site].prompts.push(...extra);

// Two research apps from the Tulane HydroInformatics Lab, added 2026-10-17:
// a radar viewer with a three-step picker and tabs, and a flood-map viewer
// whose panels only exist once a layer is ticked. Both draw on a map.
// `later` throughout: the later steps appear only after the first has
// loaded something from the server. The radar chains that go past the date
// wait on the app decoding a day of radar files, which takes minutes.
module.exports.radarviz = {
  url: "https://hydroinformatics.tulane.edu/lab/radarviz/",
  note: "NEXRAD Level 2 radar viewer: pick a site, a date and time, a product; animate; QPE. The radar image is a picture on a Google map.",
  prompts: [
    { say: "search radar sites for miami, select the miami radar, then set the year to 2023", kind: "multistep",
      steps: ["Search Radar Sites", "KAMX - Miami, FL", "Year"], later: true },
    { say: "search radar sites for new orleans, select the radar, set the year to 2024 and the month to august, then pick the first day listed", kind: "multistep",
      steps: ["Search Radar Sites", "KLIX - New Orleans, LA", "Year", "Month", "Day"], later: true },
    { say: "search for houston and select the radar, reset all filters and selections, then search for dallas and select that radar", kind: "multistep",
      steps: ["Search Radar Sites", "KHGX - Houston/Galveston, TX", "Reset all filters and selections", "KFWS - Dallas/Fort Worth, TX"], later: true },
    { say: "open settings, clear the cached data, then switch volume units to acre-feet and distance units to miles", kind: "multistep",
      steps: ["Settings", "Clear", "Volume units", "Distance units"], later: true },
    { say: "search for houston, select the radar, set the year to 2024, the month to july and the day to 8, pick the first time listed, then choose correlation coefficient and set the resolution to auto", kind: "multistep",
      steps: ["Search Radar Sites", "KHGX - Houston/Galveston, TX", "Year", "Month", "Day", "Radar Product", "Resolution"], later: true },
    { say: "search for houston, select the radar, set the year to 2024, the month to july and the day to 8, pick the first time listed, set the resolution to high resolution, then pick the first scan level", kind: "multistep",
      steps: ["Search Radar Sites", "KHGX - Houston/Galveston, TX", "Year", "Month", "Day", "Resolution", "Scan Level (Elevation) - Select to Display"], later: true },
    { say: "search for houston, select the radar, set the year to 2024, the month to july and the day to 8, pick the first time listed, set the resolution to auto, pick the first scan level, then open the precipitation tab and set the CC threshold to 0.90", kind: "multistep",
      steps: ["Search Radar Sites", "KHGX - Houston/Galveston, TX", "Year", "Month", "Day", "Resolution", "Precipitation", "CC Threshold"], later: true },
    { say: "search for houston, select the radar, set the year to 2024 and tell me which months have data", kind: "action+explain",
      steps: ["Search Radar Sites", "KHGX - Houston/Galveston, TX", "Year"], explain: true, later: true },
    { say: "what radar products can be displayed here", kind: "explain", explain: true },
    { say: "read this page", kind: "explain", explain: true },
  ],
};
module.exports.fims = {
  url: "https://hydroinformatics.tulane.edu/lab/fims/",
  note: "Flood inundation map viewer: layer checkboxes open panels that fill in from the server. The flood map is drawn on a Google map.",
  prompts: [
    { say: "turn on flood map set (scenario), then choose cedar rapids", kind: "multistep",
      steps: ["Flood Map Set (Scenario)", "Cedar Rapids (D)"], later: true },
    { say: "turn on flood map set (scenario), choose cedar rapids, open the metrics tab and enable total dollar damage", kind: "multistep",
      steps: ["Flood Map Set (Scenario)", "Cedar Rapids (D)", "Metrics", "Total Dollar Damage"], later: true },
    { say: "turn on flood map set (scenario), choose cedar rapids, open layer settings and enable show properties on hover", kind: "multistep",
      steps: ["Flood Map Set (Scenario)", "Cedar Rapids (D)", "Layer Settings", "Show properties on hover"], later: true },
    { say: "turn on flood depth, then choose the 1% (100 yr) return period", kind: "multistep",
      steps: ["Flood Depth", "1% (100 yr)"], later: true },
    { say: "open the fim comparison uploader, click select existing scenario, choose cedar rapids as the first scenario and des moines as the second, then start the comparison", kind: "multistep",
      steps: ["FIM Comparison", "Select Existing Scenario", "Name", "scenario2 name", "Start Comparison"], later: true },
    { say: "turn on flood map set (scenario), choose des moines, then open the legend tab", kind: "multistep",
      steps: ["Flood Map Set (Scenario)", "Des Moines (M) (D)", "Legend"], later: true },
    { say: "turn on flood map set (scenario), choose cedar rapids, open the metrics tab, enable percent structure damage, then enable dollar structure damage", kind: "multistep",
      steps: ["Flood Map Set (Scenario)", "Cedar Rapids (D)", "Metrics", "Percent Structure Damage", "Dollar Structure Damage"], later: true },
    { say: "turn on flood map set (scenario), choose cedar rapids, and tell me which models are available", kind: "action+explain",
      steps: ["Flood Map Set (Scenario)", "Cedar Rapids (D)"], explain: true, later: true },
    { say: "which cities have flood map scenarios", kind: "explain", explain: true },
    { say: "what map layers can be turned on here", kind: "explain", explain: true },
  ],
};

// Round 4, 2026-10-20: three federal water-infrastructure sites, prompts written
// from screenshots before the agent ran on them. Not run offline either.
module.exports.usace = {
  "url": "https://water.usace.army.mil/overview",
  "note": "USACE Water Management (CWMS) locations by office: a table of divisions and districts, each with List View, Map View and an office link, behind a DoD warning to agree to first.",
  "later": true,
  "prompts": [
    {
      "say": "open the list view for the new orleans district",
      "kind": "action",
      "steps": [
        "List View"
      ],
      "later": true
    },
    {
      "say": "open the map view for the vicksburg district",
      "kind": "action",
      "steps": [
        "Map View"
      ],
      "later": true
    },
    {
      "say": "search for mississippi river",
      "kind": "action",
      "steps": [
        "Search"
      ]
    },
    {
      "say": "open the list view for the st. louis district, then tell me which locations it lists",
      "kind": "action+explain",
      "steps": [
        "List View"
      ],
      "explain": true,
      "later": true
    },
    {
      "say": "go to the interactive map, then open the data page",
      "kind": "multistep",
      "steps": [
        "Map",
        "Data"
      ],
      "later": true
    },
    {
      "say": "open the active flooding events page",
      "kind": "action",
      "steps": [
        "Active Flooding Events"
      ],
      "later": true
    },
    {
      "say": "open the help page and go to the data disclaimer",
      "kind": "multistep",
      "steps": [
        "Help",
        "Data Disclaimer"
      ],
      "later": true
    },
    {
      "say": "open the office link for the omaha district",
      "kind": "action",
      "steps": [
        "Office Link"
      ],
      "later": true
    },
    {
      "say": "open the list view for the tulsa district and open the first location listed",
      "kind": "multistep",
      "steps": [
        "List View",
        "first location listed"
      ],
      "later": true
    },
    {
      "say": "open the map view for the sacramento district and zoom in",
      "kind": "multistep",
      "steps": [
        "Map View",
        "Zoom in"
      ],
      "later": true
    },
    {
      "say": "open the list view for the alaska district",
      "kind": "action",
      "steps": [
        "List View"
      ],
      "later": true
    },
    {
      "say": "open the api docs",
      "kind": "action",
      "steps": [
        "API Docs"
      ],
      "later": true
    },
    {
      "say": "go to the contact us section",
      "kind": "action",
      "steps": [
        "Contact Us"
      ],
      "later": true
    },
    {
      "say": "open the locations page from the footer, then open the list view for the memphis district",
      "kind": "multistep",
      "steps": [
        "Locations by Office",
        "List View"
      ],
      "later": true
    },
    {
      "say": "open the list view for the louisville district and tell me how many locations it has",
      "kind": "action+explain",
      "steps": [
        "List View"
      ],
      "explain": true,
      "later": true
    },
    {
      "say": "which districts are in the mississippi valley division",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "how many divisions are listed on this page",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what does this website provide",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "which division does the galveston district belong to",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ],
  "firstContact": true
};
module.exports.rise = {
  "url": "https://data.usbr.gov/catalog",
  "note": "Bureau of Reclamation RISE catalog search: a search box, filter checkboxes by theme, data structure, location type, region and state, an order-by list and paged results.",
  "later": true,
  "prompts": [
    {
      "say": "search the catalog for lake mead",
      "kind": "action",
      "steps": [
        "Search Datasets"
      ]
    },
    {
      "say": "search for folsom reservoir and open the first result",
      "kind": "multistep",
      "steps": [
        "Search Datasets",
        "first result"
      ],
      "later": true
    },
    {
      "say": "filter to the hydropower theme and time series data",
      "kind": "multistep",
      "steps": [
        "Hydropower",
        "Time series"
      ]
    },
    {
      "say": "show only datasets in california, then sort by last record update newest",
      "kind": "multistep",
      "steps": [
        "California",
        "Order by"
      ]
    },
    {
      "say": "filter the unified region to columbia-pacific northwest and the location type to dam",
      "kind": "multistep",
      "steps": [
        "Columbia-Pacific Northwest",
        "Dam"
      ]
    },
    {
      "say": "search for evaporation, filter to the environmental theme, then sort alphabetically",
      "kind": "multistep",
      "steps": [
        "Search Datasets",
        "Environmental",
        "Order by"
      ]
    },
    {
      "say": "go to the next page of results",
      "kind": "action",
      "steps": [
        "Next"
      ]
    },
    {
      "say": "jump to the last page of results",
      "kind": "action",
      "steps": [
        "Last"
      ]
    },
    {
      "say": "show the search instructions",
      "kind": "action",
      "steps": [
        "Show Instructions"
      ]
    },
    {
      "say": "filter to arizona, then clear all the search filters",
      "kind": "multistep",
      "steps": [
        "Arizona",
        "Clear Search/Filters"
      ]
    },
    {
      "say": "open the time series query tool",
      "kind": "action",
      "steps": [
        "Time Series Query"
      ],
      "later": true
    },
    {
      "say": "open the map interface",
      "kind": "action",
      "steps": [
        "Map Interface"
      ],
      "later": true
    },
    {
      "say": "filter the legacy region to lower colorado and show only geospatial data",
      "kind": "multistep",
      "steps": [
        "Lower Colorado",
        "Geospatial"
      ]
    },
    {
      "say": "search for sediment, filter to idaho, and tell me how many records are found",
      "kind": "action+explain",
      "steps": [
        "Search Datasets",
        "Idaho"
      ],
      "explain": true
    },
    {
      "say": "sort the results by last record update oldest and tell me which dataset is first",
      "kind": "action+explain",
      "steps": [
        "Order by"
      ],
      "explain": true
    },
    {
      "say": "filter to the biological theme and tell me how many records match",
      "kind": "action+explain",
      "steps": [
        "Biological"
      ],
      "explain": true
    },
    {
      "say": "how many records are in the catalog",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what can I search for in the catalog search box",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what data structures can I filter by",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what does RISE stand for",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ],
  "firstContact": true
};
module.exports.nid = {
  "url": "https://nid.sec.usace.army.mil/nid/#/",
  "note": "USACE National Inventory of Dams: a search box, national statistics, a state list and map, layer and legend controls and featured dams, behind a disclaimer to accept first.",
  "later": true,
  "prompts": [
    {
      "say": "search for hoover dam",
      "kind": "action",
      "steps": [
        "Search"
      ]
    },
    {
      "say": "search for lake mead and open the first result",
      "kind": "multistep",
      "steps": [
        "Search",
        "first result"
      ],
      "later": true
    },
    {
      "say": "select texas in the state list",
      "kind": "action",
      "steps": [
        "Texas"
      ]
    },
    {
      "say": "select california in the state list, then browse these dams",
      "kind": "multistep",
      "steps": [
        "California",
        "Browse These Dams"
      ],
      "later": true
    },
    {
      "say": "open the layer controls and switch the basemap to named rivers",
      "kind": "multistep",
      "steps": [
        "Layer Controls",
        "Named Rivers"
      ]
    },
    {
      "say": "zoom the map to hawaii",
      "kind": "action",
      "steps": [
        "Hawaii"
      ]
    },
    {
      "say": "type colorado in the list search and pick colorado",
      "kind": "multistep",
      "steps": [
        "Search this list",
        "Colorado"
      ]
    },
    {
      "say": "open advanced search",
      "kind": "action",
      "steps": [
        "Advanced Search"
      ],
      "later": true
    },
    {
      "say": "show the puerto rico & u.s. virgin islands map",
      "kind": "action",
      "steps": [
        "Puerto Rico & U.S. Virgin Islands"
      ]
    },
    {
      "say": "open the legend",
      "kind": "action",
      "steps": [
        "Legend"
      ]
    },
    {
      "say": "learn more about the mahoning creek dam",
      "kind": "action",
      "steps": [
        "Learn More"
      ],
      "later": true
    },
    {
      "say": "open the about the nid menu",
      "kind": "action",
      "steps": [
        "About the NID"
      ]
    },
    {
      "say": "open the low-head dam inventory",
      "kind": "action",
      "steps": [
        "Low-Head Dam Inventory"
      ],
      "later": true
    },
    {
      "say": "select ohio, then browse these dams and tell me how many dams are listed",
      "kind": "action+explain",
      "steps": [
        "Ohio",
        "Browse These Dams"
      ],
      "explain": true,
      "later": true
    },
    {
      "say": "open the geography dropdown and tell me which territory types are available",
      "kind": "action+explain",
      "steps": [
        "States and Counties"
      ],
      "explain": true
    },
    {
      "say": "how many dams are in the national inventory",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what percent of dams have hydropower",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "where is the lakeview cemetery flood control dam and how tall is it",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what percent of dams are state regulated",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ],
  "firstContact": true
};

// Round 5, 2026-10-21: two climate and water-supply sites, prompts written
// from screenshots before the agent ran on them. Not run offline either.
module.exports.cag = {
  "url": "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/national/time-series",
  "note": "NOAA NCEI Climate at a Glance, national time series: parameter, time scale, filter and month lists, start and end years, base-period and trend options, a Plot button, a chart, downloads and a table of values with ranks.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "change the parameter to precipitation",
      "kind": "action",
      "steps": [
        "Parameter"
      ]
    },
    {
      "say": "set the time scale to 12-month",
      "kind": "action",
      "steps": [
        "Time Scale"
      ]
    },
    {
      "say": "pick july as the month",
      "kind": "action",
      "steps": [
        "Month"
      ]
    },
    {
      "say": "apply the 5-year average filter",
      "kind": "action",
      "steps": [
        "Filter"
      ]
    },
    {
      "say": "set the start year to 1950 and click plot",
      "kind": "multistep",
      "steps": [
        "Start Year",
        "Plot"
      ]
    },
    {
      "say": "turn on display trend",
      "kind": "action",
      "steps": [
        "Display Trend"
      ]
    },
    {
      "say": "switch the parameter to maximum temperature, then plot it",
      "kind": "multistep",
      "steps": [
        "Parameter",
        "Plot"
      ]
    },
    {
      "say": "download the data as csv",
      "kind": "action",
      "steps": [
        "CSV"
      ]
    },
    {
      "say": "open the national rankings page",
      "kind": "action",
      "steps": [
        "National Rankings"
      ],
      "later": true
    },
    {
      "say": "define a custom base period from 1991 to 2020",
      "kind": "multistep",
      "steps": [
        "Define Custom Base Period",
        "Start"
      ]
    },
    {
      "say": "select the palmer drought severity index and tell me which time scales it supports",
      "kind": "action+explain",
      "steps": [
        "Parameter"
      ],
      "explain": true
    },
    {
      "say": "what was the average temperature in september 2026",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what rank did september 2006 get",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what parameters can I choose from",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what does PDSI stand for",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};
module.exports.twdb = {
  "url": "https://www.waterdatafortexas.org/reservoirs/statewide",
  "note": "Texas Water Development Board, Water Data for Texas statewide reservoirs: a map, a storage chart with Recent / Historical / Statistics views, download menus, a summary table and a table of every reservoir's recent conditions.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "show the historical storage chart",
      "kind": "action",
      "steps": [
        "Historical"
      ]
    },
    {
      "say": "switch to the statistics view",
      "kind": "action",
      "steps": [
        "Statistics"
      ]
    },
    {
      "say": "open the daily historical data menu",
      "kind": "action",
      "steps": [
        "Daily Historical Data"
      ]
    },
    {
      "say": "open the by river basin menu",
      "kind": "action",
      "steps": [
        "By River Basin"
      ]
    },
    {
      "say": "open the austin reservoir page",
      "kind": "action",
      "steps": [
        "Austin"
      ],
      "later": true
    },
    {
      "say": "zoom in on the map",
      "kind": "action",
      "steps": [
        "+"
      ]
    },
    {
      "say": "go to the drought page",
      "kind": "action",
      "steps": [
        "Drought"
      ],
      "later": true
    },
    {
      "say": "switch to the historical view, then back to recent",
      "kind": "multistep",
      "steps": [
        "Historical",
        "Recent"
      ]
    },
    {
      "say": "open the static map",
      "kind": "action",
      "steps": [
        "Static map"
      ],
      "later": true
    },
    {
      "say": "open the flooding page",
      "kind": "action",
      "steps": [
        "Flooding"
      ],
      "later": true
    },
    {
      "say": "switch to statistics and tell me what the chart shows",
      "kind": "action+explain",
      "steps": [
        "Statistics"
      ],
      "explain": true
    },
    {
      "say": "what percent full are texas reservoirs today",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "how full is abilene",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what was the statewide percent full one year ago",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what is the conservation capacity of amistad",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};

// Round 6, 2026-10-21: two water-observation sites, prompts written
// from screenshots before the agent ran on them. Not run offline either.
module.exports.ndbc = {
  "url": "https://www.ndbc.noaa.gov/station_page.php?station=46026",
  "note": "NOAA National Data Buoy Center, station 46026 (San Francisco): station facts, links, a map type list and zoom, a refresh switch, unit and time-zone lists with Select buttons, current conditions, and tables of previous observations and waves.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "switch the units to metric",
      "kind": "action",
      "steps": [
        "Unit of Measure"
      ]
    },
    {
      "say": "change the time zone to greenwich mean time",
      "kind": "action",
      "steps": [
        "Time Zone"
      ]
    },
    {
      "say": "change the map type to satellite",
      "kind": "action",
      "steps": [
        "Map Type"
      ]
    },
    {
      "say": "turn on refresh every 10 minutes",
      "kind": "action",
      "steps": [
        "Refresh page every 10 minutes"
      ]
    },
    {
      "say": "open the latest nws marine forecast",
      "kind": "action",
      "steps": [
        "Latest NWS Marine Forecast"
      ],
      "later": true
    },
    {
      "say": "zoom in on the map",
      "kind": "action",
      "steps": [
        "Zoom in"
      ]
    },
    {
      "say": "set the unit of measure to metric and press select",
      "kind": "multistep",
      "steps": [
        "Unit of Measure",
        "Select"
      ]
    },
    {
      "say": "open the station list",
      "kind": "action",
      "steps": [
        "Station List"
      ],
      "later": true
    },
    {
      "say": "search for station 46042",
      "kind": "action",
      "steps": [
        "Station ID Search"
      ],
      "later": true
    },
    {
      "say": "switch to metric and tell me the wave height",
      "kind": "action+explain",
      "steps": [
        "Unit of Measure"
      ],
      "explain": true
    },
    {
      "say": "what is the wind speed right now",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "how deep is the water at this buoy",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what kind of buoy is this",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what is the water temperature",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "who owns and maintains this station",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};
module.exports.codwr = {
  "url": "https://dwr.state.co.us/Tools/Stations",
  "note": "Colorado DWR / CWCB stations, current conditions: station filters (geographic location, water division, data category, station type, data provider, more options) with Search, map and table switches, a legend, export, and a paged table of stations with discharge values.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "pick the arkansas water division",
      "kind": "action",
      "steps": [
        "Water Division"
      ]
    },
    {
      "say": "change the data category to ground water",
      "kind": "action",
      "steps": [
        "Data Category"
      ]
    },
    {
      "say": "set the station type to stream gage",
      "kind": "action",
      "steps": [
        "Station Type"
      ]
    },
    {
      "say": "set the data provider to u.s. geological survey",
      "kind": "action",
      "steps": [
        "Data Provider"
      ]
    },
    {
      "say": "choose the south platte division and click search",
      "kind": "multistep",
      "steps": [
        "Water Division",
        "Search"
      ]
    },
    {
      "say": "turn the map off",
      "kind": "action",
      "steps": [
        "Map"
      ]
    },
    {
      "say": "go to the next page of the table",
      "kind": "action",
      "steps": [
        "Next"
      ]
    },
    {
      "say": "hide the legend",
      "kind": "action",
      "steps": [
        "Hide"
      ]
    },
    {
      "say": "open the export menu",
      "kind": "action",
      "steps": [
        "Export"
      ]
    },
    {
      "say": "hide the select stations panel",
      "kind": "action",
      "steps": [
        "Hide"
      ]
    },
    {
      "say": "set the station type to storage structure, click search, and tell me how many items are found",
      "kind": "action+explain",
      "steps": [
        "Station Type",
        "Search"
      ],
      "explain": true
    },
    {
      "say": "how many items are in the table",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what is the discharge at united #3 pump inlet 1",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "which water source is the croke canal inlet to standley reservoir on",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what station types can I choose from",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};

// Round 7, 2026-10-23: two water-quality sites, prompts written
// from screenshots before the agent ran on them. Not run offline either.
module.exports.hmw = {
  "url": "https://mywaterway.epa.gov/community/Boulder,%20CO/overview",
  "note": "EPA How's My Waterway, community view for Boulder, CO: Community / State & Tribal / National tabs, a location box with Go, topic tabs (Overview, Swimming, Eating Fish, Aquatic Life, Drinking Water...), a Show Text switch, waterbody / monitoring / discharger tabs, a waterbody list with Expand All, and downloads.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "open the swimming tab",
      "kind": "action",
      "steps": [
        "Swimming"
      ]
    },
    {
      "say": "show the drinking water tab",
      "kind": "action",
      "steps": [
        "Drinking Water"
      ]
    },
    {
      "say": "switch to the water monitoring locations tab",
      "kind": "action",
      "steps": [
        "Water Monitoring Locations"
      ]
    },
    {
      "say": "show the permitted dischargers",
      "kind": "action",
      "steps": [
        "Permitted Dischargers"
      ]
    },
    {
      "say": "turn off show text",
      "kind": "action",
      "steps": [
        "Show Text"
      ]
    },
    {
      "say": "expand all the waterbodies",
      "kind": "action",
      "steps": [
        "Expand All"
      ]
    },
    {
      "say": "go to the state & tribal page",
      "kind": "action",
      "steps": [
        "State & Tribal"
      ],
      "later": true
    },
    {
      "say": "type denver, co in the location box and press go",
      "kind": "multistep",
      "steps": [
        "Search",
        "Go"
      ],
      "later": true
    },
    {
      "say": "open the glossary",
      "kind": "action",
      "steps": [
        "Glossary"
      ]
    },
    {
      "say": "download all the waterbody data as a csv",
      "kind": "action",
      "steps": [
        "CSV"
      ]
    },
    {
      "say": "open the eating fish tab and tell me what it says",
      "kind": "action+explain",
      "steps": [
        "Eating Fish"
      ],
      "explain": true
    },
    {
      "say": "how many waterbodies are in this watershed",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what watershed is boulder in",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "how big is the watershed",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "which waterbodies are impaired",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};
module.exports.wqp = {
  "url": "https://www.waterqualitydata.us/",
  "note": "Water Quality Portal: an intro box with Close intro and a don't-show-again box, Basic / Advanced tabs, a three-step download form (country, state, county, point location by miles, lat and long, site type) with Clear search and Next, and menus for exploring sites and help.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "close the intro",
      "kind": "action",
      "steps": [
        "Close intro"
      ]
    },
    {
      "say": "switch to the advanced form",
      "kind": "action",
      "steps": [
        "Advanced"
      ]
    },
    {
      "say": "set the state to colorado",
      "kind": "action",
      "steps": [
        "State"
      ]
    },
    {
      "say": "set the site type to stream",
      "kind": "action",
      "steps": [
        "Site Type"
      ]
    },
    {
      "say": "set the country to united states and the state to texas",
      "kind": "multistep",
      "steps": [
        "Country",
        "State"
      ]
    },
    {
      "say": "go to the next step",
      "kind": "action",
      "steps": [
        "Next"
      ]
    },
    {
      "say": "clear the search",
      "kind": "action",
      "steps": [
        "Clear search"
      ]
    },
    {
      "say": "tick don't show again on this computer",
      "kind": "action",
      "steps": [
        "Don't show again on this computer"
      ]
    },
    {
      "say": "search within 10 miles of latitude 40 and longitude -105",
      "kind": "multistep",
      "steps": [
        "Miles of",
        "Lat",
        "Long"
      ]
    },
    {
      "say": "open the explore wqp sites menu",
      "kind": "action",
      "steps": [
        "Explore WQP Sites"
      ]
    },
    {
      "say": "open the advanced download page",
      "kind": "action",
      "steps": [
        "Advanced Download"
      ],
      "later": true
    },
    {
      "say": "open help & about and tell me what it lists",
      "kind": "action+explain",
      "steps": [
        "Help & About"
      ],
      "explain": true
    },
    {
      "say": "what is the water quality portal",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "which agencies contribute data to the portal",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "when did the nwis content last change",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};

// Round 8, 2026-10-23: two sites for the decision-mode comparison, prompts written
// from screenshots before the agent ran on them. Not run offline either.
module.exports.stormev = {
  "url": "https://www.ncei.noaa.gov/access/storm-events-database/",
  "note": "NCEI Storm Events Database home: Home / About / Data Access / Documentation / External Resources menus, Start Search and bulk-data links, featured events, resources and a return-to-top link.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "open the data access menu",
      "kind": "action",
      "steps": [
        "Data Access"
      ]
    },
    {
      "say": "open the documentation menu",
      "kind": "action",
      "steps": [
        "Documentation"
      ]
    },
    {
      "say": "open the external resources menu",
      "kind": "action",
      "steps": [
        "External Resources"
      ]
    },
    {
      "say": "start a search",
      "kind": "action",
      "steps": [
        "Start Search"
      ],
      "later": true
    },
    {
      "say": "open the hurricane helene featured event",
      "kind": "action",
      "steps": [
        "Hurricane Helene"
      ],
      "later": true
    },
    {
      "say": "show the events history on october 23",
      "kind": "action",
      "steps": [
        "Events History on October 23"
      ],
      "later": true
    },
    {
      "say": "open the quick start guide",
      "kind": "action",
      "steps": [
        "View Quick Start Guide"
      ],
      "later": true
    },
    {
      "say": "learn more about bulk data access",
      "kind": "action",
      "steps": [
        "Learn More"
      ],
      "later": true
    },
    {
      "say": "go to the about page",
      "kind": "action",
      "steps": [
        "About"
      ],
      "later": true
    },
    {
      "say": "go to the monthly storm data publication page",
      "kind": "action",
      "steps": [
        "Go to Publication Page"
      ],
      "later": true
    },
    {
      "say": "return to the top of the page",
      "kind": "action",
      "steps": [
        "Return to top"
      ]
    },
    {
      "say": "open the data access menu, then open the documentation menu",
      "kind": "multistep",
      "steps": [
        "Data Access",
        "Documentation"
      ]
    },
    {
      "say": "what time period does the database cover",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "how can i get a certified report",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what is the storm events database",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};
module.exports.echo = {
  "url": "https://echo.epa.gov/facilities/facility-search",
  "note": "EPA ECHO facility search: collapsible sections (media program, geography, community, facility characteristics, enforcement), Collapse All / Expand All, dropdowns, radio groups, text boxes, a results view switch (map or data table) and Search.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "collapse all the sections",
      "kind": "action",
      "steps": [
        "Collapse All"
      ]
    },
    {
      "say": "expand all the sections",
      "kind": "action",
      "steps": [
        "Expand All"
      ]
    },
    {
      "say": "show more search options",
      "kind": "action",
      "steps": [
        "View More Search Options"
      ]
    },
    {
      "say": "open related tools",
      "kind": "action",
      "steps": [
        "Related Tools"
      ]
    },
    {
      "say": "switch the results view to data table",
      "kind": "action",
      "steps": [
        "Data Table"
      ]
    },
    {
      "say": "set the epa region to region 9",
      "kind": "action",
      "steps": [
        "EPA Region"
      ]
    },
    {
      "say": "set active/operating to any",
      "kind": "action",
      "steps": [
        "Any"
      ]
    },
    {
      "say": "type sacramento in the city box",
      "kind": "action",
      "steps": [
        "City"
      ]
    },
    {
      "say": "set the state to california and click search",
      "kind": "multistep",
      "steps": [
        "State/Territory",
        "Search"
      ]
    },
    {
      "say": "open the analyze trends menu",
      "kind": "action",
      "steps": [
        "Analyze Trends"
      ]
    },
    {
      "say": "open the data services menu",
      "kind": "action",
      "steps": [
        "Data Services"
      ]
    },
    {
      "say": "set the frs tribal land code to yes",
      "kind": "action",
      "steps": [
        "Yes"
      ]
    },
    {
      "say": "switch to the data table view and click search",
      "kind": "multistep",
      "steps": [
        "Data Table",
        "Search"
      ]
    },
    {
      "say": "open the help page",
      "kind": "action",
      "steps": [
        "Help"
      ],
      "later": true
    },
    {
      "say": "what does echo stand for",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};

// Round 9, 2026-10-24: one site for the 3B and 4B comparison in choice mode, prompts written
// from screenshots before the agent ran on them. Not run offline either.
module.exports.nohrsc = {
  "url": "https://www.nohrsc.noaa.gov/nsa/",
  "note": "NOAA NOHRSC National Snow Analyses: a sidebar of links, region/year/month/day lists with - / + / Go, nine map panels each with Season / Two weeks / One Day animation links, metric-unit links, the model discussion figures and a top-ten snow reports table.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "show the schedule for snow surveys",
      "kind": "action",
      "steps": [
        "Snow Survey Schedule"
      ],
      "later": true
    },
    {
      "say": "animate the snow depth map over the season",
      "kind": "action",
      "steps": [
        "Season"
      ],
      "later": true
    },
    {
      "say": "animate two weeks of snow melt",
      "kind": "action",
      "steps": [
        "Two weeks"
      ],
      "later": true
    },
    {
      "say": "switch the numbers to metric",
      "kind": "action",
      "steps": [
        "Metric Units..."
      ],
      "later": true
    },
    {
      "say": "go back one day",
      "kind": "action",
      "steps": [
        "-"
      ]
    },
    {
      "say": "move forward a day",
      "kind": "action",
      "steps": [
        "+"
      ]
    },
    {
      "say": "pick the sierra nevada region and press go",
      "kind": "multistep",
      "steps": [
        "Region",
        "Go"
      ]
    },
    {
      "say": "show the interactive maps",
      "kind": "action",
      "steps": [
        "Interactive Maps"
      ],
      "later": true
    },
    {
      "say": "open the help and faq page",
      "kind": "action",
      "steps": [
        "Help and FAQ"
      ],
      "later": true
    },
    {
      "say": "show the station snowfall reports",
      "kind": "action",
      "steps": [
        "Station Snowfall Reports"
      ],
      "later": true
    },
    {
      "say": "open the airborne surveys page",
      "kind": "action",
      "steps": [
        "Airborne Surveys"
      ],
      "later": true
    },
    {
      "say": "show more of the model discussion",
      "kind": "action",
      "steps": [
        "more..."
      ],
      "later": true
    },
    {
      "say": "what percent of the area is covered by snow",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "which station had the most snowfall",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "how much snow fell at crested butte",
      "kind": "explain",
      "steps": [],
      "explain": true
    }
  ]
};

// Round 10, 2026-10-24: City-FIDAP run locally, the same fifteen prompts the widget lists, so
// the extension and the widget can be compared on one set.
module.exports.city-fidap-local = {
  "url": "http://localhost:3000/lab/dt/",
  "note": "City-FIDAP (uihilab/CityDigitalTwin) run locally with npm start. Layer menus are closed accordions whose items appear only once opened. Close the welcome window and Google's dialog first, except for prompt 14.",
  "later": true,
  "firstContact": true,
  "prompts": [
    {
      "say": "show me where the bridges are",
      "kind": "action",
      "steps": [
        "Bridges"
      ]
    },
    {
      "say": "put the flood maps on the map",
      "kind": "action",
      "steps": [
        "Flood Maps"
      ]
    },
    {
      "say": "where are the police stations",
      "kind": "action",
      "steps": [
        "Police Stations"
      ]
    },
    {
      "say": "show the river gauges",
      "kind": "action",
      "steps": [
        "Stream Gauges"
      ]
    },
    {
      "say": "show me the bus routes",
      "kind": "action",
      "steps": [
        "Bus Route"
      ]
    },
    {
      "say": "which roads are closed",
      "kind": "action",
      "steps": [
        "Road Closures"
      ]
    },
    {
      "say": "show where the power plants are",
      "kind": "action",
      "steps": [
        "Electric Power Plants"
      ]
    },
    {
      "say": "show the wastewater treatment plants",
      "kind": "action",
      "steps": [
        "Waste Water TP"
      ]
    },
    {
      "say": "what is this platform for",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "what can I look at under public services",
      "kind": "explain",
      "steps": [],
      "explain": true
    },
    {
      "say": "pull up the weather forecast and tell me if it will rain",
      "kind": "action+explain",
      "steps": [
        "Weather Forecast"
      ],
      "explain": true
    },
    {
      "say": "show the air quality and tell me if it is good or bad",
      "kind": "action+explain",
      "steps": [
        "Air Quality Data"
      ],
      "explain": true
    },
    {
      "say": "show the schools and then the fire stations",
      "kind": "multistep",
      "steps": [
        "School",
        "Fire Stations"
      ]
    },
    {
      "say": "close the welcome window, then show the drought maps",
      "kind": "multistep",
      "steps": [
        "×",
        "Drought Maps"
      ]
    },
    {
      "say": "show the train route and the railway crossings",
      "kind": "multistep",
      "steps": [
        "Train Route",
        "Railway Crossing"
      ]
    }
  ]
};
