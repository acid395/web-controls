# Action matrix — five federal sites

Derived from live HTML, no per-site code. Each control the extension finds is
turned back into the instruction a person would plausibly type, and scored on
whether that instruction resolves to the control it came from.

Static HTML only: no JavaScript runs, so client-rendered sites are a lower
bound. water.noaa.gov reports 169 controls live and 8 here.

| site | resolved | actions | rate |
|---|---|---|---|
| USGS NWIS | 18 | 22 | 81% |
| NWPS (NOAA) | 7 | 8 | 87% |
| Drought.gov | 20 | 22 | 90% |
| EPA MyWaterway | 20 | 22 | 90% |
| weather.gov | 21 | 22 | 95% |
| **total** | **86** | **96** | **89%** |

## By control kind

| kind | resolved |
|---|---|
| `a` | 46/48 |
| `button:button` | 16/16 |
| `button:submit` | 4/6 |
| `span` | 0/5 |
| `input:text` | 4/4 |
| `div` | 4/4 |
| `a:button` | 3/3 |
| `input:search` | 2/2 |
| `input:submit` | 2/2 |
| `select:select-one` | 1/2 |
| `input:radio` | 2/2 |
| `combobox` | 1/1 |
| `input:checkbox` | 1/1 |

## Remaining failures

| site | kind | instruction | why |
|---|---|---|---|
| USGS NWIS | `span` | click Here’s how you know | wrong control |
| USGS NWIS | `span` | click WDFN tools and data | wrong control |
| USGS NWIS | `span` | click Other water data resources | wrong control |
| USGS NWIS | `span` | click Connect | wrong control |
| NWPS (NOAA) | `a` | click Hyperlink to FIM PDF | ambiguous |
| Drought.gov | `select:select-one` | open Input location | no match |
| Drought.gov | `span` | click U.S. Drought Monitor map details and infor | ambiguous |
| EPA MyWaterway | `button:submit` | click Search | wrong control |
| EPA MyWaterway | `button:submit` | click x | no match |
| weather.gov | `a` | click Rivers and Lakes | ambiguous |

## Full matrix

