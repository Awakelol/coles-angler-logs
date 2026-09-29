# Leyte waters: research notes

Notes behind the expansion from Leyte Gulf to all the waters around Leyte, and
the later species additions. Everything in `js/data/regions/leyte.js` should
trace back to something here.

Each fact is tagged:

- **[sourced]** citation given
- **[verify]** probably right, but no source good enough to rely on
- **[gap]** nothing found; needs local knowledge

---

## 1. How the waters divide

Leyte sits between two fishery management areas, and the water on each side
behaves differently.

| | Pacific side | Bohol Sea side |
|---|---|---|
| Waters | Leyte Gulf, San Pedro Bay, Carigara Bay, San Juanico Strait | Sogod Bay, Surigao Strait, Camotes Sea, Ormoc Bay, Canigao Channel |
| Management | FMA 8 (Eastern Visayas) [sourced] | FMA 9 (Sogod Bay confirmed) [sourced] |
| Character | Pacific swell, broad shallow shelf, mud and seagrass | Deeper, current-driven, reef and drop-off |

- **FMA 8** covers the western coast of Calicoan Island, north-western Suluan,
  Siargao, Lanuza Bay, the Panaon Island coast and the Samar coast: 51 coastal
  municipalities across Eastern Visayas and Caraga. Main targets: anchovies,
  rabbitfish, blue swimming crab, parrotfish. [sourced]
  [EDF](https://fisherysolutionscenter.edf.org/fisheries-management-area-planning-philippines) ·
  [FMA 8 site](https://fisheriesmanagementarea8ph.com/) ·
  [Oceana briefer](https://ph.oceana.org/wp-content/uploads/sites/16/oceana_-_fisheries_management_area_briefer.pdf)
- **FMA 9** includes Sogod Bay: 11 LGUs around the bay, including Macrohon and
  Maasin City. [sourced] [PNA](https://www.pna.gov.ph/articles/1215403)

[verify] Which FMA covers the Camotes Sea, Ormoc Bay and Canigao Channel. They
face Central Visayas and may be in a different FMA. BFAR's
[FMA shapefiles](https://www.foi.gov.ph/agencies/bfar/fisheries-management-areas-shapefiles/)
and [FMA maps](https://www.bfar.da.gov.ph/fisheries-management-area-maps/)
would settle it.

---

## 2. Per-water notes

### Leyte Gulf

BFAR/NFRDI demersal trawl survey, 24 Apr to 8 May 2020, 19 stations, bottom
otter trawl (71 m, 43 m head rope): [sourced]

| Measure | Value |
|---|---|
| Total catch | 4.22 t |
| Diversity | 230 species / 74 families |
| Leiognathidae (ponyfish) | 39.45% |
| Lutjanidae (snappers) | 8.05% |
| Gerreidae (mojarras) | 7.07% |
| *Photopectoralis bindus* | 25.49% (most abundant species) |
| *Gazza minuta* | 7.42% |
| *Pentaprion longimanus* | 5.80% |
| Mean CPUE | ~222.08 kg/hr |
| Biomass | 2.81 t/km² (+68.26% vs 2014) |

Source: *Demersal stock assessment in Leyte Gulf, Philippines*,
[The Palawan Scientist](https://palawanscientist.org/tps/article/view/112)

The original catalogue's three main ponyfish/mojarra species match the survey's
top three, in the same order. The paper also notes a shift toward "low-valued,
non-targeted, and small-sized species".

### Carigara Bay (north coast)

| | |
|---|---|
| Coordinates | 11°22′53″N 124°39′49″E [sourced] |
| Average depth | 54 m [sourced] |
| Maximum depth | 63 m [sourced] |
| Part of | Samar Sea [sourced] |
| Bordering LGUs | Babatngon, Barugo, Capoocan, Carigara, Leyte, San Miguel [sourced] |

- Rhizostome jellyfish are harvested commercially here, and juvenile *Alepes
  djedaba* (shrimp scad) and *Carangoides equula* (whitefin trevally) shelter
  among them. [sourced]
  [ResearchGate](https://www.researchgate.net/publication/260871487_Associations_of_fish_juveniles_with_rhizostome_jellyfishes_in_the_Philippines_with_taxonomic_remarks_on_a_commercially_harvested_species_in_Carigara_Bay_Leyte_Island)
- Mangroves: 22 species across 12 families along the bay. [sourced]
  [ResearchGate](https://www.researchgate.net/publication/371322495_Diversity_and_Assemblage_of_Mangroves_Along_the_Carigara_Bay_in_Leyte_Philippines)
- [verify] Named among five bays in Eastern Visayas affected by harmful algal
  blooms. Red tide closures affect shellfish rather than finfish, but they do
  close waters.
  [Frontiers in Marine Science](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2022.730518/full)
- Management background: [FAO, resource management strategies for Carigara Bay](https://openknowledge.fao.org/server/api/core/bitstreams/d7f5e418-0b2f-48a8-ac52-c3af8d82ff69/content)

### San Juanico Strait (between Leyte and Samar)

| | |
|---|---|
| Coordinates | 11°20′25″N 124°58′42″E [sourced] |
| Length | ~38 km [sourced] |
| Narrowest | 2 km [sourced] |
| Connects | Carigara Bay (Samar Sea) and San Pedro Bay (Leyte Gulf) [sourced] |
| Depth | [gap] |
| Currents | [gap] |

Tacloban's harbour is on Cancabato Bay at the southern entrance [sourced].
Crossed by the San Juanico Bridge and an HVDC line; heavy ferry traffic.

[verify] A 2 km gap between two tidal basins suggests strong reversing
currents, so it's treated as a current-driven fishery. That's an inference.

### Ormoc Bay (west coast)

| | |
|---|---|
| Coordinates | 10°57′N 124°36′E [sourced] |
| Part of | Extension of the Camotes Sea [sourced] |
| Bordering LGUs | Albuera, Merida, Ormoc [sourced] |
| Depth / dimensions | [gap] |
| Fisheries | [gap] |

The least documented water in the set.

### Camotes Sea (west and northwest)

| | |
|---|---|
| Coordinates | 10°30′N 124°20′E [sourced] |
| Bounded by | Cebu (W), Leyte (E and N), Bohol (S) [sourced] |
| Connects | Visayan Sea (N); Bohol Sea (S) via Cebu Strait and Canigao Channel [sourced] |
| Maximum depth | [gap] |

- Classified by BFAR as heavily exploited, alongside Lingayen Gulf, the
  Visayan Sea and Davao Gulf. [sourced]
  [Inquirer](https://newsinfo.inquirer.net/57797/no-more-big-fish-overfishing-blamed)
- Small pelagics declining: sardines, matambaka (ox-eye scad), galunggong.
  National Sardines Management Plan approved 15 May 2020. [sourced]
- Species mentioned: sulu skate, ocean sunfish, mackerel, great barracuda;
  surgeonfish and pufferfish on the reefs; whitetip shark. [sourced]
- Danajon Bank, the only double barrier reef in the Philippines, is on the
  Bohol side. [sourced]

### Canigao Channel (between Leyte and Bohol)

| | |
|---|---|
| Coordinates | 10°15′N 124°42′E [sourced] |
| Separates | Bohol and Leyte [sourced] |
| Connects | Camotes Sea and Bohol Sea [sourced] |
| Features | Adam, Abel, Cain and Eve Reefs; Tood Islets; Canigao Island [sourced] |
| Width / depth / currents | [gap] |

With four named reefs and an island, it's modelled as a reef zone.

### Sogod Bay (Southern Leyte)

| | |
|---|---|
| Coordinates | 10°10′N 125°03′E [sourced] |
| Maximum length | 45 km [sourced] |
| Maximum width | 10 km [sourced] |
| Extension of | Bohol Sea [sourced] |
| Depth (ISRA delineation) | 0–200 m [sourced] |
| Bordering LGUs | Bontoc, Libagon, Liloan, Limasawa, Malitbog, Padre Burgos, Pintuyan, San Francisco, Sogod, Tomas Oppus [sourced] |

- Main fishery: mangko, *Euthynnus affinis* (kawakawa), with a seasonal
  influx. A 1994 Silliman University study recorded seven pelagic species
  entering the bay. [sourced]
- Provincial catch: skipjack, striped mackerel, Spanish mackerel, round scads,
  anchovies, sardines, flying fish. [sourced]
- Seasonal upwelling drives plankton productivity November to April. [sourced]
- Whale shark (*Rhincodon typus*) feeding area. [sourced]
- Subangdaku River watershed degraded by quarrying and sand mining, causing
  siltation. [sourced]
- FishCORE project runs 2023–2029 across 11 LGUs. [sourced]

[verify] Depth. The only citable figure is the ISRA delineation of 0–200 m,
which describes the assessed area rather than the seabed. The bay is known for
drop-offs close to shore, but no depth figure is used in the data.

### Surigao Strait (between Leyte/Panaon and Mindanao/Dinagat)

| | |
|---|---|
| Coordinates | 10°10′N 125°23′E [sourced] |
| Maximum width | 25 km [sourced] |
| Depth | described as deep, no figure |
| Currents | up to 8 knots (15 km/h) [sourced] |
| Connects | Bohol Sea and Leyte Gulf [sourced] |
| Separates | Northern Mindanao / Panaon Island; Dinagat Islands / Leyte [sourced] |

8 knots is faster than many bancas can make headway against, so zones here
carry safety advice and use their own `strait` habitat type.

Panaon Island's coastline falls under FMA 8. [sourced]

---

## 3. Effect on the data model

- Two new habitat types: `strait` (San Juanico, Surigao) and `deep` (Sogod's
  drop-offs). The `channel` and `offshore` advice doesn't fit them.
- Zones weighted toward Sogod Bay and the Camotes/Ormoc side; two or three each
  for Carigara and San Juanico; one for Ormoc Bay until more is known.
- New species suggested by the sources: *Euthynnus affinis* (mangko), *Alepes
  djedaba*, *Carangoides equula*, flying fish, anchovies, Spanish mackerel,
  more parrotfish and rabbitfish. Blue swimming crab was already in as
  *Portunus pelagicus*.
- The Nov–April upwelling lines up with the existing amihan/habagat tip.

## 4. Open questions

1. Ormoc Bay: depth, fishing grounds, what's caught.
2. Sogod Bay depth near shore.
3. Canigao Channel currents.
4. Which FMA covers Camotes / Ormoc / Canigao.
5. BFAR Region VIII provincial fishery office data for
   [Leyte](https://region8.bfar.da.gov.ph/provincial-fishery-office-leyte/) and
   [Southern Leyte](https://region8.bfar.da.gov.ph/provincial-fishery-office-southern-leyte/).
6. San Pedro Bay pin (11.18 / 125.06). [verify] Moved from 11.10 / 125.02,
   which was just off Tanauan and overlapped the Tanauan zone. The new spot is
   mid-bay judging from the coastline, not from a source.
7. Pin placement in general. [verify] At high zoom the Cancabato Bay pin
   (11.238 / 125.004) sits over Tacloban itself rather than the bay. The other
   zones haven't been checked at that zoom yet.
8. Local names on the species added from FishBase. None have been checked
   against Leyte usage. A corrected local name should go first in the list.

---

## 5. FishBase ecosystem expansion (68 → 107 species)

[sourced] FishBase's `ecosystem` table maps species to named bodies of water,
and it has entries for all six waters around Leyte:

| E_CODE | Water |
| --- | --- |
| 288 | Leyte Gulf |
| 289 | Sogod Bay |
| 316 | Ormoc Bay |
| 337 | San Pedro Bay |
| 338 | Carigara Bay |
| 765 | Camotes Sea |

That's 572 species across the six. The cut: listed as highly commercial,
commercial, minor commercial or subsistence, and reaching at least 15 cm. That
gave 39 additions, 19 of them from families that weren't in the catalogue yet
(sweetlips, flathead, tripletail, moonfish, bigeye, sicklefish, tonguesole,
wolf-herring, lizardfish, croaker, halfbeak, conger, sea chub, triggerfish,
filefish, stingray, requiem shark, billfish, spiny turbot).

Query: `ecosystem.parquet` joined to `species.parquet` on `SpecCode`, filtered
on `E_CODE`, using the same duckdb + Parquet setup as `tools/fetch_fishbase.py`.

### Placing them in zones

A species goes into the zones for the waters it's recorded in, filtered by the
zone's bottom type (so no billfish in a mangrove creek). Two limits on top:

- At most 2–3 zones per species. Without it most of the 39 landed in the
  western gulf shelf, since the gulf has ten zones.
- A cap per zone, so small bays don't end up with huge lists. When a zone is
  full, species recorded in more of the six waters win. Every species still
  ends up somewhere.

### Not verified

- None of the 39 have BFAR Region VIII names; the local names are FishBase's
  national list.
- The notes are general biology, not local practice.
- A record means the species has been seen in that water, not that it's common.
- All 39 use placeholder art.

---

## 6. Southern Leyte provincial record (111 species)

[sourced] The Province of Southern Leyte's *Marine and Coastal Resources* page
lists what's caught in Sogod, Cabalian and Hinunangan bays:

> skip jack tuna, striped mackerel, Spanish mackerel, round scads, anchovies,
> sardines, and flying fish. Lobsters, shrimps, prawns, crabs, shellfish, and
> mussels are also caught in limited quantities.

All the fish on that list were already in the catalogue. The page has no
scientific names, so each addition was matched to a SeaLifeBase or FishBase
ecosystem record for the same water:

| Added | Basis |
| --- | --- |
| *Rhincodon typus*, whale shark | Province calls Sogod Bay "the haven of the world's biggest fish"; FishBase records it in Sogod Bay (E_CODE 289). |
| *Penaeus monodon*, giant tiger prawn | SeaLifeBase, commercial, these waters |
| *Metapenaeus ensis*, greasyback shrimp | SeaLifeBase, highly commercial, these waters |
| *Sepia pharaonis*, pharaoh cuttlefish | SeaLifeBase, commercial, these waters |

The whale shark is `target: false`, and its note says it's protected under
Philippine law, harmless, and that a hooked one means cutting the line.

### Not added

Lobsters and mussels, also on the provincial list, have no species-level record
for these waters in SeaLifeBase. Likely candidates are *Panulirus ornatus* /
*P. versicolor* and *Perna viridis*, but that needs confirming.
