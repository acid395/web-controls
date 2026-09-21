# Action matrix - twelve further federal and state sites

Second batch, run after the five-site matrix. Same method: every control the
extension derives is turned back into the instruction a person would type, and
scored on whether it resolves to that control. A wrapper inside a link counts
as the link - resolving "click Facebook" to the anchor rather than the span
inside it is the right answer.

Static HTML, no JavaScript: client-rendered sites are a lower bound.

| site | resolved | actions |
|---|---|---|
| CDEC (CA Water) | 10 | 14 |
| census.gov | 11 | 14 |
| climate.gov | 13 | 14 |
| data.gov | 12 | 14 |
| energy.gov | 12 | 14 |
| AirNow (EPA) | 12 | 14 |
| nasa.gov | 7 | 14 |
| noaa.gov | 14 | 14 |
| nps.gov | 10 | 14 |
| Texas Water | 13 | 14 |
| USGS Earthquakes | 2 | 2 |
| Wisconsin DNR | 14 | 14 |
| **total** | **130** | **156** |

## Remaining failures

| site | kind | instruction | why |
|---|---|---|---|
| CDEC (CA Water) | `div` | click DWR Home page. | ambiguous |
| CDEC (CA Water) | `a` | click CA-Gov | ambiguous |
| CDEC (CA Water) | `button:button` | click Set Location | ambiguous |
| CDEC (CA Water) | `div` | click DFM Home page. | ambiguous |
| census.gov | `div` | click Explore Census.gov for... | ambiguous |
| census.gov | `h2` | click Income, Poverty and Health Insurance Cov | ambiguous |
| census.gov | `button:button` | click Search | wrong control |
| climate.gov | `input:submit` | click edit-submit | wrong control |
| data.gov | `button:submit` | click Close button | no match |
| data.gov | `button:submit` | click Search | wrong control |
| energy.gov | `div` | click Secretary of Energy | ambiguous |
| energy.gov | `div` | click Deputy Secretary of Energy | ambiguous |
| AirNow (EPA) | `h2` | click Fires | wrong control |
| AirNow (EPA) | `button:submit` | click Search | wrong control |
| nasa.gov | `a` | click News & Events | wrong control |
| nasa.gov | `div` | click 2 min read | wrong control |
| nasa.gov | `span` | click article | wrong control |
| nasa.gov | `p` | click NASA Awards SpaceX Three Crew Flights to | ambiguous |
| nasa.gov | `textarea:textarea` | search Δ for smith river | wrong control |
| nasa.gov | `button:submit` | click Search | wrong control |
| nasa.gov | `div` | click NASA Awards SpaceX Three Crew Flights to | ambiguous |
| nps.gov | `span` | click Stories of Places & People | ambiguous |
| nps.gov | `button:button` | click Search | wrong control |
| nps.gov | `input:text` | search Search for smith river | wrong control |
| nps.gov | `span` | click Protecting the Natural World | ambiguous |
| Texas Water | `button:button` | click Toggle navigation | ambiguous |
