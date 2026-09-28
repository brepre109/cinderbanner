// Chapter content for the campaign shell: the realm map, its battle nodes, the story beats, the starting
// company and every recruit. Pure data (no DOM, no three.js) so the shell screens, the battle page and any
// headless check can import it. Map ids are the registry ids in src/world/mapregistry.js; place names here
// are our own (the map module's display name is never shown in the campaign).
//
// Node coordinates are in the painted map's own pixel space (assets/worldmap.jpg, 1376 x 768).

// Chapters. Each has its own painted region (assets/worldmap.jpg, worldmap2.jpg -- both 1376 x 768) and its nodes carry `ch`.
// CHAPTER is LIVE: it reads whichever chapter the loaded save is in (save.js validate() calls setChapter), so every screen and
// the battle cover that print `CHAPTER.roman` follow the save without knowing chapters exist. Nodes default to ch 1.
export const CHAPTERS = [
  { no: 1, roman: 'I', name: 'The Ember Oath', region: 'The Southmarch', home: 'hollin' },
  { no: 2, roman: 'II', name: 'The Hollow Crown', region: 'The Northreach', home: 'road_south' },
];
let curChapter = 1;
export function setChapter(n) { curChapter = CHAPTERS[(+n || 1) - 1] ? +n : 1; }
export const chapterInfo = (n) => CHAPTERS[(+n || 1) - 1] || CHAPTERS[0];
export const CHAPTER = {
  get no() { return chapterInfo(curChapter).no; }, get roman() { return chapterInfo(curChapter).roman; }, get name() { return chapterInfo(curChapter).name; },
};
export const MAP_IMG = { w: 1376, h: 768 };
export const chOf = (n) => n?.ch || 1;

// Speakers: portrait sprite comes from the class sheet (units/roster.js spriteFor).
export const CAST = {
  aldric: { name: 'Aldric', cls: 'knight' },
  seren: { name: 'Seren', cls: 'cleric' },
  tobin: { name: 'Tobin', cls: 'archer' },
  ysolde: { name: 'Ysolde', cls: 'sorcerer' },
  brannoc: { name: 'Brannoc', cls: 'wyrmlancer' },
  pell: { name: 'Pell', cls: 'footman' },
  wren: { name: 'Wren', cls: 'hunter' },
  osric: { name: 'Osric', cls: 'monk' },
  mirela: { name: 'Mirela', cls: 'earthshaper' },
  corvina: { name: 'Corvina', cls: 'dreadknight' },
  varg: { name: 'Varg', cls: 'thief' },
  acolyte: { name: 'Grey Acolyte', cls: 'warlock' },
  galen: { name: 'Ser Galen', cls: 'blademaster' },
  malquor: { name: 'Malquor', cls: 'necromancer' },
  // Chapter II
  tamsin: { name: 'Tamsin', cls: 'runesword' },
  hesper: { name: 'Hesper', cls: 'gunner' },
  warden: { name: 'Crown Bellwarden', cls: 'bellwarden', foe: true },
  crane: { name: 'Wagonmaster Crane', cls: 'knight', foe: true },
  vey: { name: 'Ossian Vey', cls: 'bellwarden', foe: true },
  headsman: { name: 'Crown Headsman', cls: 'assassin', foe: true },
  maule: { name: 'Chancellor Maule', cls: 'vampire', foe: true },
  // Story staging (src/campaign/stage): bosses that speak or are named on the battle map.
  ashmaw: { name: 'Ash-Maw', cls: 'behemoth', foe: true },
  cerberus: { name: 'Gloom Cerberus', cls: 'gloomhound', foe: true },
  barrowking: { name: 'The Barrow King', cls: 'colossus', foe: true },
  narrator: { name: '', cls: null },
};
for (const k of ['varg', 'acolyte', 'galen', 'malquor']) CAST[k].foe = true;

// The Cinder Company at the start of the chapter. Six sworn, five may take the field.
export const START_ROSTER = [
  // The captain wears the Ember Oath Signet (R10: SPD +1, Move +1, ATK +1; R12: Move +1, ATK +1 -- the Oathknight is SPD M on
  // his own, so the signet's SPD point went with the job it was compensating for): a SPD-L Knight otherwise arrived after every
  // fight was decided and dealt 12-24 damage a battle across the chapter (campaignsim detail=1, R10).
  // R12: and he is no longer a plain Knight. He takes the field in his own hero job, the Oathknight (src/game/data.js,
  // progression.swearHero), with the Knight he was kept as his secondary and heroJp in the new job, which is enough for
  // Job Lv 2 and the Oathbound Charge the first time the player opens Learn Abilities.
  { key: 'aldric', name: 'Aldric', cls: 'knight', lvl: 3, brv: 70, hero: true, heroJob: 'oathknight', heroJp: 100, gear: { acc: 'oath_signet' } },
  { key: 'seren', name: 'Seren', cls: 'cleric', lvl: 2, brv: 55 },
  { key: 'tobin', name: 'Tobin', cls: 'archer', lvl: 2, brv: 62 },
  { key: 'ysolde', name: 'Ysolde', cls: 'sorcerer', lvl: 2, brv: 58 },
  { key: 'brannoc', name: 'Brannoc', cls: 'wyrmlancer', lvl: 4, brv: 74 },
  { key: 'pell', name: 'Pell', cls: 'footman', lvl: 1, brv: 66 },
];
export const START_PARTY = ['aldric', 'seren', 'tobin', 'ysolde', 'brannoc'];
export const START_FLORINS = 1200;

// Mercenaries for hire at Hollin Keep (Muster). Names are drawn in order, then numbered.
export const HIRELINGS = [
  { cls: 'footman', cost: 400, names: ['Dorran', 'Kit', 'Aelis', 'Bram'] },
  { cls: 'apothecary', cost: 500, names: ['Nell', 'Jory', 'Maud', 'Piers'] },
];

// A few spare pieces in the company chest at the start, so the Equip command has something to show from minute one.
export const START_ITEMS = { felt_cap: 2, leather_bracer: 1 };

// Towns: world-map nodes with a shop (and, at Hollin, the muster). `needs` = story nodes cleared before the town shows.
// Shop stock is item tiers (src/game/equipment.js) unlocked by chapter progress; rare boss relics are never stocked.
// `slots` narrows a stock line to some equipment slots (weapon | shield | head | body | acc).
export const TOWNS = [
  { id: 'hollin', name: 'Hollin Keep', x: 262, y: 548, needs: [], hire: true, keeper: 'apothecary', desc: 'Seat of the Cinder Company. Hire swords, outfit the company, and set out.',
    shop: { name: 'Keep Quartermaster', greet: 'Steel for the Crown\'s coin. Mind the edges.', stock: [{ needs: [], tiers: [1] }, { needs: ['b2'], tiers: [2], slots: ['weapon', 'shield', 'head', 'body'] }] } },
  { id: 'tollgate', name: 'Tollgate Market', lbl: 'up', x: 868, y: 354, needs: ['b3'], links: ['b3'], keeper: 'blacksmith', desc: 'A walled toll-tower where the aqueduct road meets the gorge. Its smiths sell to anyone who pays the toll.',
    shop: { name: 'Tollgate Smithy', greet: 'Aqueduct steel, gorge-forged. Better than anything in Hollin.', stock: [{ needs: [], tiers: [2] }, { needs: ['b4'], tiers: [3], slots: ['weapon', 'shield', 'head', 'body'] }] } },
  { id: 'gullwater', name: 'Gullwater', x: 1180, y: 478, needs: ['b5'], links: ['b5'], keeper: 'juggler', desc: 'A harbour town of salt-traders and relic-hawkers, the last free port before the marsh.',
    shop: { name: 'Gullwater Curios', greet: 'Charms off every ship in the bay. No refunds once you leave the pier.', stock: [{ needs: [], tiers: [3] }] } },
];
// Chapter II towns (the Northreach).
TOWNS.push(
  { id: 'vesk', ch: 2, name: 'Vesk Hollow', lbl: 'up', x: 488, y: 336, needs: ['c2'], links: ['c2'], hire: true, keeper: 'runesword', desc: 'A walled hill village under one bell tower. Its smith has cold steel, and its young folk want to see the Crown answer for the tithe.',
    shop: { name: 'Vesk Forge', greet: 'Northern steel. It holds an edge in the cold, which is more than southern steel does.', stock: [{ needs: [], tiers: [3] }, { needs: ['c4'], tiers: [4], slots: ['weapon', 'shield'] }] } },
  { id: 'karsmoor', ch: 2, name: 'Karsmoor Market', lbl: 'right', x: 784, y: 480, needs: ['c5'], links: ['c5'], keeper: 'blacksmith', desc: 'The foundry workers\' market, loud again now that the furnaces are cold. Everything the Crown ordered and never paid for is for sale.',
    shop: { name: 'Foundry Stores', greet: 'Crown-grade kit, sold at a traitor\'s discount. The Chancellor won\'t be needing it.', stock: [{ needs: [], tiers: [3, 4] }] } },
);
// Roads between regions: a node on each painted map that switches the world map to the other region (from Chapter II on).
export const ROADS = [
  { id: 'road_north', ch: 1, to: 2, needs: [], name: 'Greyspine Road', x: 664, y: 150, links: ['b3'], desc: 'The old road north over the Greyspine mountains, to the Northreach.' },
  { id: 'road_south', ch: 2, to: 1, needs: [], name: 'Road to Hollin', x: 236, y: 652, desc: 'Back south over the Greyspine, to Hollin Keep and the Southmarch.' },
];
export const TOWN = TOWNS[0];   // the company's home (legacy name: the muster and the default map position)
export const TOWN_BY_ID = Object.fromEntries(TOWNS.map((t) => [t.id, t]));

