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
    { say: "open the small craft advisory on the hazards map and summarize where it applies",
      kind: "action+explain", steps: ["Small Craft Advisory"], explain: true },
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
