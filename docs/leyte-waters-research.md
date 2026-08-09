# Leyte waters — research notes

Working document for expanding the app from Leyte Gulf to all waters around
Leyte island. **Everything here is sourced or flagged.** Nothing goes into
`js/data/regions/leyte.js` from memory.

Three confidence levels are used throughout:

- **✅ Sourced** — a citation is given. Take it as read unless you know better.
- **⚠️ Verify** — plausible and probably right, but I could not find a source
  I'd stake the data on. These are the lines to check first.
- **❌ Gap** — I could not find it at all. Needs local knowledge or a document
  I don't have access to.

> **Two sites blocked automated access (HTTP 403):**
> `southernleyte.gov.ph/marine-resources` and `sharkrayareas.org`. Both are
> readable in a browser and both are directly relevant — the provincial page
> in particular carries an official Southern Leyte species list. Worth a look
> when you fact-check.

---

## 1. The waters, and how they divide

Leyte is not surrounded by one sea. It sits on a **boundary between two
fishery management regimes**, and that division is real rather than
administrative tidiness — the water either side behaves differently.

| | Pacific side | Bohol Sea side |
|---|---|---|
| **Waters** | Leyte Gulf, San Pedro Bay, Carigara Bay, San Juanico Strait | Sogod Bay, Surigao Strait, Camotes Sea, Ormoc Bay, Canigao Channel |
| **Management** | **FMA 8** (Eastern Visayas) ✅ | **FMA 9** (Sogod Bay confirmed) ✅ |
| **Character** | Pacific swell, broad shallow shelf, mud and seagrass | Deeper, current-driven, reef and drop-off |