// kind: 'story' advances the chapter; 'side' is optional and repeatable (levels scale with the company).
// enemies: [cls, lvl, name?, boss?]; lvl on side battles is an offset from the company's average level. `boss` is a per-enemy
// override honoured by campaign.enemiesFor -> progression.enemyOpts: { lvlBonus, learned, equip (merged over the level kit),
// hpMul, name, sprite, scale, reaction, support, movement }. spoils: { pool, n, rare? } item drops on a win (n distinct
// picks from pool); relic: a boss's signature item, dropped on the first clear.
// Line-ups and levels are tuned with `node src/game/campaignsim.mjs n=128 jobs=8` (the whole chapter, both sides on
// ai.js, applyResults between battles): AI-played party first-try win rate b1 ~89% down to b7 ~66-72%, 8-15 rounds.
// R10 (equipment): the sim's company now shops before every battle and wears the level kit's mirror on the enemy side,
// so these levels are one tier-step higher than R9's; on the R10 maps, n=256: b1 89 s1 87 b2 83 b3 82 s2 88 b4 79
// b5 79 b6 71 b7 64. Levels 4->5 and 6->7 are ALSO gear steps (equipment.enemyTier), the steepest cliffs in the table.
// Enemy levels are steppy, not smooth: a class gains an action at levels 3/6/9, its R/S/M at 2/3/4 and a secondary
// set at 8 (progression.enemyOpts), so one level on a boss can move a battle 20+ points -- re-run the sim after edits.
// R12 (hero job): the Oathknight lifted every battle 5-20 points (b3 95, b4 93, b7 83), so the line-ups below were re-tuned
// to the old band: b2 Deserter 5 / Camp Thief 4, b3 Bowman 5 and Varg hpMul 1.3, b4 Acolyte 10 / Pikeman 9 / Risen 9 /
// Risen Archer 8 / Cantor 10, b6 Veiled Blade 9 / Invoker 9 and Ash-Maw hpMul 1.65, b7 Malquor 13 (hpMul 1.8) / Wyrm 11 /
// Echoes 11+10 / Captain 10, s1 last hound +2. n=384: b1 84 s1 86 b2 82 b3 80 s2 88 b4 76 b5 72 b6 65 b7 70.
// needs: node ids that must be cleared first. links: roads drawn on the map (to earlier nodes).
export const BATTLES = [
  {
    id: 'b1', kind: 'story', map: 'wendford_crossing', name: 'Wend Ford', x: 502, y: 512, links: ['hollin'], needs: [],
    blurb: 'Bandits wait where the old road fords the Wend.',
    // Parity r13: the 84% the sim reported for this line-up was a company that had already spent 970 florins at Hollin; the
    // New Game flow goes Formation -> Wend Ford with the starter kit, where it won 64% (the browser AI-party matched it:
    // 8/12). The two Poachers' charged Focused Shots (50+ on a mage) decided it, so they drop to Lv 3 / 3 (integrator: ~90% AI first try, not a 97% walkover): 97% at 3/2 AI first
    // try with the default five, ~52% with Pell (Lv 1) fielded instead of Brannoc.
    enemies: [['thief', 4, 'Cutpurse'], ['footman', 4, 'Brigand'], ['footman', 4, 'Brigand'], ['archer', 3, 'Poacher'], ['archer', 3, 'Poacher']],
    florins: 600, recruit: null, spoils: { pool: ['dirk', 'felt_cap', 'linen_tunic', 'shortbow', 'leather_bracer'], n: 1 },
    intro: [
      ['narrator', 'The year the long war ended, the Crown had no coin left for soldiers. It hired companies instead.'],
      ['brannoc', 'One cart, one crate, three days to Ravenscar. The Crown pays double and asks no questions. I like that in a client.'],
      ['ysolde', 'I would like to ask one question. Why does the crate hum?'],
      ['aldric', 'Leave it sealed. We were paid to carry it, not to open it.'],
      ['tobin', 'Riders on the far bank. Four... no, five. No colours.'],
      ['aldric', 'Wagons back from the water. Company, to me!'],
    ],
    outro: [['brannoc', 'Road trash, but well fed. Someone paid them to be here.'], ['seren', 'One of them had a grey hood folded in his pack. Like a priest\'s.']],
  },
  {
    // R15 (integrator): story-fit maps -- b2 marrow_camp, s2 watchtower_ruin, s3 rimewood, c2 vesk_hollow, c3 tithe_road,
    // s4 varg_shore, c6 kings_road, c7 undercroft, c8 aurelmont_nave. Their shorter approaches made b2/c7/c8 ~+10 easier,
    // so every enemy in those three nodes is +1 level.
    id: 'b2', kind: 'story', map: 'marrow_camp', name: 'Marrow Flats', x: 650, y: 470, links: ['b1'], needs: ['b1'],
    blurb: 'Night camp on the open flats. Something is hunting the company.',
    // R18 (review17 P5): b2 was a full rout on Normal for a player straight out of b1 (Lv 2-3 party); every foe -1 Lv.
    enemies: [['hound', 4, 'Ash Hound'], ['hound', 4, 'Ash Hound'], ['footman', 5, 'Deserter'], ['apothecary', 5, 'Camp Thief'], ['archer', 5, 'Deserter']],
    florins: 800, recruit: { key: 'wren', name: 'Wren', cls: 'hunter', lvl: 3, brv: 64 }, spoils: { pool: ['boar_spear', 'iron_sallet', 'hempen_robe', 'leather_bracer', 'hatchet'], n: 2 },
    intro: [
      ['narrator', 'Two nights out from Hollin, the flats go quiet. Even the crickets stop.'],
      ['tobin', 'Hounds. Ash hounds, by the smell. Somebody\'s run them all the way from the burned country.'],
      ['pell', 'Hounds don\'t carry torches, sir.'],
      ['aldric', 'Deserters behind the pack. They want the cart. Circle it and hold.'],
    ],
    outro: [
      ['wren', 'I\'ve tracked that pack three weeks. You killed it in an evening. Mind if I walk with you?'],
      ['ysolde', 'Aldric. The crate is open. The stone inside is gone.'],
      ['brannoc', 'Varg. That was Varg\'s knot on the harness. He\'ll run for the aqueduct road.'],
    ],
  },
  {
    id: 'b3', kind: 'story', map: 'aqueduct_span', name: 'Old Aqueduct', x: 716, y: 352, links: ['b2'], needs: ['b2'],
    blurb: 'Varg the bandit chief runs the stone across the high aqueduct.',
    // BOSS Varg: was a pushover -- his Lv 6 learned set was Steal Weapon / Pilfer / Beguile, so he opened every fight
    // stealing and never drew blood. Now a knife-fighter who dashes and blinks in (Dash Thrust, Phantom Cut) with his
    // Magpie's Kris (WP 8, Disarm on hit) doing the stealing for him, on Wayfarer Boots.
    enemies: [['thief', 7, 'Varg', { learned: ['dash_thrust', 'phantom_cut', 'beguile'], equip: { weapon: 'magpie_kris', acc: 'wayfarer_boots' }, hpMul: 1.2 }],
      ['archer', 5, 'Bowman'], ['knight', 4, 'Sellsword'], ['sorcerer', 4, 'Hedge Mage'], ['apothecary', 4, 'Runner']],
    florins: 1100, recruit: null, spoils: { pool: ['viper_kris', 'plumed_hat', 'leather_jerkin', 'longbow'], n: 2 }, relic: 'magpie_kris',
    intro: [
      ['varg', 'Brannoc! Still hauling the Crown\'s crates? The grey hoods pay better, old friend.'],
      ['brannoc', 'You were never my friend, Varg. Give back the stone and I\'ll let you swim.'],
      ['varg', 'It sings, you know. At night. I\'ll be glad to be rid of it.'],
      ['aldric', 'Across the span, then. Keep your footing.'],
    ],
    outro: [
      ['varg', 'Too late... the acolytes took it at dawn. North, to the vineyards. Gods help Lornhill.'],
      ['seren', 'He\'s shaking. Whatever that stone does, he saw it.'],
    ],
  },
  {
    id: 'b4', kind: 'story', map: 'highland_terraces', name: 'Lornhill Terraces', x: 790, y: 262, links: ['b3'], needs: ['b3'],
    blurb: 'The vineyards are full of the dead, and a bell is ringing.',
    enemies: [['warlock', 9, 'Grey Acolyte'], ['skeleton', 8, 'Risen Pikeman'], ['zombie', 7, 'Risen'], ['skeleton', 8, 'Risen Archer'], ['mystic', 8, 'Choir Cantor']],
    florins: 1400, recruit: { key: 'osric', name: 'Osric', cls: 'monk', lvl: 6, brv: 72 }, spoils: { pool: ['silk_robe', 'cleric_staff', 'hermits_rosary', 'barbute', 'frost_rod'], n: 2 },
    intro: [
      ['narrator', 'Lornhill buried two hundred men in the last year of the war. Tonight they are walking the terraces.'],
      ['acolyte', 'Hear it? The Bell-Stone remembers every voice the war silenced. We only help them answer.'],
      ['osric', 'Those were my brothers\' graves. Whoever you are, I\'ll hold the upper terrace with you.'],
      ['aldric', 'Break the cantors first. The dead follow the song.'],
    ],
    outro: [
      ['osric', 'They lay down when the cantor fell. Just... lay down, like tired men.'],
      ['acolyte', 'Ser Galen holds the Twin Bridges. You will not pass them.'],
    ],
  },
  {
    id: 'b5', kind: 'story', map: 'twin_span', name: 'The Twin Bridges', x: 984, y: 390, links: ['b4'], needs: ['b4'],
    blurb: 'Choir knights hold both spans over the gorge.',
    // BOSS Ser Galen: the Oathblade (WP 9, Fear on hit) and Night Edge as his opening verb -- the Choir's champion
    // breaks your nerve before he breaks your line. Guardian's Sigil keeps him under Protect.
    enemies: [['blademaster', 8, 'Ser Galen', { learned: ['night_edge', 'wrath_draw', 'blade_veil'], equip: { weapon: 'oathblade' }, hpMul: 1.3 }],
      ['dreadknight', 6, 'Choir Knight'], ['knight', 7, 'Choir Knight'], ['archer', 6, 'Bridge Archer'], ['chronomancer', 6, 'Choir Chronist']],
    florins: 1800, recruit: { key: 'corvina', name: 'Corvina', cls: 'dreadknight', lvl: 8, brv: 70 }, spoils: { pool: ['steel_cuirass', 'kite_shield', 'mistcutter', 'brawlers_cuff'], n: 2 }, relic: 'oathblade',
    intro: [
      ['galen', 'Company of ash. You kill for coin. We kill so that no one is ever forgotten again.'],
      ['aldric', 'You raised a village\'s dead to dig your trenches. That isn\'t remembering.'],
      ['corvina', 'Ser Galen... he isn\'t wrong. We saw the vineyards. That was not what we swore to.'],
      ['galen', 'Hold your tongue, Corvina, and hold the bridge.'],
    ],
    outro: [
      ['corvina', 'I swore to the Choir to honour the dead, not to march them. Let me ride with you. I know Ravenscar\'s gates.'],
      ['brannoc', 'A turncoat in the company. Well. We\'ve had worse.'],
    ],
  },
  {
    id: 'b6', kind: 'story', map: 'ravenscar_ascent', name: 'Ravenscar Ascent', x: 1036, y: 170, links: ['b5'], needs: ['b5'],
    blurb: 'Storm the cliff road to the Choir-held fortress.',
    // BOSS Ash-Maw: the chained beast carries the Cinder Heart in its chest (auto-Regen, fire +25%, drinks fire) and
    // stands a head taller than a normal behemoth. Break it fast or it breathes back what you took.
    enemies: [['behemoth', 9, 'Ash-Maw', { equip: { acc: 'cinder_heart' }, hpMul: 1.5, scale: 1.12 }], ['ninja', 8, 'Veiled Blade'], ['conjurer', 8, 'Choir Invoker'], ['knight', 8, 'Gate Warden']],
    florins: 2400, recruit: null, spoils: { pool: ['chain_shirt', 'sages_circlet', 'wayfarer_boots', 'snaphance'], n: 2 }, relic: 'cinder_heart',
    intro: [
      ['corvina', 'The cliff road is the only way up. They keep a beast chained at the second gate.'],
      ['ysolde', 'You say that like it\'s a small beast.'],
      ['tobin', 'It is not a small beast.'],
      ['aldric', 'Up the road, gate by gate. Nobody fights alone.'],
    ],
    outro: [
      ['corvina', 'Malquor isn\'t here. The chapel in the marsh... he means to ring the stone where the drowned army lies.'],
      ['seren', 'Ten thousand dead under that water. If they wake...'],
    ],
  },
  {
    id: 'b7', kind: 'story', map: 'sunken_choir', name: 'The Drowned Chapel', x: 924, y: 592, links: ['b6'], needs: ['b6'], final: true,
    blurb: 'Hierophant Malquor rings the Bell-Stone over the drowned army.',
    // BOSS Malquor: wears the Bell-Stone Shard -- he rises once from his first defeat (auto-Reraise) and casts harder.
    enemies: [['necromancer', 13, 'Malquor', { equip: { acc: 'bell_shard' }, hpMul: 1.8 }], ['wyrm', 11, 'Marsh Wyrm'], ['ghost', 11, 'Drowned Echo'], ['ghost', 11, 'Drowned Echo'], ['skeleton', 10, 'Risen Captain']],
    florins: 3500, recruit: null, spoils: { pool: ['great_helm', 'sages_vestment', 'guardian_sigil', 'dawn_staff'], n: 2 }, relic: 'bell_shard',
    intro: [
      ['malquor', 'You carried it to me yourselves, mercenaries. Every road you took was mine.'],
      ['aldric', 'We carried a crate. We\'re here to take it back.'],
      ['malquor', 'Listen to them. The war ended and no one said their names. The Bell-Stone will say them all at once.'],
      ['seren', 'Then we\'ll say them for you, when this is over. Company, with me!'],
    ],
    outro: [
      ['narrator', 'The Bell-Stone cracks with a sound like a last breath. The marsh goes still.'],
      ['brannoc', 'Double pay. I\'m told the Crown asks no questions.'],
      ['aldric', 'Then it had better start. Somebody made that stone. And there was more than one crate on the manifest.'],
      ['narrator', 'End of Chapter I. The Ember Oath.'],
    ],
  },
  // --- optional, repeatable ---
  {
    id: 's1', kind: 'side', map: 'saltglass_dunes', name: 'Saltglass Dunes', x: 282, y: 262, links: ['hollin'], needs: ['b1'],
    blurb: 'Beasts gather at the dune wells. Good hunting, fair pay.',
    enemies: [['cockatrice', 2], ['hound', 2], ['cockatrice', 2], ['werewolf', 2], ['hound', 2]],
    florins: 500, recruit: { key: 'mirela', name: 'Mirela', cls: 'earthshaper', lvl: 4, brv: 60 }, recruitOnce: true,
    spoils: { pool: ['leather_jerkin', 'plumed_hat', 'hatchet', 'leather_bracer', 'sorcerers_band'], n: 1, rare: { id: 'wayfarer_boots', chance: 0.15 } },
    intro: [
      ['mirela', 'You\'re the Cinder Company? Good. The wells are overrun and my guild won\'t pay for help. You look cheap.'],
      ['brannoc', 'We are not cheap. We are affordable.'],
    ],
    outro: [['mirela', 'The sand listens to me, you know. Take me along and it\'ll listen to you too.']],
    repeatIntro: [['narrator', 'The dune wells have drawn beasts again.']],
  },
  {
    id: 's2', kind: 'side', map: 'watchtower_ruin', name: 'Watchtower Ruin', lbl: 'up', x: 490, y: 272, links: ['b3'], needs: ['b3'],
    blurb: 'Risen dead haunt the old watchtower. The Crown pays a bounty per skull.',
    enemies: [['skeleton', 4, 'Risen'], ['zombie', 3, 'Risen'], ['ghost', 4, 'Echo'], ['skeleton', 4, 'Risen'], ['warlock', 4, 'Grey Acolyte']],
    florins: 700, recruit: null, spoils: { pool: ['hermits_rosary', 'silk_robe', 'barbute', 'viper_kris', 'warding_ribbon'], n: 1, rare: { id: 'verdant_pendant', chance: 0.12 } },
    intro: [
      ['osric', 'More of the Choir\'s work. They left a cantor here to keep the dead singing.'],
      ['aldric', 'Then we end the song. Quietly.'],
    ],
    outro: [['seren', 'Rest now. Your names were said.']],
  },
];

