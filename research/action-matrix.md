# Action matrix - five federal sites, all resolving

108 actions derived from the live HTML of waterdata.usgs.gov, water.noaa.gov,
drought.gov, mywaterway.epa.gov and weather.gov. Every control the extension
finds is turned back into the instruction a person would type, and scored on
whether it resolves to that control.

Reaching a different control carrying an identical label counts: from the
label alone there is no correct answer to pick.

Static HTML, no JavaScript - client-rendered sites are a lower bound, and the
instructions come from the controls' own labels, so this is a ceiling rather
than a field measurement.

| site | resolved | actions |
|---|---|---|
| USGS NWIS | 25 | 25 |
| NWPS (NOAA) | 8 | 8 |
| Drought.gov | 25 | 25 |
| EPA MyWaterway | 25 | 25 |
| weather.gov | 25 | 25 |
| **total** | **108** | **108** |

## By control kind

| kind | resolved |
|---|---|
| `a` | 59/59 |
| `button:button` | 17/17 |
| `button:submit` | 7/7 |
| `div` | 5/5 |
| `input:text` | 4/4 |
| `input:submit` | 4/4 |
| `a:button` | 3/3 |
| `input:search` | 2/2 |
| `select:select-one` | 2/2 |
| `input:radio` | 2/2 |
| `combobox` | 1/1 |
| `span` | 1/1 |
| `input:checkbox` | 1/1 |

## Every action