- **FMA 8** covers the western coastline of Calicoan Island, north-western
  Suluan, Siargao, Lanuza Bay, Panaon Island coastline and the Samar Island
  coastline — 51 coastal municipalities across Eastern Visayas and Caraga.
  Highly valued targets: **anchovies, rabbitfishes, blue swimming crabs,
  parrotfishes**. ✅
  [EDF](https://fisherysolutionscenter.edf.org/fisheries-management-area-planning-philippines) ·
  [FMA 8 site](https://fisheriesmanagementarea8ph.com/) ·
  [Oceana briefer](https://ph.oceana.org/wp-content/uploads/sites/16/oceana_-_fisheries_management_area_briefer.pdf)
- **FMA 9** includes Sogod Bay — 11 LGUs around the bay, incl. Macrohon and
  Maasin City. ✅
  [PNA](https://www.pna.gov.ph/articles/1215403)

⚠️ **Verify:** which FMA covers Camotes Sea, Ormoc Bay and Canigao Channel.
Those are Central-Visayas-facing and may fall under a different FMA again.
BFAR publishes [FMA shapefiles](https://www.foi.gov.ph/agencies/bfar/fisheries-management-areas-shapefiles/)
and [FMA maps](https://www.bfar.da.gov.ph/fisheries-management-area-maps/) —
that would settle it exactly.

---

## 2. Per-water facts

### Leyte Gulf — already in the app

The existing seed data **checks out against a primary source**, which is worth
recording because it raises confidence in everything already shipped.

BFAR/NFRDI demersal trawl survey, 24 Apr – 8 May 2020, 19 stations, bottom
otter trawl (71 m, 43 m head rope): ✅

| Measure | Value |
|---|---|
| Total catch | 4.22 t |
| Diversity | 230 species / 74 families |
| Leiognathidae (ponyfish) | **39.45%** |
| Lutjanidae (snappers) | **8.05%** |
| Gerreidae (mojarras) | **7.07%** |
| *Photopectoralis bindus* | **25.49%** — single most abundant |
| *Gazza minuta* | 7.42% |
| *Pentaprion longimanus* | 5.80% |
| Mean CPUE | ~222.08 kg/hr |
| Biomass | 2.81 t/km² (+68.26% vs 2014) |

Source: *Demersal stock assessment in Leyte Gulf, Philippines*,
[The Palawan Scientist](https://palawanscientist.org/tps/article/view/112)

The app's three flagship ponyfish/mojarra are the survey's top three species,
in the same order. The paper also notes a shift toward **"low-valued,
non-targeted, and small-sized species"** — which is a genuinely useful thing
for the app to say out loud somewhere.

### Carigara Bay — north coast

| | |
|---|---|
| Coordinates | 11°22′53″N 124°39′49″E ✅ |
| Average depth | **54 m** ✅ |
| Maximum depth | **63 m** ✅ |
| Part of | Samar Sea ✅ |
| Bordering LGUs | Babatngon, Barugo, Capoocan, Carigara, Leyte, San Miguel ✅ |

- **Commercial jellyfish harvest.** Rhizostome jellyfish are harvested
  commercially here, and juvenile *Alepes djedaba* (shrimp scad) and
  *Carangoides equula* (whitefin trevally) shelter among them. ✅
  [ResearchGate](https://www.researchgate.net/publication/260871487_Associations_of_fish_juveniles_with_rhizostome_jellyfishes_in_the_Philippines_with_taxonomic_remarks_on_a_commercially_harvested_species_in_Carigara_Bay_Leyte_Island)
  — *this is a good app detail: where there are jellyfish, there are juvenile scad.*
- **Mangroves:** 22 species across 12 families along the bay. ✅
  [ResearchGate](https://www.researchgate.net/publication/371322495_Diversity_and_Assemblage_of_Mangroves_Along_the_Carigara_Bay_in_Leyte_Philippines)
- **⚠️ Harmful algal blooms.** Carigara Bay is named among five HAB-affected
  bays in Eastern Visayas. Worth a safety note if confirmed — red tide closures
  affect shellfish, not finfish, but they do close waters.
  [Frontiers in Marine Science](https://www.frontiersin.org/journals/marine-science/articles/10.3389/fmars.2022.730518/full)
- Deeper management context: [FAO — Resource management strategies for Carigara Bay](https://openknowledge.fao.org/server/api/core/bitstreams/d7f5e418-0b2f-48a8-ac52-c3af8d82ff69/content)

### San Juanico Strait — between Leyte and Samar

| | |
|---|---|
| Coordinates | 11°20′25″N 124°58′42″E ✅ |
| Length | ~38 km ✅ |
| Narrowest | **2 km** ✅ |
| Connects | Carigara Bay (Samar Sea) ↔ San Pedro Bay (Leyte Gulf) ✅ |
| Depth | ❌ Gap |
| Currents | ❌ Gap — but a 2 km constriction between two basins implies strong reversing tidal flow |

Tacloban's harbour sits on Cancabato Bay at the **southern entrance** ✅ — so
this connects directly to the zone the app already has. Crossed by the San
Juanico Bridge and an HVDC power line; heavy ferry traffic.

⚠️ The structure alone (2 km gap, two basins, tidal) argues for treating this
as a current-driven fishery. That's an inference, not a source.

### Ormoc Bay — west coast

| | |
|---|---|
| Coordinates | 10°57′N 124°36′E ✅ |
| Part of | Extension of the Camotes Sea ✅ |
| Bordering LGUs | Albuera, Merida, Ormoc ✅ |
| Depth / dimensions | ❌ Gap |
| Fisheries | ❌ Gap — Wikipedia covers Ormoc's rice/copra/sugar exports and says nothing about fishing |

**This is the thinnest water in the whole set.** If you know Ormoc Bay, your
knowledge beats anything I found.

### Camotes Sea — west and northwest

| | |
|---|---|
| Coordinates | 10°30′N 124°20′E ✅ |
| Bounded by | Cebu (W), Leyte (E and N), Bohol (S) ✅ |
| Connects | Visayan Sea (N); Bohol Sea (S) via Cebu Strait and Canigao Channel ✅ |
| Maximum depth | ❌ Gap |

- **BFAR classifies it as heavily exploited** in the national stock assessment
  programme, alongside Lingayen Gulf, the Visayan Sea and Davao Gulf. ✅
  [Inquirer](https://newsinfo.inquirer.net/57797/no-more-big-fish-overfishing-blamed)
- Small pelagics declining — **sardines, matambaka (ox-eye scad),
  galunggong**. National Sardines Management Plan approved 15 May 2020. ✅
- Species named: **sulu skate, ocean sunfish, mackerel, great barracuda**;
  reef fish of Acanthuridae and Tetraodontidae; white-tip shark. ✅
- **Danajon Bank** lies in these waters — the only double barrier reef in the
  Philippines. ✅ (Bohol side, but it shapes the sea's productivity.)

### Canigao Channel — southwest, between Leyte and Bohol

| | |
|---|---|
| Coordinates | 10°15′N 124°42′E ✅ |
| Separates | Bohol and Leyte ✅ |
| Connects | Camotes Sea ↔ Bohol Sea ✅ |
| Features | Adam, Abel, Cain and Eve Reefs; Tood Islets; **Canigao Island** ✅ |
| Width / depth / currents | ❌ Gap |

Four named reefs plus an island in one channel is a strong argument for a reef
zone here rather than an open-water one.

### Sogod Bay — south, Southern Leyte

| | |
|---|---|
| Coordinates | 10°10′N 125°03′E ✅ |
| Maximum length | 45 km ✅ |
| Maximum width | 10 km ✅ |
| Extension of | **Bohol Sea** ✅ |
| Depth (ISRA delineation) | **0–200 m** ✅ |
| Bordering LGUs | Bontoc, Libagon, Liloan, Limasawa, Malitbog, Padre Burgos, Pintuyan, San Francisco, Sogod, Tomas Oppus ✅ |

- **Major fishery resource: mangko, *Euthynnus affinis*** (kawakawa / eastern
  little tuna), with a seasonal influx. ✅ A 1994 Silliman University study
  documented seven pelagic finfish species entering the bay.
- Species caught in the province: **skipjack tuna, striped mackerel, Spanish
  mackerel, round scads, anchovies, sardines, flying fish**. ✅
- **Seasonal upwelling drives plankton productivity November–April.** ✅ That
  is directly actionable for an angler and pairs with the app's existing
  amihan/habagat tip.
- **Whale sharks (*Rhincodon typus*)** — feeding area, threatened. ✅
  Not a catch; if it appears in the app at all it should be as a "do not
  target" note.
- Environmental: Subangdaku River watershed degraded by quarrying and sand
  mining → rapid siltation. ✅
- FishCORE project runs 2023–2029 across 11 LGUs. ✅

> **I owe you a correction.** Earlier I said Sogod Bay "drops past 500 m" and
> the plan agent said past 1,500 m. **Neither is sourced.** The only depth
> figure I can cite is the ISRA delineation of **0–200 m**, and that describes
> the *assessed area*, not the seabed. Sogod Bay is an arm of the Bohol Sea,
> which is genuinely deep, and the bay is known for shore drop-offs — but I am
> not going to put a number in the data I can't defend. ⚠️ **Verify.**

### Surigao Strait — south, between Leyte/Panaon and Mindanao/Dinagat

| | |
|---|---|
| Coordinates | 10°10′N 125°23′E ✅ |
| Maximum width | 25 km ✅ |
| Depth | "deep" — no figure given ✅/❌ |
| **Currents** | **up to 8 knots (15 km/h)** ✅ |
| Connects | Bohol Sea ↔ Leyte Gulf ✅ |
| Separates | Northern Mindanao / Panaon Island; Dinagat Islands / Leyte ✅ |

**8 knots is the single most important number in this document.** That is
faster than most bancas can make way against. Any zone here needs a genuine
safety framing, and it justifies a distinct `strait` habitat type rather than
reusing `channel`.

Panaon Island's coastline falls under FMA 8. ✅

---

## 3. What this implies for the data model

- **Two new habitat types are justified by sources, not taste:**
  `strait` (San Juanico's 2 km constriction; Surigao's 8 kn) and `deep`
  (Sogod's drop-off into the Bohol Sea). Both need advice that the existing
  `channel` and `offshore` entries get wrong.
- **Zone count:** roughly 12–15 across seven new waters, weighted toward
  Sogod Bay and the Camotes/Ormoc side. Carigara and San Juanico support 2–3
  each; Ormoc Bay is currently too thin to justify more than one until you
  fill the gap.
- **New species suggested by the sources**, all needing catalogue entries:
  *Euthynnus affinis* (mangko), *Alepes djedaba* (shrimp scad),
  *Carangoides equula* (whitefin trevally), flying fish, anchovies
  (Engraulidae), Spanish mackerel (*Scomberomorus* spp.), parrotfish and
  rabbitfish beyond what's already listed, blue swimming crab (already
  present as *Portunus pelagicus*).
- **The upwelling window (Nov–April) and the amihan/habagat tip already in the
  app are the same seasonal story from two directions.** Worth cross-linking
  rather than duplicating.

## 4. Where I most need you

1. **Ormoc Bay** — almost nothing found. Depth, grounds, what's actually caught.
2. **Sogod Bay depth** — is the shore drop-off real, and how deep?
3. **Canigao Channel currents** — reef fishing there is current-dependent.
4. **Which FMA** covers Camotes/Ormoc/Canigao.
5. **The Southern Leyte provincial species list** at
   `southernleyte.gov.ph/marine-resources` — blocked to me, open to you.
6. Anything from the **BFAR Region VIII provincial fishery offices** for
   [Leyte](https://region8.bfar.da.gov.ph/provincial-fishery-office-leyte/) and
   [Southern Leyte](https://region8.bfar.da.gov.ph/provincial-fishery-office-southern-leyte/).
7. **San Pedro Bay's pin, now at 11.18 / 125.06.** ⚠️ **Verify.** It was at
   11.10 / 125.02, which is 1.1 km off Tanauan — a pin for the whole bay
   sitting on one town's shallows, and close enough to the Tanauan zone that
   the two overlapped on the map. I moved it to what looks like mid-basin from
   the surrounding coastline. That is **inference, not a source**: worth
   confirming it is open water and is what people mean by San Pedro Bay.
8. **Zone pin placement, now that the map zooms to 19.** ⚠️ **Verify.** The
   old ceiling of 15 was too coarse to see whether a pin sat on water. At 17
   the Cancabato Bay pin (11.238 / 125.004) is clearly over Tacloban's
   rooftops rather than the bay itself — it is the town's coordinate, not the
   water's. San Pedro Bay has already been moved for a related reason. The
   other nineteen have not been checked at all; the zoom now makes it possible.
9. **The local names on the 28 new species.** Every one is FishBase's, none
   checked against Leyte usage — the least trustworthy data in the app. A
   correction means putting the local name **first**, not appending it.

---

## 5. The FishBase ecosystem expansion (68 → 107 species)

**✅ Sourced.** FishBase keeps an `ecosystem` table mapping species to *named
bodies of water*, and it happens to carry a row for every water this app cares
about:

| E_CODE | water |
| --- | --- |
| 288 | Leyte Gulf |
| 289 | Sogod Bay |
| 316 | Ormoc Bay |
| 337 | San Pedro Bay |
| 338 | Carigara Bay |
| 765 | Camotes Sea |

572 distinct species are listed across the six. That is a checklist, not a
guide, so it was cut down: **recorded as highly commercial, commercial, minor
commercial or subsistence-fished, and reaching at least 15 cm** — a fish
someone means to catch rather than one that turns up in a net. 39 were added,
19 of them from families the catalogue had never carried at all (sweetlips,
flathead, tripletail, moonfish, bigeye, sicklefish, tonguesole, wolf-herring,
lizardfish, croaker, halfbeak, conger, sea chub, triggerfish, filefish,
stingray, requiem shark, billfish, spiny turbot).

Query it with the same `duckdb` + Parquet route `tools/fetch_fishbase.py` uses:
`ecosystem.parquet` joined to `species.parquet` on `SpecCode`, filtered on
`E_CODE`.

### How they were placed in zones

Not by guesswork. FishBase says which of the six waters a species is recorded
in; that maps onto the app's zones, and the zone's **bottom type** then filters
it, so an oceanic billfish never lands in a mangrove creek and a mud-bottom
tonguesole never lands on a reef edge.

Two limits were needed on top of that, both learned by getting it wrong:

- **At most 2–3 zones per species.** The first pass put 34 of the 39 into the
  western gulf shelf, because most are recorded in "Leyte Gulf" and the gulf
  covers ten zones.
- **A ceiling per zone.** Carigara and Sogod have three zones each, so
  everything recorded in those waters piled into the same short lists — 28
  species in a bay that held 10. A zone list is *what is worth trying here*,
  not everything the water contains.
- The cap is scored by **how many of the six waters record the fish**, so a
  five-water species wins a contested slot. Without that the cap threw out the
  most widespread species first, which is exactly backwards. Nothing is left
  unplaced.

### ⚠️ What is NOT verified

- **No BFAR Region VIII names exist for any of these 39.** Every local name on
  them is FishBase's national COMNAMES list. It does not know that a fish is
  called something particular around Tacloban. Correcting one means putting the
  local name **first** — see the ordering rule at the head of the catalogue.
- **The notes are general biology**, not local practice. "Takes a trolled lure"
  is true of the species; it is not a report of how it is fished off Tolosa.
- **Presence is not abundance.** An ecosystem record says a species has been
  recorded in that water, not that you will meet it, nor when.
- **All 39 carry `art: 'placeholder'`** — a borrowed silhouette from the
  nearest of the existing archetypes. Nineteen of these families have no drawn
  art at all.