// ================================================================= CHAPTER II: THE HOLLOW CROWN =================================
// The Northreach (assets/worldmap2.jpg). Story nodes c1-c8, skirmishes s3-s5. Same rules as Chapter I; `objective` is read by
// objectiveFor() below: { leader: <enemy index> } = "Defeat <that enemy>!", { protect: 'hero' } = the captain must not fall.
// Levels tuned with `node src/game/campaignsim.mjs n=256 jobs=14` (Chapter II runs after Chapter I with the party it produced;
// Chapter I unchanged). First-try AI win%: c1 87 s3 77 c2 85 c3 81 s4 70 c4 78 s5 81 c5 65 c6 69 c7 69 c8 61, 0 timeouts,
// 7-10 rounds. As in Chapter I the table is steppy: a ranged enemy (archer / hunter / gunner) is worth 20-40 points on the
// high-ground maps here, which is why several line-ups carry one at a deliberately low level.
BATTLES.push(
  {
    id: 'c1', ch: 2, kind: 'story', map: 'greyspine_pass', name: 'Greyspine Pass', x: 404, y: 586, links: ['road_south'], needs: ['b7'],
    blurb: 'Raiders and frost beasts hold the col of the pass north.',
    enemies: [['wendigo', 12, 'Wendigo'], ['hound', 12, 'Rime Hound'], ['werewolf', 12, 'Pass Wolf'], ['footman', 12, 'Pass Raider'], ['archer', 8, 'Raider Lookout']],
    florins: 2600, recruit: null, spoils: { pool: ['great_helm', 'rangers_garb', 'chain_shirt', 'yew_warbow', 'swift_anklet'], n: 2 },
    intro: [
      ['narrator', 'The Greyspine road climbs until the air hurts. At the col the snow is trampled by something with too many knuckles.'],
      ['tobin', 'Wendigo tracks. And boots beside them. Raiders use the beasts to herd travellers into the cut.'],
      ['wren', 'The Crown pays a bounty on both. Nobody\'s collected it in years.'],
      ['aldric', 'Then we collect. Hold the road and take the col.'],
    ],
    outro: [
      ['brannoc', 'Raiders in Crown-issue boots. Somebody outfits these people.'],
      ['seren', 'Look north. Every village below us has a bell tower, and every bell is tolling.'],
    ],
  },
  {
    id: 'c2', ch: 2, kind: 'story', map: 'vesk_hollow', name: 'The Bell Tithe', x: 566, y: 404, links: ['c1'], needs: ['c1'],
    blurb: 'The Crown\'s Bellwardens have come to collect Vesk Hollow\'s dead.',
    enemies: [['bellwarden', 14, 'Crown Bellwarden'], ['knight', 14, 'Tithe Knight'], ['chirurgeon', 13, 'Chirurgeon'], ['archer', 12, 'Tithe Archer'], ['beetle', 14, 'Tithe Siegebreaker']],
    florins: 2800, recruit: { key: 'tamsin', name: 'Tamsin', cls: 'runesword', lvl: 11, brv: 68 }, spoils: { pool: ['sages_circlet', 'sages_vestment', 'warding_ribbon', 'dawnfang', 'bastion_shield'], n: 2 },
    intro: [
      ['narrator', 'Vesk Hollow rings its bell for its dead. Today the Crown has come to collect them.'],
      ['tamsin', 'Get out of my village, warden! My father is barely cold!'],
      ['warden', 'The tithe is owed, girl. The Crown claims every soldier it ever paid. Living, or otherwise.'],
      ['aldric', 'Company! Between the wardens and the graves.'],
    ],
    outro: [
      ['tamsin', 'They have carted the dead out of three villages this month. The wagons go to Karsmoor, down the Tithe Road.'],
      ['tamsin', 'I\'m Tamsin. My blade is runed and I know every road north of the pass. Let me ride with you.'],
      ['corvina', 'Wagons of the dead, bound for a bellfoundry. I have seen this before. I was on the other side of it.'],
    ],
  },
  {
    id: 'c3', ch: 2, kind: 'story', map: 'tithe_road', name: 'The Tithe Road', x: 676, y: 466, links: ['c2'], needs: ['c2'], objective: { leader: 0 },
    blurb: 'A tithe-wagon of the dead rolls for Karsmoor under Crown guard.',
    // BOSS Wagonmaster Crane: a Crown knight in the Warden's Tithe (auto-Protect and Shell). The objective is HIM -- the guard
    // breaks when the wagonmaster falls -- so the fight is a dash through gunfire to one heavily armoured man.
    enemies: [['knight', 13, 'Wagonmaster Crane', { equip: { acc: 'wardens_tithe' }, hpMul: 1.35 }], ['gunner', 14, 'Foundry Gunner'], ['boar', 13, 'Draught Boar'], ['archer', 13, 'Tithe Archer'], ['bellwarden', 13, 'Crown Bellwarden']],
    florins: 3000, recruit: { key: 'hesper', name: 'Hesper', cls: 'gunner', lvl: 12, brv: 62 }, spoils: { pool: ['longbarrel', 'anvilbreaker', 'choirsteel_plate', 'guardian_sigil', 'verdant_pendant'], n: 2 }, relic: 'wardens_tithe',
    intro: [
      ['crane', 'Stand aside, sellswords. These are the King\'s dead and this is the King\'s road.'],
      ['hesper', 'Please! I only load the guns. I didn\'t know what the wagons carried.'],
      ['aldric', 'Now you know. Choose your side.'],
      ['crane', 'Guns up! Nobody touches the tithe!'],
    ],
    outro: [
      ['hesper', 'Master Vey casts the Bell-Stones in the deep furnace. Every stone needs a hundred of the dead to tune it.'],
      ['hesper', 'I cast cannon for him for six years. I\'ll aim them at him now, if you\'ll have me.'],
      ['brannoc', 'A gunner. Finally someone in this company who can hit what I point at.'],
    ],
  },
  {
    id: 'c4', ch: 2, kind: 'story', map: 'ashfall_barrow', name: 'Ashfall Barrow', x: 1004, y: 606, links: ['c3'], needs: ['c3'],
    blurb: 'The foundry digs Bell-Stone from a barrow older than the kingdom.',
    enemies: [['ossuary', 17, 'Ossuary Wheel'], ['necromancer', 17, 'Barrow-Priest'], ['wendigo', 17, 'Barrow Wendigo'], ['archer', 17, 'Foundry Picket'], ['skeleton', 16, 'Barrow Guard']],
    florins: 3200, recruit: null, spoils: { pool: ['saints_charm', 'swift_anklet', 'sages_vestment', 'warden_greatsword', 'dawn_staff'], n: 2 },
    intro: [
      ['narrator', 'On the heath east of Karsmoor, the foundry is digging into a barrow older than the kingdom.'],
      ['hesper', 'They call him the Barrow King. The first bell was cast from the stone they found in his tomb.'],
      ['osric', 'Pickets on the spoil heaps, and the whole mound awake beneath them. Priests, bones, and whatever that wheel is.'],
      ['aldric', 'Break the dig. No stone, no bells.'],
    ],
    outro: [
      ['seren', 'The tomb is empty. Whatever lay at the heart of the mound, they have already carted it away.'],
      ['hesper', 'To the capital. The Chancellor wanted the King himself.'],
    ],
  },
  {
    id: 'c5', ch: 2, kind: 'story', map: 'karsmoor_foundry', name: 'Karsmoor Foundry', x: 806, y: 392, links: ['c4', 'c3'], needs: ['c4'],
    blurb: 'Master Founder Ossian Vey tolls his bell over the Royal Bellfoundry.',
    // BOSS Ossian Vey: a Bellwarden with every Knell and the Founder's Bell (WP 9, holy +25%, Sleep on hit) under a Guardian's
    // Sigil. Toll the Dead stands his fallen yard back up at 40% -- the second wave -- so a company that grinds down the yard
    // and leaves the bell-ringer for last fights it twice. Rout: every one of them must stay down.
    enemies: [['bellwarden', 18, 'Ossian Vey', { learned: ['knell', 'toll_the_dead', 'toll_of_rest', 'great_knell', 'vesper'], equip: { weapon: 'founders_bell', acc: 'guardian_sigil' }, hpMul: 1.7 }],
      ['ossuary', 17, 'Ossuary Wheel'], ['gunner', 18, 'Foundry Gunner'], ['necromancer', 18, 'Foundry Cantor'], ['beetle', 18, 'Siegebreaker']],
    florins: 3800, recruit: null, spoils: { pool: ['runesteel_blade', 'vesper_staff', 'mithril_mail', 'magus_hood', 'culverin'], n: 2 }, relic: 'founders_bell',
    intro: [
      ['vey', 'The Cinder Company. Your crate was my finest casting, you know. Malquor wasted it on a swamp.'],
      ['aldric', 'Your bells raise the dead to fight for a Crown that won\'t pay the living.'],
      ['vey', 'The dead are loyal, captain. They never desert, never strike, and never ask for a pension.'],
      ['vey', 'Listen. Every soul in this yard answers when I toll. Break them as often as you like.'],
      ['tamsin', 'Then we silence the bell-ringer. Everyone, at Vey!'],
    ],
    outro: [
      ['vey', 'The Great Bell... is already hung... he rings it at the Crowning...'],
      ['narrator', 'In Vey\'s ledger one order stands above the rest: a bell the size of a house, for the cathedral of Aurelmont.'],
      ['corvina', 'The Crowning is in three days. Every soldier who ever died for this kingdom will be standing in the square.'],
    ],
  },
  {
    id: 'c6', ch: 2, kind: 'story', map: 'kings_road', name: 'The King\'s Road', x: 948, y: 318, links: ['c5'], needs: ['c5'], objective: { protect: 'hero' },
    blurb: 'Crown executioners hunt the captain on the road to the capital.',
    enemies: [['assassin', 14, 'Crown Headsman'], ['knight', 15, 'Kingsguard'], ['blademaster', 15, 'Kingsguard'], ['werewolf', 14, 'Warhound'], ['hunter', 10, 'Crown Tracker']],
    florins: 4200, recruit: null, spoils: { pool: ['nightfang', 'northwind_bow', 'shadow_leathers', 'frostmoon', 'vigil_charm'], n: 2 },
    intro: [
      ['narrator', 'The Chancellor has posted a price on the captain of the Cinder Company: traitor, bell-breaker, murderer of a Royal Founder.'],
      ['brannoc', 'Five thousand crowns. I\'m almost insulted they didn\'t hire us to collect it.'],
      ['headsman', 'The Chancellor wants the captain\'s head. The rest of you may keep yours, if you run.'],
      ['seren', 'They\'re here for Aldric. Keep him standing. If he falls, the company falls with him.'],
    ],
    outro: [
      ['aldric', 'Crown executioners on the King\'s own road. Where is the King in all this?'],
      ['hesper', 'No one has seen him in a year. The Chancellor speaks for him. The Chancellor speaks for everyone.'],
    ],
  },
  {
    id: 'c7', ch: 2, kind: 'story', map: 'undercroft', name: 'The Undercroft', x: 1044, y: 254, links: ['c6'], needs: ['c6'],
    blurb: 'Under the capital, the flooded crypts run to the cathedral stair.',
    // BOSS the Gloom Cerberus: the cathedral's chained gate-beast in the Eclipse Collar (auto-Haste, drinks dark).
    enemies: [['gloomhound', 19, 'Gloom Cerberus', { equip: { acc: 'eclipse_collar' }, hpMul: 1.5, scale: 1.1 }], ['bellwarden', 19, 'Crypt Warden'], ['vampire', 19, 'Crypt Thrall'], ['gunner', 18, 'Crypt Gunner'], ['ghost', 18, 'Crypt Echo']],
    florins: 4600, recruit: null, spoils: { pool: ['crown_plate', 'archmage_robe', 'grand_armet', 'knights_brooch', 'arcanist_ring', 'tower_shield'], n: 2 }, relic: 'eclipse_collar',
    intro: [
      ['narrator', 'Aurelmont has shut its gates for the Crowning. Beneath the city, the old crypts run all the way to the cathedral.'],
      ['corvina', 'The Choir used these tunnels. There is a gate-beast chained at the cathedral stair.'],
      ['ysolde', 'Of course there is.'],
      ['tobin', 'It is not a small beast.'],
    ],
    outro: [
      ['narrator', 'Behind the beast, a sealed crypt. On the bier, the King. Dead a year, bound in a founder\'s cage of bell-bronze.'],
      ['seren', 'The King has been dead all this time. Maule rings him up for audiences.'],
      ['aldric', 'Then there is no one left to ask. Only one man left to answer.'],
    ],
  },
  {
    id: 'c8', ch: 2, kind: 'story', map: 'aurelmont_nave', name: 'The Hollow Crown', x: 1096, y: 152, links: ['c7'], needs: ['c7'], final: true,
    blurb: 'Chancellor Maule rings the Great Bell over the Crowning.',
    // BOSS Chancellor Maule wears the Hollow Crown (auto-Reraise, MAG/RES/SPD up): he rises once from his first fall, and the
    // Barrow King -- the colossus dug out of Ashfall -- stands at his side. Both must fall.
    enemies: [['vampire', 19, 'Chancellor Maule', { equip: { acc: 'hollow_crown' }, hpMul: 1.4 }], ['colossus', 18, 'The Barrow King', { hpMul: 1.9, scale: 1.08 }], ['bellwarden', 18, 'Cathedral Warden'], ['knight', 17, 'Kingsguard'], ['conjurer', 17, 'Court Invoker']],
    florins: 6000, recruit: null, spoils: { pool: ['kingsguard_blade', 'bellhammer', 'spinebreaker', 'rimeglass_rod', 'courtsword'], n: 2 }, relic: 'hollow_crown',
    intro: [
      ['maule', 'Mercenaries. How fitting. You are the last of a dying trade.'],
      ['maule', 'The living want coin, and bread, and a say. The dead want nothing. I will give this kingdom an army that wants nothing, and a king who says only what I tell him.'],
      ['aldric', 'We carried your crate. We cracked your stone. We came for our pay, Chancellor.'],
      ['maule', 'Then take it from the King\'s own hands. Rise, old king. Your Crowning is at hand.'],
      ['brannoc', 'That is not a small beast either.'],
    ],
    outro: [
      ['narrator', 'The Great Bell tears loose from its tower and breaks on the cathedral steps. Across the city, ten thousand dead lie down at once.'],
      ['corvina', 'The Chancellor is dead and the King a year dead. Who holds the crown now?'],
      ['aldric', 'Nobody is paying us to decide that.'],
      ['seren', 'No. But somebody should say their names. All of them.'],
      ['narrator', 'End of Chapter II. The Hollow Crown.'],
    ],
  },
  // --- Chapter II skirmishes (optional, repeatable; levels float on the company) ---
  {
    id: 's3', ch: 2, kind: 'side', map: 'rimewood', name: 'Rimewood Hunt', x: 226, y: 318, links: ['c1'], needs: ['c1'],
    blurb: 'Rimewood trappers pay for wendigo pelts. Good coin, bad teeth.',
    enemies: [['wendigo', 5], ['werewolf', 5], ['beetle', 5], ['boar', 5], ['hound', 5]],
    florins: 1400, recruit: null, spoils: { pool: ['rangers_garb', 'swift_anklet', 'yew_warbow', 'wyrmtooth_glaive', 'plumed_hat'], n: 1, rare: { id: 'vigil_charm', chance: 0.15 } },
    intro: [
      ['wren', 'The Rimewood trappers pay by the pelt. Wendigo pelts pay best, if you can keep your fingers.'],
      ['tobin', 'The pack is gathering above the treeline. They know we are coming.'],
    ],
    outro: [['wren', 'Pelts for the trappers, meat for the village. A good day on the hill.']],
    repeatIntro: [['narrator', 'The Rimewood pack has gathered again above the treeline.']],
  },
  {
    id: 's4', ch: 2, kind: 'side', map: 'varg_shore', name: 'Varg\'s Wager', x: 648, y: 244, links: ['c3'], needs: ['c3'],
    blurb: 'Crown gaolers mean to hang a thief on the lakeshore. The thief is an old acquaintance.',
    enemies: [['knight', 0, 'Crown Gaoler'], ['archer', 0, 'Gaol Archer'], ['bellwarden', 0, 'Crown Bellwarden'], ['chirurgeon', -1, 'Chirurgeon'], ['knight', -1, 'Crown Gaoler']],
    florins: 1600, recruit: { key: 'varg', name: 'Varg', cls: 'thief', lvl: 12, brv: 64 }, recruitOnce: true,
    spoils: { pool: ['mailbreaker', 'viper_kris', 'leather_jerkin', 'warding_ribbon', 'wayfarer_boots'], n: 1, rare: { id: 'nightfang', chance: 0.15 } },
    intro: [
      ['varg', 'Brannoc! Tell these Crown thugs I\'m worth more alive. I robbed the Crown\'s own tithe-wagon. You\'d think they\'d admire the nerve.'],
      ['brannoc', 'They\'re going to hang you, Varg.'],
      ['varg', 'Which is why you\'re here. For old times.'],
    ],
    outro: [
      ['varg', 'Twice now you\'ve had cause to let me drown, and twice you haven\'t. My knife is yours till the debt is paid.'],
      ['brannoc', 'Keep your hands where I can see them.'],
    ],
    repeatIntro: [['narrator', 'Crown gaolers patrol the lakeshore, looking for the thief who got away.']],
  },
  {
    id: 's5', ch: 2, kind: 'side', map: 'ashfall_barrow', name: 'Barrow Wights', lbl: 'up', x: 1154, y: 566, links: ['c4'], needs: ['c4'],
    blurb: 'The emptied mounds still stir at dusk. Karsmoor pays to keep them quiet.',
    enemies: [['skeleton', 4, 'Barrow Guard'], ['wendigo', 4, 'Barrow Wendigo'], ['beetle', 4, 'Siegebreaker'], ['necromancer', 3, 'Barrow-Priest'], ['gunner', 1, 'Grave-Robber']],
    florins: 1500, recruit: null, spoils: { pool: ['saints_charm', 'hermits_rosary', 'dawn_staff', 'sages_circlet', 'great_helm'], n: 1, rare: { id: 'vigil_charm', chance: 0.12 } },
    intro: [
      ['osric', 'The mounds are empty, but the dead in them never learned to lie still. Somebody is still ringing for them.'],
      ['aldric', 'Then we end the song. Again.'],
    ],
    outro: [['seren', 'Rest now. Your names were said.']],
    repeatIntro: [['narrator', 'The barrow-dead stir again at dusk.']],
  },
);