| site | kind | instruction | tool |
|---|---|---|---|
| USGS NWIS | `a` | click Skip to main content | `pageClick` |
| USGS NWIS | `button:button` | click Here’s how you know | `pageClick` |
| USGS NWIS | `combobox` | click [][]Select a stateteleport startv-iftelepo | `pageClick` |
| USGS NWIS | `input:text` | search -searchbox for smith river | `pageFill` |
| USGS NWIS | `a` | click WDFN Home | `pageClick` |
| USGS NWIS | `button:button` | click Menu | `pageClick` |
| USGS NWIS | `a` | click My Favorite Monitoring Locations | `pageClick` |
| USGS NWIS | `button:button` | click WDFN tools and data | `pageClick` |
| USGS NWIS | `a` | click National Water Dashboard | `pageClick` |
| USGS NWIS | `button:button` | click Other water data resources | `pageClick` |
| USGS NWIS | `a` | click WaterAlert | `pageClick` |
| USGS NWIS | `button:button` | click Connect | `pageClick` |
| USGS NWIS | `a` | click Explore USGS Water Data | `pageClick` |
| USGS NWIS | `button:button` | click Dismiss site alert | `pageClick` |
| USGS NWIS | `a` | click USGS Water Data APIs | `pageClick` |
| USGS NWIS | `a` | click Statistics documentation | `pageClick` |
| USGS NWIS | `a` | click Water Resources Mission Area | `pageClick` |
| USGS NWIS | `a` | click Water Data Visualizations | `pageClick` |
| USGS NWIS | `a` | click Water Science School | `pageClick` |
| USGS NWIS | `a` | click WMA Catalog | `pageClick` |
| USGS NWIS | `a` | click National Water Availability Assessment Dat | `pageClick` |
| USGS NWIS | `a` | click USGS Water Resources Instagram | `pageClick` |
| USGS NWIS | `a` | click USGS Water Resources Facebook | `pageClick` |
| USGS NWIS | `a` | click USGS Water Resources X | `pageClick` |
| USGS NWIS | `a` | click USGS Data Science X | `pageClick` |
| NWPS (NOAA) | `a` | click Hyperlink to FIM PDF | `pageClick` |
| NWPS (NOAA) | `a:button` | click View full page | `pageClick` |
| NWPS (NOAA) | `button:button` | click Close | `pageClick` |
| NWPS (NOAA) | `a` | click Hyperlink to FIM page on NWPS | `pageClick` |
| NWPS (NOAA) | `a:button` | click Continue | `pageClick` |
| NWPS (NOAA) | `button:button` | click Cancel | `pageClick` |
| NWPS (NOAA) | `a` | click Hyperlink to a PDF that details FIM usage | `pageClick` |
| NWPS (NOAA) | `a:button` | click New window | `pageClick` |
| Drought.gov | `a` | click Skip to main content | `pageClick` |
| Drought.gov | `button:submit` | click Here's how you know | `pageClick` |
| Drought.gov | `input:search` | search Query for smith river | `pageFill` |
| Drought.gov | `input:submit` | click Search | `pageClick` |
| Drought.gov | `select:select-one` | open Input location | `pageClick` |
| Drought.gov | `button:button` | click tag: Drought Index | `pageClick` |
| Drought.gov | `span` | click U.S. Drought Monitor map details and infor | `pageClick` |
| Drought.gov | `div` | click Sep 22 2026 September Southeast Climate Mo | `pageClick` |
| Drought.gov | `a` | click Home | `pageClick` |
| Drought.gov | `button:submit` | click Open Search Bar | `pageClick` |
| Drought.gov | `select:select-one` | set Select a State to Alabama | `pageSelectOption` |
| Drought.gov | `button:button` | click tag: Water Supply | `pageClick` |
| Drought.gov | `div` | click Sep 28 2026 NOAA Drought Seminar Series: D | `pageClick` |
| Drought.gov | `a` | click Drought.gov Facebook account | `pageClick` |
| Drought.gov | `button:submit` | click Menu | `pageClick` |
| Drought.gov | `button:button` | click tag: Agriculture | `pageClick` |
| Drought.gov | `div` | click Sep 29 2026 Arkansas-Louisiana-Mississippi | `pageClick` |
| Drought.gov | `a` | click Drought.gov Instagram account | `pageClick` |
| Drought.gov | `button:submit` | click Close | `pageClick` |
| Drought.gov | `button:button` | click tag: Precipitation | `pageClick` |
| Drought.gov | `div` | click August 25, 2026 Drought Status Update for  | `pageClick` |
| Drought.gov | `a` | click Drought.gov LinkedIn account | `pageClick` |
| Drought.gov | `button:submit` | click Data and Maps | `pageClick` |
| Drought.gov | `button:button` | click tag: Temperature | `pageClick` |
| Drought.gov | `div` | click August 20, 2026 Drought Status Update for  | `pageClick` |
| EPA MyWaterway | `a` | click Skip to main content | `pageClick` |
| EPA MyWaterway | `button:button` | click Here’s how you know | `pageClick` |
| EPA MyWaterway | `input:search` | search Search for smith river | `pageFill` |
| EPA MyWaterway | `button:submit` | click Search | `pageClick` |
| EPA MyWaterway | `a` | click Home | `pageClick` |
| EPA MyWaterway | `button:button` | click Open search drawer | `pageClick` |
| EPA MyWaterway | `button:submit` | click x | `pageClick` |
| EPA MyWaterway | `a` | click Environmental Topics | `pageClick` |
| EPA MyWaterway | `button:button` | click Menu | `pageClick` |
| EPA MyWaterway | `a` | click Laws & Regulations | `pageClick` |
| EPA MyWaterway | `button:button` | click Close | `pageClick` |
| EPA MyWaterway | `a` | click Report a Violation | `pageClick` |
| EPA MyWaterway | `a` | click About EPA | `pageClick` |
| EPA MyWaterway | `a` | click ArcGIS API for JavaScript System Requireme | `pageClick` |
| EPA MyWaterway | `a` | click So Long Internet Explorer | `pageClick` |
| EPA MyWaterway | `a` | click EXIT | `pageClick` |
| EPA MyWaterway | `a` | click Accessibility Statement | `pageClick` |
| EPA MyWaterway | `a` | click Budget & Performance | `pageClick` |
| EPA MyWaterway | `a` | click Contracting | `pageClick` |
| EPA MyWaterway | `a` | click EPA www Web Snapshot | `pageClick` |
| EPA MyWaterway | `a` | click Grants | `pageClick` |
| EPA MyWaterway | `a` | click No FEAR Act Data | `pageClick` |
| EPA MyWaterway | `a` | click Plain Writing | `pageClick` |
| EPA MyWaterway | `a` | click Privacy and Security Notice | `pageClick` |
| EPA MyWaterway | `a` | click Data | `pageClick` |
| weather.gov | `a` | click National Oceanic and Atmospheric Administr | `pageClick` |
| weather.gov | `input:text` | search Search For for smith river | `pageFill` |
| weather.gov | `input:submit` | click NWS All NOAA | `pageClick` |
| weather.gov | `input:radio` | enable NWS | `pagePickRadio` |
| weather.gov | `input:checkbox` | enable Remember Me | `pageCheck` |
| weather.gov | `a` | click HOME | `pageClick` |
| weather.gov | `input:text` | search Local forecast by "City, St" or ZIP code  | `pageFill` |
| weather.gov | `input:submit` | click Location Help | `pageClick` |
| weather.gov | `input:radio` | enable All NOAA | `pagePickRadio` |
| weather.gov | `a` | click FORECAST | `pageClick` |
| weather.gov | `input:text` | search Enter Your City, ST or ZIP Code for smith | `pageFill` |
| weather.gov | `input:submit` | click Privacy Policy | `pageClick` |
| weather.gov | `a` | click Local | `pageClick` |
| weather.gov | `a` | click Graphical | `pageClick` |
| weather.gov | `a` | click Aviation | `pageClick` |
| weather.gov | `a` | click Marine | `pageClick` |
| weather.gov | `a` | click Rivers and Lakes | `pageClick` |
| weather.gov | `a` | click Hurricanes | `pageClick` |
| weather.gov | `a` | click Severe Weather | `pageClick` |
| weather.gov | `a` | click Fire Weather | `pageClick` |
| weather.gov | `a` | click Sunrise/Sunset | `pageClick` |
| weather.gov | `a` | click Long Range Forecasts | `pageClick` |
| weather.gov | `a` | click Climate Prediction | `pageClick` |
| weather.gov | `a` | click Space Weather | `pageClick` |
| weather.gov | `a` | click PAST WEATHER | `pageClick` |
