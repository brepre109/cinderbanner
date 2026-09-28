// Game data for the vertical slice: classes (DESIGN.md §3), abilities, reactions, supports, movement abilities and statuses (§2.4).
// Pure data, no DOM/three: imported by the headless sim (src/game/sim.mjs) as well as the renderer.
import { spriteFor, heightFor } from '../units/roster.js';

// ---- Stat tiers at Lv 10 (WP tier 6). Scaled so a Mid ATK unit kills a Mid HP unit in ~4 hits (§5.2). ----
const T = {
  hp: { L: 96, M: 120, H: 150 }, mp: { L: 24, M: 40, H: 64 },
  atk: { L: 32, M: 40, H: 50 }, def: { L: 8, M: 12, H: 18 },
  mag: { L: 22, M: 27, H: 32 }, res: { L: 8, M: 12, H: 16 },
  spd: { L: 6, M: 8, H: 10 }, eva: { L: 5, M: 10, H: 15 },
};
export const WP = 6;               // weapon power tier at unit level 10 (§5.2: 4/6/8/10 at 1/6/12/18)
export const STAT_MOD_STEP = 0.08; // one point of ATK/MAG/DEF modifier (Focus, Rend) = 8% of base; bounded ±3 (§5.1.7)
export const LEVEL = 10;

// weapon: type, range (tiles), ranged (gets +1 range per 2h of height advantage)
const W = {
  sword: { type: 'sword', range: 1 }, dagger: { type: 'dagger', range: 1 }, bow: { type: 'bow', range: 4, ranged: true },
  staff: { type: 'staff', range: 1 }, rod: { type: 'rod', range: 1 }, spear: { type: 'spear', range: 2 }, katana: { type: 'katana', range: 1 },
  rapier: { type: 'rapier', range: 1 }, fists: { type: 'fists', range: 1 }, gun: { type: 'gun', range: 6, ranged: true }, claw: { type: 'claw', range: 1 }, fang: { type: 'fang', range: 1 },
  hammer: { type: 'hammer', range: 1 },   // Blacksmith: reach of a sword, no shield hand — the type letter only matters to Eye for Distance, which tests 'gun'
};