// Chapter II opens with this scene (story screen, prologue card) the first time the world map loads after the Drowned Chapel.
export const CH2_PROLOGUE = [
  ['narrator', 'A month after the Drowned Chapel, the Crown paid the Cinder Company in full. It paid too quickly.'],
  ['aldric', 'Seven crates on the manifest. Six came south with us. The seventh was signed for at Greyspine, by the Royal Bellfoundry.'],
  ['corvina', 'Karsmoor. The Choir bought its stones there. Malquor only rang them.'],
  ['brannoc', 'A foundry doesn\'t cast what nobody ordered. Who\'s the customer?'],
  ['seren', 'The seal on the order is the Chancellor\'s.'],
  ['ysolde', 'The Crown had no coin for soldiers, so it hired us. The dead need no coin at all.'],
  ['aldric', 'Then we go north and ask the Chancellor our one question. Company, over the Greyspine.'],
];
// What entering Chapter II grants: the Crown's last honest payment, and a chest of northern kit from the quartermaster.
export const CH2_START = { florins: 3000, items: { chain_shirt: 1, sages_circlet: 1, swift_anklet: 1 } };

/** Briefing text for node `b`'s objective (formation / world map): { win, lose }. Mirrors battle.objectiveText(). */
export function objectiveText(b) {
  const o = b?.objective || {}; const foe = o.leader != null ? b.enemies[o.leader] : null;
  const hero = START_ROSTER.find((r) => r.hero)?.name || 'The captain';
  return { win: foe ? `Defeat ${foe[3]?.name || foe[2] || 'the leader'}!` : 'Defeat all enemies', lose: o.protect === 'hero' ? `${hero} falls` : 'All allies fall' };
}
/** The battle objective for node `b` (battle.setObjective / Engine.setObjective argument), resolved against the placed units.
 *  units: the engine's unit list (team, id, recordId); party: the deployed records (the hero is `r.hero`). */
