// Class → sprite sheet mapping (owned by the units item). Sheets are packed by tools/pack_sprites.py from keyed AI-generated source frames (not in this repo)
// and are packed with tools/pack_sprites.py into public/sprites/ (`python3 tools/pack_sprites.py --all` reads this file).
// Keys follow DESIGN.md §3 (24 classes) + monsters.
//
// `height` = the world-unit height of the character's CORE (head top → feet, ignoring a raised weapon), default 1.40.
// `width`  = the world-unit cap on the core width, default 1.02. Adjacent tiles are only 0.71 world units apart on
//            screen, so anything much wider than ~1 unit visibly intersects its neighbours; the packer shrinks a wide
//            silhouette until it fits instead of letting it grow fat (see tools/pack_sprites.py). Quadrupeds and
//            winged monsters are allowed to be wider than they are tall, which is what makes a hound read as a hound.
// Measured against a reference capture / a reference capture: a classic human is ~1.0 tile-screen-width tall, ~0.66 wide.
//
// Two ported classes have no art of their own and BORROW another class's sheet. They reference it through this map
// rather than a string literal on purpose: tools/pack_sprites.py's roster_sizes() finds sheets by the regex
// /sprite:\s*'([^']+)'/ and keeps the LAST match per sheet, so a borrower written as a literal would overwrite the
// sheet OWNER's pack-time height/width on the next `--all` repack. Indirected, the packer never sees the borrowers
// at all, the owner's numbers stand whatever the file order is, and the borrower's height stays what it actually is
// here: runtime-only. (UnitSprite reads opts.height; `width` is a pack-time budget, never read at runtime.)
const BORROWED = { knight: '03_knight_paladin', skeleton: '17_skeleton_phantom' };
export const ROSTER = {
  // --- the 24 jobs of DESIGN.md §3 ---
  footman:       { sprite: '01_fighter' },
  apothecary:      { sprite: '43_alchemist_apothecary' },
  knight:       { sprite: '03_knight_paladin' },
  archer:       { sprite: '02_amazon' },
  monk:         { sprite: '09_berserker', width: 1.18 },         // unarmed brawler: broad shoulders, so the
  //                                                            default 1.02 width cap cost him 20 % of his height
  cleric:    { sprite: '05_cleric_shaman' },
  sorcerer:    { sprite: '04_wizard_mage' },
  chronomancer:     { sprite: '24_chronomancer' },
  thief:        { sprite: '58_locksmith_keymaster' },
  earthshaper:    { sprite: '28_geomancer_earth_shaper' },
  wyrmlancer:      { sprite: '34_dragoon_wyrmslayer', height: 1.50, width: 1.40 }, // heavy lancer: stands ~7 % over a
  //              human (1.40), a touch above the 1.46 heavy-armour line. The lance stance spreads his mass, so at the default
  //              width cap he packed at 0.89u core -- the SHORTEST human; width 1.40 lets the height stand
  ninja:        { sprite: '07_ninja_master_ninja' },
  blademaster:      { sprite: '26_ironclad_steam_knight', height: 1.46 }, // heavy-armour melee (was a tanner)
  conjurer:     { sprite: '37_stormweaver' },
  mystic:       { sprite: '45_mask_maker_illusionist', width: 1.18 }, // wide robe, same reason as monk
  paladin:      { sprite: '12_angel_seraph', width: 1.15 },
  battlemage:      { sprite: '27_duelist_fencer' },
  beastsage:     { sprite: '08_beast_master_dragoner' },
  gunner:       { sprite: '52_glass_blower_pyrotechnician' },
  juggler:      { sprite: '36_puppeteer_marionetteer' },
  assassin:     { sprite: '30_shadowblade_assassin' },
  dreadknight: { sprite: '35_blood_knight', height: 1.46 },
  runesword:   { sprite: '06_valkyrie_freya' },
  warlock:      { sprite: '29_necromancer_gravekeeper' },
  // --- classes ported from the prototype ---
  guardian:     { sprite: BORROWED.knight, height: 1.46 },      // tower-shield line on the knight's art, so scale is
  //              the only lever. 1.46 (the blademaster/dreadknight heavy-armour value) drives the sprite past that
  //              sheet's silhouette-mass budget and sprites.js clamps it there, so the guardian ships at the knight's
  //              mass cap — measured 1.035x the knight in both height and width, which is as heavy as one tile allows.
  //              The clamp binds whether that sheet is packed at 1.40 or at a CAST_SCALEd 1.092, so this never inverts.
  hunter:       { sprite: '40_falconer_sky_hunter' },           // slim ranger; the raised falcon arm sits outside the
  //              core, so he packs at 100 % of the default height with mass 0.77 of a 0.88 budget. No override needed.
  blacksmith:   { sprite: '47_blacksmith_forge_guard', width: 1.20 }, // barrel chest over a wide stance: at the
  //              default 1.02 cap the width budget bound first and cost him 21 % of his height, which aborts the
  //              pack (MIN_H_FRAC 0.80). 1.20 buys most of it back — he ships broad and ~7 % short, which is the read.
  necromancer:  { sprite: '23_lich', width: 1.12 },             // the flared robe is full-height, so it counts as core
  //              and the default cap left the lich 6 % under a human. 1.12 lets the skirt spread at full height.
  // --- monsters: height is the core height, width the silhouette cap (quadrupeds are wide and low) ---
  skeleton:     { sprite: '17_skeleton_phantom', height: 1.42 },
  ghost:        { sprite: '18_ghost_spectre', height: 1.30, width: 1.05 },
  wyrm:         { sprite: '15_wyrm_dragon', height: 1.85, width: 1.80 },
  cockatrice:   { sprite: '16_gryphon_cockatrice', height: 1.20, width: 1.45 },
  hound:        { sprite: '82_ash_hound', height: 0.92, width: 1.55 },
  boar:         { sprite: '94_ironback_siege_boar', height: 1.00, width: 1.60 },
  werewolf:     { sprite: '21_werewolf_tigerman', height: 1.62, width: 1.15 },
  treant:       { sprite: '73_thorn_treant_rootwarden', height: 2.05, width: 1.70 },
  beetle:       { sprite: '71_rhinoceros_beetle_siegebreaker', height: 0.85, width: 1.50 },
  behemoth:     { sprite: '84_magma_cerberus', height: 1.55, width: 1.70 },
  // --- Chapter II (content owner): new sheets packed with tools/pack_sprites.py <sheet> ---
  wendigo:      { sprite: '38_wendigo_frostbeast', height: 1.70, width: 1.35 },   // frost beast of the Greyspine: a head over a man
  bellwarden:   { sprite: '39_bell_ringer_exorcist' },                            // the Crown's bell-ringing exorcist (job + enemy)
  vampire:      { sprite: '22_vampire', height: 1.44 },                           // the Hollow Chancellor: tall, gaunt
  gloomhound:   { sprite: '85_eclipse_cerberus', height: 1.55, width: 1.70 },     // the capital's chained gate-beast
  colossus:     { sprite: '14_giant_titan', height: 2.20, width: 1.60 },          // the bell-bound barrow king
  ossuary:      { sprite: '88_ossuary_wheel', height: 1.45, width: 1.40 },        // a rolling wheel of bone, foundry-made
  chirurgeon:   { sprite: '25_plague_doctor' },                                   // the Crown's plague-masked field surgeons
  zombie:       { sprite: BORROWED.skeleton, height: 1.30 },     // no zombie art exists anywhere in extracted_frames,
  //              so it borrows the skeleton's sheet. 1.30 against that sheet's packed 1.42 renders it 8.5 % shorter at
  //              the same width (measured: core 1.300 u vs 1.420 u) — a stooped shamble that reads as bulk rather than
  //              as a second skeleton. Should that sheet ever be repacked under a CAST_SCALE factor, the mass clamp in
  //              sprites.js catches BOTH units and the stoop flattens to parity; drop this to ~1.15 then. It cannot
  //              invert either way, which is why 1.30 is safe to leave as-is.
};
export function spriteFor(cls) { return ROSTER[cls]?.sprite || '01_fighter'; }
export function heightFor(cls) { return ROSTER[cls]?.height; }