// R18 (review17 P8, walk-heavy openings): every human job that is not plate-armoured moves 4 -- Apothecary, Archer, the
// mages, Wyrmlancer, Blademaster, Gunner and the Chapter II Bellwarden/Chirurgeon were Move 3, so a new company spent its
// first two rounds walking (b1 hand play: 7 of 13 turns reached no target). Move 3 is kept only where the kit pays for
// it: the plate tanks (Knight, Paladin, Guardian, Dread Knight, Blacksmith) hold ground, shield their neighbours
// (Bulwark Advance, Cover, Menacing Advance) and are the bodies the line forms on, plus the heavy monsters.
// Raw class table. hp/mp/atk/def/mag/res/spd/eva are tier letters resolved below. `packed` = a sprite sheet exists in src/units/roster.js.
const RAW = {
  footman:    { name: 'Footman',     role: 'Generalist',  hp: 'M', mp: 'L', atk: 'M', def: 'M', mag: 'L', res: 'L', spd: 'M', eva: 'M', move: 4, jump: 2, brv: 65, weapon: 'sword',
               abilities: ['attack', 'focus', 'yell', 'sling_stone', 'first_aid', 'opener'], reaction: 'counter_tackle', support: 'jp_boost', movement: 'move_plus1', packed: true },
  apothecary:   { name: 'Apothecary',    role: 'Support',     hp: 'L', mp: 'L', atk: 'L', def: 'L', mag: 'M', res: 'M', spd: 'M', eva: 'M', move: 4, jump: 2, brv: 60, weapon: 'gun',
               abilities: ['attack', 'potion', 'greater_potion', 'ember_plume', 'remedy', 'mana_tonic'], reaction: 'reflex_tonic', support: 'throw_item', movement: 'scavenger', packed: true,
               items: { potion: 3, greater_potion: 1, ember_plume: 2, remedy: 1, mana_tonic: 1 } },
  knight:    { name: 'Knight',     role: 'Tank',        hp: 'H', mp: 'L', atk: 'H', def: 'H', mag: 'L', res: 'L', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 75, weapon: 'sword', shield: true,
               abilities: ['attack', 'rend_armor', 'rend_weapon', 'rend_speed', 'shield_bash', 'cross_cut'], reaction: 'parry', support: 'equip_heavy', movement: 'bulwark_advance', packed: true },
  archer:    { name: 'Archer',     role: 'Ranged DPS',  hp: 'M', mp: 'L', atk: 'M', def: 'L', mag: 'L', res: 'L', spd: 'H', eva: 'M', move: 4, jump: 3, brv: 60, weapon: 'bow',
               abilities: ['attack', 'aim', 'focused_shot', 'leg_shot', 'arm_shot', 'pierce_line', 'quad_shot'], reaction: 'deflect_arrows', support: 'concentrate', movement: 'jump_plus2', packed: true },
  monk:      { name: 'Monk',       role: 'Brawler',     hp: 'H', mp: 'L', atk: 'H', def: 'M', mag: 'L', res: 'L', spd: 'M', eva: 'M', move: 4, jump: 3, brv: 70, weapon: 'fists',
               abilities: ['attack', 'ki_burst', 'ground_rend', 'inner_calm', 'revive', 'whirl_fist', 'tri_strike', 'blood_fury'], reaction: 'counter', support: 'martial_arts', movement: 'fleet_foot', packed: true },
  cleric: { name: 'Cleric', role: 'Healer',      hp: 'L', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'H', spd: 'M', eva: 'L', move: 4, jump: 2, brv: 55, weapon: 'staff',
               abilities: ['attack', 'cure', 'mending_light', 'raise', 'protect', 'purify', 'holy', 'halo_mend', 'mass_raise'], reaction: 'regenerate', support: 'healing_boost', movement: 'pilgrims_step', packed: true },
  sorcerer: { name: 'Sorcerer', role: 'Magic DPS',   hp: 'L', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'M', spd: 'L', eva: 'L', move: 4, jump: 2, brv: 55, weapon: 'rod',
               abilities: ['attack', 'fire', 'blizzard', 'thunder', 'blaze', 'poison', 'flare', 'chain_bolt', 'emberfall'], reaction: 'magic_counter', support: 'arcane_focus', movement: 'move_mp_up', packed: true },
  chronomancer:  { name: 'Chronomancer',  role: 'Control',     hp: 'L', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'M', spd: 'H', eva: 'L', move: 4, jump: 2, brv: 55, weapon: 'staff',
               abilities: ['attack', 'haste', 'slow', 'stop', 'quick', 'gravity', 'clock_hit', 'ct_swap'], reaction: 'mana_shield', support: 'short_charge', movement: 'teleport', packed: true },
  thief:     { name: 'Thief',      role: 'Utility',     hp: 'M', mp: 'L', atk: 'M', def: 'L', mag: 'L', res: 'L', spd: 'H', eva: 'H', move: 5, jump: 3, brv: 60, weapon: 'dagger',
               abilities: ['attack', 'steal_weapon', 'pilfer', 'beguile', 'dash_thrust', 'phantom_cut'], reaction: 'caution', support: 'nimble', movement: 'move_plus2', packed: true },
  earthshaper: { name: 'Earthshaper',  role: 'Terrain DPS', hp: 'M', mp: 'M', atk: 'M', def: 'M', mag: 'M', res: 'M', spd: 'M', eva: 'M', move: 4, jump: 3, brv: 65, weapon: 'sword',
               abilities: ['attack', 'earthsong', 'cataclysm', 'tremor', 'wildfire', 'tide_pull'], reaction: 'tidal_retort', support: 'natures_blessing', movement: 'terrain_walker', packed: true },
  wyrmlancer:   { name: 'Wyrmlancer',    role: 'Mobile DPS',  hp: 'H', mp: 'L', atk: 'H', def: 'H', mag: 'L', res: 'L', spd: 'M', eva: 'L', move: 4, jump: 4, brv: 70, weapon: 'spear',
               abilities: ['attack', 'jump', 'leech_lance', 'fire_breath', 'wyrmkiller'], reaction: 'dragonheart', support: 'equip_spears', movement: 'ignore_height', packed: true },
  ninja:     { name: 'Ninja',      role: 'Fast DPS',    hp: 'M', mp: 'L', atk: 'H', def: 'L', mag: 'L', res: 'L', spd: 'H', eva: 'H', move: 4, jump: 4, brv: 60, weapon: 'dagger',
               abilities: ['attack', 'throw', 'fire_veil', 'earth_veil', 'unspell', 'vanish', 'shadow_step'], reaction: 'shadowstep', support: 'dual_wield', movement: 'shinobi_stride', packed: true },
  blademaster:   { name: 'Blademaster',    role: 'Hybrid',      hp: 'H', mp: 'M', atk: 'H', def: 'M', mag: 'M', res: 'M', spd: 'L', eva: 'L', move: 4, jump: 2, brv: 70, weapon: 'katana',
               abilities: ['attack', 'wrath_draw', 'rain_blade', 'blade_veil', 'night_edge', 'rank_break'], reaction: 'blade_catch', support: 'doublehand', movement: 'unyielding_step', packed: true },
  conjurer:  { name: 'Conjurer',   role: 'AoE Magic',   hp: 'L', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'M', spd: 'L', eva: 'L', move: 4, jump: 2, brv: 55, weapon: 'rod',
               abilities: ['attack', 'pyrelord', 'frost_maiden', 'storm_elder', 'hearthling', 'gemfox', 'wyrm_sovereign', 'comet_fall'], reaction: 'mp_restore', support: 'half_mp', movement: 'float_move', packed: true },
  mystic:    { name: 'Mystic',     role: 'Debuffer',    hp: 'L', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'M', spd: 'M', eva: 'L', move: 4, jump: 2, brv: 55, weapon: 'staff',
               abilities: ['attack', 'blind', 'silence', 'sleep', 'life_drain', 'dispel', 'mind_spike'], reaction: 'absorb_mp', support: 'defense_boost', movement: 'spirit_walk', packed: true },
  paladin:   { name: 'Paladin',    role: 'Holy Tank',   hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'M', res: 'M', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 75, weapon: 'sword', shield: true,
               abilities: ['attack', 'nurse', 'cover', 'holy_blade', 'saint_cross', 'holy_cross', 'verdict'], reaction: 'guardian', support: 'equip_shields', movement: 'heavy_stride', packed: true },
  // R12 HERO JOB. Aldric's own job, held by no one else (progression.HERO_JOBS): a Knight who swore the Ember Oath at
  // Hollin. The Knight chassis with the two things that kept Aldric the company's weakest damage dealer through R11
  // (dmg 30-89 a battle in campaignsim, below every other front-liner) taken off it: SPD L (he acted ~2/3 as often as
  // the Wyrmlancer and arrived after fights were decided) and a kit of x0.5 rends. SPD M, MOVE 4, MAG M for the fire in
  // his sword, and a free signature so he never spends a turn waiting on MP. No art of its own: it wears the knight
  // sheet (`spriteOf`), so the units item never sees a new roster key.
  oathknight: { name: 'Oathknight', role: 'Vanguard', hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'M', res: 'M', spd: 'M', eva: 'L', move: 4, jump: 2, brv: 75, weapon: 'sword', shield: true,
               abilities: ['attack', 'oathfire', 'oath_charge', 'rallying_oath', 'cinder_arc', 'unbroken_oath'], reaction: 'counter', support: 'fortify', movement: 'vanguard', packed: true, hero: true, spriteOf: 'knight' },
  battlemage:   { name: 'Battlemage',   role: 'Hybrid Caster', hp: 'M', mp: 'M', atk: 'M', def: 'M', mag: 'M', res: 'M', spd: 'M', eva: 'M', move: 4, jump: 2, brv: 60, weapon: 'rapier',
               abilities: ['attack', 'rm_fire', 'rm_blizzard', 'rm_thunder', 'rm_cure', 'rm_sleep', 'barrier', 'chain_frost', 'duelist'], reaction: 'riposte', support: 'doublecast', movement: 'runners_grace', packed: true },
  beastsage:  { name: 'Beastsage',  role: 'Adaptive',    hp: 'M', mp: 'M', atk: 'M', def: 'M', mag: 'M', res: 'M', spd: 'M', eva: 'M', move: 4, jump: 2, brv: 65, weapon: 'sword',
               abilities: ['attack', 'brute_jab', 'stalwart_ward', 'soothing_gale', 'rancid_breath', 'soul_trade'], reaction: 'bestial_instinct', support: 'learn', movement: 'beast_path', packed: true },
  gunner:    { name: 'Gunner',     role: 'Range Status', hp: 'L', mp: 'L', atk: 'M', def: 'L', mag: 'L', res: 'L', spd: 'M', eva: 'M', move: 4, jump: 2, brv: 60, weapon: 'gun',
               abilities: ['attack', 'fireshot', 'boltshot', 'iceshot', 'stopshot', 'blindshot', 'chargeshot', 'ember_lance'], reaction: 'return_fire', support: 'eye_for_distance', movement: 'gunslingers_perch', packed: true },
  // Balance pass: mp L -> M, the same diagnosis as the Guardian. Every one of the Juggler's six cards costs MP
  // (6-12 each) against a 24 MP pool that starts half full, so the bottom class of the roster (37.9%) got two or
  // three actions a battle out of a kit built on volume. Nothing about a trickster is in the pool size.
  juggler:   { name: 'Juggler',    role: 'Trickster',   hp: 'L', mp: 'M', atk: 'M', def: 'L', mag: 'M', res: 'M', spd: 'H', eva: 'H', move: 4, jump: 3, brv: 60, weapon: 'dagger',
               abilities: ['attack', 'ring', 'dagger_throw', 'firebomb', 'ball', 'smile', 'file_break'], reaction: 'catch', support: 'trickster', movement: 'acrobat', packed: true },
  assassin:  { name: 'Assassin',   role: 'Striker',     hp: 'L', mp: 'M', atk: 'H', def: 'L', mag: 'M', res: 'L', spd: 'H', eva: 'H', move: 4, jump: 3, brv: 60, weapon: 'katana',
               abilities: ['attack', 'shadowbind', 'nightmare', 'mute_needle', 'chill_needle', 'ruin_strike', 'execute', 'backlash'], reaction: 'reflex', support: 'assassinate', movement: 'shadow_step', packed: true },
  // Balance pass: mp L -> M. Third class with the same shape as the Guardian and the Juggler, and the pattern is
  // measurable across the roster: an mp-L class whose kit has a FREE core (Archer's Aim, Hunter's Longshot, Ninja's
  // Throw, Wyrmlancer's Jump, Monk's Inner Calm) sits at 48-62%, and an mp-L class where EVERY option is paid (Guardian,
  // Juggler, Dread Knight) sat at 38-39%. The Dread Knight's five cards cost 4/6/12/15/0 against a 24 MP pool.
  dreadknight: { name: 'Dread Knight', role: 'Debuff Tank', hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'L', res: 'L', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 75, weapon: 'sword',
               abilities: ['attack', 'fearful_impact', 'dread_strike', 'soul_reave', 'intimidate', 'siphon_arc'], reaction: 'frightful_presence', support: 'fortify', movement: 'menacing_advance', packed: true },
  runesword: { name: 'Runesword', role: 'Magic Sword', hp: 'M', mp: 'M', atk: 'M', def: 'M', mag: 'M', res: 'M', spd: 'M', eva: 'M', move: 4, jump: 3, brv: 65, weapon: 'spear', shield: true,
               abilities: ['attack', 'spellstrike', 'rune_shield', 'rf_heal', 'rf_fire', 'rf_ice', 'rf_lightning', 'pack_tactics', 'lodestone'], reaction: 'spell_ward', support: 'rampart_aura', movement: 'vanguard', packed: true },
  warlock:   { name: 'Warlock',    role: 'Dark Debuff', hp: 'L', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'M', spd: 'L', eva: 'L', move: 4, jump: 2, brv: 55, weapon: 'rod',
               abilities: ['attack', 'word_of_pain', 'meditate', 'curse', 'charm_spell', 'hex'], reaction: 'malediction', support: 'arcane_reservoir', movement: 'fell_approach', packed: true },
  // Ported from the prototype. Stat letters are the prototype's raw numbers put back through the tier cut points these tables imply
  // (hp L<28/M28-35/H>=36, mp L<12/M12-19/H>=20, atk L<7/M7-9/H>=10, def L<=4/M5/H>=6, mag L<6/M6-9/H>=10,
  // res L<5/M5-7/H>=8, spd L<7/M7-8/H>=9, eva L<10/M10-14/H>=15). MOVE and BRV carry over 1:1; JUMP does not —
  // the prototype hands out 2-5 where this roster runs 1-4, so JUMP is set from the neighbour that shares the class's build.
  // Balance pass: mp L -> M, and MOVE 4 dropped off the Hunter above. A 24 MP pool bought the Guardian two casts a
  // battle out of a four-ability list that is entirely MP, which is why it sat at 38% while taking the least damage
  // per death of any front-liner: it survived and did nothing. Nothing about the bulwark identity is in the pool.
  guardian:  { name: 'Guardian',   role: 'Bulwark',     hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'L', res: 'M', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 75, weapon: 'sword', shield: true,
               // the prototype's Tower Shield is not a weapon here: `shield: true` is what pays it (DEF +2, EVA +5 in stat()).
               abilities: ['attack', 'fearful_impact', 'last_stand', 'protect', 'shock_ring'], reaction: 'aegis', support: 'defense_boost', movement: 'unyielding_step', packed: true },
  // Balance pass: atk H -> M. The Hunter shipped at 72.8% win / 400 dmg per game over 1,800 battles, 15 points
  // clear of the next class, and the surplus was raw swing, not reach: it kept MOVE 6, a 7-tile Tracker reach and
  // SPD H while ALSO hitting harder than every melee class. M is the Archer's tier — the skirmisher out-ranges and
  // out-runs the bowman, it does not also out-hit him.
  hunter:    { name: 'Hunter',     role: 'Skirmisher',  hp: 'M', mp: 'L', atk: 'M', def: 'L', mag: 'L', res: 'L', spd: 'H', eva: 'M', move: 4, jump: 3, brv: 65, weapon: 'bow',
               abilities: ['attack', 'longshot', 'twin_shot', 'leg_shot', 'railshot', 'opening_gambit', 'scatter'], reaction: 'reflex', support: 'tracker', movement: 'move_plus1', packed: true },
  blacksmith:{ name: 'Blacksmith', role: 'Forge Support', hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'M', res: 'M', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 75, weapon: 'hammer',
               abilities: ['attack', 'temper_blade', 'ward_plate', 'quench', 'slag_shot', 'armor_pierce', 'forge_hammer'], reaction: 'caution', support: 'healing_boost', movement: 'heavy_stride', packed: true, resist: ['fire'] },
  necromancer:{ name: 'Necromancer', role: 'Undead Caster', hp: 'L', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'H', spd: 'M', eva: 'L', move: 4, jump: 2, brv: 55, weapon: 'staff',
               // Fell Approach is the kit's engine: it poisons everything the necromancer walks past, which is what
               // arms a Zombie ally's Salt the Wound. Absorbs dark like the undead it raises, and burns for holy.
               abilities: ['attack', 'grave_bolt', 'animate_dead', 'mana_burn', 'life_drain', 'curse', 'dread_touch'], reaction: 'malediction', support: 'arcane_reservoir', movement: 'fell_approach', packed: true,
               absorb: ['dark'], weak: ['holy'] },
  // Monsters (team B roster). Elemental affinities follow the genre conventions.
  // Balance pass: wyrm hpMul 1.45 -> 1.35 (217 -> 202 HP), same argument the Behemoth pass used —
  // a 62% win / 19-deaths-per-42-games body anchoring the shipped default roster's B side, while the
  // default matchup's A side sat at 33% over 200 seeds (band floor 35). Zombie 1.45 (174 HP vs the
  // Skeleton's 195) is untouched: that ratio is the port spec.
  skeleton:  { name: 'Skeleton',   role: 'Undead',      hp: 'H', mp: 'L', atk: 'H', def: 'H', mag: 'L', res: 'L', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 70, weapon: 'sword', monster: true, packed: true,
               abilities: ['attack', 'bone_throw', 'dread_touch'], reaction: 'counter', support: 'undead', movement: 'move_plus1', absorb: ['dark'], weak: ['fire', 'holy'], immune: ['poison'], hpMul: 1.3 },
  wyrm:      { name: 'Wyrm',       role: 'Dragon',      hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'M', res: 'M', spd: 'L', eva: 'L', move: 4, jump: 3, brv: 80, weapon: 'fang', monster: true, packed: true, dragon: true,
               abilities: ['attack', 'fire_breath', 'tail_sweep', 'frost_line'], reaction: 'dragonheart', support: 'fortify', movement: 'ignore_height', absorb: ['fire'], weak: ['ice'], hpMul: 1.35, atkMul: 1.2 },
  cockatrice:{ name: 'Cockatrice', role: 'Beast',       hp: 'M', mp: 'L', atk: 'M', def: 'L', mag: 'L', res: 'L', spd: 'H', eva: 'H', move: 5, jump: 5, brv: 60, weapon: 'claw', monster: true, packed: true,
               abilities: ['attack', 'shriek', 'feather_dart'], reaction: 'reflex', support: 'nimble', movement: 'acrobat', weak: ['thunder'], resist: ['earth'] },
  ghost:     { name: 'Ghost',      role: 'Undead',      hp: 'M', mp: 'H', atk: 'L', def: 'L', mag: 'H', res: 'H', spd: 'M', eva: 'H', move: 4, jump: 2, brv: 65, weapon: 'claw', monster: true, packed: true,
               abilities: ['attack', 'dread_touch', 'life_drain', 'swap'], reaction: 'absorb_mp', support: 'undead', movement: 'float_move', absorb: ['dark'], weak: ['holy', 'fire'], immune: ['poison'] },
  werewolf:  { name: 'Werewolf',   role: 'Beast',       hp: 'H', mp: 'L', atk: 'H', def: 'M', mag: 'L', res: 'L', spd: 'H', eva: 'M', move: 5, jump: 4, brv: 75, weapon: 'claw', monster: true, packed: true,
               abilities: ['attack', 'rend_claw', 'howl'], reaction: 'counter', support: 'martial_arts', movement: 'acrobat', hpMul: 1.15 },
  // Balance pass: hp M -> H, def L -> M. The Ash Hound was the worst unit in the game at 34.9% and 5% survival —
  // a two-ability chaser with a caster's armour that reached the enemy line one turn early and died there. It is
  // still the lesser beast (the Werewolf keeps atk H, a third ability and its own hpMul), just no longer free JP.
  hound:     { name: 'Ash Hound',  role: 'Beast',       hp: 'H', mp: 'L', atk: 'M', def: 'M', mag: 'L', res: 'L', spd: 'H', eva: 'M', move: 5, jump: 3, brv: 70, weapon: 'fang', monster: true, packed: true,
               abilities: ['attack', 'rend_claw'], reaction: 'counter', support: 'nimble', movement: 'move_plus1', resist: ['fire'] },
  // MOVE 2 with SPD L meant the Treant reached the fight after it was decided (38%, 231 damage taken a game); MOVE 3
  // is still the slowest walk on the board. JUMP stays at 1: it is the ONLY JUMP-1 row in the live roster, and
  // tools/mapcheck.mjs's parity sweep uses it to cover the 2h tier (raising it to 2 trades a within-noise +2.6% for
  // a `parity.no-probe` warning on every map).
  treant:    { name: 'Treant',     role: 'Bulwark',     hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'M', res: 'M', spd: 'L', eva: 'L', move: 3, jump: 1, brv: 80, weapon: 'claw', monster: true, packed: true,
               abilities: ['attack', 'tail_sweep', 'root_snare', 'rescue_swap'], reaction: 'counter', support: 'fortify', movement: 'terrain_walker', weak: ['fire'], resist: ['water', 'earth'], hpMul: 1.5 },
  // Balance pass: atk M -> H alongside the def M -> H below. The Zombie stayed the roster's floor (37%) after both
  // earlier passes because it is slow (SPD L, MOVE 3), carries TWO elemental weaknesses and hit for 69 damage a
  // game. ATK H is the Skeleton's tier; the Zombie is still the lesser undead on 174 HP against the Skeleton's 195.
  zombie:    { name: 'Zombie',     role: 'Raised Dead', hp: 'M', mp: 'L', atk: 'H', def: 'H', mag: 'L', res: 'L', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 50, weapon: 'claw', monster: true, packed: true,
               // hpMul is not decoration: the prototype puts the zombie at 0.94 of a skeleton, and a literal hp:'M' against
               // this tree's hpMul-inflated monsters lands it at 0.62. 1.45 restores 174 HP, 0.89 of the skeleton.
               // Balance pass: def M -> H and reaction counter -> malediction. The Zombie ate 240 damage a game, more
               // than anything without a dragon's hpMul, and its signature Salt the Wound fired 57 times in 1,800
               // battles because NOTHING on its own side reliably poisons. Malediction poisons whoever melees it —
               // and at 240 damage taken a game that is the most-triggered reaction slot on the board — so the
               // exploit arms itself off the one thing the Zombie is guaranteed to do: get hit.
               abilities: ['attack', 'rend_claw', 'dread_touch', 'salt_wound'], reaction: 'malediction', support: 'undead', movement: 'move_plus1', absorb: ['dark'], weak: ['fire', 'holy'], immune: ['poison'], hpMul: 1.45 },
  behemoth:  { name: 'Behemoth',   role: 'Brute',       hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'M', res: 'M', spd: 'M', eva: 'L', move: 4, jump: 3, brv: 80, weapon: 'claw', monster: true, packed: true,
               // hpMul 1.5 -> 1.38 (225 -> 207 HP): the Behemoth topped the roster at 67.6% while absorbing 380 damage a
               // game, which is a boss's stat line inside a pool the sim drafts five at a time. Still the largest
               // body on the board — the Treant's 1.5 stays, because a Treant cannot chase anything.
               abilities: ['attack', 'fire_breath', 'tail_sweep', 'rend_claw', 'blood_pact'], reaction: 'dragonheart', support: 'fortify', movement: 'ignore_height', absorb: ['fire'], weak: ['ice'], hpMul: 1.38, atkMul: 1.15 },
  // ---- Chapter II (content owner). `campaign: true` keeps these out of PACKED_CLASSES, so the balance sims' random drafts
  // (sim.mjs roster=packed / randmirror) stay the shipped pool; the campaign fields them by name.
  // BELLWARDEN: the Crown's bell-ringing exorcists, and a job the company can learn once a Cleric has walked with the
  // dead (progression UNLOCKS: Cleric Lv 3 + Mystic Lv 1). A holy caster with a mid-weight body: it rings the bell
  // in melee reach as often as from the back, so HP/DEF M, and its free signature Knell keeps it from waiting on MP.
  bellwarden: { name: 'Bellwarden', role: 'Exorcist', hp: 'M', mp: 'H', atk: 'L', def: 'M', mag: 'H', res: 'H', spd: 'M', eva: 'L', move: 4, jump: 2, brv: 65, weapon: 'staff',
               abilities: ['attack', 'knell', 'vesper', 'toll_of_rest', 'bell_ward', 'great_knell', 'toll_the_dead'], reaction: 'mana_shield', support: 'healing_boost', movement: 'pilgrims_step', packed: true, campaign: true, resist: ['holy'] },
  // Enemy-only human: the Crown's plague-masked field surgeons. No UNLOCKS row, so never a job.
  chirurgeon: { name: 'Chirurgeon', role: 'Field Surgeon', hp: 'M', mp: 'M', atk: 'M', def: 'L', mag: 'M', res: 'M', spd: 'M', eva: 'M', move: 4, jump: 2, brv: 60, weapon: 'dagger',
               abilities: ['attack', 'field_dressing', 'miasma', 'bloodletting', 'purify'], reaction: 'caution', support: 'healing_boost', movement: 'move_plus1', packed: true, campaign: true, immune: ['poison'] },
  wendigo:   { name: 'Wendigo',    role: 'Frost Beast', hp: 'H', mp: 'M', atk: 'H', def: 'M', mag: 'M', res: 'M', spd: 'M', eva: 'M', move: 4, jump: 3, brv: 75, weapon: 'claw', monster: true, packed: true, campaign: true,
               abilities: ['attack', 'rend_claw', 'frost_line', 'rime_roar'], reaction: 'counter', support: 'fortify', movement: 'terrain_walker', absorb: ['ice'], weak: ['fire'], hpMul: 1.3 },
  vampire:   { name: 'Vampire',    role: 'Night Lord',  hp: 'H', mp: 'H', atk: 'M', def: 'M', mag: 'H', res: 'H', spd: 'M', eva: 'M', move: 4, jump: 3, brv: 80, weapon: 'claw', monster: true, packed: true, campaign: true,
               abilities: ['attack', 'blood_kiss', 'grave_bolt', 'charm_spell', 'crimson_rain'], reaction: 'absorb_mp', support: 'arcane_focus', movement: 'float_move', absorb: ['dark'], weak: ['holy'], immune: ['poison'], hpMul: 1.25 },
  gloomhound:{ name: 'Gloom Cerberus', role: 'Brute',   hp: 'H', mp: 'M', atk: 'H', def: 'H', mag: 'M', res: 'M', spd: 'M', eva: 'L', move: 4, jump: 3, brv: 80, weapon: 'fang', monster: true, packed: true, campaign: true,
               abilities: ['attack', 'rend_claw', 'umbral_breath', 'howl'], reaction: 'counter', support: 'fortify', movement: 'ignore_height', absorb: ['dark'], weak: ['holy'], hpMul: 1.35, atkMul: 1.1 },
  colossus:  { name: 'Colossus',   role: 'Titan',       hp: 'H', mp: 'L', atk: 'H', def: 'H', mag: 'L', res: 'M', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 90, weapon: 'claw', monster: true, packed: true, campaign: true,
               abilities: ['attack', 'titan_slam', 'quake_stomp', 'boulder_hurl'], reaction: 'counter', support: 'fortify', movement: 'unyielding_step', resist: ['earth'], weak: ['thunder'], hpMul: 1.9, atkMul: 1.15 },
  ossuary:   { name: 'Ossuary Wheel', role: 'Construct', hp: 'H', mp: 'M', atk: 'M', def: 'H', mag: 'M', res: 'L', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 90, weapon: 'claw', monster: true, packed: true, campaign: true,
               abilities: ['attack', 'bone_throw', 'grave_wheel', 'dread_touch'], reaction: 'counter', support: 'undead', movement: 'move_plus1', absorb: ['dark'], weak: ['holy'], immune: ['poison'], hpMul: 1.4 },
  // The two packed monster sheets that never had a class (roster.js boar / beetle). Siege beasts the foundry harnesses.
  boar:      { name: 'Siege Boar', role: 'Charger',  hp: 'H', mp: 'L', atk: 'H', def: 'H', mag: 'L', res: 'L', spd: 'M', eva: 'L', move: 4, jump: 2, brv: 80, weapon: 'fang', monster: true, packed: true, campaign: true,
               abilities: ['attack', 'gore_charge', 'tusk_toss'], reaction: 'counter', support: 'fortify', movement: 'move_plus1', resist: ['earth'], weak: ['ice'], hpMul: 1.25 },
  beetle:    { name: 'Siegebreaker', role: 'Armour', hp: 'H', mp: 'L', atk: 'M', def: 'H', mag: 'L', res: 'M', spd: 'L', eva: 'L', move: 3, jump: 2, brv: 85, weapon: 'claw', monster: true, packed: true, campaign: true,
               abilities: ['attack', 'horn_ram', 'carapace'], reaction: 'counter', support: 'fortify', movement: 'unyielding_step', resist: ['earth', 'fire'], weak: ['thunder'], hpMul: 1.45 },
};