export function objectiveFor(b, units, party = []) {
  const o = b?.objective; if (!o) return { type: 'rout' };
  const out = { type: 'rout' };
  if (o.leader != null) { const foe = units.filter((u) => u.team === 'B')[o.leader]; if (foe) { out.type = 'leader'; out.leaderId = foe.id; } }
  if (o.protect === 'hero') { const h = party.find((r) => r.hero); const u = h && units.find((x) => x.team === 'A' && x.recordId === h.id); if (u) out.protect = [u.recordId]; }
  return out;
}

export const NODE = Object.fromEntries(BATTLES.map((b) => [b.id, b]));
export const battleById = (id) => NODE[id] || null;

// ================================================================= STORY STAGING (src/campaign/stage) ==============================
// Scenes played ON the battle map with the real units: `intro` after the map loads (before deployment), `outro` after a
// first-clear victory (before the results screen). The shell's story screen keeps only the narrator lines of a staged
// node (travel/narration between battles); the dialogue itself is acted out here. Ops (stage/player.js runs them):
//   ['arrive']                    the deployed company walks in to its start tiles (the camera frames them)
//   ['line', i]                   line i of the node's intro/outro: camera on the speaker, speaker turns, dialogue window
//   ['say', who, text] / ['narr', text]
//   ['cam', who|'party'|'foes'|'all', zoom?]      ['wait', ms]      ['shake', amp]      ['flash', css colour]
//   ['step', who|'party'|'foes', toward, n]      n tiles toward `toward` (negative: away)
//   ['face', who, toward]         ['emote', who, '!' | '?' | '...' | '!!' | 'anger' | 'note']
//   ['enter', who, near, team?]   a character not in the battle walks in beside `near`; ['exit', who] walks off
//   ['join', who]                 "<name> joins the company" flourish (recruits)
//   ['plate', who]                boss nameplate slam + sting (title from BOSSES)
//   ['pose', who, pose, ms]       ['kneel', who]       ['fx', vfx, who]       ['sting', 'boss'|'bell'|'join'|'dread']
//   ['tableau', title, sub]       finale: the company gathers on the hero, slow pull-out, fade, a title card
// `who` is a CAST key. A speaker who is not on the field still talks (an unanchored window); moves just skip them.
export const STAGE = {
  b1: {
    intro: [
      ['arrive'], ['line', 1], ['emote', 'ysolde', '?'], ['face', 'ysolde', 'brannoc'], ['line', 2],
      ['face', 'aldric', 'ysolde'], ['line', 3],
      ['emote', 'tobin', '!'], ['line', 4], ['cam', 'foes'], ['step', 'foes', 'party', 1], ['wait', 400],
      ['cam', 'party'], ['emote', 'aldric', '!'], ['line', 5],
    ],
  },
  b2: {
    outro: [
      ['enter', 'wren', 'aldric'], ['line', 0], ['join', 'wren'],
      ['emote', 'ysolde', '!'], ['line', 1], ['emote', 'aldric', '!'], ['face', 'brannoc', 'aldric'], ['line', 2],
    ],
  },
  b3: {
    intro: [
      ['arrive'], ['cam', 'varg', 1.7], ['step', 'varg', 'party', 2], ['plate', 'varg'], ['line', 0],
      ['emote', 'brannoc', 'anger'], ['face', 'brannoc', 'varg'], ['line', 1],
      ['line', 2], ['step', 'varg', 'party', -2], ['cam', 'party'], ['line', 3],
    ],
    outro: [['kneel', 'varg'], ['cam', 'varg', 1.7], ['line', 0], ['emote', 'seren', '...'], ['line', 1]],
  },
  b4: {
    intro: [
      ['arrive'], ['cam', 'acolyte', 1.6], ['pose', 'acolyte', 'cast', 900], ['fx', 'debuff', 'acolyte'], ['sting', 'dread'], ['line', 1],
      ['enter', 'osric', 'aldric'], ['emote', 'osric', '!'], ['line', 2], ['face', 'aldric', 'osric'], ['line', 3], ['exit', 'osric'],
    ],
    outro: [['enter', 'osric', 'aldric'], ['line', 0], ['kneel', 'acolyte'], ['line', 1], ['emote', 'osric', 'anger'], ['join', 'osric']],
  },
  b5: {
    intro: [
      ['arrive'], ['cam', 'galen', 1.7], ['step', 'galen', 'party', 1], ['plate', 'galen'], ['line', 0],
      ['face', 'aldric', 'galen'], ['line', 1],
      ['enter', 'corvina', 'galen', 'B'], ['face', 'corvina', 'galen'], ['line', 2],
      ['emote', 'galen', 'anger'], ['face', 'galen', 'corvina'], ['line', 3], ['exit', 'corvina'],
    ],
    outro: [['enter', 'corvina', 'aldric'], ['line', 0], ['join', 'corvina'], ['emote', 'brannoc', '...'], ['line', 1]],
  },
  b6: {
    intro: [
      ['arrive'], ['line', 0], ['cam', 'ashmaw', 1.5], ['shake', 0.3], ['sting', 'dread'], ['plate', 'ashmaw'],
      ['emote', 'ysolde', '...'], ['line', 1], ['line', 2], ['cam', 'party'], ['line', 3],
    ],
  },
  b7: {
    intro: [
      ['arrive'], ['cam', 'malquor', 1.7], ['pose', 'malquor', 'cast', 1200], ['fx', 'debuff', 'malquor'], ['plate', 'malquor'], ['line', 0],
      ['line', 1], ['line', 2], ['emote', 'seren', '!'], ['line', 3],
    ],
    outro: [
      ['cam', 'malquor', 1.5], ['fx', 'holy', 'malquor'], ['flash', '#fff4d8'], ['shake', 0.35], ['sting', 'bell'], ['narr', 0],
      ['line', 1], ['face', 'aldric', 'brannoc'], ['line', 2],
      ['tableau', 'The Ember Oath', 'End of Chapter I'],
    ],
  },
  s1: { outro: [['enter', 'mirela', 'aldric'], ['line', 0], ['join', 'mirela']] },
  c2: {
    intro: [
      ['arrive'], ['enter', 'tamsin', 'warden'], ['face', 'tamsin', 'warden'], ['emote', 'tamsin', 'anger'], ['line', 1],
      ['cam', 'warden', 1.7], ['plate', 'warden'], ['line', 2], ['cam', 'party'], ['emote', 'aldric', '!'], ['line', 3], ['exit', 'tamsin'],
    ],
    outro: [['enter', 'tamsin', 'aldric'], ['line', 0], ['line', 1], ['join', 'tamsin'], ['face', 'corvina', 'tamsin'], ['line', 2]],
  },
  c3: {
    intro: [
      ['arrive'], ['cam', 'crane', 1.7], ['step', 'crane', 'party', 1], ['plate', 'crane'], ['line', 0],
      ['enter', 'hesper', 'crane'], ['emote', 'hesper', '!'], ['line', 1], ['face', 'aldric', 'hesper'], ['line', 2],
      ['emote', 'crane', 'anger'], ['line', 3], ['exit', 'hesper'],
    ],
    outro: [['enter', 'hesper', 'aldric'], ['line', 0], ['line', 1], ['join', 'hesper'], ['emote', 'brannoc', 'note'], ['line', 2]],
  },
  c5: {
    intro: [
      ['arrive'], ['cam', 'vey', 1.7], ['step', 'vey', 'party', 1], ['plate', 'vey'], ['line', 0],
      ['face', 'aldric', 'vey'], ['line', 1], ['line', 2],
      ['pose', 'vey', 'cast', 1300], ['fx', 'holy', 'vey'], ['shake', 0.22], ['sting', 'bell'], ['line', 3],
      ['emote', 'tamsin', 'anger'], ['line', 4],
    ],
    outro: [['kneel', 'vey'], ['cam', 'vey', 1.7], ['line', 0], ['narr', 1], ['line', 2]],
  },
  c6: {
    intro: [['arrive'], ['line', 1], ['cam', 'headsman', 1.7], ['step', 'headsman', 'party', 1], ['plate', 'headsman'], ['line', 2], ['emote', 'seren', '!'], ['line', 3]],
  },
  c7: {
    intro: [['arrive'], ['line', 1], ['cam', 'cerberus', 1.5], ['shake', 0.3], ['sting', 'dread'], ['plate', 'cerberus'], ['emote', 'ysolde', '...'], ['line', 2], ['line', 3]],
  },
  c8: {
    intro: [
      ['arrive'], ['cam', 'maule', 1.7], ['plate', 'maule'], ['line', 0], ['line', 1], ['face', 'aldric', 'maule'], ['line', 2],
      ['pose', 'maule', 'cast', 1300], ['line', 3], ['cam', 'barrowking', 1.4], ['fx', 'debuff', 'barrowking'], ['shake', 0.4], ['sting', 'dread'],
      ['plate', 'barrowking'], ['emote', 'brannoc', '...'], ['line', 4],
    ],
    outro: [
      ['cam', 'maule', 1.4], ['flash', '#fff4d8'], ['shake', 0.45], ['sting', 'bell'], ['narr', 0],
      ['line', 1], ['line', 2], ['line', 3],
      ['tableau', 'The Hollow Crown', 'End of Chapter II'],
    ],
  },
  s4: { outro: [['enter', 'varg', 'brannoc'], ['line', 0], ['emote', 'brannoc', '...'], ['line', 1], ['join', 'varg']] },
};

