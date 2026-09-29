// General fishing tips, shown in every region. Region-specific tips live in
// the region file.
//
// `tags`     searchable keywords
// `category` Info tab it shows under: 'fishes', 'gear' or 'zones'

export const GENERAL_TIPS = [
  {
    id: 'gen-log-everything',
    title: 'Log the conditions, not just the fish',
    body: 'A catch on its own teaches you very little. The same catch recorded with tide state, wind and time of day becomes a pattern you can fish again. Fill in the bait and method fields even when the answer is boring.',
    tags: ['habit', 'records'],
    category: 'zones',
  },
  {
    id: 'gen-first-light',
    title: 'First and last light beat the middle of the day',
    body: 'Low light lets predators approach bait without being seen, and in the tropics it also means cooler surface water. If you only get one window, take dawn.',
    tags: ['timing'],
    category: 'zones',
  },
  {
    id: 'gen-match-hatch',
    title: 'Match the bait that is actually present',
    body: 'Before tying anything on, spend two minutes looking at what is in the water — sardine fry, small shrimp, crabs on the flat. Size matters more than colour; a lure roughly the length of the local bait will out-fish a prettier one at the wrong size.',
    tags: ['technique', 'bait'],
    category: 'fishes',
  },
  {
    id: 'gen-drag',
    title: 'Set your drag before you cast',
    body: 'Roughly a quarter to a third of your line\'s breaking strain, checked by pulling line off the spool by hand. Almost every fish lost near structure is lost because the drag was set optimistically after the hook-up instead of deliberately before it.',
    tags: ['tackle'],
    category: 'gear',
  },
  {
    id: 'gen-rinse',
    title: 'Rinse gear the same day, every time',
    body: 'Salt does its damage in the hours after you get home, not on the water. A freshwater rinse and a dry towel on reels and rod guides costs five minutes and roughly doubles the life of your gear in a tropical climate.',
    tags: ['tackle', 'habit'],
    category: 'gear',
  },
  {
    id: 'gen-release',
    title: 'Release well or not at all',
    body: 'Wet your hands, support the belly, keep it out of the water for less time than you can hold your own breath, and never hold a fish by the gills if you intend to let it go. If a fish is bleeding heavily from the gills, keep it — releasing it only wastes it.',
    tags: ['ethics', 'conservation'],
    category: 'fishes',
  },
  {
    id: 'gen-size-limits',
    title: 'Know the local rules before the trip',
    body: 'Municipal waters in the Philippines are managed locally, so closed seasons, gear restrictions and minimum sizes vary between LGUs. Check with the barangay or the local BFAR office rather than assuming national rules apply uniformly.',
    tags: ['rules', 'conservation'],
    category: 'zones',
  },
  {
    id: 'gen-safety',
    title: 'Tell someone your plan',
    body: 'Before going out — especially alone or on a small banca — tell someone where you are fishing and when you expect to be back. Carry a charged phone in a dry bag and a light, even for a day trip.',
    tags: ['safety'],
    category: 'gear',
  },
];
