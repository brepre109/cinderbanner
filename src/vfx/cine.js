// SPECT15 CINEMATIC TIER — which abilities get a screen-owning moment, and how it is timed.
// Shared by vfx/effects.js (lead-in, full-frame elements, impact freeze) and render/cinematics.js (camera push-in,
// grade shift, release), so both sides always agree on the tier and the beat.
//
// Tier 3 = big spells: tier-2+ elementals (Blaze-class area casts), summons, Holy / Flare / Wyrm Sovereign / ultimate-class and
// boss signatures. Everything else keeps the tier-1 treatment (the plain effect + the stage framing).
const EXPLICIT = new Set(['blaze', 'flare', 'holy', 'pyrelord', 'frost_maiden', 'storm_elder', 'wyrm_sovereign', 'hearthling', 'gemfox', 'great_knell', 'toll_the_dead', 'cataclysm',
  'ruin_strike', 'comet_fall', 'emberfall', 'chain_bolt', 'verdict', 'saint_cross']);
const NEVER = new Set(['attack', 'counter_hit', 'return_shot']);
// element / look of the full-frame moment, from the ability's element first, then its vfx key
const LOOK = { fire: 'fire', ice: 'ice', thunder: 'thunder', holy: 'holy', earth: 'quake', dark: 'dark', water: 'ice' };
export function cineTier(ab, id) {
  if (!ab) return 0; id = id || ab.id;
  if (NEVER.has(id) || ab.self) return 0;
  if (EXPLICIT.has(id)) return 3;
  // boss signatures / anything heavy the explicit list does not name: an expensive or long-charged spell
  if ((ab.kind === 'mag' || ab.kind === 'raise') && ((ab.mp || 0) >= 22 || (ab.ct || 0) >= 4)) return 3;
  return 0;
}
export function cineLook(ab, id) {
  id = id || ab?.id;
  if (id === 'flare' || id === 'ruin_strike') return 'flare';
  if (id === 'wyrm_sovereign') return 'wyrm_sovereign';
  if (id === 'hearthling') return 'cure';
  if (id === 'gemfox') return 'reflect';
  const e = ab?.element && LOOK[ab.element]; if (e) return e;
  const v = ab?.vfx; return v === 'fire' || v === 'ice' || v === 'thunder' || v === 'holy' || v === 'quake' ? v : 'holy';
}
// Grade tint (linear RGB) and the value the world is pulled down to during the moment.
export const CINE_TINT = {
  fire: [1.0, 0.42, 0.18], ice: [0.35, 0.7, 1.0], thunder: [0.42, 0.55, 1.0], holy: [0.75, 0.85, 1.0],
  quake: [0.9, 0.55, 0.3], flare: [1.0, 0.35, 0.55], wyrm_sovereign: [0.55, 0.65, 1.0], dark: [0.6, 0.35, 0.9],
  cure: [0.6, 1.0, 0.72], reflect: [1.0, 0.55, 0.78],
};
// Timeline, seconds at speed 1 (divided by battle.speed): LEAD is the gather beat the effect is delayed by (the world
// darkens, the lens pushes in, the full-frame elements start), HOLD how long the grade stays after the impact.
export const CINE_LEAD = 0.55, CINE_HOLD = 0.45, CINE_RELEASE = 0.4;
// At x4 the moment is a flash: no lead-in, no full-frame set piece, just the grade dip and the impact freeze.
export const cineSpeedScale = (speed) => 1 / Math.max(1, speed || 1);
export const cineFull = (speed) => (speed || 1) < 3.5;