// Boss set pieces (stage/director.js). `idx` = the boss's index in the node's enemies. On the boss's first turn: the
// nameplate (title) slams in with a sting and `first` is spoken; `hint` goes on the objective plate for the whole battle
// (and `win` replaces the Win line). At `phase.at` HP (default 50%) the phase change plays at the next turn boundary:
// `lines`, a screen flash, and the effect -- statuses on the boss (`self`), on its allies (`allies`), stat mods, `summon`
// ([cls, lvl, name] beside the boss) or `toll` (every fallen ally of the boss rises at that fraction of its HP).
// `rise` is spoken when the boss's Reraise fires; `down` when it falls while the battle goes on.
export const BOSSES = {
  b3: { key: 'varg', idx: 0, title: 'Bandit Chief of the Wend', hint: 'Varg\'s kris strips weapons on a hit. Close in from his back.',
    first: [['varg', 'Brannoc\'s new friends! Let\'s see who wants a knife first.']],
    phase: { lines: [['varg', 'Enough! Nobody robs Varg of his haul twice!']], self: ['haste'], mods: { atkMod: 1 }, flash: '#ff6a3a', announce: 'Varg is cornered: Haste, ATK up', hint: 'Varg is cornered and fast. Surround him.' },
    down: [['varg', 'Alright... alright! I yield!']] },
  b4: { key: 'acolyte', idx: 0, title: 'Grey Acolyte of the Choir', hint: 'The dead follow the song. Break the Choir Cantor first.',
    first: [['acolyte', 'Sing, brothers. Let the terraces remember.']] },
  b5: { key: 'galen', idx: 0, title: 'Champion of the Choir', hint: 'Ser Galen\'s Oathblade strikes Fear. Keep your mages behind the line.',
    first: [['galen', 'Face me, captain. The Choir does not hide behind its bridges.']],
    phase: { lines: [['galen', 'Choir! Remember your oath! Shields to the bridge!']], self: ['regen'], allies: ['protect'], mods: { atkMod: 1 }, flash: '#ffe7a0', announce: 'Oath of the Choir: allies Protect, Galen Regen', hint: 'Galen regenerates now. Finish him quickly.' },
    down: [['galen', 'Corvina... you were right...']] },
  b6: { key: 'ashmaw', idx: 0, title: 'Chained Beast of Ravenscar', hint: 'Ash-Maw drinks fire and regenerates. Use steel and ice.',
    first: [['ashmaw', 'GRRRAAAAHHH!']],
    phase: { lines: [['ashmaw', 'RRRAAAAAGGHH!'], ['tobin', 'The chain! It\'s broken the chain!']], self: ['haste'], mods: { atkMod: 1 }, flash: '#ff4a1a', shake: 0.5, announce: 'The chain breaks: Ash-Maw hastes', hint: 'Ash-Maw is loose and fast. Hit it from range.' } },
  b7: { key: 'malquor', idx: 0, title: 'Hierophant of the Choir', hint: 'Malquor\'s Bell-Stone Shard raises him once from his first fall.',
    first: [['malquor', 'Every name the war forgot, I remember. Shall I say yours?']],
    phase: { lines: [['malquor', 'Rise, drowned ones! Your names are called!']], summon: [['ghost', 9, 'Drowned Echo'], ['ghost', 9, 'Drowned Echo']], flash: '#7fd7ff', announce: 'Malquor calls the drowned', hint: 'Malquor calls the drowned. Silence him before more rise.' },
    rise: [['malquor', 'You cannot kill what the bell remembers!']] },
  c2: { key: 'warden', idx: 0, title: 'Collector of the Tithe', hint: 'The Bellwarden\'s knells sleep and stun. Spread out.',
    first: [['warden', 'In the King\'s name, the tithe is collected!']] },
  c3: { key: 'crane', idx: 0, title: 'Wagonmaster of the Tithe', hint: 'Only Crane must fall. He wears Protect and Shell. Break through the guns.', win: 'Defeat Wagonmaster Crane!',
    first: [['crane', 'Guns, on the sellswords! Nobody touches the tithe!']],
    phase: { lines: [['crane', 'Close the wagons! Guard, on me!']], allies: ['haste'], mods: { defMod: 1 }, flash: '#ffd27a', announce: 'Close the wagons: the guard hastes', hint: 'The guard closes ranks. Strike Crane now.' },
    down: [['crane', 'The tithe... the King\'s road...']] },
  c5: { key: 'vey', idx: 0, title: 'Master Founder of Karsmoor', hint: 'Vey raises the fallen. Silence the bell-ringer!', win: 'Silence Ossian Vey and his yard!',
    first: [['vey', 'Hear the bell, sellswords. Every blow you strike, I answer.']],
    phase: { lines: [['vey', 'Listen! The yard answers the bell!']], toll: 0.35, self: ['regen'], flash: '#ffe08a', shake: 0.4, sting: 'bell', announce: 'The bell tolls: the fallen rise', hint: 'The fallen rose. Vey regenerates. Break him NOW.' },
    down: [['vey', 'The bell... is still ringing...']] },
  c6: { key: 'headsman', idx: 0, title: 'Crown Executioner', hint: 'The Headsman hunts Aldric. Keep the captain covered.',
    first: [['headsman', 'Captain. Kneel, and this ends quickly.']] },
  c7: { key: 'cerberus', idx: 0, title: 'Gate-Beast of Aurelmont', hint: 'The Cerberus never slows and drinks darkness. Use light and steel.',
    first: [['cerberus', 'GRRRRRRR...']],
    phase: { lines: [['cerberus', 'RRROOOAAARRR!'], ['corvina', 'The third head is awake! Brace!']], self: ['regen'], mods: { atkMod: 1 }, flash: '#b070ff', shake: 0.45, announce: 'The third head wakes: ATK up, Regen', hint: 'The beast regenerates. Pile on the damage.' } },
  c8: { key: 'maule', idx: 0, title: 'Chancellor of the Realm', hint: 'Maule rises once (the Hollow Crown). The Barrow King must fall too.',
    first: [['maule', 'Kneel before the Crown, mercenaries. It is the only coin you will ever see.']],
    phase: { lines: [['maule', 'Old king! Your Chancellor commands you: crush them!']], target: 'barrowking', other: ['haste'], self: ['shell'], flash: '#d04040', shake: 0.5, sting: 'bell', announce: 'The Barrow King answers: Haste', hint: 'The Barrow King is hasted. Maule still rises once.' },
    rise: [['maule', 'The Crown does not fall, sellsword. It is hollow!']] },
};

