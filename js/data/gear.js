// ---------------------------------------------------------------------------
// GEAR CATALOGUE
//
// Region-independent, exactly like the species catalogue: a rod is a rod in
// Leyte Gulf or anywhere else. Nothing here is tied to a region, so adding one
// never means touching this file.
//
// Every entry answers the same three questions, which is the whole point:
//
//   what   what the thing actually is, in plain language
//   when   the conditions or situations that call for it
//   where  the water or the part of the setup it belongs in
//
// `group` drives the section headings and must match a GEAR_GROUPS id.
// `icon` is a pixel icon name from js/pixel.js.
// `palette` recolours that icon — see PALETTES.
//
// TO ADD GEAR: append an entry with a unique id and an existing group.
// ---------------------------------------------------------------------------

export const GEAR_GROUPS = [
  { id: 'rods', name: 'Rods', blurb: 'The lever. Length buys distance, action buys feel.' },
  { id: 'reels', name: 'Reels', blurb: 'Line storage, drag, and the only brake you have.' },
  { id: 'lines', name: 'Lines & leaders', blurb: 'The one component between you and the fish.' },
  { id: 'terminal', name: 'Terminal tackle', blurb: 'The small metal at the business end.' },
  { id: 'lures', name: 'Lures & jigs', blurb: 'Artificials, sorted by the depth they work.' },
  { id: 'bait', name: 'Bait', blurb: 'What is already on the menu locally.' },
  { id: 'kit', name: 'Kit & accessories', blurb: 'Everything that is not tackle but decides the day.' },
];