| site | kind | instruction | tool | ok |
|---|---|---|---|---|
| USGS NWIS | `a` | click Skip to main content | `pageClick` | yes |
| USGS NWIS | `button:button` | click Here’s how you know | `pageClick` | yes |
| USGS NWIS | `span` | click Here’s how you know | `pageClick` | NO |
| USGS NWIS | `combobox` | click Select a state | `pageClick` | yes |
| USGS NWIS | `input:text` | search -searchbox for smith river | `pageFill` | yes |
| USGS NWIS | `a` | click WDFN Home | `pageClick` | yes |
| USGS NWIS | `button:button` | click Menu | `pageClick` | yes |
| USGS NWIS | `span` | click WDFN tools and data | `pageClick` | NO |
| USGS NWIS | `a` | click My Favorite Monitoring Locations | `pageClick` | yes |
| USGS NWIS | `button:button` | click WDFN tools and data | `pageClick` | yes |
| USGS NWIS | `span` | click Other water data resources | `pageClick` | NO |
| USGS NWIS | `a` | click National Water Dashboard | `pageClick` | yes |
| USGS NWIS | `button:button` | click Other water data resources | `pageClick` | yes |
| USGS NWIS | `span` | click Connect | `pageClick` | NO |
| USGS NWIS | `a` | click WaterAlert | `pageClick` | yes |
| USGS NWIS | `button:button` | click Connect | `pageClick` | yes |
| USGS NWIS | `a` | click Explore USGS Water Data | `pageClick` | yes |
| USGS NWIS | `button:button` | click Dismiss site alert | `pageClick` | yes |
| USGS NWIS | `a` | click USGS Water Data APIs | `pageClick` | yes |
| USGS NWIS | `a` | click Statistics documentation | `pageClick` | yes |
| USGS NWIS | `a` | click Water Resources Mission Area | `pageClick` | yes |
| USGS NWIS | `a` | click Water Data Visualizations | `pageClick` | yes |
| NWPS (NOAA) | `a` | click Hyperlink to FIM PDF | `no match` | NO |
| NWPS (NOAA) | `a:button` | click View full page | `pageClick` | yes |
| NWPS (NOAA) | `button:button` | click Close | `pageClick` | yes |
| NWPS (NOAA) | `a` | click Hyperlink to FIM page on NWPS | `pageClick` | yes |
| NWPS (NOAA) | `a:button` | click Continue | `pageClick` | yes |
| NWPS (NOAA) | `button:button` | click Cancel | `pageClick` | yes |
| NWPS (NOAA) | `a` | click Hyperlink to a PDF that details FIM usage | `pageClick` | yes |
| NWPS (NOAA) | `a:button` | click New window | `pageClick` | yes |
| Drought.gov | `a` | click Skip to main content | `pageClick` | yes |
| Drought.gov | `button:submit` | click Here's how you know | `pageClick` | yes |
| Drought.gov | `input:search` | search Query for smith river | `pageFill` | yes |
| Drought.gov | `input:submit` | click Search | `pageClick` | yes |
| Drought.gov | `select:select-one` | open Input location | `no match` | NO |
| Drought.gov | `button:button` | click tag: Drought Index | `pageClick` | yes |
| Drought.gov | `span` | click U.S. Drought Monitor map details and infor | `no match` | NO |
| Drought.gov | `div` | click Sep 22 2026 September Southeast Climate Mo | `pageClick` | yes |
| Drought.gov | `a` | click Home | `pageClick` | yes |
| Drought.gov | `button:submit` | click Open Search Bar | `pageClick` | yes |
| Drought.gov | `select:select-one` | set Select a State to Alabama | `pageSelectOption` | yes |
| Drought.gov | `button:button` | click tag: Water Supply | `pageClick` | yes |
| Drought.gov | `div` | click Sep 28 2026 NOAA Drought Seminar Series: D | `pageClick` | yes |
| Drought.gov | `a` | click Drought.gov Facebook account | `pageClick` | yes |
| Drought.gov | `button:submit` | click Menu | `pageClick` | yes |
| Drought.gov | `button:button` | click tag: Agriculture | `pageClick` | yes |
| Drought.gov | `div` | click Sep 29 2026 Arkansas-Louisiana-Mississippi | `pageClick` | yes |
| Drought.gov | `a` | click Drought.gov Instagram account | `pageClick` | yes |
| Drought.gov | `button:submit` | click Close | `pageClick` | yes |
| Drought.gov | `button:button` | click tag: Precipitation | `pageClick` | yes |
| Drought.gov | `div` | click August 25, 2026 Drought Status Update for  | `pageClick` | yes |
| Drought.gov | `a` | click Drought.gov LinkedIn account | `pageClick` | yes |
| EPA MyWaterway | `a` | click Skip to main content | `pageClick` | yes |
| EPA MyWaterway | `button:button` | click Here’s how you know | `pageClick` | yes |
| EPA MyWaterway | `input:search` | search Search for smith river | `pageFill` | yes |
| EPA MyWaterway | `button:submit` | click Search | `pageClick` | NO |
| EPA MyWaterway | `a` | click Home | `pageClick` | yes |
| EPA MyWaterway | `button:button` | click Open search drawer | `pageClick` | yes |
| EPA MyWaterway | `button:submit` | click x | `no match` | NO |
| EPA MyWaterway | `a` | click Environmental Topics | `pageClick` | yes |
| EPA MyWaterway | `button:button` | click Menu | `pageClick` | yes |
| EPA MyWaterway | `a` | click Laws & Regulations | `pageClick` | yes |
| EPA MyWaterway | `button:button` | click Close | `pageClick` | yes |
| EPA MyWaterway | `a` | click Report a Violation | `pageClick` | yes |
| EPA MyWaterway | `a` | click About EPA | `pageClick` | yes |
| EPA MyWaterway | `a` | click ArcGIS API for JavaScript System Requireme | `pageClick` | yes |
| EPA MyWaterway | `a` | click So Long Internet Explorer | `pageClick` | yes |
| EPA MyWaterway | `a` | click EXIT | `pageClick` | yes |
| EPA MyWaterway | `a` | click Accessibility Statement | `pageClick` | yes |
| EPA MyWaterway | `a` | click Budget & Performance | `pageClick` | yes |
| EPA MyWaterway | `a` | click Contracting | `pageClick` | yes |
| EPA MyWaterway | `a` | click EPA www Web Snapshot | `pageClick` | yes |
| EPA MyWaterway | `a` | click Grants | `pageClick` | yes |
| EPA MyWaterway | `a` | click No FEAR Act Data | `pageClick` | yes |
| weather.gov | `a` | click National Oceanic and Atmospheric Administr | `pageClick` | yes |
| weather.gov | `input:text` | search Search For for smith river | `pageFill` | yes |
| weather.gov | `input:radio` | enable NWS | `pagePickRadio` | yes |
| weather.gov | `input:submit` | click btnSearch | `pageClick` | yes |
| weather.gov | `input:checkbox` | enable Remember Me | `pageCheck` | yes |
| weather.gov | `a` | click HOME | `pageClick` | yes |
| weather.gov | `input:text` | search Local forecast by "City, St" or ZIP code  | `pageFill` | yes |
| weather.gov | `input:radio` | enable All NOAA | `pagePickRadio` | yes |
| weather.gov | `a` | click FORECAST | `pageClick` | yes |
| weather.gov | `input:text` | search Enter Your City, ST or ZIP Code for smith | `pageFill` | yes |
| weather.gov | `a` | click Local | `pageClick` | yes |
| weather.gov | `a` | click Graphical | `pageClick` | yes |
| weather.gov | `a` | click Aviation | `pageClick` | yes |
| weather.gov | `a` | click Marine | `pageClick` | yes |
| weather.gov | `a` | click Rivers and Lakes | `no match` | NO |
| weather.gov | `a` | click Hurricanes | `pageClick` | yes |
| weather.gov | `a` | click Severe Weather | `pageClick` | yes |
| weather.gov | `a` | click Fire Weather | `pageClick` | yes |
| weather.gov | `a` | click Sunrise/Sunset | `pageClick` | yes |
| weather.gov | `a` | click Long Range Forecasts | `pageClick` | yes |
| weather.gov | `a` | click Climate Prediction | `pageClick` | yes |
| weather.gov | `a` | click Space Weather | `pageClick` | yes |