// In-battle lines (stage/director.js). Each pauses the battle at the next turn boundary: a brief window by the speaker.
//   ko[key]        an ally falls            heroLow        the captain drops under 30% HP (once a battle)
//   first[key]     a recruit's first action with the company (once per save)
export const BARKS = {
  ko: {
    aldric: 'Hold... the line...', seren: 'Forgive me... I can\'t...', tobin: 'Took one... in the ribs...', ysolde: 'Oh. That was... rude.',
    brannoc: 'Not... cheap...', pell: 'Sorry, sir...', wren: 'Should\'ve stayed... in the trees...', osric: 'Brothers... I come...',
    mirela: 'The sand... won\'t hear me...', corvina: 'Not like this. Not again...', tamsin: 'Father...', hesper: 'Misfire...', varg: 'Knew I should\'ve... run...',
  },
  heroLow: [['aldric', 'Still standing. Company, keep formation!'], ['seren', 'Aldric! Fall back to me, I\'ll mend you!']],
  first: {
    wren: 'Let\'s see if this company can keep up with me.', mirela: 'Sand, listen. We have work.', osric: 'For the brothers of Lornhill.',
    corvina: 'Choir steel, turned the right way at last.', tamsin: 'For Vesk Hollow!', hesper: 'Six years casting guns. Let\'s see how they fire.',
    varg: 'Knife\'s out. Point me at someone rich.', pell: 'Footman Pell, reporting! Sir!',
  },
};
