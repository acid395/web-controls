/* ============================================================================
 * env-vocab.js - shared environmental-science vocabulary, not tied to any
 * one site.
 *
 * web-controls.js's SUPPLIED.PARAMS only knows USGS's own numeric codes
 * (00060 = discharge). That table had to be typed in from scratch, because
 * nothing on the page says what the codes mean. Most of that knowledge isn't
 * actually USGS-specific, it's just common hydrology/environmental
 * vocabulary, so re-typing it for every new site (NOAA, EPA, a state DEQ
 * site, ...) would be repeating work that doesn't need repeating.
 *
 * This file exists to be read, not pasted and run for its own sake (there's
 * nothing to "do" with it alone). Two uses:
 *   1. A person mapping a new site can check here first before inventing a
 *      synonym table from scratch.
 *   2. Once manifests are auto-generated (see README, "Any site"), this is
 *      the context an LLM gets handed alongside a site's raw inventory, so
 *      it starts with real domain knowledge instead of guessing.
 *
 * Paste it if you want window.ENV_VOCAB available in the console, same as
 * any other file here. It doesn't depend on WC and nothing else depends on
 * it yet, it's a knowledge table, not active code.
 * ========================================================================== */
(() => {
  const ENV_VOCAB = {
    // canonical concept -> the words a person actually types for it
    parameters: {
      discharge: ["discharge", "streamflow", "flow", "flow rate", "cfs", "cubic feet per second"],
      gageHeight: ["gage height", "gauge height", "stage", "water surface elevation", "ft", "feet"],
      waterTemperature: ["water temperature", "water temp", "temperature", "temp"],
      airTemperature: ["air temperature", "air temp"],
      dissolvedOxygen: ["dissolved oxygen", "do", "oxygen"],
      specificConductance: ["specific conductance", "conductivity", "conductance"],
      pH: ["ph"],
      turbidity: ["turbidity", "ntu"],
      precipitation: ["precipitation", "precip", "rainfall"],
      snowDepth: ["snow depth"],
      snowWaterEquivalent: ["snow water equivalent", "swe"],
      groundwaterLevel: ["groundwater level", "depth to water level", "water level", "well level"],
      soilMoisture: ["soil moisture"],
    },

    // ISO-8601 durations, which is what a lot of federal sites use as the
    // literal value in the DOM, and the everyday phrases for the same thing
    durations: {
      P1D: ["1 day", "today", "daily", "24 hours", "24h"],
      P7D: ["7 days", "a week", "last week", "weekly"],
      P30D: ["30 days", "a month", "last month", "monthly"],
      P90D: ["90 days", "3 months", "quarterly"],
      P120D: ["120 days"],
      P365D: ["1 year", "a year", "annual", "last year"],
    },

    // severity/category vocabulary, worded differently site to site but
    // meaning the same handful of tiers
    floodCategories: ["major flood", "moderate flood", "minor flood", "action", "near flood", "no flood"],
    droughtCategories: ["exceptional drought", "extreme drought", "severe drought", "moderate drought", "abnormally dry", "none"],
    airQualityCategories: ["hazardous", "very unhealthy", "unhealthy", "unhealthy for sensitive groups", "moderate", "good"],

    // agencies and the sites/APIs commonly seen so far, useful for an LLM
    // deciding "which agency's convention is this page probably using"
    agencies: {
      USGS: { fullName: "U.S. Geological Survey", sites: ["waterdata.usgs.gov", "dashboard.waterdata.usgs.gov", "streamstats.usgs.gov", "earthquake.usgs.gov"] },
      NOAA: { fullName: "National Oceanic and Atmospheric Administration", sites: ["water.noaa.gov", "tidesandcurrents.noaa.gov", "nowcoast.noaa.gov"] },
      NWS: { fullName: "National Weather Service", sites: ["weather.gov", "water.weather.gov"] },
      EPA: { fullName: "Environmental Protection Agency", sites: ["mywaterway.epa.gov", "waterqualitydata.us"] },
      NIDIS: { fullName: "National Integrated Drought Information System", sites: ["drought.gov"] },
    },

    // units, in case a site states a value with a unit that needs
    // normalizing against another site's numbers for the same concept
    units: {
      cfs: "cubic feet per second", ft: "feet", degF: "degrees Fahrenheit", degC: "degrees Celsius",
      mgL: "milligrams per liter", NTU: "nephelometric turbidity units", uScm: "microsiemens per centimeter",
      in: "inches", mm: "millimeters",
    },
  };

  // reverse lookup: any known synonym -> its canonical concept name
  const lookup = new Map();
  for (const [canonical, synonyms] of Object.entries(ENV_VOCAB.parameters)) {
    for (const s of synonyms) lookup.set(s.toLowerCase(), canonical);
  }
  ENV_VOCAB.resolveParameter = (text) => lookup.get((text || "").trim().toLowerCase()) || null;

  const durLookup = new Map();
  for (const [iso, phrases] of Object.entries(ENV_VOCAB.durations)) {
    for (const p of phrases) durLookup.set(p.toLowerCase(), iso);
  }
  ENV_VOCAB.resolveDuration = (text) => durLookup.get((text || "").trim().toLowerCase()) || null;

  window.ENV_VOCAB = ENV_VOCAB;
  console.log("%cLoaded  window.ENV_VOCAB", "color:green;font-weight:bold");
  console.log("ENV_VOCAB.resolveParameter('flow') ->", ENV_VOCAB.resolveParameter("flow"));
})();
