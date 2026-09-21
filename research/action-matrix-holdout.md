# Holdout: three sites never seen during development

Fetched and tested only after every fix was complete. Nothing in these pages
informed any rule, fixture or threshold - they are the generalisation check.

| site | resolved | actions | controls found | inventory |
|---|---|---|---|---|
| U.S. Fish & Wildlife Service | 34 | 34 | 77 | 299ms |
| NOAA NCEI | 34 | 34 | 69 | 204ms |
| Bureau of Reclamation | 34 | 34 | 727 | 900ms |
| **total** | **102** | **102** | | |

A further 51 free-form instructions were run across the same three pages -
searches, sequences, nonsense, a Spanish-language link, a pronoun reference -
checking for crashes, navigation, empty cards and stalls. None occurred.

## By control kind

| kind | resolved |
|---|---|
| `a` | 66/66 |
| `div` | 12/12 |
| `button:submit` | 10/10 |
| `button:button` | 5/5 |
| `input:text` | 4/4 |
| `tab:button` | 2/2 |
| `span` | 1/1 |
| `select:select-one` | 1/1 |
| `img` | 1/1 |

## Every action

| site | kind | instruction | tool |
|---|---|---|---|
| U.S. Fish & Wildlife Service | `a` | click Skip to main content | `pageClick` |
| U.S. Fish & Wildlife Service | `button:button` | click Here's how you know$/$ | `pageClick` |
| U.S. Fish & Wildlife Service | `span` | click U.S. Fish & Wildlife Service | `pageClick` |
| U.S. Fish & Wildlife Service | `tab:button` | click Places to Go | `pageClick` |
| U.S. Fish & Wildlife Service | `select:select-one` | set All statesAlabamaAlaskaAmerican SamoaArizo | `pageSelectOption` |
| U.S. Fish & Wildlife Service | `button:submit` | click Search | `pageClick` |
| U.S. Fish & Wildlife Service | `input:text` | search Search species for smith river | `pageFill` |
| U.S. Fish & Wildlife Service | `div` | click $~/$National Wildlife Refuges | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Home | `pageClick` |
| U.S. Fish & Wildlife Service | `button:button` | click Select your state | `pageClick` |
| U.S. Fish & Wildlife Service | `tab:button` | click Species | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click $~/$Fish Hatcheries | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Buy a Pass | `pageClick` |
| U.S. Fish & Wildlife Service | `button:button` | click Previous slide | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click $/$Wilderness Areas | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Apply for a Permit | `pageClick` |
| U.S. Fish & Wildlife Service | `button:button` | click Next slide | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click $~/$Rivers | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Buy a Duck Stamp | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Celebrating America's 250th Anniversary! | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Find a Refuge or Fish Hatchery | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Join the U.S. Fish and Wildlife Service  | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Find a Species | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Wildlife Refuge | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click National Wildlife Refuges | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Wichita Mountains Wildlife Refuge | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Fish Hatcheries | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Cache, OK | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Wilderness Areas | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Situated just outside the Lawton/Ft. Sil | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Rivers | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Pelican Island National Wildlife Refuge | `pageClick` |
| U.S. Fish & Wildlife Service | `a` | click Celebrating America's 250th Anniversary! | `pageClick` |
| U.S. Fish & Wildlife Service | `div` | click Vero Beach, FL | `pageClick` |
| NOAA NCEI | `a` | click Skip to main content | `pageClick` |
| NOAA NCEI | `button:submit` | click Here's how you know | `pageClick` |
| NOAA NCEI | `img` | click National Centers for Environmental Infor | `pageClick` |
| NOAA NCEI | `button:button` | click Toggle navigation | `pageClick` |
| NOAA NCEI | `input:text` | search Search for smith river | `pageFill` |
| NOAA NCEI | `a` | click pagetop | `pageClick` |
| NOAA NCEI | `button:submit` | click commit | `pageClick` |
| NOAA NCEI | `input:text` | search Enter Location for smith river | `pageFill` |
| NOAA NCEI | `a` | click Home | `pageClick` |
| NOAA NCEI | `button:submit` | click Search | `pageClick` |
| NOAA NCEI | `a` | click Products | `pageClick` |
| NOAA NCEI | `a` | click Search and filter content on the site | `pageClick` |
| NOAA NCEI | `a` | click Access | `pageClick` |
| NOAA NCEI | `a` | click Archive | `pageClick` |
| NOAA NCEI | `a` | click Data Certification | `pageClick` |
| NOAA NCEI | `a` | click Maps | `pageClick` |
| NOAA NCEI | `a` | click Monitoring | `pageClick` |
| NOAA NCEI | `a` | click Online Store | `pageClick` |
| NOAA NCEI | `a` | click Regional | `pageClick` |
| NOAA NCEI | `a` | click State of the Services | `pageClick` |
| NOAA NCEI | `a` | click World Data System | `pageClick` |
| NOAA NCEI | `a` | click Resources | `pageClick` |
| NOAA NCEI | `a` | click Alerts | `pageClick` |
| NOAA NCEI | `a` | click Change Notices | `pageClick` |
| NOAA NCEI | `a` | click Education | `pageClick` |
| NOAA NCEI | `a` | click Metadata | `pageClick` |
| NOAA NCEI | `a` | click Quick Links | `pageClick` |
| NOAA NCEI | `a` | click News | `pageClick` |
| NOAA NCEI | `a` | click BAMS | `pageClick` |
| NOAA NCEI | `a` | click Publications | `pageClick` |
| NOAA NCEI | `a` | click Contact | `pageClick` |
| NOAA NCEI | `a` | click About | `pageClick` |
| NOAA NCEI | `a` | click Locations | `pageClick` |
| NOAA NCEI | `a` | click Our Impact | `pageClick` |
| Bureau of Reclamation | `a` | click Skip to Primary Navigation | `pageClick` |
| Bureau of Reclamation | `input:text` | search Search for smith river | `pageFill` |
| Bureau of Reclamation | `button:submit` | click Search | `pageClick` |
| Bureau of Reclamation | `a` | click Skip to Main Content | `pageClick` |
| Bureau of Reclamation | `button:submit` | click Select a Region | `pageClick` |
| Bureau of Reclamation | `a` | click Skip to Footer | `pageClick` |
| Bureau of Reclamation | `button:submit` | click Select an Office | `pageClick` |
| Bureau of Reclamation | `a` | click Reclamation Home | `pageClick` |
| Bureau of Reclamation | `button:submit` | click Select a Dam | `pageClick` |
| Bureau of Reclamation | `a` | click Facebook | `pageClick` |
| Bureau of Reclamation | `button:submit` | click Select a Powerplant | `pageClick` |
| Bureau of Reclamation | `a` | click LinkedIn | `pageClick` |
| Bureau of Reclamation | `button:submit` | click Select a Project | `pageClick` |
| Bureau of Reclamation | `a` | click Twitter | `pageClick` |
| Bureau of Reclamation | `a` | click YouTube | `pageClick` |
| Bureau of Reclamation | `a` | click Flickr | `pageClick` |
| Bureau of Reclamation | `a` | click Instagram | `pageClick` |
| Bureau of Reclamation | `a` | click Water & Power | `pageClick` |
| Bureau of Reclamation | `a` | click Dams | `pageClick` |
| Bureau of Reclamation | `a` | click Powerplants | `pageClick` |
| Bureau of Reclamation | `a` | click Projects | `pageClick` |
| Bureau of Reclamation | `a` | click Agrimet/Hydromet | `pageClick` |
| Bureau of Reclamation | `a` | click Water Operations | `pageClick` |
| Bureau of Reclamation | `a` | click Resources & Research | `pageClick` |
| Bureau of Reclamation | `a` | click Programs | `pageClick` |
| Bureau of Reclamation | `a` | click Technical Service Center | `pageClick` |
| Bureau of Reclamation | `a` | click Research & Development | `pageClick` |
| Bureau of Reclamation | `a` | click Reclamation Manual | `pageClick` |
| Bureau of Reclamation | `a` | click Reclamation Information Sharing Environm | `pageClick` |
| Bureau of Reclamation | `a` | click Environmental Resources/Reports | `pageClick` |
| Bureau of Reclamation | `a` | click Library | `pageClick` |
| Bureau of Reclamation | `a` | click About Us | `pageClick` |
| Bureau of Reclamation | `a` | click Mission | `pageClick` |
| Bureau of Reclamation | `a` | click Fact Sheet | `pageClick` |
