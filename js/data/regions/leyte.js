// ---------------------------------------------------------------------------
// REGION: Leyte, Philippines
//
// Species emphasis follows BFAR Region VIII (Eastern Visayas) survey findings:
// Leiognathidae (ponyfish), Lutjanidae (snappers) and Gerreidae (mojarras)
// dominate landings, alongside the small pelagics that drive municipal catch.
//
// This file describes a PLACE. The fish themselves live in the shared
// catalogue at js/data/species/indo-pacific.js and are referenced here by id,
// so a species can be a possible catch in any number of regions and zones
// without being duplicated.
//
// TO ADD A SPECIES TO THIS REGION: make sure it exists in the catalogue, then
// add its id to `species` below and to whichever zones it turns up in.
// ---------------------------------------------------------------------------

export default {
  id: 'leyte',
  name: 'Leyte',
  country: 'Philippines',
  blurb: 'The waters around Leyte island — Pacific-facing gulf on one side, the deeper Bohol Sea on the other, and everything from mangrove creeks to 8-knot straits in between.',
  timezone: 'Asia/Manila',

  // Home for the weather + tide dashboard: where they point when the device
  // won't give a location, or gives one from outside the country.
  //
  // Tacloban, not the middle of the gulf. This used to be 11.0/125.2, an
  // offshore point with no station, no name and nobody standing on it — and
  // it is also the tide cache key, so predictions were being fetched for open
  // water rather than for the port everyone actually launches from.
  coords: { lat: 11.238, lon: 125.004 },

  // Named fishing spots. Add freely — the catch log builds its dropdown here.
  spots: [
    { id: 'tacloban-bay', name: 'Cancabato Bay (Tacloban)', coords: { lat: 11.238, lon: 125.004 }, type: 'bay' },
    { id: 'san-pedro-bay', name: 'San Pedro Bay', coords: { lat: 11.10, lon: 125.02 }, type: 'bay' },
    { id: 'basey-flats', name: 'Basey tidal flats', coords: { lat: 11.28, lon: 125.07 }, type: 'flats' },
    { id: 'guiuan-reefs', name: 'Guiuan fringing reefs', coords: { lat: 11.03, lon: 125.72 }, type: 'reef' },
    { id: 'homonhon', name: 'Homonhon Island channel', coords: { lat: 10.75, lon: 125.70 }, type: 'channel' },
    { id: 'tanauan-coast', name: 'Tanauan coastal shallows', coords: { lat: 11.11, lon: 125.02 }, type: 'shallows' },
    { id: 'offshore-pacific', name: 'Offshore / Pacific edge', coords: { lat: 10.80, lon: 125.95 }, type: 'offshore' },
    { id: 'carigara-bay', name: 'Carigara Bay', coords: { lat: 11.381, lon: 124.664 }, type: 'bay' },
    { id: 'san-juanico', name: 'San Juanico narrows', coords: { lat: 11.340, lon: 124.978 }, type: 'strait' },
    { id: 'ormoc-bay', name: 'Ormoc Bay', coords: { lat: 10.950, lon: 124.600 }, type: 'bay' },
    { id: 'camotes-grounds', name: 'Camotes Sea grounds', coords: { lat: 10.72, lon: 124.42 }, type: 'offshore' },
    { id: 'canigao-reefs', name: 'Canigao Channel reefs', coords: { lat: 10.250, lon: 124.700 }, type: 'reef' },
    { id: 'sogod-bay', name: 'Sogod Bay', coords: { lat: 10.30, lon: 125.02 }, type: 'bay' },
    { id: 'padre-burgos', name: 'Padre Burgos reef edge', coords: { lat: 10.05, lon: 125.02 }, type: 'reef' },
    { id: 'surigao-strait', name: 'Surigao Strait', coords: { lat: 10.167, lon: 125.383 }, type: 'strait' },
  ],

  // Map view: where the map opens, and how far it can be zoomed out.
  // `bounds` frames the whole of Leyte plus the gulf and southern Samar — it's
  // the fallback view when the device won't share a location.
  map: {
    center: { lat: 10.85, lon: 125.00 },
    zoom: 9,
    minZoom: 7,
    // 19 is as far as both tile sources go. It was 15, which is about "this
    // bay" — not close enough to pick out the actual reef edge or wharf you
    // meant, which is the whole point of putting a spot on a map.
    maxZoom: 19,
    bounds: { south: 9.85, west: 124.15, north: 11.6, east: 126.0 },

    // How far you may pan away from the region — the Philippines, here.
    // Deliberately much wider than `bounds`: this is not "where the fish
    // are", it is "where this app is about". You can still drag up to Luzon
    // to see where a storm is coming from; you cannot drag out to the
    // Pacific and lose the country entirely.
    //
    // It is also what counts as being in the area. A fix outside this box
    // sends the weather back to `coords` above rather than reporting the
    // conditions wherever the phone happens to be.
    //
    // Corners are the archipelago's extremes: Y'Ami in the Batanes to the
    // north, the Tawi-Tawi group to the south, Balabac west, Pusan Point
    // east — each rounded outward. The far-western Kalayaan claim is left
    // out on purpose; including it would stretch the box across several
    // hundred km of open sea nobody is fishing from Leyte.
    panBounds: { south: 4.2, west: 116.0, north: 21.4, east: 126.8 },
  },

  // ---------------------------------------------------------------------
  // FISHING ZONES — the pins on the map.
  //
  //   type      key from HABITAT_TACTICS in js/data/tactics.js; drives the
  //             habitat advice shown when a pin is opened
  //   minZoom   pin appears at this zoom and closer. Broad offshore grounds
  //             use a low value; small creeks use a high one, so detail
  //             reveals itself as you zoom in
  //   species   ids from the shared catalogue — the POSSIBLE catches here.
  //             The same species can and should appear in several zones.
  //
  // TO ADD A ZONE: copy an entry, set coords, pick a type, list species ids.
  // ---------------------------------------------------------------------
  zones: [
    {
      id: 'z-cancabato',
      water: 'Leyte Gulf',
      name: 'Cancabato Bay',
      type: 'bay',
      coords: { lat: 11.238, lon: 125.004 },
      minZoom: 10,
      depth: '2–12 m',
      blurb: 'Sheltered bay right off Tacloban with piers, moorings and roughly 54 ha of seagrass. Reliable when the gulf is too rough to go out, and the seagrass supports far more than its size suggests.',
      species: [
        'sphyraena-obtusata', 'sphyraena-barracuda', 'lates-calcarifer', 'lutjanus-argentimaculatus',
        'terapon-jarbua', 'scatophagus-argus', 'planiliza-subviridis', 'megalops-cyprinoides',
        'tylosurus-crocodilus', 'sillago-sihama', 'gerres-oyena', 'photopectoralis-bindus',
        'siganus-guttatus', 'upeneus-tragula', 'plotosus-lineatus', 'uroteuthis-duvaucelii',
        'portunus-pelagicus',
      ],
      best: 'Run-out tide, early morning; barracuda and tarpon at dusk',
    },
    {
      id: 'z-san-pedro',
      water: 'Leyte Gulf',
      name: 'San Pedro Bay',
      type: 'bay',
      // Mid-basin, between the Tacloban–Palo shore and the Samar side. The pin
      // used to sit at 11.10/125.02, which is 1.1 km off Tanauan — a pin for
      // the whole bay parked on one town's shallows, and close enough to the
      // Tanauan zone's own pin that the two collided from zoom 10 in.
      // INFERRED from the surrounding coastline, not from a source. Worth a
      // local check that this is open water and fished as San Pedro Bay.
      coords: { lat: 11.18, lon: 125.06 },
      minZoom: 8,
      depth: '5–30 m',
      blurb: 'The broad inner basin of the gulf. Mixed mud and sand — the main ground for ponyfish and mojarra volume.',
      species: ['photopectoralis-bindus', 'gazza-minuta', 'leiognathus-equulus', 'secutor-ruconius', 'pentaprion-longimanus', 'gerres-filamentosus', 'nemipterus-japonicus',
        'mugil-cephalus',
        'nemipterus-virgatus',
        'otolithes-ruber',
        'pomadasys-argenteus',
        'sardinella-gibbosa',
        'scolopsis-taenioptera',
      ],
      best: 'Any moving tide; best a day or two after rain',
    },
    {
      id: 'z-basey-flats',
      water: 'Leyte Gulf',
      name: 'Basey tidal flats',
      type: 'flats',
      coords: { lat: 11.28, lon: 125.07 },
      minZoom: 11,
      depth: '0.5–3 m',
      blurb: 'Wide shallow flats fed by the Basey river. Fish move up with the flood to feed over newly covered sand and seagrass.',
      species: [
        'gerres-oyena', 'gerres-filamentosus', 'pentaprion-longimanus', 'siganus-guttatus',
        'chanos-chanos', 'sillago-sihama', 'terapon-jarbua', 'planiliza-subviridis',
        'upeneus-tragula', 'tylosurus-crocodilus', 'plotosus-lineatus', 'portunus-pelagicus',
      
        'cynoglossus-bilineatus',
        'eubleekeria-splendens',
        'nemipterus-virgatus',
        'pomadasys-argenteus',
        'psettodes-erumei',
        'scolopsis-taenioptera',
      ],
      best: 'First two hours of the flood',
    },
    {
      id: 'z-basey-mangrove',
      water: 'Leyte Gulf',
      name: 'Basey mangrove creeks',
      type: 'mangrove',
      coords: { lat: 11.305, lon: 125.09 },
      minZoom: 12,
      depth: '1–5 m',
      blurb: 'Tangled root systems and undercut banks. The best mangrove jack water in the northern gulf — accurate casting matters more than distance here.',
      species: [
        'lutjanus-argentimaculatus', 'lutjanus-russellii', 'lutjanus-johnii', 'lates-calcarifer',
        'siganus-guttatus', 'epinephelus-coioides', 'scatophagus-argus', 'megalops-cyprinoides',
        'eleutheronema-tetradactylum', 'terapon-jarbua',
      ],
      best: 'Last of the run-out, into dusk',
    },
    {
      id: 'z-tanauan',
      water: 'Leyte Gulf',
      name: 'Tanauan coastal shallows',
      type: 'shallows',
      coords: { lat: 11.11, lon: 125.02 },
      minZoom: 10,
      depth: '1–8 m',
      blurb: 'Open sandy shoreline with patchy seagrass. Easy shore access and consistent small-fish action.',
      species: [
        'gerres-oyena', 'photopectoralis-bindus', 'sardinella-fimbriata', 'rastrelliger-kanagurta',
        'scomberoides-commersonnianus', 'sillago-sihama', 'terapon-jarbua', 'sphyraena-obtusata',
        'upeneus-tragula', 'planiliza-subviridis', 'eleutheronema-tetradactylum',
      ],
      best: 'Dawn and dusk',
    },
    {
      id: 'z-guiuan-reef',
      water: 'Leyte Gulf',
      name: 'Guiuan fringing reefs',
      type: 'reef',
      coords: { lat: 11.03, lon: 125.72 },
      minZoom: 9,
      depth: '3–25 m',
      blurb: 'Coral fringe on the eastern side of the gulf. Clear water, strong structure and the best grouper and snapper of the region.',
      species: [
        'epinephelus-coioides', 'lutjanus-fulviflamma', 'lutjanus-russellii', 'caranx-ignobilis',
        'sphyraena-barracuda', 'siganus-guttatus', 'lethrinus-lentjan', 'scarus-ghobban',
        'upeneus-tragula', 'tylosurus-crocodilus', 'uroteuthis-duvaucelii',
      
        'drepane-punctata',
        'parupeneus-indicus',
        'platycephalus-indicus',
        'priacanthus-macracanthus',
        'saurida-tumbil',
        'sphyraena-jello',
      ],
      best: 'Mid-tide, calm mornings',
    },
    {
      id: 'z-homonhon',
      water: 'Leyte Gulf',
      name: 'Homonhon Island channel',
      type: 'channel',
      coords: { lat: 10.75, lon: 125.70 },
      minZoom: 9,
      depth: '15–60 m',
      blurb: 'Deep channel between islands with hard tidal flow. Bait funnels through and predators sit on the edges waiting.',
      species: [
        'caranx-ignobilis', 'sphyraena-barracuda', 'scomberoides-commersonnianus',
        'lutjanus-malabaricus', 'auxis-thazard', 'selar-crumenophthalmus', 'lethrinus-lentjan',
        'tylosurus-crocodilus',
      
        'kyphosus-vaigiensis',
      ],
      best: 'Peak flow, mid-tide either direction',
    },
    {
      id: 'z-pacific-edge',
      water: 'Leyte Gulf',
      name: 'Pacific edge / offshore',
      type: 'offshore',
      coords: { lat: 10.80, lon: 125.95 },
      minZoom: 8,
      depth: '60–500 m+',
      blurb: 'Where the gulf opens to the Philippine Sea and the bottom falls away. Pelagic ground — tuna, skipjack and the deep-water snappers.',
      species: ['katsuwonus-pelamis', 'auxis-thazard', 'decapterus-macarellus', 'selar-crumenophthalmus', 'lutjanus-malabaricus', 'sphyraena-barracuda'],
      best: 'Calm early mornings; watch for working birds',
    },
    {
      id: 'z-leyte-west',
      water: 'Leyte Gulf',
      name: 'Western gulf shelf',
      type: 'shallows',
      coords: { lat: 10.90, lon: 125.15 },
      minZoom: 8,
      depth: '10–45 m',
      blurb: 'Gently shelving mud and sand along the Leyte shoreline. Steady bottom fishing when the wind keeps you off the eastern reefs.',
      species: [
        'nemipterus-japonicus', 'leiognathus-equulus', 'gazza-minuta', 'pentaprion-longimanus',
        'rastrelliger-kanagurta', 'decapterus-macarellus', 'lethrinus-lentjan', 'upeneus-tragula',
        'sillago-sihama', 'eleutheronema-tetradactylum',
      
        'abalistes-stellatus',
        'aluterus-monoceros',
        'decapterus-kurroides',
        'mene-maculata',
        'parupeneus-indicus',
        'platycephalus-indicus',
        'priacanthus-macracanthus',
        'saurida-tumbil',
      ],
      best: 'Amihan season, when the east side is choppy',
    },
    {
      id: 'z-sardine-grounds',
      water: 'Leyte Gulf',
      name: 'Central sardine grounds',
      type: 'offshore',
      coords: { lat: 11.00, lon: 125.40 },
      minZoom: 8,
      depth: '20–80 m',
      blurb: 'Open water where the small pelagic schools hold. Where you fill the bait bucket before doing anything else.',
      species: ['sardinella-fimbriata', 'rastrelliger-kanagurta', 'decapterus-macarellus', 'selar-crumenophthalmus', 'auxis-thazard'],
      best: 'Dawn, and after dark under lights',
    },

    // =====================================================================
    // NORTH COAST — Carigara Bay and the San Juanico Strait
    // Carigara Bay is part of the Samar Sea; the strait joins it to the gulf.
    // =====================================================================
    {
      id: 'z-carigara-bay',
      water: 'Carigara Bay',
      name: 'Carigara Bay',
      type: 'bay',
      coords: { lat: 11.381, lon: 124.664 },
      minZoom: 9,
      depth: '54 m average, 63 m at its deepest',
      blurb: 'The broad north-coast bay, part of the Samar Sea. Deeper than the gulf side and more enclosed. Jellyfish are harvested here commercially — and juvenile scad shelter underneath them, so a bloom is worth fishing rather than avoiding.',
      species: ['alepes-djedaba', 'carangoides-equula', 'rastrelliger-brachysoma', 'selaroides-leptolepis', 'sardinella-fimbriata', 'selar-crumenophthalmus', 'nemipterus-japonicus', 'sillago-sihama', 'gerres-oyena', 'trichiurus-lepturus',
        'auxis-rochei',
        'epinephelus-fasciatus',
        'eubleekeria-splendens',
        'hemiramphus-far',
        'nemipterus-virgatus',
        'rastrelliger-faughni',
      ],
      best: 'Moving tide; look for jellyfish and fish underneath them',
    },
    {
      id: 'z-carigara-mangrove',
      water: 'Carigara Bay',
      name: 'Carigara mangrove fringe',
      type: 'mangrove',
      coords: { lat: 11.32, lon: 124.72 },
      minZoom: 11,
      depth: 'Shallow — 1–4 m',
      blurb: 'The mangrove belt along the southern shore of the bay. Twenty-two mangrove species have been recorded here across twelve families, which is a lot of root structure and a lot of places for a snapper to sit.',
      species: ['lutjanus-argentimaculatus', 'lutjanus-russellii', 'scylla-serrata', 'lates-calcarifer', 'terapon-jarbua', 'planiliza-subviridis', 'megalops-cyprinoides', 'scatophagus-argus'],
      best: 'Last two hours of the run-out, tight to the roots',
    },
    {
      id: 'z-san-juanico',
      water: 'San Juanico Strait',
      name: 'San Juanico narrows',
      type: 'strait',
      coords: { lat: 11.340, lon: 124.978 },
      minZoom: 10,
      depth: 'Varies with the channel',
      blurb: 'Thirty-eight kilometres of strait between Leyte and Samar, pinched to two kilometres at its narrowest. It joins Carigara Bay to San Pedro Bay, so the whole tidal exchange between the Samar Sea and Leyte Gulf squeezes through here twice a day. Bridge pilings and ferry traffic — fish the eddies, stay out of the lane.',
      species: ['caranx-ignobilis', 'sphyraena-barracuda', 'lutjanus-argentimaculatus', 'scomberoides-commersonnianus', 'megalaspis-cordyla', 'trichiurus-lepturus', 'eleutheronema-tetradactylum', 'tylosurus-crocodilus',
        'acanthocybium-solandri',
        'caesio-caerulaurea',
        'carcharhinus-melanopterus',
        'chirocentrus-dorab',
        'epinephelus-fasciatus',
        'hemiramphus-far',
        'lutjanus-lutjanus',
        'neotrygon-kuhlii',
        'parastromateus-niger',
        'rastrelliger-faughni',
        'selar-boops',
        'siganus-argenteus',
      ],
      best: 'The slack either side of the turn, never the peak run',
    },

    // =====================================================================
    // WEST COAST — Ormoc Bay and the Camotes Sea
    // =====================================================================
    {
      id: 'z-ormoc-bay',
      water: 'Ormoc Bay',
      name: 'Ormoc Bay',
      type: 'bay',
      coords: { lat: 10.950, lon: 124.600 },
      minZoom: 10,
      depth: 'Not recorded — sheltered bay water',
      blurb: 'A sheltered arm of the Camotes Sea at the head of which sits Ormoc city. Calmer than the gulf when amihan is blowing across the island. The least documented water in this guide — treat the species list as a starting point and correct it from what you actually catch.',
      species: ['rastrelliger-brachysoma', 'selaroides-leptolepis', 'sardinella-fimbriata', 'selar-crumenophthalmus', 'photopectoralis-bindus', 'gerres-oyena', 'sillago-sihama', 'planiliza-subviridis', 'lutjanus-fulviflamma',
        'auxis-rochei',
        'conger-cinereus',
        'eubleekeria-splendens',
        'lobotes-surinamensis',
        'mugil-cephalus',
        'rastrelliger-faughni',
        'scarus-rivulatus',
        'scolopsis-taenioptera',
      ],
      best: 'Early morning off the wharves; calmer here during amihan',
    },
    {
      id: 'z-camotes-sea',
      water: 'Camotes Sea',
      name: 'Camotes Sea grounds',
      type: 'offshore',
      coords: { lat: 10.72, lon: 124.42 },
      minZoom: 8,
      depth: 'Open water',
      blurb: 'The open sea between Leyte, Cebu and Bohol, and the volume fishery of the west coast — sardines, round scad and mackerel. BFAR classes it as heavily exploited, and the small pelagics here have been declining for years. Fish it, but do not expect the numbers older fishers describe.',
      species: ['sardinella-lemuru', 'amblygaster-sirm', 'decapterus-macrosoma', 'decapterus-macarellus', 'selar-crumenophthalmus', 'rastrelliger-kanagurta', 'megalaspis-cordyla', 'auxis-thazard', 'stolephorus-indicus', 'scomberomorus-commerson'],
      best: 'Dawn, on a moving tide, wherever the birds are working',
    },
    {
      id: 'z-camotes-reef',
      water: 'Camotes Sea',
      name: 'Western fringing reefs',
      type: 'reef',
      coords: { lat: 10.88, lon: 124.48 },
      minZoom: 11,
      depth: 'Shallow reef into deeper water',
      blurb: 'The reef edge along Leyte\'s west coast. Surgeonfish and pufferfish are recorded among the reef families of this sea, alongside the trevally and emperor that make it worth fishing. Keep lures above the coral.',
      species: ['caranx-melampygus', 'caesio-cuning', 'naso-unicornis', 'lethrinus-harak', 'lethrinus-lentjan', 'arothron-hispidus', 'scarus-ghobban', 'siganus-canaliculatus', 'epinephelus-coioides', 'lutjanus-fulviflamma'],
      best: 'Run-in tide over the reef edge, early or late',
    },
    {
      id: 'z-canigao',
      water: 'Canigao Channel',
      name: 'Canigao Channel reefs',
      type: 'reef',
      coords: { lat: 10.250, lon: 124.700 },
      minZoom: 10,
      depth: 'Reef into channel depth',
      blurb: 'The channel between Leyte and Bohol, carrying water between the Camotes and Bohol seas. Four named reefs — Adam, Abel, Cain and Eve — plus Canigao Island and the Tood Islets. Reef fishing here is current-driven; check which way it is running before you set up.',
      species: ['caranx-melampygus', 'epinephelus-malabaricus', 'epinephelus-coioides', 'caesio-cuning', 'lethrinus-harak', 'lutjanus-malabaricus', 'naso-unicornis', 'scarus-ghobban', 'elagatis-bipinnulata', 'sepioteuthis-lessoniana'],
      best: 'Either side of the tide change, up-current of the reef',
    },

    // =====================================================================
    // SOUTH — Sogod Bay and the Surigao Strait
    // Fishery Management Area 9, and a different sea: this is the Bohol Sea.
    // =====================================================================
    {
      id: 'z-sogod-bay',
      water: 'Sogod Bay',
      name: 'Sogod Bay',
      type: 'bay',
      coords: { lat: 10.30, lon: 125.02 },
      minZoom: 9,
      depth: '0–200 m across the assessed area',
      blurb: 'Forty-five kilometres long and ten wide, reaching south into Southern Leyte as an arm of the Bohol Sea. Kawakawa — mangko — is the major fishery here, with a seasonal influx that whole municipalities fish. Seasonal upwelling drives plankton productivity from November through April, and everything else follows it.',
      species: ['euthynnus-affinis', 'katsuwonus-pelamis', 'auxis-thazard', 'rastrelliger-kanagurta', 'sardinella-lemuru', 'amblygaster-sirm', 'stolephorus-indicus', 'cheilopogon-cyanopterus', 'scomberomorus-commerson', 'selar-crumenophthalmus',
        'lethrinus-nebulosus',
      ],
      best: 'November to April, when the upwelling brings the bait in',
    },
    {
      id: 'z-sogod-deep',
      water: 'Sogod Bay',
      name: 'Sogod drop-off',
      type: 'deep',
      coords: { lat: 10.18, lon: 125.10 },
      minZoom: 10,
      depth: 'Deep water close to shore',
      blurb: 'Where the bay floor falls away toward the Bohol Sea. Deep water within reach of a small boat, which is unusual and is why this coast has the reputation it does. Whale sharks feed here — a protected species, not a catch; give them room and keep your gear clear of them.',
      species: ['thunnus-albacares', 'thunnus-obesus', 'thunnus-tonggol', 'pristipomoides-multidens', 'epinephelus-malabaricus', 'coryphaena-hippurus', 'elagatis-bipinnulata', 'euthynnus-affinis',
        'istiophorus-platypterus',
      ],
      best: 'First light, dropped deep or trolled along the edge',
    },
    {
      id: 'z-sogod-reef',
      water: 'Sogod Bay',
      name: 'Padre Burgos reef edge',
      type: 'reef',
      coords: { lat: 10.05, lon: 125.02 },
      minZoom: 11,
      depth: 'Shallow reef onto a steep edge',
      blurb: 'The fringing reef along the western mouth of the bay, off Padre Burgos and Limasawa. Reef on one side and deep water on the other within a few boat lengths — the fish move between the two on the tide.',
      species: ['caranx-melampygus', 'caesio-cuning', 'lethrinus-harak', 'naso-unicornis', 'epinephelus-coioides', 'siganus-canaliculatus', 'sepioteuthis-lessoniana', 'scarus-ghobban', 'lutjanus-fulviflamma',
        'diagramma-pictum',
        'epinephelus-fasciatus',
        'hemiramphus-far',
        'lutjanus-lutjanus',
        'parastromateus-niger',
        'selar-boops',
      ],
      best: 'Run-in tide along the edge, dawn or dusk',
    },
    {
      id: 'z-surigao-strait',
      water: 'Surigao Strait',
      name: 'Surigao Strait',
      type: 'strait',
      coords: { lat: 10.167, lon: 125.383 },
      minZoom: 9,
      depth: 'Deep, with very strong current',
      blurb: 'Twenty-five kilometres wide at most, between Panaon Island and Mindanao, joining the Bohol Sea to Leyte Gulf. The current runs to eight knots — faster than most bancas can make way against. Superb fishing and genuinely dangerous water; go with someone who knows the turn, and never fish it on a dropping engine.',
      species: ['thunnus-tonggol', 'thunnus-obesus', 'euthynnus-affinis', 'katsuwonus-pelamis', 'scomberomorus-commerson', 'megalaspis-cordyla', 'elagatis-bipinnulata', 'caranx-ignobilis', 'coryphaena-hippurus'],
      best: 'Slack water either side of the turn — never the peak run',
    },
  ],

  // Possible catches in this region — ids from the shared catalogue in
  // js/data/species/indo-pacific.js. A species may appear in any number of
  // regions and zones; nothing here is exclusive.
  species: [
    'photopectoralis-bindus', 'gazza-minuta', 'leiognathus-equulus', 'secutor-ruconius',
    'lutjanus-argentimaculatus', 'lutjanus-fulviflamma', 'lutjanus-russellii', 'lutjanus-johnii',
    'lutjanus-malabaricus', 'pentaprion-longimanus', 'gerres-oyena', 'gerres-filamentosus',
    'rastrelliger-kanagurta', 'sardinella-fimbriata', 'selar-crumenophthalmus', 'decapterus-macarellus',
    'auxis-thazard', 'katsuwonus-pelamis', 'epinephelus-coioides', 'siganus-guttatus',
    'caranx-ignobilis', 'nemipterus-japonicus', 'sphyraena-barracuda', 'chanos-chanos',
    'scomberoides-commersonnianus', 'sphyraena-obtusata', 'terapon-jarbua', 'sillago-sihama',
    'lates-calcarifer', 'scatophagus-argus', 'planiliza-subviridis', 'tylosurus-crocodilus',
    'lethrinus-lentjan', 'upeneus-tragula', 'eleutheronema-tetradactylum', 'plotosus-lineatus',
    'megalops-cyprinoides', 'scarus-ghobban', 'uroteuthis-duvaucelii', 'portunus-pelagicus',
    'alepes-djedaba', 'amblygaster-sirm', 'arothron-hispidus', 'caesio-cuning',
    'carangoides-equula', 'caranx-melampygus', 'cheilopogon-cyanopterus', 'coryphaena-hippurus',
    'decapterus-macrosoma', 'elagatis-bipinnulata', 'epinephelus-malabaricus', 'euthynnus-affinis',
    'lethrinus-harak', 'megalaspis-cordyla', 'naso-unicornis', 'pristipomoides-multidens',
    'rastrelliger-brachysoma', 'sardinella-lemuru', 'scomberomorus-commerson', 'scylla-serrata',
    'selaroides-leptolepis', 'sepioteuthis-lessoniana', 'siganus-canaliculatus', 'stolephorus-indicus',
    'thunnus-albacares', 'thunnus-obesus', 'thunnus-tonggol', 'trichiurus-lepturus',
    'abalistes-stellatus',
    'acanthocybium-solandri',
    'aluterus-monoceros',
    'auxis-rochei',
    'caesio-caerulaurea',
    'carcharhinus-melanopterus',
    'chirocentrus-dorab',
    'conger-cinereus',
    'cynoglossus-bilineatus',
    'decapterus-kurroides',
    'diagramma-pictum',
    'drepane-punctata',
    'epinephelus-fasciatus',
    'eubleekeria-splendens',
    'hemiramphus-far',
    'istiophorus-platypterus',
    'kyphosus-vaigiensis',
    'lethrinus-nebulosus',
    'lobotes-surinamensis',
    'lutjanus-lutjanus',
    'mene-maculata',
    'mugil-cephalus',
    'nemipterus-virgatus',
    'neotrygon-kuhlii',
    'otolithes-ruber',
    'parastromateus-niger',
    'parupeneus-indicus',
    'platycephalus-indicus',
    'pomadasys-argenteus',
    'priacanthus-macracanthus',
    'psettodes-erumei',
    'rastrelliger-faughni',
    'sardinella-gibbosa',
    'saurida-tumbil',
    'scarus-rivulatus',
    'scolopsis-taenioptera',
    'selar-boops',
    'siganus-argenteus',
    'sphyraena-jello',
  ],

  tips: [
    {
      id: 'lg-tides',
      title: 'Fish the moving tide, not the slack',
      body: 'Leyte Gulf is broad and shallow, so bait gets pushed hard through channel mouths and over the flats on a running tide. The first two hours of the flood and the last two of the ebb consistently outproduce slack water. Check the tide card before you commit to a spot.',
      tags: ['tides', 'timing'],
      category: 'zones',
    },
    {
      id: 'lg-habagat',
      title: 'Read the monsoon, not just the day',
      body: 'Amihan (northeast, roughly November–April) brings cooler, drier air and choppier conditions on the Pacific-facing side. Habagat (southwest, roughly June–October) is wetter with calmer eastern water but sudden squalls. Amihan generally favours the sheltered inner bays; habagat opens up the outer reefs on calm mornings.',
      tags: ['weather', 'seasons'],
      category: 'zones',
    },
    {
      id: 'lg-sapsap',
      title: 'Sap-sap after rain',
      body: 'Ponyfish schools concentrate near river mouths and estuary edges once runoff pushes nutrients out. A day or two after heavy rain, fish the brackish margins with the smallest hooks you own and cut shrimp — expect volume, not size.',
      tags: ['species', 'leiognathidae'],
      category: 'fishes',
    },
    {
      id: 'lg-mangrove',
      title: 'Snapper live in the structure, not near it',
      body: 'Mangrove red snapper hold tight inside root systems and under fallen timber. Cast into the cover, not alongside it, and set your drag heavy enough to turn the fish in the first two seconds — give it any line and it will reef you.',
      tags: ['species', 'lutjanidae', 'technique'],
      category: 'fishes',
    },
    {
      id: 'lg-night-squid',
      title: 'Night squid under lights',
      body: 'Nokus come shallow after dark. A single bright light over the water for twenty minutes will gather baitfish and squid behind them. Egi jigs in natural colours, worked in slow upward hops off the bottom.',
      tags: ['species', 'night', 'technique'],
      category: 'fishes',
    },
    {
      id: 'lg-birds',
      title: 'Follow the birds for tulingan',
      body: 'Frigate tuna and skipjack push bait to the surface and terns give the position away long before you can see the fish. Run wide around the school and cast ahead of its direction of travel — driving through the middle puts it down.',
      tags: ['species', 'pelagic', 'technique'],
      category: 'fishes',
    },
  ],
};