// ---- R19 motion profiles (units item): per-class WEIGHT and body plan for src/units/anim.js + sprites.js. ----
// light   fast wind-up, short hold, quick snap (thieves, ninja, fencers, archers)
// normal  the default human beat
// heavy   long wind-up, long hold, committed slam, bigger shake (plate, polearms, hammers)
// caster  staff poke in melee, robe sway at idle
// beast   quadrupeds: crouch then POUNCE (a hop arc onto the target), panting idle
// giant   big bodies: rear up, slam down with a stomp (dust + shake), slow heaving breath, heavy footfalls
// flyer   winged: hover-rise on the wind-up, dive on the strike
// float   ghosts: always a hand off the ground, glide instead of step
const MOTION_BY_CLASS = {
  thief: 'light', ninja: 'light', assassin: 'light', archer: 'light', battlemage: 'light', runesword: 'light',
  juggler: 'light', hunter: 'light', gunner: 'light', apothecary: 'light',
  knight: 'heavy', blademaster: 'heavy', dreadknight: 'heavy', wyrmlancer: 'heavy', guardian: 'heavy', blacksmith: 'heavy', paladin: 'heavy',
  cleric: 'caster', sorcerer: 'caster', chronomancer: 'caster', conjurer: 'caster', mystic: 'caster', earthshaper: 'caster',
  warlock: 'caster', necromancer: 'caster', bellwarden: 'caster', chirurgeon: 'caster', beastsage: 'caster',
  hound: 'beast', boar: 'beast', beetle: 'beast', behemoth: 'beast', gloomhound: 'beast',
  treant: 'giant', colossus: 'giant', wendigo: 'giant', werewolf: 'heavy', ossuary: 'giant',
  wyrm: 'flyer', cockatrice: 'flyer', ghost: 'float',
};
const MOTION_BY_SHEET = {};
for (const [cls, r] of Object.entries(ROSTER)) if (!(r.sprite in MOTION_BY_SHEET)) MOTION_BY_SHEET[r.sprite] = MOTION_BY_CLASS[cls] || 'normal';
/** Motion profile for a packed sheet name (UnitSprite.atlas.name). Borrowers share the owner's plan. */
export function motionForSheet(sheet) { return MOTION_BY_SHEET[sheet] || 'normal'; }
