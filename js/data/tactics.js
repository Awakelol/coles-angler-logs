// ---------------------------------------------------------------------------
// LURE & RETRIEVE RECOMMENDATIONS
//
// Rather than repeating tactics on all ~27 species, advice is keyed by family
// (how the fish feeds) and by habitat type (how you have to present to it).
// A species can override its family default with its own `tactics` block.
//
// TO EXTEND:
//   - new family        -> add to FAMILY_TACTICS
//   - new water type    -> add to HABITAT_TACTICS, and use that `type` on a zone
//   - one-off species   -> add `tactics: { lures, retrieve }` to the species
// This file is region-agnostic; families and habitats repeat across the world.
// ---------------------------------------------------------------------------

export const FAMILY_TACTICS = {
  Leiognathidae: {
    lures: ['Size 10–14 bait hooks', 'Tiny sabiki rigs', 'Cut shrimp', 'Bread paste'],
    retrieve:
      'Barely a retrieve at all — these are small, soft-mouthed fish. Fish a light bait rig just off the bottom and let the current move it. Watch for the line ticking rather than a pull.',
  },
  Lutjanidae: {
    lures: ['Soft plastic paddletails 3–5"', 'Suspending jerkbaits', 'Live tamban or shrimp', 'Bucktail jigs 15–30 g'],
    retrieve:
      'Cast tight into structure and start the retrieve immediately — snapper strike as the lure leaves cover. Steady medium pace with two or three sharp twitches, then a pause. Most hits come on the pause; be ready to lock up and turn the fish before it reaches the roots.',
  },
  Gerreidae: {
    lures: ['Size 8–12 hooks', 'Small worm or shrimp pieces', 'Micro soft plastics 1"'],
    retrieve:
      'Bottom-focused. Cast onto clean sand, let it settle, then drag slowly in short pulls with long pauses — you are imitating a worm or crustacean disturbed in the sand.',
  },
  Carangidae: {
    lures: ['Surface poppers 60–140 mm', 'Stickbaits', 'Metal jigs 20–60 g', 'Sabiki rigs (for scad)'],
    retrieve:
      'Fast and unbroken. Trevally and queenfish chase down prey, so speed triggers them — a lure that stops usually gets refused. For poppers, sharp downward rod strokes with a continuous reel. For scad on jigs, quick lifts and a controlled drop.',
  },
  Scombridae: {
    lures: ['Metal slugs 20–40 g', 'Small chrome spoons', 'Feather jigs', 'Trolled skirts'],
    retrieve:
      'As fast as you can wind. Mackerel and tuna feed on fleeing baitfish and a slow lure looks wrong. Cast past the school, never into it, and burn the lure across the edge.',
  },
  Clupeidae: {
    lures: ['Sabiki bait rigs', 'Tiny flashers'],
    retrieve:
      'Drop through the school and lift in short rhythmic jerks. Mainly a bait-gathering exercise — keep them alive in a bucket for snapper and trevally.',
  },
  Serranidae: {
    lures: ['Live bait on a running sinker', 'Heavy soft plastics 5–7"', 'Deep-diving hard bodies', 'Octopus-pattern jigs'],
    retrieve:
      'Slow, deep and close to structure. Grouper ambush from a hole and rarely chase. Bump the bottom, pause several seconds, lift, and pause again. Set the hook hard and immediately — give it line and it will rock you up.',
  },
  Siganidae: {
    lures: ['Size 10–14 hooks', 'Algae or seaweed strips', 'Bread dough', 'Small green soft plastics'],
    retrieve:
      'Effectively static. Rabbitfish graze, so anchor a bait near weed or structure and wait. Mind the venomous dorsal spines when unhooking.',
  },
  Nemipteridae: {
    lures: ['Two-hook bottom rigs', 'Cut squid or fish strips', 'Small metal jigs'],
    retrieve:
      'Bottom bouncing. Let the rig settle, lift half a metre every twenty seconds, and hold. Small aggressive bites — wait for the weight before striking.',
  },
  Sphyraenidae: {
    lures: ['Long minnow lures 100–150 mm', 'Fast metal spoons', 'Wire-trace live bait'],
    retrieve:
      'Fast and erratic with hard direction changes. Always use a wire trace — barracuda will cut mono instantly. Expect the hit right at the boat or shore.',
  },
  Chanidae: {
    lures: ['Size 12–16 hooks', 'Bread paste', 'Algae baits'],
    retrieve:
      'Static, with the lightest line you can manage. Milkfish are wary graziers and spook off heavy leader. Long soft rod — they run hard and fast on the hookup.',
  },
  Loliginidae: {
    lures: ['Egi squid jigs size 2.5–3.5', 'Natural / amber colours at night'],
    retrieve:
      'Sharp double upward flicks, then let the jig sink on a tight line. Squid grab it on the drop, so watch the line. Fish under a light after dark.',
  },
  Portunidae: {
    lures: ['Baited pots and traps', 'Fish frames or chicken necks'],
    retrieve:
      'Not a lure fishery. Set baited pots on sand or seagrass on a run-out tide and check them every hour or two.',
  },
  Terapontidae: {
    lures: ['Size 8–12 hooks', 'Shrimp or worm pieces', 'Small metal blades'],
    retrieve:
      'Aggressive and unfussy. Cast into shallow sandy water and retrieve in short hops, or simply fish bait on the bottom — they find it fast and hit hard for their size.',
  },
  Sillaginidae: {
    lures: ['Size 6–10 long-shank hooks', 'Live or peeled shrimp', 'Beach worms', 'Small soft plastics 1–2"'],
    retrieve:
      'Fish clean sand, not weed. Cast out, let it settle, then drag slowly with long pauses. Whiting follow the tide in — work water barely deep enough to cover them.',
  },
  Latidae: {
    lures: ['Soft plastic paddletails 4–6"', 'Shallow suspending jerkbaits', 'Live mullet or prawn', 'Surface walkers at dusk'],
    retrieve:
      'Slow-roll past structure and current lines, with long pauses — barramundi sit facing the flow and inhale prey as it drifts past. Fish the run-out at creek mouths and hold on: the first run and jump is where most are lost.',
  },
  Scatophagidae: {
    lures: ['Size 10–14 hooks', 'Bread', 'Shrimp pieces', 'Algae'],
    retrieve:
      'Static bait around pilings, wharves and mangrove edges. They are bold and will feed in dirty water. Mind the venomous dorsal spines when unhooking.',
  },
  Mugilidae: {
    lures: ['Size 12–16 hooks', 'Bread paste', 'Algae strips', 'Cast net'],
    retrieve:
      'Barely a retrieve — mullet graze and spook easily. Lightest line you can manage, tiny hook, unweighted bait drifting naturally. Most locals simply cast-net them.',
  },
  Belonidae: {
    lures: ['Long thin minnows', 'Rope-fly / frayed nylon lures', 'Small metal spoons'],
    retrieve:
      'Fast across the surface. Their bony beaks make hookups poor, so a frayed-rope lure that tangles the teeth often works better than hooks. Keep them away from your face when landing.',
  },
  Lethrinidae: {
    lures: ['Bottom rigs with squid or shrimp', 'Soft plastics 3–4"', 'Small jigs 15–30 g'],
    retrieve:
      'Fish sand patches next to reef. Let the bait sit, then lift and drop. Emperors nose along the bottom, so keep the offering down and be patient.',
  },
  Mullidae: {
    lures: ['Small bait hooks', 'Worm or shrimp pieces'],
    retrieve:
      'Dead still on sand. Goatfish locate food with chin barbels by smell and touch, so movement gains you nothing. Cast, settle, wait.',
  },
  Polynemidae: {
    lures: ['Soft plastic paddletails 3–5"', 'Live prawn', 'Vibes and blades'],
    retrieve:
      'Slow and close to the bottom in murky water. Threadfin hunt by feel with their trailing pectoral filaments, so a steady thumping lure they can sense beats a subtle one.',
  },
  Plotosidae: {
    lures: ['Not targeted — avoid'],
    retrieve:
      'Do not target and do not handle. The dorsal and pectoral spines are venomous and stings are severe. If one takes your bait, cut the line rather than unhooking it.',
  },
  Megalopidae: {
    lures: ['Small soft plastics 2–4"', 'Shallow minnows', 'Live prawn', 'Surface lures at dusk'],
    retrieve:
      'Steady with sharp twitches, near the surface at low light. Their mouths are hard and bony, so strike firmly and repeatedly, and expect them to throw the hook on the jump.',
  },
  Scaridae: {
    lures: ['Algae or seaweed bait', 'Small hooks — rarely takes lures'],
    retrieve:
      'Effectively a bait or spear fishery. Parrotfish scrape algae from coral and almost never chase a lure. Bait weed tight against hard bottom, or leave them be.',
  },
};

