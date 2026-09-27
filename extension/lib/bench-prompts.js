/* bench-prompts.js - the prompt set, frozen, so a live run and an offline
 * one are the same experiment.
 *
 * These are the exact instructions research/live-scoring/actions.js runs
 * against captured snapshots with the model off. Shipping them inside the
 * extension lets the same list run live, in Chrome, with the model on - and
 * the only difference between the two numbers is then the thing being
 * measured, rather than a difference in what was asked.
 *
 * Generated from the offline run; do not hand-edit. Each entry carries what
 * the offline grounding-layer-only pass did with it (offline: true/false),
 * so a live result can be compared row by row rather than only in total.
 */
globalThis.WC_BENCH_PROMPTS = {
 "usgs": {
  "url": "https://waterdata.usgs.gov/monitoring-location/01646500/",
  "prompts": [
   {
    "say": "click 7 days",
    "kind": "toggle",
    "on": "7 days",
    "want": {
     "on": "7 days"
    },
    "offline": true
   },
   {
    "say": "click 30 days",
    "kind": "toggle",
    "on": "30 days",
    "want": {
     "on": "30 days"
    },
    "offline": true
   },
   {
    "say": "click 1 year",
    "kind": "toggle",
    "on": "1 year",
    "want": {
     "on": "1 year"
    },
    "offline": true
   },
   {
    "say": "click Linear",
    "kind": "toggle",
    "on": "Linear",
    "want": {
     "on": "Linear"
    },
    "offline": false
   },
   {
    "say": "click Select data to graph on second y-axis",
    "kind": "toggle",
    "on": "Select data to graph on second y-axis",
    "want": {
     "on": "Select data to graph on second y-axis"
    },
    "offline": true
   },
   {
    "say": "click Graph Discharge, cubic feet per second",
    "kind": "toggle",
    "on": "Graph Discharge, cubic feet per second",
    "want": {
     "on": "Graph Discharge, cubic feet per second"
    },
    "offline": true
   },
   {
    "say": "click Menu",
    "kind": "press",
    "on": "Menu",
    "want": {
     "clicked": "Menu"
    },
    "offline": true
   },
   {
    "say": "click survey",
    "kind": "press",
    "on": "survey",
    "want": {
     "clicked": "survey"
    },
    "offline": true
   },
   {
    "say": "click Dismiss site alert",
    "kind": "press",
    "on": "Dismiss site alert",
    "want": {
     "clicked": "Dismiss site alert"
    },
    "offline": true
   },
   {
    "say": "click provisional",
    "kind": "press",
    "on": "provisional",
    "want": {
     "clicked": "provisional"
    },
    "offline": true
   },
   {
    "say": "click Expand all data collections",
    "kind": "press",
    "on": "Expand all data collections",
    "want": {
     "clicked": "Expand all data collections"
    },
    "offline": true
   },
   {
    "say": "click Site Location",
    "kind": "press",
    "on": "Site Location",
    "want": {
     "clicked": "Site Location"
    },
    "offline": false
   },
   {
    "say": "click Zoom in",
    "kind": "press",
    "on": "Zoom in",
    "want": {
     "clicked": "Zoom in"
    },
    "offline": true
   },
   {
    "say": "click Hide legend",
    "kind": "press",
    "on": "Hide legend",
    "want": {
     "clicked": "Hide legend"
    },
    "offline": true
   },
   {
    "say": "click USGS - Federal Priority Streamgages",
    "kind": "press",
    "on": "USGS - Federal Priority Streamgages",
    "want": {
     "clicked": "USGS - Federal Priority Streamgages"
    },
    "offline": true
   },
   {
    "say": "click Legal",
    "kind": "press",
    "on": "Legal",
    "want": {
     "clicked": "Legal"
    },
    "offline": true
   },
   {
    "say": "click Site Map",
    "kind": "press",
    "on": "Site Map",
    "want": {
     "clicked": "Site Map"
    },
    "offline": true
   },
   {
    "say": "click USGS Github",
    "kind": "press",
    "on": "USGS Github",
    "want": {
     "clicked": "USGS Github"
    },
    "offline": true
   },
   {
    "say": "click DOI Inspector General",
    "kind": "press",
    "on": "DOI Inspector General",
    "want": {
     "clicked": "DOI Inspector General"
    },
    "offline": true
   },
   {
    "say": "click No Fear Act",
    "kind": "press",
    "on": "No Fear Act",
    "want": {
     "clicked": "No Fear Act"
    },
    "offline": true
   },
   {
    "say": "click Exapnd all data collections",
    "kind": "misspelt",
    "on": "Expand all data collections",
    "want": {
     "clicked": "Expand all data collections"
    },
    "offline": true
   },
   {
    "say": "click USGS - Feedral Priority Streamgages",
    "kind": "misspelt",
    "on": "USGS - Federal Priority Streamgages",
    "want": {
     "clicked": "USGS - Federal Priority Streamgages"
    },
    "offline": true
   },
   {
    "say": "click DOI Inpsector General",
    "kind": "misspelt",
    "on": "DOI Inspector General",
    "want": {
     "clicked": "DOI Inspector General"
    },
    "offline": true
   },
   {
    "say": "could you please click Menu for me",
    "kind": "polite",
    "on": "Menu",
    "want": {
     "clicked": "Menu"
    },
    "offline": true
   },
   {
    "say": "could you please click Hide legend for me",
    "kind": "polite",
    "on": "Hide legend",
    "want": {
     "clicked": "Hide legend"
    },
    "offline": true
   },
   {
    "say": "explain this data",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "what does this page show",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "click the tidal predictions calibrator",
    "kind": "absent",
    "on": "(nothing - should refuse)",
    "want": {
     "refuse": true
    },
    "offline": false
   }
  ]
 },
 "noaa": {
  "url": "https://water.noaa.gov/",
  "prompts": [
   {
    "say": "click here",
    "kind": "press",
    "on": "here",
    "want": {
     "clicked": "here"
    },
    "offline": true
   },
   {
    "say": "click Rivers-at-a-Glance",
    "kind": "press",
    "on": "Rivers-at-a-Glance",
    "want": {
     "clicked": "Rivers-at-a-Glance"
    },
    "offline": true
   },
   {
    "say": "click Categorical FIM List",
    "kind": "press",
    "on": "Categorical FIM List",
    "want": {
     "clicked": "Categorical FIM List"
    },
    "offline": true
   },
   {
    "say": "click Long Range Outlook",
    "kind": "press",
    "on": "Long Range Outlook",
    "want": {
     "clicked": "Long Range Outlook"
    },
    "offline": true
   },
   {
    "say": "click Key Messages",
    "kind": "press",
    "on": "Key Messages",
    "want": {
     "clicked": "Key Messages"
    },
    "offline": true
   },
   {
    "say": "click Significant River Flood Outlook",
    "kind": "press",
    "on": "Significant River Flood Outlook",
    "want": {
     "clicked": "Significant River Flood Outlook"
    },
    "offline": true
   },
   {
    "say": "click River Ice Surveillance",
    "kind": "press",
    "on": "River Ice Surveillance",
    "want": {
     "clicked": "River Ice Surveillance"
    },
    "offline": true
   },
   {
    "say": "click NWPS APIs",
    "kind": "press",
    "on": "NWPS APIs",
    "want": {
     "clicked": "NWPS APIs"
    },
    "offline": true
   },
   {
    "say": "click Future Study: Modernizing PMP",
    "kind": "press",
    "on": "Future Study: Modernizing PMP",
    "want": {
     "clicked": "Future Study: Modernizing PMP"
    },
    "offline": true
   },
   {
    "say": "click Short-term Probabilistic Guidance Product",
    "kind": "press",
    "on": "Short-term Probabilistic Guidance Product",
    "want": {
     "clicked": "Short-term Probabilistic Guidance Product"
    },
    "offline": true
   },
   {
    "say": "click Weather Forecast Offices",
    "kind": "press",
    "on": "Weather Forecast Offices",
    "want": {
     "clicked": "Weather Forecast Offices"
    },
    "offline": true
   },
   {
    "say": "click NWPS Release Notes",
    "kind": "press",
    "on": "NWPS Release Notes",
    "want": {
     "clicked": "NWPS Release Notes"
    },
    "offline": true
   },
   {
    "say": "click NWPS User Guide",
    "kind": "press",
    "on": "NWPS User Guide",
    "want": {
     "clicked": "NWPS User Guide"
    },
    "offline": true
   },
   {
    "say": "click GitHub link",
    "kind": "press",
    "on": "GitHub link",
    "want": {
     "clicked": "GitHub link"
    },
    "offline": true
   },
   {
    "say": "click Singificant River Flood Outlook",
    "kind": "misspelt",
    "on": "Significant River Flood Outlook",
    "want": {
     "clicked": "Significant River Flood Outlook"
    },
    "offline": true
   },
   {
    "say": "click Wetaher Forecast Offices",
    "kind": "misspelt",
    "on": "Weather Forecast Offices",
    "want": {
     "clicked": "Weather Forecast Offices"
    },
    "offline": true
   },
   {
    "say": "could you please click here for me",
    "kind": "polite",
    "on": "here",
    "want": {
     "clicked": "here"
    },
    "offline": true
   },
   {
    "say": "could you please click Weather Forecast Offices for me",
    "kind": "polite",
    "on": "Weather Forecast Offices",
    "want": {
     "clicked": "Weather Forecast Offices"
    },
    "offline": true
   },
   {
    "say": "select National Hydromet Discussion September 24, 2026",
    "kind": "choose",
    "on": "selector -> National Hydromet Discussion September 24, 2026",
    "want": {
     "value": "National Hydromet Discussion September 24, 2026"
    },
    "offline": true
   },
   {
    "say": "explain this data",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "what does this page show",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "click the tidal predictions calibrator",
    "kind": "absent",
    "on": "(nothing - should refuse)",
    "want": {
     "refuse": true
    },
    "offline": false
   }
  ]
 },
 "droughtmap": {
  "url": "https://droughtmonitor.unl.edu/CurrentMap.aspx",
  "prompts": [
   {
    "say": "click View grayscale version of the map",
    "kind": "toggle",
    "on": "View grayscale version of the map",
    "want": {
     "on": "View grayscale version of the map"
    },
    "offline": true
   },
   {
    "say": "click U.S. Drought Monitor",
    "kind": "press",
    "on": "U.S. Drought Monitor",
    "want": {
     "clicked": "U.S. Drought Monitor"
    },
    "offline": true
   },
   {
    "say": "click Map Archive",
    "kind": "press",
    "on": "Map Archive",
    "want": {
     "clicked": "Map Archive"
    },
    "offline": true
   },
   {
    "say": "click Map Viewer",
    "kind": "press",
    "on": "Map Viewer",
    "want": {
     "clicked": "Map Viewer"
    },
    "offline": true
   },
   {
    "say": "click Custom Map Request",
    "kind": "press",
    "on": "Custom Map Request",
    "want": {
     "clicked": "Custom Map Request"
    },
    "offline": true
   },
   {
    "say": "click Bar Chart",
    "kind": "press",
    "on": "Bar Chart",
    "want": {
     "clicked": "Bar Chart"
    },
    "offline": true
   },
   {
    "say": "click Statistics by Threshold",
    "kind": "press",
    "on": "Statistics by Threshold",
    "want": {
     "clicked": "Statistics by Threshold"
    },
    "offline": true
   },
   {
    "say": "click AOI Values",
    "kind": "press",
    "on": "AOI Values",
    "want": {
     "clicked": "AOI Values"
    },
    "offline": true
   },
   {
    "say": "click What is the USDM?",
    "kind": "press",
    "on": "What is the USDM?",
    "want": {
     "clicked": "What is the USDM?"
    },
    "offline": true
   },
   {
    "say": "click Drought Classification",
    "kind": "press",
    "on": "Drought Classification",
    "want": {
     "clicked": "Drought Classification"
    },
    "offline": true
   },
   {
    "say": "click Drought Alert Request",
    "kind": "press",
    "on": "Drought Alert Request",
    "want": {
     "clicked": "Drought Alert Request"
    },
    "offline": true
   },
   {
    "say": "click Media Kit",
    "kind": "press",
    "on": "Media Kit",
    "want": {
     "clicked": "Media Kit"
    },
    "offline": true
   },
   {
    "say": "click Ag in Drought",
    "kind": "press",
    "on": "Ag in Drought",
    "want": {
     "clicked": "Ag in Drought"
    },
    "offline": true
   },
   {
    "say": "click David Mocko",
    "kind": "press",
    "on": "David Mocko",
    "want": {
     "clicked": "David Mocko"
    },
    "offline": true
   },
   {
    "say": "click Continental U.S.",
    "kind": "press",
    "on": "Continental U.S.",
    "want": {
     "clicked": "Continental U.S."
    },
    "offline": true
   },
   {
    "say": "click U.S. Druoght Monitor",
    "kind": "misspelt",
    "on": "U.S. Drought Monitor",
    "want": {
     "clicked": "U.S. Drought Monitor"
    },
    "offline": true
   },
   {
    "say": "click Druoght Severity and Coverage Index",
    "kind": "misspelt",
    "on": "Drought Severity and Coverage Index",
    "want": {
     "clicked": "Drought Severity and Coverage Index"
    },
    "offline": true
   },
   {
    "say": "click Pouplation Statistics",
    "kind": "misspelt",
    "on": "Population Statistics",
    "want": {
     "clicked": "Population Statistics"
    },
    "offline": true
   },
   {
    "say": "click Cotninental U.S.",
    "kind": "misspelt",
    "on": "Continental U.S.",
    "want": {
     "clicked": "Continental U.S."
    },
    "offline": true
   },
   {
    "say": "could you please click U.S. Drought Monitor for me",
    "kind": "polite",
    "on": "U.S. Drought Monitor",
    "want": {
     "clicked": "U.S. Drought Monitor"
    },
    "offline": true
   },
   {
    "say": "could you please click Population Statistics for me",
    "kind": "polite",
    "on": "Population Statistics",
    "want": {
     "clicked": "Population Statistics"
    },
    "offline": true
   },
   {
    "say": "explain this data",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "what does this page show",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "click the tidal predictions calibrator",
    "kind": "absent",
    "on": "(nothing - should refuse)",
    "want": {
     "refuse": true
    },
    "offline": true
   }
  ]
 },
 "weather": {
  "url": "https://www.weather.gov/",
  "prompts": [
   {
    "say": "click Remember Me",
    "kind": "toggle",
    "on": "Remember Me",
    "want": {
     "on": "Remember Me"
    },
    "offline": true
   },
   {
    "say": "click HOME",
    "kind": "press",
    "on": "HOME",
    "want": {
     "clicked": "HOME"
    },
    "offline": true
   },
   {
    "say": "click Hurricanes",
    "kind": "press",
    "on": "Hurricanes",
    "want": {
     "clicked": "Hurricanes"
    },
    "offline": true
   },
   {
    "say": "click Climate Prediction",
    "kind": "press",
    "on": "Climate Prediction",
    "want": {
     "clicked": "Climate Prediction"
    },
    "offline": true
   },
   {
    "say": "click Certified Weather Data",
    "kind": "press",
    "on": "Certified Weather Data",
    "want": {
     "clicked": "Certified Weather Data"
    },
    "offline": true
   },
   {
    "say": "click Brochures",
    "kind": "press",
    "on": "Brochures",
    "want": {
     "clicked": "Brochures"
    },
    "offline": true
   },
   {
    "say": "click GIS Data Portal",
    "kind": "press",
    "on": "GIS Data Portal",
    "want": {
     "clicked": "GIS Data Portal"
    },
    "offline": true
   },
   {
    "say": "click StormReady",
    "kind": "press",
    "on": "StormReady",
    "want": {
     "clicked": "StormReady"
    },
    "offline": true
   },
   {
    "say": "click NEWS",
    "kind": "press",
    "on": "NEWS",
    "want": {
     "clicked": "NEWS"
    },
    "offline": true
   },
   {
    "say": "click Glossary",
    "kind": "press",
    "on": "Glossary",
    "want": {
     "clicked": "Glossary"
    },
    "offline": true
   },
   {
    "say": "click RIVERS, LAKES, RAINFALL",
    "kind": "press",
    "on": "RIVERS, LAKES, RAINFALL",
    "want": {
     "clicked": "RIVERS, LAKES, RAINFALL"
    },
    "offline": true
   },
   {
    "say": "click Puerto Rico/Virgin Islands",
    "kind": "press",
    "on": "Puerto Rico/Virgin Islands",
    "want": {
     "clicked": "Puerto Rico/Virgin Islands"
    },
    "offline": true
   },
   {
    "say": "click Red Flag Warning",
    "kind": "press",
    "on": "Red Flag Warning",
    "want": {
     "clicked": "Red Flag Warning"
    },
    "offline": true
   },
   {
    "say": "click High Surf Advisory",
    "kind": "press",
    "on": "High Surf Advisory",
    "want": {
     "clicked": "High Surf Advisory"
    },
    "offline": true
   },
   {
    "say": "click Beach Hazards Statement",
    "kind": "press",
    "on": "Beach Hazards Statement",
    "want": {
     "clicked": "Beach Hazards Statement"
    },
    "offline": true
   },
   {
    "say": "click Weather-Ready Naiton",
    "kind": "misspelt",
    "on": "Weather-Ready Nation",
    "want": {
     "clicked": "Weather-Ready Nation"
    },
    "offline": true
   },
   {
    "say": "click Naitonal Centers",
    "kind": "misspelt",
    "on": "National Centers",
    "want": {
     "clicked": "National Centers"
    },
    "offline": true
   },
   {
    "say": "could you please click HOME for me",
    "kind": "polite",
    "on": "HOME",
    "want": {
     "clicked": "HOME"
    },
    "offline": true
   },
   {
    "say": "could you please click National Centers for me",
    "kind": "polite",
    "on": "National Centers",
    "want": {
     "clicked": "National Centers"
    },
    "offline": true
   },
   {
    "say": "search potomac",
    "kind": "search",
    "on": "Enter Your City, ST or ZIP Code",
    "want": {
     "typed": "potomac"
    },
    "offline": true
   },
   {
    "say": "explain this data",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "what does this page show",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "click the tidal predictions calibrator",
    "kind": "absent",
    "on": "(nothing - should refuse)",
    "want": {
     "refuse": true
    },
    "offline": true
   }
  ]
 },
 "airnow": {
  "url": "https://www.airnow.gov/",
  "prompts": [
   {
    "say": "click How to use this site",
    "kind": "press",
    "on": "How to use this site",
    "want": {
     "clicked": "How to use this site"
    },
    "offline": true
   },
   {
    "say": "click Announcements",
    "kind": "press",
    "on": "Announcements",
    "want": {
     "clicked": "Announcements"
    },
    "offline": true
   },
   {
    "say": "click Using the Air Quality Index",
    "kind": "press",
    "on": "Using the Air Quality Index",
    "want": {
     "clicked": "Using the Air Quality Index"
    },
    "offline": true
   },
   {
    "say": "click Air Quality and Health",
    "kind": "press",
    "on": "Air Quality and Health",
    "want": {
     "clicked": "Air Quality and Health"
    },
    "offline": true
   },
   {
    "say": "click Asthma and Heart Disease",
    "kind": "press",
    "on": "Asthma and Heart Disease",
    "want": {
     "clicked": "Asthma and Heart Disease"
    },
    "offline": true
   },
   {
    "say": "click More Information",
    "kind": "press",
    "on": "More Information",
    "want": {
     "clicked": "More Information"
    },
    "offline": true
   },
   {
    "say": "click Information by state",
    "kind": "press",
    "on": "Information by state",
    "want": {
     "clicked": "Information by state"
    },
    "offline": true
   },
   {
    "say": "click By Monitor",
    "kind": "press",
    "on": "By Monitor",
    "want": {
     "clicked": "By Monitor"
    },
    "offline": true
   },
   {
    "say": "click Developers/API",
    "kind": "press",
    "on": "Developers/API",
    "want": {
     "clicked": "Developers/API"
    },
    "offline": true
   },
   {
    "say": "click Information for:",
    "kind": "press",
    "on": "Information for:",
    "want": {
     "clicked": "Information for:"
    },
    "offline": true
   },
   {
    "say": "click Mexico",
    "kind": "press",
    "on": "Mexico",
    "want": {
     "clicked": "Mexico"
    },
    "offline": true
   },
   {
    "say": "click Web Cameras",
    "kind": "press",
    "on": "Web Cameras",
    "want": {
     "clicked": "Web Cameras"
    },
    "offline": true
   },
   {
    "say": "click Recursos en español",
    "kind": "press",
    "on": "Recursos en español",
    "want": {
     "clicked": "Recursos en español"
    },
    "offline": true
   },
   {
    "say": "click Fire & Smoke Map",
    "kind": "press",
    "on": "Fire & Smoke Map",
    "want": {
     "clicked": "Fire & Smoke Map"
    },
    "offline": true
   },
   {
    "say": "click Your Helath",
    "kind": "misspelt",
    "on": "Your Health",
    "want": {
     "clicked": "Your Health"
    },
    "offline": true
   },
   {
    "say": "click AiDrata",
    "kind": "misspelt",
    "on": "AirData",
    "want": {
     "clicked": "AirData"
    },
    "offline": true
   },
   {
    "say": "click Web Caemras",
    "kind": "misspelt",
    "on": "Web Cameras",
    "want": {
     "clicked": "Web Cameras"
    },
    "offline": true
   },
   {
    "say": "could you please click How to use this site for me",
    "kind": "polite",
    "on": "How to use this site",
    "want": {
     "clicked": "How to use this site"
    },
    "offline": true
   },
   {
    "say": "could you please click AirCompare for me",
    "kind": "polite",
    "on": "AirCompare",
    "want": {
     "clicked": "AirCompare"
    },
    "offline": true
   },
   {
    "say": "search potomac",
    "kind": "search",
    "on": "ZIP Code, City, or State",
    "want": {
     "typed": "potomac"
    },
    "offline": true
   },
   {
    "say": "explain this data",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "what does this page show",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "click the tidal predictions calibrator",
    "kind": "absent",
    "on": "(nothing - should refuse)",
    "want": {
     "refuse": true
    },
    "offline": false
   }
  ]
 },
 "drought": {
  "url": "https://www.drought.gov/",
  "prompts": [
   {
    "say": "click Home",
    "kind": "press",
    "on": "Home",
    "want": {
     "clicked": "Home"
    },
    "offline": true
   },
   {
    "say": "click Menu",
    "kind": "press",
    "on": "Menu",
    "want": {
     "clicked": "Menu"
    },
    "offline": true
   },
   {
    "say": "click Close",
    "kind": "press",
    "on": "Close",
    "want": {
     "clicked": "Close"
    },
    "offline": true
   },
   {
    "say": "click U.S. Drought Monitor",
    "kind": "press",
    "on": "U.S. Drought Monitor",
    "want": {
     "clicked": "U.S. Drought Monitor"
    },
    "offline": false
   },
   {
    "say": "click NDMC",
    "kind": "press",
    "on": "NDMC",
    "want": {
     "clicked": "NDMC"
    },
    "offline": true
   },
   {
    "say": "click NOAA",
    "kind": "press",
    "on": "NOAA",
    "want": {
     "clicked": "NOAA"
    },
    "offline": true
   },
   {
    "say": "click USDA",
    "kind": "press",
    "on": "USDA",
    "want": {
     "clicked": "USDA"
    },
    "offline": true
   },
   {
    "say": "click NASA",
    "kind": "press",
    "on": "NASA",
    "want": {
     "clicked": "NASA"
    },
    "offline": true
   },
   {
    "say": "click UC Merced",
    "kind": "press",
    "on": "UC Merced",
    "want": {
     "clicked": "UC Merced"
    },
    "offline": true
   },
   {
    "say": "click tag: Drought Index",
    "kind": "press",
    "on": "tag: Drought Index",
    "want": {
     "clicked": "tag: Drought Index"
    },
    "offline": true
   },
   {
    "say": "click Learn More",
    "kind": "press",
    "on": "Learn More",
    "want": {
     "clicked": "Learn More"
    },
    "offline": true
   },
   {
    "say": "click tag: Precipitation",
    "kind": "press",
    "on": "tag: Precipitation",
    "want": {
     "clicked": "tag: Precipitation"
    },
    "offline": true
   },
   {
    "say": "click tag: Temperature",
    "kind": "press",
    "on": "tag: Temperature",
    "want": {
     "clicked": "tag: Temperature"
    },
    "offline": true
   },
   {
    "say": "click D1 - Moderate Drought",
    "kind": "press",
    "on": "D1 - Moderate Drought",
    "want": {
     "clicked": "D1 - Moderate Drought"
    },
    "offline": true
   },
   {
    "say": "click UC Mecred",
    "kind": "misspelt",
    "on": "UC Merced",
    "want": {
     "clicked": "UC Merced"
    },
    "offline": true
   },
   {
    "say": "click tag: Tepmerature",
    "kind": "misspelt",
    "on": "tag: Temperature",
    "want": {
     "clicked": "tag: Temperature"
    },
    "offline": true
   },
   {
    "say": "could you please click Home for me",
    "kind": "polite",
    "on": "Home",
    "want": {
     "clicked": "Home"
    },
    "offline": true
   },
   {
    "say": "could you please click tag: Drought Index for me",
    "kind": "polite",
    "on": "tag: Drought Index",
    "want": {
     "clicked": "tag: Drought Index"
    },
    "offline": true
   },
   {
    "say": "search potomac",
    "kind": "search",
    "on": "Query",
    "want": {
     "typed": "potomac"
    },
    "offline": true
   },
   {
    "say": "explain this data",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "what does this page show",
    "kind": "read",
    "on": "(the page's own values)",
    "want": {
     "read": true
    },
    "offline": true
   },
   {
    "say": "click the tidal predictions calibrator",
    "kind": "absent",
    "on": "(nothing - should refuse)",
    "want": {
     "refuse": true
    },
    "offline": true
   }
  ]
 }
};