export const CLASSES = {};
for (const k in RAW) {
  const r = RAW[k]; const c = { id: k, ...r };
  for (const s of ['hp', 'mp', 'atk', 'def', 'mag', 'res', 'spd', 'eva']) c[s] = T[s][r[s]];
  if (r.hpMul) c.hp = Math.round(c.hp * r.hpMul); if (r.atkMul) c.atk = Math.round(c.atk * r.atkMul);
  c.weapon = W[r.weapon]; c.sprite = spriteFor(r.spriteOf || k); const h = heightFor(r.spriteOf || k); if (h) c.height = h;
  c.absorb = r.absorb || []; c.weak = r.weak || []; c.resist = r.resist || []; c.immune = r.immune || [];
  CLASSES[k] = c;
}
// Hero jobs (one named unit's own job) stay out of the random-draft pools the balance sims draw from.
export const PACKED_CLASSES = Object.keys(CLASSES).filter((k) => CLASSES[k].packed && !CLASSES[k].hero && !CLASSES[k].campaign);

// ---- Abilities. kind: phys | mag | heal | buff | debuff | raise | drain | special.
// range: number or 'w' (equipped weapon). area: radius (A0 single tile). ct: charge ticks. mult: weapon multiplier. wp: fixed WP. power: spell power.
// acc: base accuracy; physical hits subtract facing-adjusted EVA (§2.2). status: {id, chance} or list. line: hits every tile in a straight line.
// pierce: {def,res} soak ignored before subtraction. opener: × multiplier against an undamaged target. exploit: {status,mult} × multiplier against a target carrying that status. drainMp: MP torn from the victim to the caster.
// hits: N separate swings, each soaking DEF on its own. execute/blood/duelist/allyBonus: further conditional × multipliers (§5.2). recoil/hpCost: HP the caster pays. ctDmg: CT knocked off the victim's clock.
// trueDamage: ignores DEF/RES and therefore Protect/Shell. falloff: × multiplier off the anchor tile. chain: {jumps,range,falloff} arcs to the nearest further foes. cross/row/column/ring: tile-anchored shapes (see shapeTiles).
// dual: {swap|ctSwap|hpSwap} two unit picks in range (dualTeam: 'foes'|'allies'; Engine.resolve early-out, no hit roll). pull: {radius,steps} drag bodies toward the anchor before the blast. blink/dash/teleportHit: caster relocation resolved before the windup. scatter: victim to a random free adjacent tile.
// Port-spec conversions: minRange (minimum Manhattan distance, targetTiles), heal (flat heal amount, alias of flat; a heal record may also carry only `mult` = the prototype's MAG×mult form), cures (alias of cure).
export const ABILITIES = {
  // ---- Chapter II (content owner) ----
  // Bellwarden (Knells). Knell is the free-ish signature; Toll the Dead is the Crown's answer to a lost fight: every fallen
  // ally in A2 stands back up at 40% (the boss's 'second wave').
  knell:        { name: 'Knell', kind: 'mag', mp: 6, range: 4, area: 1, power: 7, acc: 100, element: 'holy', vfx: 'holy', pose: 'cast', desc: 'SP 7 holy, A1' },
  vesper:       { name: 'Vesper', kind: 'heal', mp: 10, range: 3, area: 1, power: 9, allyOnly: true, vfx: 'cure', pose: 'cast', desc: 'SP 9 heal to allies, A1' },
  toll_of_rest: { name: 'Toll of Rest', kind: 'debuff', mp: 10, range: 4, area: 1, acc: 60, ct: 2, status: 'sleep', vfx: 'debuff', pose: 'cast', desc: 'Sleep 60%, A1' },
  bell_ward:    { name: 'Bell Ward', kind: 'buff', mp: 10, range: 3, area: 1, status: 'shell', ct: 1, ally: true, vfx: 'buff', pose: 'cast', desc: 'RES +33% for 3 turns, A1' },
  great_knell:  { name: 'Great Knell', kind: 'mag', mp: 22, range: 4, area: 2, power: 11, acc: 100, ct: 4, element: 'holy', vfx: 'holy', pose: 'cast', desc: 'SP 11 holy, A2' },
  toll_the_dead:{ name: 'Toll the Dead', kind: 'raise', mp: 24, range: 3, area: 2, pct: 0.4, ct: 3, ally: true, vfx: 'holy', pose: 'cast', desc: 'Every fallen ally in A2 rises at 40% HP' },
  // Chirurgeon
  field_dressing:{ name: 'Field Dressing', kind: 'heal', mp: 6, range: 3, area: 0, power: 9, ally: true, vfx: 'cure', pose: 'cast', desc: 'SP 9 heal' },
  miasma:       { name: 'Miasma', kind: 'mag', mp: 10, range: 4, area: 1, power: 5, acc: 100, status: { id: 'poison', chance: 70 }, vfx: 'debuff', pose: 'cast', desc: 'SP 5 + Poison 70%, A1' },
  bloodletting: { name: 'Bloodletting', kind: 'phys', mp: 5, range: 1, area: 0, mult: 1.0, exploit: { status: 'poison', mult: 1.6 }, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack', desc: 'WP x1.6 against a poisoned foe' },
  // Chapter II monsters
  rime_roar:    { name: 'Rime Roar', kind: 'debuff', mp: 8, range: 0, area: 2, acc: 55, enemyOnly: true, status: 'slow', vfx: 'ice', pose: 'cast', desc: 'Slow nearby enemies, 55%' },
  blood_kiss:   { name: 'Blood Kiss', kind: 'mag', mp: 4, range: 1, area: 0, power: 10, acc: 100, element: 'dark', drain: 1.0, vfx: 'debuff', pose: 'attack', desc: 'SP 10 dark, drains what it deals' },
  crimson_rain: { name: 'Crimson Rain', kind: 'mag', mp: 20, range: 4, area: 2, power: 10, acc: 100, ct: 3, element: 'dark', enemyOnly: true, vfx: 'debuff', pose: 'cast', desc: 'SP 10 dark to enemies, A2' },
  umbral_breath:{ name: 'Umbral Breath', kind: 'mag', mp: 12, range: 4, area: 0, line: 4, power: 9, acc: 100, element: 'dark', status: { id: 'blind', chance: 40 }, vfx: 'debuff', pose: 'cast', desc: 'SP 9 dark, line 4 + Blind 40%' },
  titan_slam:   { name: 'Titan Slam', kind: 'phys', mp: 0, range: 1, area: 0, mult: 1.5, acc: 100, weaponHit: true, knockback: 1, vfx: 'bash', pose: 'attack', desc: 'WP x1.5 + knockback' },
  quake_stomp:  { name: 'Quake Stomp', kind: 'phys', mp: 8, range: 0, area: 2, mult: 0.8, acc: 100, enemyOnly: true, element: 'earth', vfx: 'quake', pose: 'attack2', desc: 'WP x0.8 earth to every enemy in A2' },
  boulder_hurl: { name: 'Boulder Hurl', kind: 'phys', mp: 6, range: 4, minRange: 2, area: 0, wp: 8, acc: 100, ranged: true, thrown: true, vfx: 'stone', pose: 'attack2', desc: 'WP 8 ranged, R2-4' },
  grave_wheel:  { name: 'Grave Wheel', kind: 'phys', mp: 6, range: 3, area: 0, line: 3, mult: 1.1, acc: 100, vfx: 'bash', pose: 'attack', desc: 'WP x1.1, rolls down a line of 3' },
  gore_charge:  { name: 'Gore Charge', kind: 'phys', mp: 0, range: 4, area: 0, mult: 1.2, acc: 100, weaponHit: true, dash: true, vfx: 'bash', pose: 'attack', desc: 'Charge adjacent, WP x1.2' },
  tusk_toss:    { name: 'Tusk Toss', kind: 'phys', mp: 4, range: 1, area: 0, mult: 1.0, acc: 100, weaponHit: true, knockback: 1, ctDmg: 20, vfx: 'bash', pose: 'attack2', desc: 'WP x1.0 + knockback, CT -20' },
  horn_ram:     { name: 'Horn Ram', kind: 'phys', mp: 0, range: 1, area: 0, mult: 1.3, acc: 100, weaponHit: true, pierce: { def: 6 }, vfx: 'bash', pose: 'attack', desc: 'WP x1.3, ignores 6 DEF' },
  carapace:     { name: 'Carapace', kind: 'buff', mp: 6, range: 0, area: 0, self: true, status: 'protect', vfx: 'buff', pose: 'cast', desc: 'Protect self, 3 turns' },
  // basic
  attack:       { name: 'Attack', kind: 'phys', mp: 0, range: 'w', area: 0, mult: 1.0, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack' },
  // Footman
  focus:        { name: 'Focus', kind: 'buff', mp: 0, range: 0, area: 0, self: true, mod: { atkMod: 1 }, vfx: 'buff', pose: 'cast', desc: 'ATK +1 (stacks to +3)' },
  yell:         { name: 'Yell', kind: 'buff', mp: 4, range: 3, area: 0, ally: true, mod: { spdMod: 1 }, vfx: 'buff', pose: 'cast', desc: 'SPD +1 for 3 turns' },
  // 727 casts a run for 9 damage each: WP 3 against the Footman's mid ATK is under a third of its own swing, so the
  // starter class's only ranged option was a way to waste a turn. WP 5 is still the weakest thrown record here.
  sling_stone:  { name: 'Sling Stone', kind: 'phys', mp: 0, range: 4, area: 0, wp: 5, acc: 100, ranged: true, thrown: true, knockback: 1, vfx: 'stone', pose: 'attack2', desc: 'WP 5, knockback 1' },
  first_aid:    { name: 'First Aid', kind: 'heal', mp: 0, range: 1, area: 0, pct: 0.15, cure: ['poison', 'blind'], ally: true, vfx: 'cure', pose: 'cast', desc: 'Heal 15%, cure Poison/Blind' },
  // Apothecary (items; range 1 → 4 with Throw Item)
  potion:       { name: 'Potion', kind: 'heal', mp: 0, range: 1, area: 0, flat: 40, item: true, ally: true, vfx: 'cure', pose: 'cast', desc: 'Heal 40 HP' },
  greater_potion:    { name: 'Greater Potion', kind: 'heal', mp: 0, range: 1, area: 0, flat: 100, item: true, ally: true, vfx: 'cure', pose: 'cast', desc: 'Heal 100 HP' },
  ember_plume: { name: 'Ember Plume', kind: 'raise', mp: 0, range: 1, area: 0, pct: 0.1, item: true, ally: true, vfx: 'cure', pose: 'cast', desc: 'Revive at 10% HP' },
  remedy:       { name: 'Remedy', kind: 'heal', mp: 0, range: 1, area: 0, cureAll: true, item: true, ally: true, vfx: 'cure', pose: 'cast', desc: 'Cure all ailments' },
  mana_tonic:        { name: 'Mana Tonic', kind: 'heal', mp: 0, range: 1, area: 0, mpFlat: 30, item: true, ally: true, vfx: 'buff', pose: 'cast', desc: 'Restore 30 MP' },
  // Knight
  rend_armor:   { name: 'Rend Armor', kind: 'phys', mp: 4, range: 1, area: 0, mult: 0.5, acc: 100, weaponHit: true, mod: { defMod: -3 }, vfx: 'slash', pose: 'attack', desc: 'WP ×0.5, DEF −3' },
  rend_weapon:  { name: 'Rend Weapon', kind: 'phys', mp: 4, range: 1, area: 0, mult: 0.5, acc: 100, weaponHit: true, mod: { atkMod: -3 }, vfx: 'slash', pose: 'attack', desc: 'WP ×0.5, ATK −3' },
  // Rend Armor pays out once per physical ally that can reach the target and costs 4 MP; Speed Rent pays once and
  // cost 8, so the greedy argmax never reached it (27 uses in 1,800). 5 MP.
  rend_speed:   { name: 'Rend Speed', kind: 'phys', mp: 5, range: 1, area: 0, mult: 0.5, acc: 100, weaponHit: true, mod: { spdMod: -2 }, vfx: 'slash', pose: 'attack', desc: 'WP ×0.5, SPD −2' },
  shield_bash:  { name: 'Shield Bash', kind: 'phys', mp: 6, range: 1, area: 0, mult: 1.0, acc: 100, weaponHit: true, knockback: 1, vfx: 'bash', pose: 'attack2', desc: 'WP ×1.0 + knockback' },
  // Archer
  aim:          { name: 'Aim', kind: 'phys', mp: 0, range: 'w', area: 0, mult: 1.5, acc: 100, ct: 2, weaponHit: true, ranged: true, vfx: 'arrow', pose: 'attack', desc: 'WP ×1.5, CT 2' },
  focused_shot: { name: 'Focused Shot', kind: 'phys', mp: 6, range: 'w', area: 0, mult: 2.0, acc: 100, ct: 4, ignoreEva: true, ranged: true, vfx: 'arrow', pose: 'attack', desc: 'WP ×2.0, cannot miss, CT 4' },
  leg_shot:     { name: 'Leg Shot', kind: 'phys', mp: 8, range: 'w', area: 0, mult: 0.8, acc: 100, weaponHit: true, ranged: true, status: { id: 'immobilize', chance: 100, turns: 2 }, vfx: 'arrow', pose: 'attack2', desc: 'WP ×0.8 + Immobilize' },
  arm_shot:     { name: 'Arm Shot', kind: 'phys', mp: 8, range: 'w', area: 0, mult: 0.8, acc: 100, weaponHit: true, ranged: true, status: { id: 'disable', chance: 100, turns: 1 }, vfx: 'arrow', pose: 'attack2', desc: 'WP ×0.8 + Disable' },
  // Monk
  ki_burst:    { name: 'Ki Burst', kind: 'phys', mp: 12, range: 3, area: 0, wp: 6, acc: 100, line: 3, vfx: 'bash', pose: 'cast', desc: 'WP 6, line 3' },
  ground_rend:  { name: 'Ground Rend', kind: 'phys', mp: 16, range: 5, area: 0, wp: 5, acc: 100, line: 5, ground: true, element: 'earth', vfx: 'quake', pose: 'cast', desc: 'WP 5, line 5, ground only' },
  inner_calm:       { name: 'Inner Calm', kind: 'heal', mp: 0, range: 0, area: 1, pct: 0.2, mpPct: 0.1, ally: true, vfx: 'cure', pose: 'cast', desc: 'Heal 20% HP + 10% MP, self + adjacent' },
  revive:       { name: 'Revive', kind: 'raise', mp: 10, range: 1, area: 0, pct: 0.2, ally: true, vfx: 'cure', pose: 'cast', desc: 'Revive at 20% HP' },
  // x0.8 means a sweep that catches ONE enemy is a worse punch than a punch, and the Monk is rarely boxed in by two:
  // 21 casts in 1,800 battles. x1.0 makes it break even on one body and pay on two, which is the shape it wants.
  whirl_fist:    { name: 'Whirl Fist', kind: 'phys', mp: 6, range: 0, area: 1, mult: 1.0, acc: 100, enemyOnly: true, vfx: 'bash', pose: 'attack2', desc: 'WP ×1.0 to adjacent enemies' },
  // Cleric
  cure:         { name: 'Cure', kind: 'heal', mp: 6, range: 4, area: 1, power: 8, ct: 2, vfx: 'cure', pose: 'cast', desc: 'SP 8 heal' },
  mending_light:         { name: 'Mending Light', kind: 'heal', mp: 12, range: 4, area: 2, power: 14, ct: 3, vfx: 'cure', pose: 'cast', desc: 'SP 14 heal' },
  raise:        { name: 'Raise', kind: 'raise', mp: 12, range: 4, area: 0, pct: 0.3, ct: 3, ally: true, vfx: 'cure', pose: 'cast', desc: 'Revive at 30% HP' },
  protect:      { name: 'Protect', kind: 'buff', mp: 8, range: 4, area: 1, status: 'protect', ct: 2, ally: true, vfx: 'buff', pose: 'cast', desc: 'DEF +33% for 3 turns' },
  purify:        { name: 'Purify', kind: 'heal', mp: 10, range: 4, area: 1, cureAll: true, ct: 1, ally: true, vfx: 'cure', pose: 'cast', desc: 'Cure all ailments' },
  holy:         { name: 'Holy', kind: 'mag', mp: 32, range: 4, area: 0, power: 20, acc: 100, ct: 5, element: 'holy', vfx: 'holy', pose: 'cast', desc: 'SP 20 holy' },
  // Sorcerer
  fire:         { name: 'Fire', kind: 'mag', mp: 8, range: 4, area: 1, power: 10, acc: 100, ct: 2, element: 'fire', vfx: 'fire', pose: 'cast', desc: 'SP 10 fire' },
  blizzard:     { name: 'Blizzard', kind: 'mag', mp: 8, range: 4, area: 1, power: 10, acc: 100, ct: 2, element: 'ice', vfx: 'ice', pose: 'cast', desc: 'SP 10 ice' },
  thunder:      { name: 'Thunder', kind: 'mag', mp: 8, range: 4, area: 1, power: 10, acc: 100, ct: 2, element: 'thunder', vfx: 'thunder', pose: 'cast', desc: 'SP 10 lightning' },
  blaze:         { name: 'Blaze', kind: 'mag', mp: 18, range: 4, area: 2, power: 16, acc: 100, ct: 3, element: 'fire', vfx: 'fire', pose: 'cast', desc: 'SP 16 fire, A2' },
  // 3 casts in 1,800 battles: the Sorcerer owns six direct-damage spells that all out-score a status at equal MP.
  // The Sorcerer is a 62% class, so this is NOT a damage buff — CT 0 and 4 MP turn Poison into the cheap setup
  // card it should be (it is the only thing in the game that arms a Zombie ally's Salt the Wound at range).
  poison:       { name: 'Poison', kind: 'debuff', mp: 4, range: 4, area: 1, acc: 80, ct: 0, status: 'poison', vfx: 'debuff', pose: 'cast', desc: 'Inflict Poison, 80%' },
  flare:        { name: 'Flare', kind: 'mag', mp: 40, range: 4, area: 0, power: 26, acc: 100, ct: 6, vfx: 'fire', pose: 'cast', desc: 'SP 26 non-elemental' },
  // Chronomancer
  haste:        { name: 'Haste', kind: 'buff', mp: 12, range: 4, area: 1, status: 'haste', ct: 3, ally: true, vfx: 'buff', pose: 'cast', desc: 'Haste 3 turns' },
  slow:         { name: 'Slow', kind: 'debuff', mp: 10, range: 4, area: 1, acc: 70, ct: 3, status: 'slow', vfx: 'debuff', pose: 'cast', desc: 'Slow 3 turns, 70%' },
  // CT 4 is the charged-ability discount's cliff (x0.64) stacked on a 55% roll: 26 casts in 1,800 battles for the
  // Chronomancer's signature denial. CT 3 puts it alongside Slow and Haste, which the class casts freely.
  stop:         { name: 'Stop', kind: 'debuff', mp: 14, range: 4, area: 0, acc: 55, ct: 3, status: { id: 'stop', turns: 2 }, vfx: 'debuff', pose: 'cast', desc: 'Stop 2 turns, 55%' },
  quick:        { name: 'Quick', kind: 'special', mp: 26, range: 4, area: 0, ct: 2, ally: true, quick: true, vfx: 'buff', pose: 'cast', desc: "Target's CT → 100" },
  gravity:      { name: 'Gravity', kind: 'mag', mp: 16, range: 4, area: 1, pctDmg: 0.25, acc: 100, ct: 3, vfx: 'debuff', pose: 'cast', desc: '25% of max HP' },
  // Thief
  // The Thief's only real play, and a 45% coin flip on a class that has to stand in melee to make it. 55%.
  steal_weapon: { name: 'Steal Weapon', kind: 'special', mp: 0, range: 1, area: 0, acc: 55, steal: 'weapon', vfx: 'slash', pose: 'attack2', desc: 'Remove weapon, 55%' },
  pilfer:       { name: 'Pilfer', kind: 'special', mp: 6, range: 1, area: 0, acc: 70, pilfer: true, vfx: 'debuff', pose: 'attack2', desc: 'Take one buff, 70%' },
  beguile:  { name: 'Beguile', kind: 'debuff', mp: 8, range: 2, area: 0, acc: 40, status: 'charm', vfx: 'buff', pose: 'cast', desc: 'Charm 1 turn, 40%' },
  // Earthshaper (element + status from the user's tile; resolved in rules)
  earthsong:     { name: 'Earthsong', kind: 'mag', mp: 6, range: 4, area: 1, power: 8, acc: 100, earthsong: true, vfx: 'quake', pose: 'cast', desc: 'SP 9 by terrain' },
  cataclysm:    { name: 'Cataclysm', kind: 'mag', mp: 16, range: 4, area: 2, power: 13, acc: 100, ct: 2, earthsong: true, vfx: 'quake', pose: 'cast', desc: 'SP 14 by terrain, A2' },
  // Wyrmlancer
  jump:         { name: 'Jump', kind: 'phys', mp: 0, range: 4, area: 0, mult: 1.5, acc: 100, ct: 3, weaponHit: true, jumpAttack: true, vfx: 'jump', pose: 'attack', desc: 'Leap; land for WP ×1.5' },
  leech_lance:       { name: 'Leech Lance', kind: 'phys', mp: 8, range: 2, area: 0, mult: 0.8, acc: 100, weaponHit: true, drain: 0.5, vfx: 'slash', pose: 'attack2', desc: 'WP ×0.8, heal 50% dealt' },
  fire_breath:  { name: 'Fire Breath', kind: 'mag', mp: 12, range: 3, area: 0, power: 8, acc: 100, line: 3, element: 'fire', vfx: 'fire', pose: 'cast', desc: 'SP 8 fire, line 3' },
  wyrmkiller:   { name: 'Wyrmkiller', kind: 'phys', mp: 4, range: 2, area: 0, mult: 1.0, dragonMult: 2.0, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack', desc: 'WP ×2 vs dragons' },
  // Ninja
  throw:        { name: 'Throw', kind: 'phys', mp: 0, range: 4, area: 0, wp: 6, acc: 100, ranged: true, thrown: true, vfx: 'shuriken', pose: 'attack2', desc: 'Hurl a blade, WP 6' },
  fire_veil:    { name: 'Fire Veil', kind: 'mag', mp: 10, range: 3, area: 0, power: 8, acc: 100, element: 'fire', status: { id: 'blind', chance: 50 }, vfx: 'fire', pose: 'cast', desc: 'SP 8 fire + Blind 50%' },
  earth_veil:   { name: 'Earth Veil', kind: 'mag', mp: 12, range: 3, area: 0, power: 8, acc: 100, element: 'earth', status: { id: 'slow', chance: 50 }, vfx: 'quake', pose: 'cast', desc: 'SP 8 earth + Slow 50%' },
  unspell:      { name: 'Unspell', kind: 'debuff', mp: 8, range: 3, area: 0, acc: 100, dispel: true, vfx: 'debuff', pose: 'cast', desc: 'Remove all buffs' },
  vanish:       { name: 'Vanish', kind: 'buff', mp: 10, range: 0, area: 0, self: true, status: 'vanish', vfx: 'buff', pose: 'cast', desc: 'Untargetable until acting' },
  // Blademaster (Draw Out: self-centred A2)
  wrath_draw:       { name: 'Wrath Draw', kind: 'mag', mp: 10, range: 0, area: 2, power: 10, acc: 100, enemyOnly: true, vfx: 'slash', pose: 'cast', desc: 'SP 10 to enemies, A2' },
  rain_blade:     { name: 'Rain Blade', kind: 'heal', mp: 12, range: 0, area: 2, power: 10, allyOnly: true, vfx: 'cure', pose: 'cast', desc: 'SP 10 heal allies, A2' },
  blade_veil:     { name: 'Blade Veil', kind: 'buff', mp: 14, range: 0, area: 2, statuses: ['protect', 'shell'], allyOnly: true, vfx: 'buff', pose: 'cast', desc: 'Protect + Shell allies' },
  // 10 casts in 1,800 battles at 112 damage each — the ability works, it was simply never affordable beside Wrath Draw
  // at half the price on the same self-centred A2 footprint. 14 MP of a 40 MP pool.
  night_edge:     { name: 'Night Edge', kind: 'mag', mp: 14, range: 0, area: 2, power: 14, acc: 100, ct: 2, enemyOnly: true, status: { id: 'fear', chance: 50 }, vfx: 'debuff', pose: 'cast', desc: 'SP 14 + Fear 50%' },
  // Oathknight: the Ember Oath (R12 hero job). The signature burns HOLY, not fire: the undead of Lornhill and the Drowned
  // Chapel (and Malquor) are weak to it, and a hero on a fire sword (the Gullwater Emberbrand) still has a free swing the
  // fire-drinkers (Ash-Maw, the Marsh Wyrm) cannot drink. With a fire signature the QA r12 playtest had him out of MP
  // and out of options at Ravenscar: every free attack he owned healed Ash-Maw, and the battle stalled for 58 rounds.
  oathfire:     { name: 'Oathfire', kind: 'phys', mp: 0, range: 'w', area: 0, mult: 1.25, acc: 100, weaponHit: true, element: 'holy', vfx: 'holy', pose: 'attack', desc: 'WP x1.25 holy flame, no MP' },
  oath_charge:  { name: 'Oathbound Charge', kind: 'phys', mp: 6, range: 4, area: 0, mult: 1.2, acc: 100, weaponHit: true, dash: true, vfx: 'slash', pose: 'attack', desc: 'Charge to a foe 4 tiles off, WP x1.2' },
  rallying_oath:{ name: 'Rallying Oath', kind: 'buff', mp: 8, range: 0, area: 2, allyOnly: true, mod: { atkMod: 1 }, vfx: 'buff', pose: 'cast', desc: 'ATK +1 to self and allies, A2' },
  cinder_arc:   { name: 'Cinder Arc', kind: 'phys', mp: 8, range: 0, area: 1, mult: 1.1, acc: 100, enemyOnly: true, element: 'fire', vfx: 'fire', pose: 'attack2', desc: 'WP x1.1 fire to adjacent foes' },
  unbroken_oath:{ name: 'Unbroken Oath', kind: 'phys', mp: 10, range: 1, area: 0, mult: 1.4, blood: 1.6, acc: 100, ignoreEva: true, weaponHit: true, vfx: 'holy', pose: 'attack', desc: 'WP x1.4 (x2.2 under half HP), cannot miss' },
  // Conjurer
  pyrelord:        { name: 'Pyrelord', kind: 'mag', mp: 24, range: 4, area: 2, power: 16, acc: 100, ct: 4, element: 'fire', enemyOnly: true, vfx: 'fire', pose: 'cast', desc: 'SP 16 fire, enemies only' },
  frost_maiden:        { name: 'Frost Maiden', kind: 'mag', mp: 24, range: 4, area: 2, power: 16, acc: 100, ct: 4, element: 'ice', enemyOnly: true, vfx: 'ice', pose: 'cast', desc: 'SP 16 ice, enemies only' },
  storm_elder:        { name: 'Storm Elder', kind: 'mag', mp: 24, range: 4, area: 2, power: 16, acc: 100, ct: 4, element: 'thunder', enemyOnly: true, vfx: 'thunder', pose: 'cast', desc: 'SP 16 lightning, enemies only' },
  hearthling:       { name: 'Hearthling', kind: 'heal', mp: 16, range: 4, area: 2, power: 10, ct: 3, allyOnly: true, vfx: 'cure', pose: 'cast', desc: 'SP 10 heal allies' },
  // SP 28 over an A3 footprint measured 212 damage a cast, the largest number in the game, and with Half MP it is a
  // 30 MP spell on a 64 MP pool: 188 of the Conjurer's 340 damage a game came from this one record. SP 24.
  wyrm_sovereign:      { name: 'Wyrm Sovereign', kind: 'mag', mp: 60, range: 4, area: 3, power: 24, acc: 100, ct: 8, enemyOnly: true, vfx: 'holy', pose: 'cast', desc: 'SP 24, A3, CT 8' },
  // Mystic
  blind:        { name: 'Blind', kind: 'debuff', mp: 6, range: 4, area: 1, acc: 85, ct: 2, status: 'blind', vfx: 'debuff', pose: 'cast', desc: 'Blind 3 turns, 85%' },
  silence:      { name: 'Silence', kind: 'debuff', mp: 8, range: 4, area: 1, acc: 75, ct: 2, status: 'silence', vfx: 'debuff', pose: 'cast', desc: 'Silence 3 turns, 75%' },
  sleep:        { name: 'Sleep', kind: 'debuff', mp: 12, range: 4, area: 1, acc: 65, ct: 3, status: 'sleep', vfx: 'debuff', pose: 'cast', desc: 'Sleep, 65%' },
  life_drain:   { name: 'Life Drain', kind: 'mag', mp: 16, range: 4, area: 0, pctDmg: 0.25, acc: 100, ct: 3, drain: 1.0, vfx: 'debuff', pose: 'cast', desc: 'Drain 25% max HP' },
  dispel:       { name: 'Dispel', kind: 'debuff', mp: 10, range: 4, area: 1, acc: 100, ct: 1, dispel: true, vfx: 'debuff', pose: 'cast', desc: 'Remove all buffs' },
  // Monsters
  bone_throw:   { name: 'Bone Throw', kind: 'phys', mp: 0, range: 3, area: 0, wp: 4, acc: 100, ranged: true, thrown: true, vfx: 'stone', pose: 'attack2', desc: 'WP 4 ranged' },
  dread_touch:  { name: 'Dread Touch', kind: 'mag', mp: 8, range: 1, area: 0, power: 8, acc: 100, element: 'dark', status: { id: 'fear', chance: 50 }, vfx: 'debuff', pose: 'cast', desc: 'SP 8 dark + Fear 50%' },
  tail_sweep:   { name: 'Tail Sweep', kind: 'phys', mp: 0, range: 0, area: 1, mult: 0.8, acc: 100, enemyOnly: true, knockback: 1, vfx: 'bash', pose: 'attack2', desc: 'WP ×0.8 adjacent + knockback' },
  shriek:       { name: 'Shriek', kind: 'debuff', mp: 6, range: 0, area: 2, acc: 70, enemyOnly: true, status: 'blind', vfx: 'debuff', pose: 'cast', desc: 'Blind nearby enemies, 70%' },
  feather_dart: { name: 'Feather Dart', kind: 'phys', mp: 4, range: 3, area: 0, wp: 4, acc: 100, ranged: true, status: { id: 'poison', chance: 40 }, vfx: 'arrow', pose: 'attack2', desc: 'WP 4 + Poison 40%' },
  // Paladin
  nurse:        { name: 'Nurse', kind: 'heal', mp: 8, range: 0, area: 1, pct: 0.2, cure: ['poison', 'blind'], allyOnly: true, vfx: 'cure', pose: 'cast', desc: 'Heal 20% + cure Poison/Blind, A1' },
  cover:        { name: 'Cover', kind: 'buff', mp: 6, range: 0, area: 0, self: true, status: 'cover', vfx: 'buff', pose: 'cast', desc: "Redirect adjacent allies' damage to you" },
  holy_blade:   { name: 'Holy Blade', kind: 'phys', mp: 12, range: 1, area: 0, mult: 1.5, acc: 100, weaponHit: true, element: 'holy', vfx: 'holy', pose: 'attack', desc: 'WP ×1.5 holy' },
  // 9 casts in 1,800: Holy Blade (12 MP) and Holy Cross (15 MP) both out-score it per MP on the same turn. 12 MP.
  saint_cross:  { name: 'Saint Cross', kind: 'mag', mp: 12, range: 0, area: 1, power: 12, acc: 100, element: 'holy', enemyOnly: true, vfx: 'holy', pose: 'cast', desc: 'SP 12 holy to adjacent enemies' },
  // Battlemage (short, cheap versions of the elemental line; Doublecast pairs two CT ≤1 spells)
  rm_fire:      { name: 'Fire', kind: 'mag', mp: 6, range: 4, area: 1, power: 8, acc: 100, ct: 1, element: 'fire', vfx: 'fire', pose: 'cast', desc: 'SP 8 fire' },
  rm_blizzard:  { name: 'Blizzard', kind: 'mag', mp: 6, range: 4, area: 1, power: 8, acc: 100, ct: 1, element: 'ice', vfx: 'ice', pose: 'cast', desc: 'SP 8 ice' },
  rm_thunder:   { name: 'Thunder', kind: 'mag', mp: 6, range: 4, area: 1, power: 8, acc: 100, ct: 1, element: 'thunder', vfx: 'thunder', pose: 'cast', desc: 'SP 8 lightning' },
  rm_cure:      { name: 'Cure', kind: 'heal', mp: 6, range: 4, area: 1, power: 6, ct: 1, vfx: 'cure', pose: 'cast', desc: 'SP 6 heal' },
  // CT 2 locked the Battlemage's Sleep out of Doublecast, which pairs CT <= 1 spells and is the whole reason the rest
  // of this line runs at CT 1. 3 casts in 1,800 battles.
  rm_sleep:     { name: 'Sleep', kind: 'debuff', mp: 8, range: 4, area: 0, acc: 65, ct: 1, status: 'sleep', vfx: 'debuff', pose: 'cast', desc: 'Sleep, 65%' },
  barrier:      { name: 'Barrier', kind: 'buff', mp: 12, range: 3, area: 0, statuses: ['protect', 'shell'], ct: 2, ally: true, vfx: 'buff', pose: 'cast', desc: 'Protect + Shell' },
  // Beastsage
  brute_jab: { name: 'Brute Jab', kind: 'phys', mp: 4, range: 1, area: 0, mult: 1.5, acc: 100, weaponHit: true, vfx: 'bash', pose: 'attack', desc: 'WP ×1.5' },
  stalwart_ward: { name: 'Stalwart Ward', kind: 'buff', mp: 12, range: 0, area: 0, self: true, statuses: ['protect', 'shell'], vfx: 'buff', pose: 'cast', desc: 'Protect + Shell, self' },
  soothing_gale:   { name: 'Soothing Gale', kind: 'heal', mp: 20, range: 0, area: 2, allyOnly: true, vfx: 'cure', pose: 'cast', desc: "Heal allies for the user's current HP" },
  rancid_breath:   { name: 'Rancid Breath', kind: 'debuff', mp: 20, range: 2, area: 1, acc: 100, randomStatuses: 3, statusChance: 50, vfx: 'debuff', pose: 'cast', desc: '3 random ailments, 50% each' },
  // Gunner (gun damage is fixed: it ignores ATK)
  fireshot:     { name: 'Fireshot', kind: 'phys', mp: 6, range: 6, area: 0, fixedDmg: 46, acc: 100, ranged: true, element: 'fire', vfx: 'fire', pose: 'attack', desc: 'Fixed fire damage, R6' },
  boltshot:     { name: 'Boltshot', kind: 'phys', mp: 6, range: 6, area: 0, fixedDmg: 46, acc: 100, ranged: true, element: 'thunder', vfx: 'thunder', pose: 'attack', desc: 'Fixed lightning damage, R6' },
  iceshot:      { name: 'Iceshot', kind: 'phys', mp: 6, range: 6, area: 0, fixedDmg: 46, acc: 100, ranged: true, element: 'ice', vfx: 'ice', pose: 'attack', desc: 'Fixed ice damage, R6' },
  stopshot:     { name: 'Stopshot', kind: 'debuff', mp: 12, range: 6, area: 0, acc: 40, ranged: true, status: { id: 'stop', turns: 1 }, vfx: 'debuff', pose: 'attack2', desc: 'Stop 1 turn, 40%' },
  blindshot:    { name: 'Blindshot', kind: 'debuff', mp: 6, range: 6, area: 0, acc: 70, ranged: true, status: 'blind', vfx: 'debuff', pose: 'attack2', desc: 'Blind, 70%' },
  chargeshot:   { name: 'Chargeshot', kind: 'phys', mp: 4, range: 6, area: 0, mult: 1.5, acc: 100, ct: 2, ranged: true, weaponHit: true, vfx: 'arrow', pose: 'attack', desc: 'WP ×1.5, CT 2' },
  // Juggler (Confuse is not in §2.4 — Ball uses Charm instead)
  ring:         { name: 'Ring', kind: 'debuff', mp: 10, range: 4, area: 0, acc: 45, ranged: true, status: { id: 'stop', turns: 1 }, vfx: 'debuff', pose: 'attack2', desc: 'Stop 1 turn, 45%' },
  dagger_throw: { name: 'Dagger', kind: 'phys', mp: 6, range: 4, area: 0, mult: 0.8, acc: 100, ranged: true, thrown: true, weaponHit: true, status: { id: 'immobilize', chance: 60 }, vfx: 'shuriken', pose: 'attack2', desc: 'WP ×0.8 + Immobilize 60%' },
  firebomb:     { name: 'Firebomb', kind: 'mag', mp: 12, range: 4, area: 1, power: 8, acc: 100, element: 'fire', vfx: 'fire', pose: 'attack2', desc: 'SP 8 fire, A1' },
  ball:         { name: 'Ball', kind: 'debuff', mp: 10, range: 4, area: 0, acc: 50, ranged: true, status: 'charm', vfx: 'debuff', pose: 'attack2', desc: 'Charm 1 turn, 50%' },
  // 24 MP is the Juggler's ENTIRE pool (mp L), and units start at 50% and regain 10% a turn, so Smile was legal on
  // about turn nine of a ten-round battle: 6 casts in 1,800 battles. 12 MP makes it a real tempo card twice a fight.
  smile:        { name: 'Smile', kind: 'special', mp: 12, range: 3, area: 0, ct: 2, ally: true, quick: true, vfx: 'buff', pose: 'cast', desc: "Ally's CT → 100" },
  // Assassin
  shadowbind:   { name: 'Shadowbind', kind: 'debuff', mp: 12, range: 4, area: 0, acc: 50, ct: 0, status: { id: 'stop', turns: 2 }, vfx: 'debuff', pose: 'cast', desc: 'Stop 2 turns, 50%' },
  nightmare:    { name: 'Nightmare', kind: 'debuff', mp: 16, range: 4, area: 0, acc: 55, statuses: ['sleep', 'poison'], vfx: 'debuff', pose: 'cast', desc: 'Sleep + Poison, 55%' },
  mute_needle:      { name: 'Mute Needle', kind: 'debuff', mp: 8, range: 4, area: 0, acc: 75, status: 'silence', vfx: 'debuff', pose: 'cast', desc: 'Silence, 75%' },
  chill_needle:         { name: 'Chill Needle', kind: 'phys', mp: 10, range: 1, area: 0, mult: 0.6, acc: 100, weaponHit: true, status: 'slow', vfx: 'slash', pose: 'attack2', desc: 'WP ×0.6 + Slow' },
  // Same trap as Smile: 40 MP is the Assassin's whole pool (mp M), so the class's capstone fired 6 times in 1,800
  // battles. 24 MP still costs three turns of regen and is by some way the dearest thing in the kit.
  ruin_strike:{ name: 'Ruin Strike', kind: 'phys', mp: 24, range: 1, area: 0, mult: 2.5, acc: 100, ct: 4, weaponHit: true, vfx: 'holy', pose: 'attack', desc: 'WP ×2.5, CT 4' },
  // Dread Knight
  // The Dread Knight's title card, 16 uses in 1,800 battles even after Fear was repriced: a self-centred A1 only
  // pays with two enemies on you, and at 8 MP of a 24 MP pool it had to pay big. 4 MP.
  fearful_impact:{ name: 'Fearful Impact', kind: 'debuff', mp: 4, range: 0, area: 1, acc: 80, enemyOnly: true, status: 'fear', vfx: 'debuff', pose: 'cast', desc: 'Fear to adjacent enemies, 80%' },
  dread_strike: { name: 'Dread Strike', kind: 'phys', mp: 6, range: 1, area: 0, mult: 1.0, acc: 100, weaponHit: true, status: { id: 'fear', chance: 60 }, vfx: 'slash', pose: 'attack', desc: 'WP ×1.0 + Fear 60%' },
  soul_reave:   { name: 'Soul Reave', kind: 'phys', mp: 12, range: 1, area: 0, mult: 1.2, acc: 100, weaponHit: true, element: 'dark', drain: 0.5, vfx: 'slash', pose: 'attack', desc: 'WP ×1.2 dark, heal 50% dealt' },
  intimidate:   { name: 'Intimidate', kind: 'buff', mp: 0, range: 0, area: 0, self: true, status: 'intimidate', vfx: 'debuff', pose: 'cast', desc: 'Aura: adjacent enemies lose ATK (stack 3)' },
  // Runesword
  spellstrike:  { name: 'Spellstrike', kind: 'phys', mp: 6, range: 'w', area: 0, mult: 1.0, acc: 100, weaponHit: true, bonusPower: 4, element: 'fire', vfx: 'fire', pose: 'attack', desc: 'WP ×1.0 + SP 4 rune damage' },
  rune_shield:  { name: 'Rune Shield', kind: 'buff', mp: 10, range: 0, area: 1, status: 'shell', allyOnly: true, vfx: 'buff', pose: 'cast', desc: 'Shell, self + adjacent allies' },
  rf_heal:      { name: 'Heal', kind: 'heal', mp: 8, range: 3, area: 0, power: 8, ct: 1, vfx: 'cure', pose: 'cast', desc: 'SP 8 heal' },
  rf_fire:      { name: 'Fire', kind: 'mag', mp: 8, range: 4, area: 0, power: 8, acc: 100, ct: 1, element: 'fire', vfx: 'fire', pose: 'cast', desc: 'SP 8 fire' },
  rf_ice:       { name: 'Ice', kind: 'mag', mp: 8, range: 4, area: 0, power: 8, acc: 100, ct: 1, element: 'ice', vfx: 'ice', pose: 'cast', desc: 'SP 8 ice' },
  rf_lightning: { name: 'Lightning', kind: 'mag', mp: 8, range: 4, area: 0, power: 8, acc: 100, ct: 1, element: 'thunder', vfx: 'thunder', pose: 'cast', desc: 'SP 8 lightning' },
  // Warlock
  word_of_pain: { name: 'Word of Pain', kind: 'mag', mp: 12, range: 4, area: 1, power: 10, acc: 100, ct: 2, element: 'dark', status: { id: 'poison', chance: 70 }, vfx: 'debuff', pose: 'cast', desc: 'SP 10 dark + Poison 70%' },
  meditate:     { name: 'Meditate', kind: 'heal', mp: 0, range: 0, area: 0, self: true, mpPct: 0.3, vfx: 'buff', pose: 'cast', desc: 'Restore 30% own MP' },
  curse:        { name: 'Curse', kind: 'debuff', mp: 10, range: 4, area: 0, acc: 100, ct: 2, status: 'curse', vfx: 'debuff', pose: 'cast', desc: 'Healing −50%, BRV −20, 3 turns' },
  // 16 MP x CT 3 x a 40% roll is three multiplicative discounts on one card: 12 casts in 1,800 battles even after
  // Charm was repriced as the two turns it really moves. 12 MP / CT 2 leaves the 40% roll as the only tax.
  charm_spell:  { name: 'Charm', kind: 'debuff', mp: 12, range: 4, area: 0, acc: 40, ct: 2, status: 'charm', vfx: 'debuff', pose: 'cast', desc: 'Charm 1 turn, 40%' },
  // Hex's use count is bounded by the BOARD, not by its price: instrumented over 400 random battles, some enemy is
  // mid-charge on 11.8% of Warlock action-turns but one inside MOVE + range 4 on only 2.2% of them, and Word of Pain
  // still out-scores it on most of those. R6 is the smallest change that widens the window it answers; the ability
  // is otherwise untouched, and it is the only counter-spell in the game.
  hex:          { name: 'Hex', kind: 'debuff', mp: 8, range: 6, area: 0, acc: 100, hex: true, vfx: 'debuff', pose: 'cast', desc: "Double the target's queued charge time" },
  // Conjurer
  gemfox:    { name: 'Gemfox', kind: 'buff', mp: 20, range: 4, area: 2, status: 'reflect', ct: 3, allyOnly: true, vfx: 'buff', pose: 'cast', desc: 'Reflect 3 turns, allies only' },
  // extra monster abilities
  rend_claw:    { name: 'Rend Claw', kind: 'phys', mp: 0, range: 1, area: 0, mult: 1.2, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack', desc: 'WP ×1.2' },
  howl:         { name: 'Howl', kind: 'buff', mp: 6, range: 0, area: 2, allyOnly: true, mod: { atkMod: 1 }, vfx: 'buff', pose: 'cast', desc: 'Allies ATK +1' },
  root_snare:   { name: 'Root Snare', kind: 'phys', mp: 6, range: 2, area: 0, mult: 0.8, acc: 100, element: 'earth', status: { id: 'immobilize', chance: 70 }, vfx: 'quake', pose: 'attack2', desc: 'WP ×0.8 + Immobilize 70%' },
  // ---- Ported from the prototype (src/data.js). the prototype stores its own scale, so every number below is converted, not copied:
  // mp = the prototype cost x1.25, ct = the prototype ct +1, power = the prototype mult x6.7, phys mult 1:1 — the regression over the 89 ids
  // the two tables already share. `pierce` is the exception: DEF here runs 8/12/18 against the prototype's 3-10, so its
  // soak-ignore numbers are doubled or they would do nothing. the prototype ids that are an existing ability under another
  // name are NOT duplicated (slash/sword_slash/shoot/punch/steal/shield_slam -> attack, armor_break -> rend_armor,
  // snare -> leg_shot, taunt -> fearful_impact, and 24 more; the port report lists all 30).
  // Guardian
  last_stand:   { name: 'Last Stand', kind: 'heal', mp: 5, range: 0, area: 0, self: true, power: 8, vfx: 'cure', pose: 'cast', desc: 'SP 8 heal, self only' },
  // SP 8 on a mag-L class is 13-21 damage next to the Guardian's own 32-42 swing, so it was picked 7 times in 1,800
  // battles; and `attack` is the only other damaging record the class owns. SP 14 / 10 MP (of a 24 MP pool) makes
  // the ring the answer to being surrounded, which is the whole point of a bulwark.
  shock_ring:   { name: 'Shock Ring', kind: 'mag', mp: 10, range: 0, area: 2, power: 14, acc: 100, element: 'thunder', enemyOnly: true, vfx: 'thunder', pose: 'cast', desc: 'SP 14 lightning to enemies, A2' },
  // Hunter. Longshot outranges the bow itself at x0.9 for free — the trade this class is built on.
  longshot:     { name: 'Longshot', kind: 'phys', mp: 0, range: 6, area: 0, mult: 0.9, acc: 100, ranged: true, weaponHit: true, vfx: 'arrow', pose: 'attack', desc: 'WP x0.9, R6' },
  twin_shot:    { name: 'Twin Shot', kind: 'phys', mp: 5, range: 3, area: 0, mult: 1.3, acc: 100, ranged: true, weaponHit: true, vfx: 'arrow', pose: 'attack', desc: 'WP x1.3, R3' },
  // x1.4 down a 6-tile line THROUGH armour measured 103 damage a use, the highest of any record in the game, on a
  // class that never has to stand where it can be answered. x1.15 and half the pierce keeps it the Hunter's big
  // swing without making every other ability in the kit a rounding error.
  railshot:     { name: 'Railshot', kind: 'phys', mp: 10, range: 6, area: 0, mult: 1.15, acc: 100, line: 6, ranged: true, pierce: { def: 4 }, vfx: 'arrow', pose: 'attack', desc: 'WP x1.15, line 6, ignores 4 DEF' },
  opening_gambit:{ name: 'Opening Gambit', kind: 'phys', mp: 8, range: 'w', area: 0, mult: 1.0, opener: 1.8, acc: 100, ranged: true, weaponHit: true, vfx: 'arrow', pose: 'attack', desc: 'WP x1.8 against an undamaged foe' },
  // Blacksmith
  temper_blade: { name: 'Temper Blade', kind: 'buff', mp: 8, range: 3, area: 0, ally: true, mod: { atkMod: 1 }, vfx: 'buff', pose: 'cast', desc: 'Ally ATK +1 (stacks to +3)' },
  ward_plate:   { name: 'Ward Plate', kind: 'buff', mp: 8, range: 3, area: 0, status: 'protect', ally: true, vfx: 'buff', pose: 'cast', desc: 'Protect an ally, 3 turns' },
  quench:       { name: 'Quench', kind: 'heal', mp: 10, range: 3, area: 0, power: 7, cure: ['poison', 'blind'], ally: true, vfx: 'cure', pose: 'cast', desc: 'SP 7 heal, cure Poison/Blind' },
  slag_shot:    { name: 'Slag Shot', kind: 'phys', mp: 5, range: 3, area: 0, wp: 5, acc: 100, ranged: true, thrown: true, vfx: 'stone', pose: 'attack2', desc: 'WP 5 ranged' },
  armor_pierce: { name: 'Armor Piercer', kind: 'phys', mp: 10, range: 2, area: 0, mult: 1.1, acc: 100, weaponHit: true, pierce: { def: 8 }, vfx: 'bash', pose: 'attack', desc: 'WP x1.1, ignores 8 DEF' },
  forge_hammer: { name: 'Forge Hammer', kind: 'phys', mp: 10, range: 1, area: 0, mult: 1.6, acc: 100, weaponHit: true, vfx: 'bash', pose: 'attack', desc: 'WP x1.6' },
  // Necromancer. Animate Dead keeps the prototype's 60% but not its zombify: turning a corpse into a unit of another class
  // mid-battle would have to rewrite cls/team/spriteName on a live unit, which is a renderer change, not a rules one.
  grave_bolt:   { name: 'Grave Bolt', kind: 'mag', mp: 10, range: 4, area: 0, power: 9, acc: 100, element: 'dark', vfx: 'debuff', pose: 'cast', desc: 'SP 9 dark' },
  animate_dead: { name: 'Animate Dead', kind: 'raise', mp: 15, range: 4, area: 0, pct: 0.6, ally: true, vfx: 'debuff', pose: 'cast', desc: 'Revive at 60% HP' },
  mana_burn:    { name: 'Mana Burn', kind: 'mag', mp: 10, range: 4, area: 0, power: 7, acc: 100, element: 'dark', drainMp: 20, vfx: 'debuff', pose: 'cast', desc: 'SP 7 dark, steal 20 MP' },
  // Zombie. Nothing in the zombie's own kit inflicts Poison — a Necromancer ally's Fell Approach does, which is
  // what makes the pair worth fielding together.
  // 8 MP of a 24 MP pool against a free x1.2 Rend Claw meant the Zombie had to be BOTH poisoned-adjacent and flush
  // to use it. 5 MP; the exploit multiplier itself is untouched.
  salt_wound:   { name: 'Salt the Wound', kind: 'phys', mp: 5, range: 1, area: 0, mult: 1.0, exploit: { status: 'poison', mult: 1.8 }, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack2', desc: 'WP x1.8 against a poisoned foe' },
  // ---- Second the prototype tranche: the upgrades the prototype gives to classes this roster ALREADY has. Same conversion as above
  // (mp = the prototype cost x1.25, ct = the prototype ct +1, power = the prototype mult x6.7, phys mult 1:1, pierce doubled for this DEF/RES
  // scale). Every one of these extends an existing class's ability list; none replaces or reorders an entry.
  // Footman
  opener:       { name: 'Opening Gambit', kind: 'phys', mp: 8, range: 2, area: 0, mult: 1.0, opener: 1.8, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack2', desc: 'WP x1.8 against an undamaged foe, R2' },
  // Knight. Cross Cut is anchored on a tile, not a body: the plus reaches two tiles down each axis from wherever it
  // is planted, which is how it catches a rank that has not closed yet.
  cross_cut:    { name: 'Cross Cut', kind: 'phys', mp: 10, range: 2, area: 0, cross: 2, mult: 1.0, acc: 100, vfx: 'slash', pose: 'attack', desc: 'WP x1.0 in a plus, 2 tiles each way' },
  // Archer
  // 9 casts in 1,800: at x1.0 it is the Archer's FREE basic attack with a line and an 8 MP bill, so it only ever
  // won with two enemies aligned and MP to burn. 5 MP. The multiplier is untouched — the Archer is a 57% class.
  pierce_line:  { name: 'Piercing Line', kind: 'phys', mp: 5, range: 4, area: 0, line: 4, mult: 1.0, acc: 100, ignoreEva: true, ranged: true, vfx: 'arrow', pose: 'attack', desc: 'WP x1.0, line 4, cannot miss' },   // ignoreEva is a no-op on the default Archer (Concentrate already grants it) and is kept only for a rebuilt one
  quad_shot:    { name: 'Quad Shot', kind: 'phys', mp: 10, range: 'w', area: 0, mult: 0.5, hits: 4, acc: 100, ranged: true, weaponHit: true, vfx: 'arrow', pose: 'attack', desc: 'Four arrows at WP x0.5' },
  // Monk
  tri_strike:   { name: 'Tri Strike', kind: 'phys', mp: 10, range: 1, area: 0, mult: 0.6, hits: 3, acc: 100, weaponHit: true, vfx: 'bash', pose: 'attack', desc: 'Three cuts at WP x0.6' },
  blood_fury:   { name: 'Blood Fury', kind: 'phys', mp: 5, range: 1, area: 0, mult: 1.0, blood: 1.8, acc: 100, weaponHit: true, vfx: 'bash', pose: 'attack', desc: 'WP x1.8 while under half HP' },
  // Cleric. Halo Mend is a hollow ring: it spares the tile it is planted on, so it heals a line of allies without
  // wasting the anchor on whoever is already standing there.
  halo_mend:    { name: 'Halo Mend', kind: 'heal', mp: 15, range: 3, area: 0, ring: 2, power: 8, allyOnly: true, vfx: 'cure', pose: 'cast', desc: 'SP 8 heal on the ring at radius 2' },
  mass_raise:   { name: 'Mass Raise', kind: 'raise', mp: 30, range: 4, area: 2, pct: 0.25, ct: 4, ally: true, vfx: 'cure', pose: 'cast', desc: 'Revive every fallen ally in A2 at 25% HP' },
  // Sorcerer
  chain_bolt:   { name: 'Chain Lightning', kind: 'mag', mp: 18, range: 4, area: 0, power: 9, acc: 100, element: 'thunder', chain: { jumps: 3, range: 2, falloff: 0.7 }, vfx: 'thunder', pose: 'cast', desc: 'SP 9, arcs to 3 more foes within 2, x0.7 a hop' },
  emberfall:    { name: 'Emberfall', kind: 'mag', mp: 15, range: 4, area: 2, power: 11, falloff: 0.5, acc: 100, element: 'fire', vfx: 'fire', pose: 'cast', desc: 'SP 11 fire, A2, edge takes half' },
  // Chronomancer
  clock_hit:    { name: 'Clock Hit', kind: 'phys', mp: 8, range: 1, area: 0, mult: 0.9, ctDmg: 40, acc: 100, weaponHit: true, vfx: 'bash', pose: 'attack2', desc: 'WP x0.9 + knock 40 CT off the clock' },
  // Earthshaper
  tremor:       { name: 'Tremor', kind: 'mag', mp: 10, range: 4, area: 1, power: 9, acc: 100, ct: 2, element: 'earth', status: { id: 'immobilize', chance: 50 }, vfx: 'quake', pose: 'cast', desc: 'SP 9 earth, A1 + Immobilize 50%' },
  wildfire:     { name: 'Wildfire', kind: 'mag', mp: 10, range: 4, area: 1, power: 9, acc: 100, ct: 2, element: 'fire', status: { id: 'blind', chance: 50 }, vfx: 'fire', pose: 'cast', desc: 'SP 9 fire, A1 + Blind 50%' },
  // Blademaster / Juggler. Rank Break sweeps along x and File Break along z — world axes, not the user's facing, so the
  // two are different tools on the same board rather than one ability the player rotates.
  rank_break:   { name: 'Rank Break', kind: 'phys', mp: 8, range: 3, area: 0, row: 2, mult: 0.9, acc: 100, mod: { defMod: -1 }, vfx: 'slash', pose: 'attack2', desc: 'WP x0.9 along a rank, DEF -1' },
  file_break:   { name: 'File Break', kind: 'phys', mp: 8, range: 3, area: 0, column: 2, mult: 0.9, acc: 100, mod: { atkMod: -1 }, vfx: 'slash', pose: 'attack2', desc: 'WP x0.9 along a file, ATK -1' },
  // Mystic. RES here runs 8/12/16 against the prototype's 3-8, so its pierce 6 is doubled or the spell would pierce nothing.
  mind_spike:   { name: 'Mind Spike', kind: 'mag', mp: 13, range: 4, area: 0, power: 9, acc: 100, element: 'dark', pierce: { res: 12 }, vfx: 'debuff', pose: 'cast', desc: 'SP 9 dark, ignores 12 RES' },
  // Paladin
  holy_cross:   { name: 'Holy Cross', kind: 'phys', mp: 15, range: 3, area: 0, cross: 2, mult: 1.1, acc: 100, element: 'holy', vfx: 'holy', pose: 'attack', desc: 'WP x1.1 holy in a plus' },
  verdict:      { name: 'Verdict', kind: 'mag', mp: 20, range: 3, area: 0, power: 11, acc: 100, ct: 2, element: 'holy', trueDamage: true, vfx: 'holy', pose: 'cast', desc: 'SP 11 holy, unsoakable' },
  // Battlemage
  chain_frost:  { name: 'Chain Frost', kind: 'mag', mp: 15, range: 4, area: 0, power: 7, acc: 100, element: 'ice', chain: { jumps: 2, range: 3, falloff: 0.8 }, status: { id: 'slow', chance: 50 }, vfx: 'ice', pose: 'cast', desc: 'SP 7 ice, arcs to 2 more, Slow 50%' },
  duelist:      { name: 'Duelist Flourish', kind: 'phys', mp: 8, range: 1, area: 0, mult: 1.0, duelist: 1.6, acc: 100, ignoreEva: true, weaponHit: true, vfx: 'slash', pose: 'attack', desc: 'WP x1.6, cannot miss, in a clean 1v1' },
  // Gunner
  // Third of the same family: SP 9 read off the Gunner's mag L is 17-25 a body against Fireshot's flat 46 for half
  // the MP, so it fired 22 times in 1,800. SP 12 makes the line worth taking when two bodies stand in it.
  ember_lance:  { name: 'Ember Lance', kind: 'mag', mp: 13, range: 5, area: 0, line: 5, power: 12, acc: 100, element: 'fire', vfx: 'fire', pose: 'cast', desc: 'SP 12 fire down a file, line 5' },
  // Assassin. Backlash is free and enormous, and the recoil is real: it can kill the assassin outright.
  execute:      { name: 'Execute', kind: 'phys', mp: 10, range: 1, area: 0, mult: 1.0, execute: { threshold: 0.3, mult: 2.2 }, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack', desc: 'WP x2.2 against a foe under 30% HP' },
  backlash:     { name: 'Backlash', kind: 'phys', mp: 0, range: 1, area: 0, mult: 2.0, recoil: 0.4, acc: 100, weaponHit: true, vfx: 'bash', pose: 'attack', desc: 'WP x2.0, suffer 40% of it back' },
  // Dread Knight
  // SP 7 off the Dread Knight's mag L is 18 damage a body; the class sat at 42% with 83 damage a game, the lowest
  // output of any High-ATK class in the roster, because its only reach record did nothing. SP 10.
  siphon_arc:   { name: 'Siphon Arc', kind: 'mag', mp: 15, range: 4, area: 0, power: 10, acc: 100, element: 'dark', chain: { jumps: 2, range: 3, falloff: 0.8 }, drain: 0.5, vfx: 'debuff', pose: 'cast', desc: 'SP 10 dark, arcs to 2 more, heal 50% dealt' },
  // Runesword. the prototype hands this to a sword user at range 1; FABLE's Runesword carries a spear AND Rampart Aura,
  // which seals every tile adjacent to it against enemy movement — a range-1 ability on this class is one no enemy
  // can ever be standing in. `range: 'w'` puts it at the spear's reach 2, which is the only range this class fights
  // at. Measured: 0 uses in 500 battles at range 1.
  pack_tactics: { name: 'Pack Tactics', kind: 'phys', mp: 8, range: 'w', area: 0, mult: 1.0, allyBonus: { per: 0.25, cap: 0.75 }, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack', desc: 'WP +25% per ally beside the user, to +75%' },
  // Monsters
  frost_line:   { name: 'Frost Line', kind: 'mag', mp: 13, range: 4, area: 0, line: 4, power: 8, acc: 100, element: 'ice', status: { id: 'slow', chance: 60 }, vfx: 'ice', pose: 'cast', desc: 'SP 8 ice, line 4 + Slow 60%' },
  // Blood Pact costs no MP because it is paid in HP, and this tree's monsters carry hpMul-inflated pools — 25% of a
  // Behemoth is 56 HP, which is why the AI only spends it on a kill or into a weakness.
  blood_pact:   { name: 'Blood Pact', kind: 'mag', mp: 0, range: 4, area: 0, power: 15, hpCost: 0.25, acc: 100, element: 'dark', vfx: 'debuff', pose: 'cast', desc: 'Pay 25% max HP, SP 15 dark' },
  // ---- Round-6 the prototype tranche: the last genuinely-missing ids, same conversions as above
  // (mp = the prototype cost x1.25, ct = the prototype ct +1, power = the prototype mult x6.7, phys mult 1:1). 26 the prototype ids that
  // are an existing card under another name stay unduplicated (slash/sword_slash/shoot/punch/steal/
  // shield_slam/dash_strike -> attack, cinder_cone -> wildfire, gale_cone -> ki_burst, fire_breath_t ->
  // fire_breath, frost_crest -> frost_line, ...), and second_wind stays CUT: endTurn() hard-assigns
  // u.ct, so a self-CT gift is overwritten the moment it fires (verified).
  // Mechanics, all Engine.resolve-side: dual = two unit picks (no footprint, no hit roll); pull = drag
  // bodies toward the anchor before the blast; blink/dash/teleportHit = caster relocation pushed as a
  // pre-beat knockback so the windup starts from the new tile; scatter = victim to a random free tile.
  // Dual-target
  swap:         { name: 'Swap', kind: 'debuff', mp: 10, range: 4, area: 0, dual: 'swap', dualTeam: 'foes', vfx: 'debuff', pose: 'cast', desc: 'Trade two enemies positions' },
  rescue_swap:  { name: 'Rescue Swap', kind: 'buff', mp: 10, range: 4, area: 0, dual: 'swap', dualTeam: 'allies', vfx: 'buff', pose: 'cast', desc: 'Trade two allies positions' },
  ct_swap:      { name: 'Clock Swap', kind: 'buff', mp: 13, range: 4, area: 0, dual: 'ctSwap', dualTeam: 'allies', vfx: 'buff', pose: 'cast', desc: 'Trade two allies CT clocks' },
  soul_trade:   { name: 'Soul Trade', kind: 'heal', mp: 15, range: 4, area: 0, dual: 'hpSwap', dualTeam: 'allies', vfx: 'cure', pose: 'cast', desc: 'Trade two allies HP pools' },
  // Pull — the prototype gates these by kind to enemies, so dragged allies are repositioned, never friendly-fired
  tide_pull:    { name: 'Tide Pull', kind: 'mag', mp: 13, range: 4, area: 1, power: 7, acc: 100, enemyOnly: true, element: 'water', status: { id: 'slow', chance: 60 }, pull: { radius: 3, steps: 3 }, vfx: 'ice', pose: 'cast', desc: 'SP 7 water A1, drags foes in + Slow 60%' },
  lodestone:    { name: 'Lodestone', kind: 'debuff', mp: 10, range: 4, area: 1, acc: 100, enemyOnly: true, status: { id: 'immobilize', chance: 70 }, pull: { radius: 2, steps: 2 }, vfx: 'debuff', pose: 'cast', desc: 'Pull A1 foes in + Immobilize 70%' },
  // Caster relocation
  // Balance pass: mp 10 -> 12 (the prototype x1.25 = 10) and mult 1.2 -> 1.0 (the prototype 1.2). Measured over the
  // shipped default matchup at 200 seeds: the card at the prototype numbers slid A-side 36.0% -> 34.5%, and
  // re-testing the MP cut alone still read 33.0% — the Ninja's ONLY gained card, no other default
  // class changed (rules.js paths for non-flagged abilities are provably identical). At x1.0 its
  // single-target value equals the Ninja's free Throw, so the AI spends 12 MP on it only for a
  // two-body A1 catch: the card stays real content without moving the matchup.
  shadow_step:  { name: 'Shadowstep Strike', kind: 'phys', mp: 12, range: 4, area: 1, mult: 1.0, acc: 100, enemyOnly: true, weaponHit: true, blink: true, vfx: 'slash', pose: 'attack2', desc: 'Blink to the tile, WP x1.0 around it' },
  comet_fall:   { name: 'Comet Fall', kind: 'mag', mp: 18, range: 5, area: 1, power: 11, acc: 100, ct: 2, enemyOnly: true, element: 'fire', blink: true, vfx: 'fire', pose: 'cast', desc: 'Blink to the tile, SP 11 fire A1, CT 2' },
  dash_thrust:  { name: 'Dash Thrust', kind: 'phys', mp: 5, range: 4, area: 0, mult: 1.1, acc: 100, weaponHit: true, dash: true, vfx: 'slash', pose: 'attack', desc: 'Step adjacent, WP x1.1' },
  phantom_cut:  { name: 'Phantom Cut', kind: 'phys', mp: 10, range: 3, area: 0, mult: 1.3, acc: 100, ignoreEva: true, weaponHit: true, teleportHit: true, vfx: 'slash', pose: 'attack2', desc: 'Trade places, WP x1.3, cannot miss' },
  // Balance pass: mult 0.9 -> 1.2 (the prototype 0.9). Probe (shots/gameplay/scatter_probe.mjs): at the prototype
  // numbers Scatter was legal and scored positive at every range yet NEVER won the argmax — Twin Shot
  // holds the same reach at x1.3 for 5 MP and Railshot out-hits it at 6 — 0 uses in 150 packed battles.
  // x1.2 plus the AI's displacement rider puts it just over Twin Shot at close range, which is the
  // slot the prototype built it for: the card that knocks a body off the tile it needs.
  scatter:      { name: 'Scatter Shot', kind: 'phys', mp: 8, range: 3, area: 0, mult: 1.2, acc: 100, ranged: true, weaponHit: true, scatter: true, vfx: 'arrow', pose: 'attack2', desc: 'WP x1.2, knocks the foe to a random tile' },
  // Reaction-only pseudo abilities
  counter_hit:  { name: 'Counter', kind: 'phys', mp: 0, range: 'w', area: 0, mult: 1.0, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack', hidden: true },
  tackle:       { name: 'Counter Tackle', kind: 'phys', mp: 0, range: 1, area: 0, wp: 3, acc: 100, knockback: 1, vfx: 'bash', pose: 'attack2', hidden: true },
  riposte_hit:  { name: 'Riposte', kind: 'phys', mp: 0, range: 1, area: 0, mult: 0.8, acc: 100, weaponHit: true, vfx: 'slash', pose: 'attack', hidden: true },
  return_shot:  { name: 'Return Fire', kind: 'phys', mp: 0, range: 'w', area: 0, mult: 1.0, acc: 100, ranged: true, vfx: 'arrow', pose: 'attack', hidden: true },
};
for (const k in ABILITIES) ABILITIES[k].id = k;

export const REACTIONS = {
  counter_tackle: { name: 'Counter Tackle', desc: 'When hit by melee, tackle back (WP 3)' },
  reflex_tonic:    { name: 'Reflex Tonic', desc: 'When damaged, drink the weakest owned Potion' },
  parry:          { name: 'Parry', desc: 'Nullify one physical hit' },
  deflect_arrows:    { name: 'Deflect Arrows', desc: 'Evade one ranged attack' },
  counter:        { name: 'Counter', desc: 'Strike the attacker if in weapon range' },
  regenerate:     { name: 'Regenerate', desc: 'When damaged, gain Regen' },
  magic_counter:  { name: 'Magic Counter', desc: 'When hit by a spell, cast it back' },
  mana_shield:    { name: 'Mana Shield', desc: 'Damage is taken from MP first' },
  caution:        { name: 'Caution', desc: 'When hit, DEF +33% until next turn' },
  tidal_retort:  { name: 'Tidal Retort', desc: 'When hit, Earthsong at the attacker' },
  dragonheart:    { name: 'Dragonheart', desc: 'When hit below 25% HP, gain Reraise' },
  shadowstep:     { name: 'Shadowstep', desc: 'When hit by melee, gain Vanish' },
  blade_catch:    { name: 'Blade Catch', desc: 'Nullify one weapon attack' },
  mp_restore:     { name: 'MP Restore', desc: 'When damaged, restore 20% MP' },
  absorb_mp:      { name: 'Mana Siphon', desc: 'When targeted by a spell, gain its MP cost' },
  reflex:         { name: 'Reflex', desc: 'Evade one physical attack' },
  spell_ward:     { name: 'Spell Ward', desc: 'Halve one incoming magical hit' },
  guardian:       { name: 'Guardian', desc: 'Take the hit aimed at an adjacent ally' },
  riposte:        { name: 'Riposte', desc: 'Counter melee hits with a rapier strike (WP ×0.8)' },
  bestial_instinct:{ name: 'Bestial Instinct', desc: 'When hit by a monster, counter with a learned Blue spell' },
  return_fire:    { name: 'Return Fire', desc: 'Counter ranged attacks with a basic shot' },
  catch:          { name: 'Catch', desc: 'Catch a thrown weapon; the attack is nullified' },
  frightful_presence:{ name: 'Frightful Presence', desc: 'A melee attacker gains Fear' },
  malediction:    { name: 'Malediction', desc: 'A melee attacker gains Poison' },
  aegis:          { name: 'Aegis', desc: 'Halve one incoming physical hit' },
};
// §5.1.10: the equip-permission supports carry their item's Weight, which is the +1 tick tempo cost of §2.1.
export const EQUIP_SUPPORTS = new Set(['equip_heavy', 'equip_spears', 'equip_shields', 'dual_wield']);
export const SUPPORTS = {
  jp_boost: { name: 'JP Boost', desc: '+50% JP earned' }, throw_item: { name: 'Throw Item', desc: 'Item range 1 → 4' }, equip_heavy: { name: 'Equip Heavy Armor', desc: 'May wear heavy armor' },
  concentrate: { name: 'Concentrate', desc: 'Attacks ignore EVA' }, martial_arts: { name: 'Martial Arts', desc: 'Unarmed WP = 4 + ATK÷16' }, healing_boost: { name: 'Healing Boost', desc: 'Healing +25%' },
  arcane_focus: { name: 'Arcane Focus', desc: 'MAG +25%' }, short_charge: { name: 'Short Charge', desc: 'CT halved (round up)' }, nimble: { name: 'Nimble', desc: 'EVA +10' },
  natures_blessing: { name: "Nature's Blessing", desc: 'ATK/MAG +1 on natural terrain' }, equip_spears: { name: 'Equip Spears', desc: 'May wield spears' }, dual_wield: { name: 'Dual Wield', desc: 'Second strike at ×0.5' },
  doublehand: { name: 'Doublehand', desc: 'Two-handed WP ×1.5' }, half_mp: { name: 'Half MP', desc: 'MP costs ×0.5' }, defense_boost: { name: 'Defense Boost', desc: 'DEF +20%' },
  fortify: { name: 'Fortify', desc: 'DEF +20%' }, undead: { name: 'Undead', desc: 'Absorbs dark, immune to Poison' },
  equip_shields: { name: 'Equip Shields', desc: 'DEF +2 and +5 EVA from a shield' }, doublecast: { name: 'Doublecast', desc: 'Cast a CT ≤1 spell twice for MP ×1.5' },
  learn: { name: 'Learn', desc: 'Acquire a monster ability when hit by it' }, eye_for_distance: { name: 'Eye for Distance', desc: 'Gun range +1' },
  trickster: { name: 'Trickster', desc: 'Status abilities +20% hit' }, assassinate: { name: 'Assassinate', desc: 'Attacks from behind deal +50%' },
  rampart_aura: { name: 'Rampart Aura', desc: 'Enemies cannot pass through adjacent tiles' }, arcane_reservoir: { name: 'Arcane Reservoir', desc: 'Max MP +30%' },
  tracker: { name: 'Tracker', desc: '+1 range on any ability that already reaches past 1 tile' },
};
export const MOVEMENTS = {
  move_plus1: { name: 'Move +1', move: 1 }, move_plus2: { name: 'Move +2', move: 2 }, jump_plus2: { name: 'Jump +2', jump: 2 }, acrobat: { name: 'Acrobat', jump: 2, noFall: true },
  scavenger: { name: 'Scavenger', desc: 'Reveals hidden items' }, bulwark_advance: { name: 'Bulwark Advance', desc: 'Adjacent ally gains DEF +2 until your next turn' },
  fleet_foot: { name: 'Fleet Foot', move: 1, desc: 'Move +1, pass through allies' }, pilgrims_step: { name: "Pilgrim's Step", desc: 'Move +1 when ending adjacent to an ally' },
  move_mp_up: { name: 'Move-MP Up', desc: '+3 MP per tile moved' }, teleport: { name: 'Teleport', desc: 'Move anywhere within MOVE ignoring terrain' },
  terrain_walker: { name: 'Terrain Walker', desc: 'Cross water freely' }, ignore_height: { name: 'Ignore Height', jump: 99 }, shinobi_stride: { name: 'Shinobi Stride', jump: 3, noFall: true },
  unyielding_step: { name: 'Unyielding Step', desc: 'Cannot be knocked back; Move +1 on flat ground' }, float_move: { name: 'Float', jump: 1, desc: 'Immune to ground effects' },
  spirit_walk: { name: 'Spirit Walk', move: 1, desc: 'Move +1, pass through enemies' },
  heavy_stride: { name: 'Heavy Stride', desc: 'No tempo penalty from heavy armour' }, runners_grace: { name: "Runner's Grace", move: 1, desc: 'Move +1, height ≤1 counts as flat' },
  beast_path: { name: 'Beast Path', move: 1, desc: 'Move +1, pass through monsters' }, gunslingers_perch: { name: "Gunslinger's Perch", desc: 'Move +1 when starting high' },
  shadow_step: { name: 'Shadow Step', move: 1, desc: 'Move +1; no counter after moving ≥3 tiles' }, menacing_advance: { name: 'Menacing Advance', desc: 'Adjacent enemies lose 10 CT' },
  vanguard: { name: 'Vanguard', desc: 'Move +1 with an ally within 2 tiles at turn start' }, fell_approach: { name: 'Fell Approach', desc: 'Enemies passed take a Poison tick' },
};

// ---- Statuses (§2.4). turns = own-turn countdown; ticks = clock-tick countdown (Stop). neg = ailment (curable), pos = buff (dispellable).
export const STATUS = {
  poison:     { name: 'Poison', neg: true, turns: 3, tickHp: -0.10 },
  blind:      { name: 'Blind', neg: true, turns: 3, hitMul: 0.5 },
  silence:    { name: 'Silence', neg: true, turns: 3 },
  sleep:      { name: 'Sleep', neg: true, turns: 3, skipTurn: true, noReact: true, breaksOnHit: true },
  slow:       { name: 'Slow', neg: true, turns: 3, spdMul: 0.5, cancels: 'haste' },
  haste:      { name: 'Haste', pos: true, turns: 3, spdMul: 1.5, cancels: 'slow' },
  stop:       { name: 'Stop', neg: true, turns: 2, frozen: true, noReact: true },
  immobilize: { name: 'Immobilize', neg: true, turns: 2, noMove: true },
  disable:    { name: 'Disable', neg: true, turns: 1, noAct: true, noReact: true },
  fear:       { name: 'Fear', neg: true, turns: 3, atkMul: 0.75, magMul: 0.75, noReact: true },
  charm:      { name: 'Charm', neg: true, turns: 1, breaksOnHit: true },
  protect:    { name: 'Protect', pos: true, turns: 3, defMul: 1.33 },
  shell:      { name: 'Shell', pos: true, turns: 3, resMul: 1.33 },
  regen:      { name: 'Regen', pos: true, turns: 3, tickHp: 0.10 },
  reraise:    { name: 'Reraise', pos: true, turns: 99 },
  vanish:     { name: 'Vanish', pos: true, turns: 99, untilAct: true },
  float:      { name: 'Float', pos: true, turns: 3 },
  // stat modifiers (bounded ±3 ATK/MAG/DEF, ±2 SPD; §5.1.7)
  focus:      { name: 'Focus', pos: true, turns: 3, mod: 'atkMod' },
  yell:       { name: 'Yell', pos: true, turns: 3, mod: 'spdMod' },
  def_down:   { name: 'Armor Rent', neg: true, turns: 3, mod: 'defMod' },
  atk_down:   { name: 'Weapon Rent', neg: true, turns: 3, mod: 'atkMod' },
  spd_down:   { name: 'Speed Rent', neg: true, turns: 3, mod: 'spdMod' },
  caution:    { name: 'Caution', pos: true, turns: 1, defMul: 1.33 },
  bulwark:    { name: 'Bulwark', pos: true, turns: 1, mod: 'defMod' },
  // R9: was turns 99 (the rest of the battle). §5.1.5 caps debuffs at 3 turns, and a permanent Disarm is what turned
  // the Chapter I opener into a 150-400-turn grind: one Lv 1 Cutpurse disarmed the Knight AND the Wyrmlancer, who then
  // spent twenty rounds trading 3-point hits. Now the victim recovers its weapon after 3 of its own turns.
  unarmed:    { name: 'Disarmed', neg: true, turns: 3, unarmed: true },
  cover:      { name: 'Cover', pos: true, turns: 1 },
  intimidate: { name: 'Intimidate', pos: true, turns: 99 },
  curse:      { name: 'Curse', neg: true, turns: 3 },
  reflect:    { name: 'Reflect', pos: true, turns: 3 },
};
export const MOD_STATUS = { atkMod: { up: 'focus', down: 'atk_down' }, defMod: { up: 'bulwark', down: 'def_down' }, spdMod: { up: 'yell', down: 'spd_down' } };

// Earthsong table: user's tile type → element + status (Confuse is not in §2.4, wood uses Blind).
export const EARTHSONG = {
  g: { name: 'Wildfire', element: 'fire', status: 'blind' }, k: { name: 'Wildfire', element: 'fire', status: 'blind' },
  s: { name: 'Tremor', element: 'earth', status: 'immobilize' }, r: { name: 'Tremor', element: 'earth', status: 'immobilize' },
  w: { name: 'Torrent', element: 'water', status: 'slow' }, d: { name: 'Sinkhole', element: 'earth', status: 'stop', turns: 1 },
  b: { name: "Will-o'-Wisp", element: 'fire', status: 'blind' },
};

// the genre names each job's action set as a command ("Fundaments", "Items", "Black Magicks"); the Act menu shows the
// primary set and the secondary set under these names (player.js), and progression.js's shop headers use them.
export const SKILLSET = {
  footman: 'Fundaments', apothecary: 'Items', knight: 'Arts of War', archer: 'Aim', monk: 'Martial Arts', cleric: 'White Magicks',
  sorcerer: 'Black Magicks', chronomancer: 'Time Magicks', thief: 'Steal', earthshaper: 'Earthsong', wyrmlancer: 'Jump', ninja: 'Throw',
  blademaster: 'Iaido', conjurer: 'Summon', mystic: 'Mystic Arts', paladin: 'Holy Sword', battlemage: 'Red Magicks', beastsage: 'Blue Magicks',
  gunner: 'Marksmanship', juggler: 'Tricks', assassin: 'Assassinate', dreadknight: 'Dread', runesword: 'Runes', warlock: 'Hexes',
  guardian: 'Bulwark', hunter: 'Hunt', oathknight: 'Ember Oath', blacksmith: 'Forge', necromancer: 'Necromancy', bellwarden: 'Knells', chirurgeon: 'Surgery',
  wendigo: 'Beast', vampire: 'Blood', boar: 'Beast', beetle: 'Beast', gloomhound: 'Beast', colossus: 'Titan', ossuary: 'Undeath',
  skeleton: 'Undeath', wyrm: 'Draconic', cockatrice: 'Beast', ghost: 'Spectral', werewolf: 'Beast', hound: 'Beast', treant: 'Sylvan', zombie: 'Undeath', behemoth: 'Beast',
};