// How the water itself changes your approach.
export const HABITAT_TACTICS = {
  mangrove: {
    label: 'Mangrove & creek',
    advice:
      'Cast into the shade line and structure, not the open channel. Short accurate casts beat long ones. Heavy leader — 30–50 lb — because everything here runs straight back into the roots.',
  },
  estuary: {
    label: 'Estuary & river mouth',
    advice:
      'Work the current seams where clear and murky water meet. Fish the run-out tide when bait is flushed out of the creeks; predators stack on the downstream edge.',
  },
  flats: {
    label: 'Tidal flats',
    advice:
      'Shallow and spooky. Long casts, light leader and a quiet approach. Best on the first push of the flood when fish move up to feed over freshly covered ground.',
  },
  reef: {
    label: 'Coral reef',
    advice:
      'Fish the edges and channels rather than the reef top. Keep lures above the coral to avoid snagging, and use enough drag to lift fish clear immediately.',
  },
  channel: {
    label: 'Channel & pass',
    advice:
      'Current is the whole game. Position up-current and let lures swing naturally through the flow. Peak movement mid-tide is when predators sit and feed.',
  },
  bay: {
    label: 'Sheltered bay',
    advice:
      'Look for structure — moored boats, pilings, weed edges, drop-offs. Calm water means fish see more, so downsize leader and lures if bites are hard to come by.',
  },
  shallows: {
    label: 'Coastal shallows',
    advice:
      'Cover ground and keep moving until you find bait. Small lures and bait rigs; dawn and dusk are the productive windows.',
  },
  offshore: {
    label: 'Offshore & open water',
    advice:
      'Watch for birds and surface commotion — they find the fish before you do. Troll to locate, then cast into the school from the edge. Never drive through it.',
  },
  // Straits are channels with the volume turned up. Surigao runs to 8 knots
  // (Wikipedia; see docs/leyte-waters-research.md), which is faster than most
  // bancas can make way against — so this advice leads with getting home.
  strait: {
    label: 'Strait & tidal narrows',
    advice:
      'Check the tide before you commit, not after. Flow reverses hard and can run faster than you can motor against it, so fish the slack either side of the turn and keep something solid downstream of you. Work the eddy lines behind points and pilings — that is where bait gets held and predators wait. Never anchor in the main flow.',
  },
  // The existing 'offshore' advice is all surface pelagics — birds, trolling,
  // casting into schools — and is actively wrong over a drop-off.
  deep: {
    label: 'Deep water & drop-off',
    advice:
      'Fish vertically, not outward. Let jigs reach the bottom and work them up through the column; most takes come on the drop. Braid rather than mono — at depth, stretch swallows the hookset entirely. Watch the sounder for the step in the contour and drift back across it rather than anchoring.',
  },
};

const FALLBACK = {
  lures: ['Small bait hooks', 'Cut bait'],
  retrieve: 'Fish bait near the bottom and let the current work it. Vary depth until you find fish.',
};

/** Tactics for one species: its own override, else its family's, else generic. */
export function tacticsFor(species) {
  if (species?.tactics) return species.tactics;
  return FAMILY_TACTICS[species?.family] || FALLBACK;
}

/** Merge the distinct lure suggestions across a set of species. */
export function lureSummary(speciesList) {
  const seen = new Set();
  for (const s of speciesList) {
    for (const l of tacticsFor(s).lures || []) seen.add(l);
  }
  return [...seen];
}

export function habitatTactics(type) {
  return HABITAT_TACTICS[type] || null;
}
