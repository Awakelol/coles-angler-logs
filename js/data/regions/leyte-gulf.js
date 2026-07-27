// ---------------------------------------------------------------------------
// REGION: Leyte Gulf, Philippines
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
  id: 'leyte-gulf',
  name: 'Leyte Gulf',
  country: 'Philippines',
  blurb: 'Wide, shallow gulf on the eastern Visayas seaboard — ponyfish and snapper country, open to the Pacific swell.',
  timezone: 'Asia/Manila',

  // Used by the weather + tide dashboard.
  coords: { lat: 11.0, lon: 125.2 },

  // Named fishing spots. Add freely — the catch log builds its dropdown here.
  spots: [
    { id: 'tacloban-bay', name: 'Cancabato Bay (Tacloban)', coords: { lat: 11.238, lon: 125.004 }, type: 'bay' },
    { id: 'san-pedro-bay', name: 'San Pedro Bay', coords: { lat: 11.10, lon: 125.02 }, type: 'bay' },
    { id: 'basey-flats', name: 'Basey tidal flats', coords: { lat: 11.28, lon: 125.07 }, type: 'flats' },
    { id: 'guiuan-reefs', name: 'Guiuan fringing reefs', coords: { lat: 11.03, lon: 125.72 }, type: 'reef' },
    { id: 'homonhon', name: 'Homonhon Island channel', coords: { lat: 10.75, lon: 125.70 }, type: 'channel' },
    { id: 'tanauan-coast', name: 'Tanauan coastal shallows', coords: { lat: 11.11, lon: 125.02 }, type: 'shallows' },
    { id: 'offshore-pacific', name: 'Offshore / Pacific edge', coords: { lat: 10.80, lon: 125.95 }, type: 'offshore' },
  ],

  // Map view: where the map opens, and how far it can be zoomed out.
  map: { center: { lat: 11.05, lon: 125.25 }, zoom: 9, minZoom: 7, maxZoom: 15 },

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
      name: 'San Pedro Bay',
      type: 'bay',
      coords: { lat: 11.10, lon: 125.02 },
      minZoom: 9,
      depth: '5–30 m',
      blurb: 'The broad inner basin of the gulf. Mixed mud and sand — the main ground for ponyfish and mojarra volume.',
      species: ['photopectoralis-bindus', 'gazza-minuta', 'leiognathus-equulus', 'secutor-ruconius', 'pentaprion-longimanus', 'gerres-filamentosus', 'nemipterus-japonicus'],
      best: 'Any moving tide; best a day or two after rain',
    },
    {
      id: 'z-basey-flats',
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
      ],
      best: 'First two hours of the flood',
    },
    {
      id: 'z-basey-mangrove',
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
      name: 'Tanauan coastal shallows',
      type: 'shallows',
      coords: { lat: 11.11, lon: 125.02 },
      minZoom: 11,
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
      name: 'Guiuan fringing reefs',
      type: 'reef',
      coords: { lat: 11.03, lon: 125.72 },
      minZoom: 10,
      depth: '3–25 m',
      blurb: 'Coral fringe on the eastern side of the gulf. Clear water, strong structure and the best grouper and snapper of the region.',
      species: [
        'epinephelus-coioides', 'lutjanus-fulviflamma', 'lutjanus-russellii', 'caranx-ignobilis',
        'sphyraena-barracuda', 'siganus-guttatus', 'lethrinus-lentjan', 'scarus-ghobban',
        'upeneus-tragula', 'tylosurus-crocodilus', 'uroteuthis-duvaucelii',
      ],
      best: 'Mid-tide, calm mornings',
    },
    {
      id: 'z-homonhon',
      name: 'Homonhon Island channel',
      type: 'channel',
      coords: { lat: 10.75, lon: 125.70 },
      minZoom: 10,
      depth: '15–60 m',
      blurb: 'Deep channel between islands with hard tidal flow. Bait funnels through and predators sit on the edges waiting.',
      species: [
        'caranx-ignobilis', 'sphyraena-barracuda', 'scomberoides-commersonnianus',
        'lutjanus-malabaricus', 'auxis-thazard', 'selar-crumenophthalmus', 'lethrinus-lentjan',
        'tylosurus-crocodilus',
      ],
      best: 'Peak flow, mid-tide either direction',
    },
    {
      id: 'z-pacific-edge',
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
      name: 'Western gulf shelf',
      type: 'shallows',
      coords: { lat: 10.90, lon: 125.15 },
      minZoom: 9,
      depth: '10–45 m',
      blurb: 'Gently shelving mud and sand along the Leyte shoreline. Steady bottom fishing when the wind keeps you off the eastern reefs.',
      species: [
        'nemipterus-japonicus', 'leiognathus-equulus', 'gazza-minuta', 'pentaprion-longimanus',
        'rastrelliger-kanagurta', 'decapterus-macarellus', 'lethrinus-lentjan', 'upeneus-tragula',
        'sillago-sihama', 'eleutheronema-tetradactylum',
      ],
      best: 'Amihan season, when the east side is choppy',
    },
    {
      id: 'z-sardine-grounds',
      name: 'Central sardine grounds',
      type: 'offshore',
      coords: { lat: 11.00, lon: 125.40 },
      minZoom: 9,
      depth: '20–80 m',
      blurb: 'Open water where the small pelagic schools hold. Where you fill the bait bucket before doing anything else.',
      species: ['sardinella-fimbriata', 'rastrelliger-kanagurta', 'decapterus-macarellus', 'selar-crumenophthalmus', 'auxis-thazard'],
      best: 'Dawn, and after dark under lights',
    },
  ],

  // Possible catches in this region — ids from the shared catalogue in
  // js/data/species/indo-pacific.js. A species may appear in any number of
  // regions and zones; nothing here is exclusive.
  species: [
    'photopectoralis-bindus', 'gazza-minuta', 'leiognathus-equulus',
    'secutor-ruconius', 'lutjanus-argentimaculatus', 'lutjanus-fulviflamma',
    'lutjanus-russellii', 'lutjanus-johnii', 'lutjanus-malabaricus',
    'pentaprion-longimanus', 'gerres-oyena', 'gerres-filamentosus',
    'rastrelliger-kanagurta', 'sardinella-fimbriata', 'selar-crumenophthalmus',
    'decapterus-macarellus', 'auxis-thazard', 'katsuwonus-pelamis',
    'epinephelus-coioides', 'siganus-guttatus', 'caranx-ignobilis',
    'nemipterus-japonicus', 'sphyraena-barracuda', 'chanos-chanos',
    'scomberoides-commersonnianus', 'sphyraena-obtusata', 'terapon-jarbua',
    'sillago-sihama', 'lates-calcarifer', 'scatophagus-argus',
    'planiliza-subviridis', 'tylosurus-crocodilus', 'lethrinus-lentjan',
    'upeneus-tragula', 'eleutheronema-tetradactylum', 'plotosus-lineatus',
    'megalops-cyprinoides', 'scarus-ghobban', 'uroteuthis-duvaucelii',
    'portunus-pelagicus',
  ],

  tips: [
    {
      id: 'lg-tides',
      title: 'Fish the moving tide, not the slack',
      body: 'Leyte Gulf is broad and shallow, so bait gets pushed hard through channel mouths and over the flats on a running tide. The first two hours of the flood and the last two of the ebb consistently outproduce slack water. Check the tide card before you commit to a spot.',
      tags: ['tides', 'timing'],
    },
    {
      id: 'lg-habagat',
      title: 'Read the monsoon, not just the day',
      body: 'Amihan (northeast, roughly November–April) brings cooler, drier air and choppier conditions on the Pacific-facing side. Habagat (southwest, roughly June–October) is wetter with calmer eastern water but sudden squalls. Amihan generally favours the sheltered inner bays; habagat opens up the outer reefs on calm mornings.',
      tags: ['weather', 'seasons'],
    },
    {
      id: 'lg-sapsap',
      title: 'Sap-sap after rain',
      body: 'Ponyfish schools concentrate near river mouths and estuary edges once runoff pushes nutrients out. A day or two after heavy rain, fish the brackish margins with the smallest hooks you own and cut shrimp — expect volume, not size.',
      tags: ['species', 'leiognathidae'],
    },
    {
      id: 'lg-mangrove',
      title: 'Snapper live in the structure, not near it',
      body: 'Mangrove red snapper hold tight inside root systems and under fallen timber. Cast into the cover, not alongside it, and set your drag heavy enough to turn the fish in the first two seconds — give it any line and it will reef you.',
      tags: ['species', 'lutjanidae', 'technique'],
    },
    {
      id: 'lg-night-squid',
      title: 'Night squid under lights',
      body: 'Nokus come shallow after dark. A single bright light over the water for twenty minutes will gather baitfish and squid behind them. Egi jigs in natural colours, worked in slow upward hops off the bottom.',
      tags: ['species', 'night', 'technique'],
    },
    {
      id: 'lg-birds',
      title: 'Follow the birds for tulingan',
      body: 'Frigate tuna and skipjack push bait to the surface and terns give the position away long before you can see the fish. Run wide around the school and cast ahead of its direction of travel — driving through the middle puts it down.',
      tags: ['species', 'pelagic', 'technique'],
    },
  ],
};