export const GEAR = [
  // --- rods ---------------------------------------------------------------
  {
    id: 'rod-spinning',
    name: 'Spinning rod',
    group: 'rods',
    icon: 'rod',
    palette: 'sunset',
    sub: '6–7 ft, light to medium',
    what: 'A rod with the guides underneath and a reel seat sized for a spinning reel. The all-rounder: 6 to 7 feet, rated roughly 8–20 lb, with a fast tip that loads on the cast and stiffens into the butt when a fish turns.',
    when: 'Your default for anything under about 5 kg. Casting light lures, live bait under a float, or bottom-fishing with a small sinker. If you own one rod, own this one.',
    where: 'Bays, piers, mangrove edges, flats — anywhere you cast rather than drop. Short enough to swing under overhanging mangrove and long enough to reach past the first drop-off from shore.',
  },
  {
    id: 'rod-surf',
    name: 'Surf / long-cast rod',
    group: 'rods',
    icon: 'rod',
    palette: 'ocean',
    sub: '10–13 ft, two or three piece',
    what: 'A long, slow-loading rod built to throw a heavy sinker a long way. Two or three sections so it fits a tricycle, with a butt long enough to cast two-handed.',
    when: 'When the fish are further out than you can reach, or when you need to hold bottom against a running tide with 60–120 g of lead. Also worth it for keeping line above breaking surf.',
    where: 'Open beaches and exposed shoreline. Wasted in a sheltered bay, where the extra length only makes the rod harder to handle.',
  },
  {
    id: 'rod-jigging',
    name: 'Jigging / boat rod',
    group: 'rods',
    icon: 'rod',
    palette: 'emerald',
    sub: '5–6 ft, heavy butt',
    what: 'Short, stiff and built to lift rather than cast. The short length gives leverage over a fish directly below you, and the strong butt takes the repeated pumping that jigging demands.',
    when: 'Fishing vertically — dropping jigs or bait straight down from a banca, or working a metal jig up through a school. Also the right tool for wreck and deep-reef fish that must be pulled up fast.',
    where: 'From a boat over deeper water: channels, drop-offs, the outer reef edge. Not a shore rod.',
  },
  {
    id: 'rod-hand-line',
    name: 'Hand line',
    group: 'rods',
    icon: 'spool',
    palette: 'slate',
    sub: 'Line on a spool, no rod at all',
    what: 'A length of monofilament wound on a plastic or wooden spool, worked directly by hand. Still the most-used tackle in Philippine municipal fishing, and not a compromise — the direct contact reads a bite better than any rod tip.',
    when: 'Anytime you want simplicity, and specifically when fishing tight to structure where a rod would be a liability. Also the honest answer when the water is calm and the target is small.',
    where: 'Piers, bancas, bridge pilings, river mouths. Wear a glove or accept the cut if something fast takes it.',
  },

  // --- reels --------------------------------------------------------------
  {
    id: 'reel-spinning',
    name: 'Spinning reel',
    group: 'reels',
    icon: 'reel',
    palette: 'sunset',
    sub: '2500–4000 size',
    what: 'A fixed-spool reel that hangs beneath the rod; line peels off the end of the spool as it casts. Forgiving, hard to tangle, and the easiest reel to learn on. Sizes run roughly 1000 (tiny) to 8000 (offshore).',
    when: 'Default choice, and the only real option for light lures — a 5 g jighead will not turn a baitcaster. A 2500 covers flats and bay work; step up to 4000 for snapper and barracuda.',
    where: 'Everywhere. Rinse it the same day in salt water; the roller bearing on the bail is the first thing to seize.',
  },
  {
    id: 'reel-baitcaster',
    name: 'Baitcasting reel',
    group: 'reels',
    icon: 'reel',
    palette: 'ocean',
    sub: 'Low profile, thumb braked',
    what: 'A reel that sits on top of the rod with the spool turning as the lure flies. More accurate and more powerful than a spinning reel of the same size, at the cost of a spool that overruns into a birds nest if you let it.',
    when: 'Casting heavier lures repeatedly at a target — a mangrove root, a piling, a gap in the cover — and when you want to lean hard on a fish immediately after the hook-up.',
    where: 'Mangrove and structure fishing where accuracy pays. Practice somewhere forgiving before you take one into a place where every backlash costs you the spot.',
  },
  {
    id: 'reel-drag',
    name: 'Drag, set properly',
    group: 'reels',
    icon: 'reel',
    palette: 'coral',
    sub: 'Not a part — a setting',
    what: 'The clutch that lets a fish take line before something breaks. Every reel has one; almost nobody sets it deliberately. Measured properly it should slip at roughly a quarter to a third of the breaking strain of your weakest link.',
    when: 'Before the first cast of every session, and again whenever you change line or leader. Set by pulling line off the spool by hand against the rod, not by guessing at the knob.',
    where: 'Tighten it up near heavy structure where you cannot afford to give line; back it off in open water where a long run costs nothing and a snapped leader costs everything.',
  },

  // --- lines --------------------------------------------------------------
  {
    id: 'line-mono',
    name: 'Monofilament',
    group: 'lines',
    icon: 'spool',
    palette: 'sunset',
    sub: '8–30 lb, the default',
    what: 'A single nylon strand. Stretches roughly 20–30%, which forgives a hard hookset and a lunging fish, and it is cheap enough to replace often. Sinks slowly and is nearly invisible in clear water.',
    when: 'Bait fishing, hand lines, anything where a bit of stretch protects a light hook hold. Replace it every few months — UV in the tropics kills mono faster than use does.',
    where: 'Any water. The forgiving choice, and still what most of the fleet uses for good reason.',
  },
  {
    id: 'line-braid',
    name: 'Braided line',
    group: 'lines',
    icon: 'spool',
    palette: 'ocean',
    sub: 'PE 1–3, near zero stretch',
    what: 'Woven fibres, far thinner than mono of the same strength and with essentially no stretch. You feel the lure ticking bottom and a bite arrives as a tap rather than a mush. Very visible in water, so it almost always wants a leader.',
    when: 'Lure fishing, deep jigging, and any situation where you must feel what is happening 20 m away. Not ideal on a hand line — it cuts skin.',
    where: 'Over reef and rubble where sensitivity tells you when to lift, and in deep water where mono stretch would swallow the hookset entirely.',
  },
  {
    id: 'line-fluoro',
    name: 'Fluorocarbon leader',
    group: 'lines',
    icon: 'spool',
    palette: 'slate',
    sub: '20–60 lb, 40–100 cm',
    what: 'A short length of dense, abrasion-resistant line tied between your main line and the hook. Its refractive index is close to water, so it is harder for a fish to see, and it takes far more rubbing than braid before it gives.',
    when: 'Always with braid. Go heavier and longer where teeth or coral are involved, lighter where the water is clear and the fish are shy.',
    where: 'Reef, rock and mangrove — anywhere the line will touch something. Check the last metre by running it through your fingers after every fish; a rough patch means retie.',
  },
  {
    id: 'line-wire',
    name: 'Wire trace',
    group: 'lines',
    icon: 'spool',
    palette: 'coral',
    sub: '15–30 cm, single strand or nylon-coated',
    what: 'A short steel leader that teeth cannot cut. Costs you some bites because it is stiff and visible, and buys you the fish that would otherwise leave with your lure.',
    when: 'When barracuda, mackerel or needlefish are around — which in Leyte Gulf is most of the time near a harbour. If you lose two lures cleanly cut at the knot, stop guessing and put wire on.',
    where: 'Harbour mouths, channel edges and anywhere you see baitfish scattering. Skip it over the flats, where the extra visibility costs more than it saves.',
  },

  // --- terminal -----------------------------------------------------------
  {
    id: 'hooks',
    name: 'Hooks',
    group: 'terminal',
    icon: 'hook',
    palette: 'sunset',
    sub: 'Size 12 up to 4/0',
    what: 'The only part that must not fail. Sizes run backwards below 1/0: a size 12 is tiny, a 4/0 is large. Circle hooks turn into the corner of the jaw on their own and are far kinder to fish you intend to release; J-hooks need you to set them.',
    when: 'Match the hook to the mouth, not to the fish you are hoping for. Ponyfish and mojarra need a size 10–14 or you will never hook one; snapper and barramundi want a 1/0–4/0.',
    where: 'Everywhere. Carry a wider range of sizes than you think you need — the wrong size is the single most common reason for a blank session over the flats.',
  },
  {
    id: 'sinkers',
    name: 'Sinkers & weights',
    group: 'terminal',
    icon: 'box',
    palette: 'slate',
    sub: 'Split shot to 120 g lead',
    what: 'Lead that gets your bait down and keeps it there. Split shot pinches on for fine adjustment; running sinkers slide on the main line so a fish feels less resistance; grip leads hold bottom in current.',
    when: 'Use the lightest weight that reaches the bottom and stays there. Overweighting kills the natural drift of a bait, and a bait that behaves oddly gets ignored.',
    where: 'Heavier in channels and running tide, lighter over the flats. On a slack tide in shallow water you may need none at all.',
  },
  {
    id: 'swivels',
    name: 'Swivels & snaps',
    group: 'terminal',
    icon: 'hook',
    palette: 'ocean',
    sub: 'Barrel swivels, snap clips',
    what: 'A rotating joint that stops a spinning bait or lure from twisting your main line into a spring. A snap on the end lets you change lures without retying, at a small cost in strength and stealth.',
    when: 'Any time the presentation rotates — trolled bait, spinners, a drifting strip of squid. Not needed for a straight bottom rig, where it is one more thing to fail.',
    where: 'Between main line and leader. Keep them as small as the target allows; an oversized swivel on light gear looks exactly like what it is.',
  },
  {
    id: 'floats',
    name: 'Floats & bobbers',
    group: 'terminal',
    icon: 'box',
    palette: 'coral',
    sub: 'Fixed or sliding',
    what: 'A buoyant marker that suspends a bait at a set depth and shows the bite. A sliding float runs on the line up to a stopper knot, so you can fish 4 m deep and still cast the rig.',
    when: 'When fish are holding above the bottom, when the bottom is too foul to fish directly, or when you want a bait to drift naturally with the tide.',
    where: 'Over seagrass and rubble where a bottom rig would snag constantly, and along piers where a drifted bait covers far more water than a static one.',
  },

  // --- lures --------------------------------------------------------------
  {
    id: 'lure-metal',
    name: 'Metal jigs & spoons',
    group: 'lures',
    icon: 'lure',
    palette: 'sunset',
    sub: '10–60 g',
    what: 'Dense pieces of shaped metal that cast a long way and sink fast, flashing on the drop. The cheapest way to cover water and to reach fish deeper than a plug will ever get.',
    when: 'When fish are feeding on small baitfish, especially surface-busting schools where you need to reach the edge of the action before it moves. Also the answer in wind, when nothing lighter will cast.',
    where: 'Open water, channel mouths, over drop-offs, and around bird activity. Retrieve fast and erratically near the surface, or hop it off the bottom in deeper water.',
  },
  {
    id: 'lure-plug',
    name: 'Hard-body plugs',
    group: 'lures',
    icon: 'lure',
    palette: 'ocean',
    sub: 'Minnows, poppers, divers',
    what: 'Plastic or wood baitfish imitations. A shallow minnow swims just under the surface, a popper spits and chugs on top, and a lipped diver pulls itself down to a set depth and holds it.',
    when: 'Poppers at dawn and dusk or over shallow structure when fish are looking up. Minnows and divers through the day. Match the length to the local bait before you worry about colour.',
    where: 'Along mangrove edges, over seagrass in a metre of water, and around harbour lights at night. Poppers need calm-ish water to be heard properly.',
  },
  {
    id: 'lure-soft',
    name: 'Soft plastics',
    group: 'lures',
    icon: 'lure',
    palette: 'emerald',
    sub: 'On a jighead, 3–7 g',
    what: 'A soft plastic body — paddle tail, curl tail or shrimp — threaded onto a weighted hook. The most versatile lure there is: change the jighead weight and the same body fishes the surface or the bottom.',
    when: 'When you do not know what you are looking for. Slow-hop it on the bottom for anything that eats shrimp, or swim it steadily at mid-water for predators.',
    where: 'Everywhere, and specifically the flats and seagrass, where a light jighead can be worked slowly over the top without fouling.',
  },
  {
    id: 'lure-egi',
    name: 'Egi (squid jig)',
    group: 'lures',
    icon: 'lure',
    palette: 'coral',
    sub: '2.5–3.5 size, no barbs',
    what: 'A prawn-shaped jig with a crown of upward-facing spines instead of hooks. Squid grab it with their tentacles and hold on; the spines simply stop them letting go.',
    when: 'After dark, especially over the first few hours of night, and around any light on the water. Work it in sharp upward hops with a long pause — squid take it on the sink.',
    where: 'Piers, moored bancas and harbour lights over seagrass or sand. Nokus come shallow at night and the light does most of the work for you.',
  },

  // --- bait ---------------------------------------------------------------
  {
    id: 'bait-shrimp',
    name: 'Shrimp & prawn',
    group: 'bait',
    icon: 'box',
    palette: 'coral',
    sub: 'Live, fresh dead or cut',
    what: 'The closest thing to a universal bait in these waters — almost everything eats shrimp. Live and hooked through the tail segment for movement, or cut into small pieces for volume fishing.',
    when: 'Live for the bigger, warier fish; cut for sap-sap, mojarra and whiting where you want a lot of small bites. Fresh always outfishes frozen by a clear margin.',
    where: 'Flats, seagrass, estuary edges and piers. Buy from the market early or catch your own with a fine net on the shallows.',
  },
  {
    id: 'bait-fish',
    name: 'Cut & live baitfish',
    group: 'bait',
    icon: 'box',
    palette: 'ocean',
    sub: 'Sardine, ponyfish, mullet',
    what: 'Strips or whole small fish. Oily species like sardine leak scent and work well cut; a live baitfish hooked through the back or nose is the highest-percentage offering for a serious predator.',
    when: 'Cut bait any time you are fishing the bottom and want scent working for you. Live bait when barracuda, snapper or barramundi are the target and nothing artificial is getting looked at.',
    where: 'Channel mouths, harbour walls, deeper bay holes. Keep live bait in a bucket with a lid and change the water often — heat kills it faster than handling does.',
  },
  {
    id: 'bait-berley',
    name: 'Berley / chum',
    group: 'bait',
    icon: 'box',
    palette: 'slate',
    sub: 'Rice bran, fish scraps, bait offcuts',
    what: 'A cheap scent trail dribbled into the water to bring fish to you rather than the reverse. Rice bran mixed with fish scraps is the local standard and costs almost nothing.',
    when: 'When you are fishing one spot for a while — a pier, an anchored banca. Little and often; a single big handful feeds the fish and then leaves.',
    where: 'Anywhere with enough current to carry the trail but not so much that it sweeps away in seconds. Upcurrent of where you want the fish to end up.',
  },

  // --- kit ----------------------------------------------------------------
  {
    id: 'kit-landing-net',
    name: 'Landing net',
    group: 'kit',
    icon: 'net',
    palette: 'emerald',
    sub: 'Knotless rubber mesh if you can',
    what: 'A hoop of mesh on a handle for the last metre, which is where most fish are lost. Knotless rubber mesh does far less damage to slime and fins than knotted nylon, and hooks do not tangle in it.',
    when: 'Any fish you would be annoyed to lose, and every fish you intend to release. Lifting a fish by the line on a light leader is how a good session ends early.',
    where: 'Piers and high banks especially, where there is no shoreline to slide a fish onto. Keep it within arm\'s reach before you hook up, not in the bag.',
  },
  {
    id: 'kit-tackle-box',
    name: 'Tackle box',
    group: 'kit',
    icon: 'box',
    palette: 'sunset',
    sub: 'Sealed compartments, drain holes',
    what: 'Organised storage. The important feature is not capacity but a lid that seals and compartments you can find things in one-handed while a fish is running.',
    when: 'Sort it after the trip, not before the next one. Anything that came home wet gets dried before it goes back in, or it will rust everything next to it.',
    where: 'Somewhere it will not slide around in the bottom of a banca. A small box you actually carry beats a large one you leave at home.',
  },
  {
    id: 'kit-pliers',
    name: 'Pliers & line cutters',
    group: 'kit',
    icon: 'box',
    palette: 'ocean',
    sub: 'Long-nose, corrosion resistant',
    what: 'Long-nose pliers to reach a hook past teeth, crimp a split shot and flatten a barb; a cutter that goes through braid, which normal scissors will not. The single most-used item that is not tackle.',
    when: 'Every session. Attached to you on a lanyard, not loose in the bag — dropped pliers in a metre of water are gone.',
    where: 'On your belt. Non-negotiable when handling barracuda, needlefish or catfish, all of which will hurt you given the opportunity.',
  },
  {
    id: 'kit-sun',
    name: 'Sun and hydration kit',
    group: 'kit',
    icon: 'box',
    palette: 'coral',
    sub: 'Hat, long sleeves, water, polarised lenses',
    what: 'A wide-brimmed hat, a long-sleeved rashguard, water, and polarised sunglasses. The glasses are genuinely tackle: they cut surface glare so you can see structure, bait and fish in shallow water.',
    when: 'Every trip in the tropics, and especially 09:00–15:00 when it is easy to underestimate what nine degrees of latitude does to UV.',
    where: 'Everywhere, but doubly so on open water where glare reflects up as well as down. Dehydration reads as tiredness, and tired anglers make bad decisions on boats.',
  },
  {
    id: 'kit-safety',
    name: 'Safety basics',
    group: 'kit',
    icon: 'box',
    palette: 'slate',
    sub: 'Dry bag, light, charged phone',
    what: 'A phone in a dry bag, a headlamp with fresh batteries, and a life vest on any small boat. None of it catches fish; all of it is why the day ends normally.',
    when: 'Always, and non-negotiably for night sessions and anything on a banca. Check the weather and tide before you leave, and tell someone your plan.',
    where: 'On you rather than in the boat, so it stays with you if you and the boat part company.',
  },
];

/** Gear grouped for display, in GEAR_GROUPS order, empty groups dropped. */
export function gearByGroup(items = GEAR) {
  return GEAR_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter(
    (g) => g.items.length
  );
}

/** Look up one item by id. */
export function getGear(id) {
  return GEAR.find((g) => g.id === id) || null;
}
