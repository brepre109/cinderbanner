// Equipment (the genre slots: Weapon / Offhand / Head / Body / Accessory). Pure data + functions, no DOM: rules.js reads a
// unit's resolved gear through gearSummary(), progression.js passes a record's `equip` through unitOpts(), the campaign
// shop / formation screens and the headless campaignsim all buy, equip and optimise through the functions below.
//
// Contract with rules.js: a unit built WITHOUT opts.equip has u.eq === null and every formula takes its legacy path
// (class weapon at WP 6, the class's implicit shield) -- sim.mjs, ?mode=ai and every pre-equipment battle are bit-identical.
// A unit built WITH opts.equip (even all-empty) is "equipped": its weapon, shield and armour come only from the items.
//
// Scale: the class table is authored at Lv 10 with WP 6 for every weapon, so a tier-1 weapon is WP 6 (a new recruit
// with its starter weapon hits exactly like the legacy unit). Tier 2 = 7, tier 3 = 8, boss relics 9. Armour adds HP
// (the currency of a fight that lasts ~4 hits) and small flat DEF; flat DEF is cheap-looking but is subtracted from
// every hit, so it stays at +1..+4. Weight over the class's carry limit is the §2.1 tempo cost (one tick per point).
import { CLASSES } from './data.js';

export const SLOTS = ['weapon', 'offhand', 'head', 'body', 'acc'];
export const SLOT_NAME = { weapon: 'Weapon', offhand: 'Offhand', head: 'Head', body: 'Body', acc: 'Accessory' };

// range = the type's reach (identical to data.js W for the legacy types); twoHand: no shield / no second weapon.
export const WEAPON_TYPES = {
  sword: { name: 'Sword', range: 1 }, ksword: { name: 'Knight Sword', range: 1 }, dagger: { name: 'Dagger', range: 1 },
  axe: { name: 'Axe', range: 1 }, bow: { name: 'Bow', range: 4, ranged: true, twoHand: true }, spear: { name: 'Spear', range: 2 },
  rod: { name: 'Rod', range: 1 }, staff: { name: 'Staff', range: 1 }, gun: { name: 'Gun', range: 6, ranged: true },
  katana: { name: 'Katana', range: 1 }, rapier: { name: 'Rapier', range: 1 }, hammer: { name: 'Hammer', range: 1, twoHand: true },
};
export const ARMOR_TYPES = { shield: 'Shield', hat: 'Hat', helm: 'Helm', clothes: 'Clothes', robe: 'Robe', light: 'Light Armor', heavy: 'Heavy Armor', acc: 'Accessory' };
export const typeName = (t) => WEAPON_TYPES[t]?.name || ARMOR_TYPES[t] || t;

// ---------------------------------------------------------------- the item table
// slot: weapon | shield | head | body | acc ('shield' items go in the offhand). tier 1-3 are shop stock (unlocked by
// chapter progress, see src/campaign/data.js TOWNS); rare items only drop (boss relics). mat: icon tint (src/campaign/icons.js).
const I = (id, name, slot, type, tier, price, stats, extra = {}) => ({ id, name, slot, type, tier, price, ...stats, ...extra });
const LIST = [
  // ---- swords (Footman, Knight, Earthshaper, Paladin, Beastsage, Dread Knight, Runesword, Guardian)
  I('broadsword', 'Broadsword', 'weapon', 'sword', 1, 200, { wp: 6 }, { mat: 'iron' }),
  I('longsword', 'Longsword', 'weapon', 'sword', 2, 650, { wp: 7 }, { mat: 'steel' }),
  I('ashen_blade', 'Ashen Blade', 'weapon', 'sword', 3, 1500, { wp: 8, atk: 1 }, { mat: 'silver' }),
  I('emberbrand', 'Emberbrand', 'weapon', 'sword', 3, 1800, { wp: 8, element: 'fire', strengthen: ['fire'] }, { mat: 'ember' }),
  I('warden_greatsword', 'Warden Greatsword', 'weapon', 'ksword', 3, 2000, { wp: 9, weight: 1 }, { mat: 'silver' }),
  // ---- daggers (Footman, Apothecary, Thief, Ninja, Juggler)
  I('dirk', 'Dirk', 'weapon', 'dagger', 1, 150, { wp: 6, eva: 2 }, { mat: 'iron' }),
  I('viper_kris', 'Viper Kris', 'weapon', 'dagger', 2, 700, { wp: 7, onHit: { status: 'poison', chance: 25 } }, { mat: 'venom' }),
  I('mailbreaker', 'Mailbreaker', 'weapon', 'dagger', 3, 1400, { wp: 8, eva: 3 }, { mat: 'silver' }),
  // ---- axes: a point of WP over the tier for a point of Weight
  I('hatchet', 'Hatchet', 'weapon', 'axe', 1, 260, { wp: 7, weight: 1 }, { mat: 'iron' }),
  I('bearded_axe', 'Bearded Axe', 'weapon', 'axe', 2, 800, { wp: 8, weight: 1 }, { mat: 'steel' }),
  // ---- bows (Archer, Hunter, Assassin)
  I('shortbow', 'Shortbow', 'weapon', 'bow', 1, 220, { wp: 6 }, { mat: 'wood' }),
  I('longbow', 'Longbow', 'weapon', 'bow', 2, 800, { wp: 7, range: 1 }, { mat: 'wood' }),
  I('yew_warbow', 'Yew Warbow', 'weapon', 'bow', 3, 1700, { wp: 8, range: 1, atk: 1 }, { mat: 'gold' }),
  // ---- spears (Wyrmlancer, Runesword; anyone with Equip Spears)
  I('boar_spear', 'Boar Spear', 'weapon', 'spear', 1, 220, { wp: 6 }, { mat: 'iron' }),
  I('partisan', 'Partisan', 'weapon', 'spear', 2, 750, { wp: 7 }, { mat: 'steel' }),
  I('wyrmtooth_glaive', 'Wyrmtooth Glaive', 'weapon', 'spear', 3, 1700, { wp: 8, jump: 1 }, { mat: 'silver' }),
  // ---- rods (Black / Chronomancer, Conjurer, Battlemage, Warlock, Necromancer): element on Attack + that element x1.25
  I('ash_rod', 'Ash Rod', 'weapon', 'rod', 1, 200, { wp: 6, mag: 1 }, { mat: 'wood' }),
  I('flame_rod', 'Flame Rod', 'weapon', 'rod', 2, 700, { wp: 6, mag: 1, element: 'fire', strengthen: ['fire'] }, { mat: 'ember' }),
  I('frost_rod', 'Frost Rod', 'weapon', 'rod', 2, 700, { wp: 6, mag: 1, element: 'ice', strengthen: ['ice'] }, { mat: 'frost' }),
  I('storm_rod', 'Storm Rod', 'weapon', 'rod', 2, 700, { wp: 6, mag: 1, element: 'thunder', strengthen: ['thunder'] }, { mat: 'storm' }),
  I('sagewood_rod', 'Sagewood Rod', 'weapon', 'rod', 3, 1600, { wp: 6, mag: 3, mp: 10 }, { mat: 'gold' }),
  // ---- staves (White / Chronomancer, Conjurer, Mystic, Necromancer)
  I('oak_staff', 'Oak Staff', 'weapon', 'staff', 1, 180, { wp: 6, mp: 6 }, { mat: 'wood' }),
  I('cleric_staff', "Cleric's Staff", 'weapon', 'staff', 2, 650, { wp: 6, mag: 1, mp: 10 }, { mat: 'silver' }),
  I('dawn_staff', 'Staff of Dawn', 'weapon', 'staff', 3, 1500, { wp: 7, mag: 2, mp: 14, strengthen: ['holy'] }, { mat: 'holy' }),
  // ---- guns (Apothecary, Gunner): the reach is the weapon, the damage is WP
  I('flintlock', 'Flintlock', 'weapon', 'gun', 1, 300, { wp: 6 }, { mat: 'iron' }),
  I('snaphance', 'Snaphance', 'weapon', 'gun', 2, 900, { wp: 7 }, { mat: 'steel' }),
  I('longbarrel', 'Longbarrel', 'weapon', 'gun', 3, 1900, { wp: 8, range: 1 }, { mat: 'gold' }),
  // ---- katanas (Blademaster, Assassin)
  I('reedcutter', 'Reedcutter', 'weapon', 'katana', 1, 300, { wp: 6 }, { mat: 'steel' }),
  I('mistcutter', 'Mistcutter', 'weapon', 'katana', 2, 900, { wp: 7, eva: 2 }, { mat: 'frost' }),
  I('dawnfang', 'Dawnfang', 'weapon', 'katana', 3, 1800, { wp: 8, atk: 1 }, { mat: 'silver' }),
  // ---- rapiers (Battlemage)
  I('foil', "Duelist's Foil", 'weapon', 'rapier', 1, 220, { wp: 6, eva: 2 }, { mat: 'steel' }),
  I('estoc', 'Estoc', 'weapon', 'rapier', 2, 800, { wp: 7, eva: 3 }, { mat: 'silver' }),
  // ---- hammers (Blacksmith, Dread Knight): two-handed, heavy
  I('forge_maul', 'Forge Maul', 'weapon', 'hammer', 1, 280, { wp: 7, weight: 1 }, { mat: 'iron' }),
  I('warhammer', 'Warhammer', 'weapon', 'hammer', 2, 850, { wp: 8, weight: 1 }, { mat: 'steel' }),
  I('anvilbreaker', 'Anvilbreaker', 'weapon', 'hammer', 3, 1800, { wp: 9, weight: 1, def: 1 }, { mat: 'ember' }),
  // ---- shields (Knight, Paladin, Runesword, Guardian; anyone with Equip Shields). The Buckler IS the legacy shield.
  I('buckler', 'Buckler', 'shield', 'shield', 1, 150, { def: 2, eva: 5 }, { mat: 'wood' }),
  I('kite_shield', 'Kite Shield', 'shield', 'shield', 2, 550, { def: 2, eva: 8, hp: 8 }, { mat: 'steel' }),
  I('bastion_shield', 'Bastion Shield', 'shield', 'shield', 3, 1400, { def: 3, eva: 10, hp: 12, weight: 1 }, { mat: 'silver' }),
  // ---- head
  I('felt_cap', 'Felt Cap', 'head', 'hat', 1, 100, { hp: 6 }, { mat: 'cloth' }),
  I('plumed_hat', 'Plumed Hat', 'head', 'hat', 2, 400, { hp: 12, eva: 2 }, { mat: 'red' }),
  I('sages_circlet', "Sage's Circlet", 'head', 'hat', 3, 1100, { hp: 14, mag: 2, mp: 8 }, { mat: 'gold' }),
  I('iron_sallet', 'Iron Sallet', 'head', 'helm', 1, 160, { hp: 10, def: 1 }, { mat: 'iron' }),
  I('barbute', 'Barbute', 'head', 'helm', 2, 500, { hp: 16, def: 1 }, { mat: 'steel' }),
  I('great_helm', 'Great Helm', 'head', 'helm', 3, 1200, { hp: 24, def: 2, weight: 1 }, { mat: 'silver' }),
  // ---- body
  I('linen_tunic', 'Linen Tunic', 'body', 'clothes', 1, 120, { hp: 8 }, { mat: 'cloth' }),
  I('leather_jerkin', 'Leather Jerkin', 'body', 'clothes', 2, 450, { hp: 16, eva: 2 }, { mat: 'leather' }),
  I('rangers_garb', "Ranger's Garb", 'body', 'clothes', 3, 1100, { hp: 24, def: 1, eva: 3 }, { mat: 'green' }),
  I('hempen_robe', 'Hempen Robe', 'body', 'robe', 1, 180, { hp: 6, mp: 8 }, { mat: 'cloth' }),
  I('silk_robe', 'Silk Robe', 'body', 'robe', 2, 600, { hp: 12, mp: 12, mag: 1 }, { mat: 'blue' }),
  I('sages_vestment', "Sage's Vestment", 'body', 'robe', 3, 1400, { hp: 16, mp: 18, mag: 2, res: 1 }, { mat: 'holy' }),
  I('studded_leather', 'Studded Leather', 'body', 'light', 2, 600, { hp: 18, def: 2 }, { mat: 'leather' }),
  I('chain_shirt', 'Chain Shirt', 'body', 'light', 3, 1300, { hp: 26, def: 3, weight: 1 }, { mat: 'steel' }),
  I('iron_plate', 'Iron Plate', 'body', 'heavy', 1, 300, { hp: 12, def: 2, weight: 1 }, { mat: 'iron' }),
  I('steel_cuirass', 'Steel Cuirass', 'body', 'heavy', 2, 800, { hp: 22, def: 3, weight: 1 }, { mat: 'steel' }),
  I('choirsteel_plate', 'Choirsteel Plate', 'body', 'heavy', 3, 1800, { hp: 30, def: 4, weight: 2 }, { mat: 'silver' }),
  // ---- accessories
  I('leather_bracer', 'Leather Bracer', 'acc', 'acc', 1, 150, { hp: 6, def: 1 }, { mat: 'leather', icon: 'bracer' }),
  I('brawlers_cuff', "Brawler's Cuff", 'acc', 'acc', 2, 800, { atk: 2 }, { mat: 'red', icon: 'bracer' }),
  I('sorcerers_band', "Sorcerer's Band", 'acc', 'acc', 2, 800, { mag: 2 }, { mat: 'blue', icon: 'ring' }),
  I('hermits_rosary', "Hermit's Rosary", 'acc', 'acc', 2, 500, { res: 2, mp: 10 }, { mat: 'wood', icon: 'amulet' }),
  I('wayfarer_boots', 'Wayfarer Boots', 'acc', 'acc', 2, 1000, { move: 1 }, { mat: 'leather', icon: 'boots' }),
  I('warding_ribbon', 'Warding Ribbon', 'acc', 'acc', 3, 1200, { immune: ['poison', 'blind', 'silence', 'sleep', 'charm'] }, { mat: 'red', icon: 'ribbon' }),
  I('verdant_pendant', 'Verdant Pendant', 'acc', 'acc', 3, 1600, { auto: ['regen'] }, { mat: 'green', icon: 'amulet' }),
  I('guardian_sigil', "Guardian's Sigil", 'acc', 'acc', 3, 1600, { auto: ['protect'] }, { mat: 'silver', icon: 'amulet' }),
  I('swift_anklet', 'Swift Anklet', 'acc', 'acc', 3, 2200, { spd: 1 }, { mat: 'gold', icon: 'ring' }),
  I('saints_charm', "Saint's Charm", 'acc', 'acc', 3, 2400, { auto: ['reraise'] }, { mat: 'holy', icon: 'amulet' }),
  // ---- tier 4 (Chapter II, the Northreach): sold at Karsmoor Market and the Greyhold Lodge after the foundry falls.
  // One WP over tier 3 (WP 9; 10 for the two-handed / heavy lines), armour +6..10 HP over its tier-3 row.
  I('runesteel_blade', 'Runesteel Blade', 'weapon', 'sword', 4, 2800, { wp: 9, atk: 1 }, { mat: 'frost' }),
  I('kingsguard_blade', 'Kingsguard Blade', 'weapon', 'ksword', 4, 3200, { wp: 10, weight: 1 }, { mat: 'gold' }),
  I('nightfang', 'Nightfang', 'weapon', 'dagger', 4, 2600, { wp: 9, eva: 3 }, { mat: 'dark' }),
  I('headsman_axe', "Headsman's Axe", 'weapon', 'axe', 4, 2700, { wp: 10, weight: 1 }, { mat: 'steel' }),
  I('northwind_bow', 'Northwind Bow', 'weapon', 'bow', 4, 3000, { wp: 9, range: 1, atk: 1 }, { mat: 'frost' }),
  I('spinebreaker', 'Spinebreaker', 'weapon', 'spear', 4, 3000, { wp: 9, jump: 1, hp: 8 }, { mat: 'silver' }),
  I('rimeglass_rod', 'Rimeglass Rod', 'weapon', 'rod', 4, 2800, { wp: 7, mag: 3, mp: 10, element: 'ice', strengthen: ['ice'] }, { mat: 'frost' }),
  I('vesper_staff', 'Vesper Staff', 'weapon', 'staff', 4, 2800, { wp: 8, mag: 3, mp: 18 }, { mat: 'holy' }),
  I('culverin', 'Culverin', 'weapon', 'gun', 4, 3200, { wp: 9, range: 1 }, { mat: 'steel' }),
  I('frostmoon', 'Frostmoon', 'weapon', 'katana', 4, 3100, { wp: 9, atk: 1, eva: 2 }, { mat: 'frost' }),
  I('courtsword', 'Courtsword', 'weapon', 'rapier', 4, 2600, { wp: 8, eva: 4, mag: 1 }, { mat: 'gold' }),
  I('bellhammer', 'Bellhammer', 'weapon', 'hammer', 4, 3100, { wp: 10, weight: 1, def: 1 }, { mat: 'gold' }),
  I('tower_shield', 'Tower Shield', 'shield', 'shield', 4, 2600, { def: 4, eva: 12, hp: 16, weight: 1 }, { mat: 'silver' }),
  I('magus_hood', 'Magus Hood', 'head', 'hat', 4, 2200, { hp: 18, mag: 3, mp: 10 }, { mat: 'blue' }),
  I('grand_armet', 'Grand Armet', 'head', 'helm', 4, 2400, { hp: 32, def: 2, weight: 1 }, { mat: 'gold' }),
  I('shadow_leathers', 'Shadow Leathers', 'body', 'clothes', 4, 2200, { hp: 30, def: 1, eva: 4 }, { mat: 'dark' }),
  I('archmage_robe', 'Archmage Robe', 'body', 'robe', 4, 2600, { hp: 22, mp: 24, mag: 3, res: 2 }, { mat: 'blue' }),
  I('mithril_mail', 'Mithril Mail', 'body', 'light', 4, 2600, { hp: 34, def: 3, weight: 1 }, { mat: 'silver' }),
  I('crown_plate', 'Crown Plate', 'body', 'heavy', 4, 3000, { hp: 40, def: 5, weight: 2 }, { mat: 'gold' }),
  I('knights_brooch', "Knight's Brooch", 'acc', 'acc', 4, 2600, { atk: 3, def: 1 }, { mat: 'gold', icon: 'amulet' }),
  I('arcanist_ring', "Arcanist's Ring", 'acc', 'acc', 4, 2600, { mag: 3, mp: 8 }, { mat: 'blue', icon: 'ring' }),
  I('vigil_charm', 'Vigil Charm', 'acc', 'acc', 4, 2400, { res: 2, immune: ['sleep', 'silence', 'charm', 'fear'] }, { mat: 'holy', icon: 'amulet' }),
  // ---- the company captain's own (Aldric starts wearing it; never sold in a shop)
  I('oath_signet', 'Ember Oath Signet', 'acc', 'acc', 3, 3000, { move: 1, atk: 1 }, { mat: 'ember', icon: 'ring', rare: true, boss: 'Aldric' }),
  // ---- boss relics (rare: dropped by the Chapter I bosses, never sold in a shop)
  I('magpie_kris', "Magpie's Kris", 'weapon', 'dagger', 3, 2600, { wp: 8, eva: 5, onHit: { status: 'unarmed', chance: 25 } }, { mat: 'gold', rare: true, boss: 'Varg' }),
  I('oathblade', 'Oathblade', 'weapon', 'katana', 4, 4000, { wp: 9, atk: 1, onHit: { status: 'fear', chance: 30 } }, { mat: 'holy', rare: true, boss: 'Ser Galen' }),
  I('cinder_heart', 'Cinder Heart', 'acc', 'acc', 4, 3600, { auto: ['regen'], strengthen: ['fire'], absorb: ['fire'] }, { mat: 'ember', icon: 'gem', rare: true, boss: 'Ash-Maw' }),
  I('bell_shard', 'Bell-Stone Shard', 'acc', 'acc', 4, 5000, { auto: ['reraise'], mag: 2, mp: 12 }, { mat: 'dark', icon: 'gem', rare: true, boss: 'Malquor' }),
  // ---- Chapter II boss relics
  I('founders_bell', "Founder's Bell", 'weapon', 'staff', 5, 5200, { wp: 9, mag: 3, mp: 16, strengthen: ['holy'], onHit: { status: 'sleep', chance: 20 } }, { mat: 'gold', rare: true, boss: 'Ossian Vey' }),
  I('eclipse_collar', 'Eclipse Collar', 'acc', 'acc', 5, 5600, { auto: ['haste'], absorb: ['dark'] }, { mat: 'dark', icon: 'ring', rare: true, boss: 'the Gloom Cerberus' }),
  I('hollow_crown', 'The Hollow Crown', 'acc', 'acc', 5, 8000, { auto: ['reraise'], mag: 3, res: 2, spd: 1 }, { mat: 'gold', icon: 'gem', rare: true, boss: 'Chancellor Maule' }),
  I('wardens_tithe', "Warden's Tithe", 'acc', 'acc', 5, 4200, { hp: 20, auto: ['shell', 'protect'] }, { mat: 'silver', icon: 'amulet', rare: true, boss: 'Wagonmaster Crane' }),
];
export const ITEMS = Object.fromEntries(LIST.map((it) => [it.id, it]));
export const ITEM_IDS = LIST.map((it) => it.id);
export const sellPrice = (id) => Math.floor((ITEMS[id]?.price || 0) / 2);

// ---------------------------------------------------------------- class permissions (DESIGN §3 Weapons / Armor column)
const HAT = ['hat'], HELM = ['helm', 'hat'], CL = ['clothes'], LIGHT = ['clothes', 'light'], ROBE = ['clothes', 'robe'], HEAVY = ['light', 'heavy'];
const P = (w, head, body, shield = false) => ({ w, head, body, shield });
export const PERMS = {
  footman: P(['sword', 'dagger', 'axe'], HAT, LIGHT), apothecary: P(['dagger', 'gun'], HAT, CL),
  knight: P(['sword', 'ksword'], HELM, HEAVY, true), archer: P(['bow'], HAT, LIGHT), monk: P([], HAT, CL),
  cleric: P(['staff'], HAT, ROBE), sorcerer: P(['rod'], HAT, ROBE), chronomancer: P(['staff', 'rod'], HAT, ROBE),
  thief: P(['dagger'], HAT, CL), earthshaper: P(['sword', 'axe'], HAT, LIGHT), wyrmlancer: P(['spear'], HELM, HEAVY),
  ninja: P(['dagger'], HAT, CL), blademaster: P(['katana'], HELM, HEAVY), conjurer: P(['rod', 'staff'], HAT, ROBE),
  mystic: P(['staff'], HAT, ROBE), paladin: P(['ksword', 'sword'], HELM, HEAVY, true), battlemage: P(['rapier', 'rod'], HAT, CL),
  beastsage: P(['sword'], HAT, CL), gunner: P(['gun'], HAT, CL), juggler: P(['dagger'], HAT, CL), assassin: P(['katana', 'bow'], HAT, CL),
  dreadknight: P(['axe', 'sword', 'hammer'], HELM, HEAVY), runesword: P(['sword', 'spear'], HAT, LIGHT, true), warlock: P(['rod'], HAT, ROBE),
  guardian: P(['sword'], HELM, HEAVY, true), hunter: P(['bow'], HAT, LIGHT), blacksmith: P(['hammer', 'axe'], HELM, HEAVY),
  necromancer: P(['staff', 'rod'], HAT, ROBE),
  oathknight: P(['sword', 'ksword'], HELM, HEAVY, true),   // R12 hero job: the Knight's permissions
  bellwarden: P(['staff', 'hammer'], HAT, ROBE), chirurgeon: P(['dagger', 'gun'], HAT, CL),   // Chapter II
};
const NO_PERMS = P([], [], [], false);
// Carry limit (§2.1): heavy-armour jobs carry 2 points of Weight for free, everyone else 1.
export const carryOf = (cls) => ((PERMS[cls] || NO_PERMS).body.includes('heavy') ? 2 : 1);

/** Can a unit of `cls` with `support` wear `item` in `slot`? `weapon` = the item in its weapon slot (for the offhand). */
export function canEquip(cls, support, id, slot, weapon = null) {
  const it = ITEMS[id]; const p = PERMS[cls]; if (!it || !p) return false;
  const wOk = (t) => p.w.includes(t) || (support === 'equip_spears' && t === 'spear');
  if (slot === 'weapon') return it.slot === 'weapon' && wOk(it.type);
  if (slot === 'offhand') {
    const w = weapon ? ITEMS[weapon] : null; if (w && WEAPON_TYPES[w.type]?.twoHand) return false;
    if (it.slot === 'shield') return p.shield || support === 'equip_shields';
    // Dual Wield: a second one-handed weapon the job can already swing (genre convention)
    return it.slot === 'weapon' && support === 'dual_wield' && !WEAPON_TYPES[it.type]?.twoHand && wOk(it.type);
  }
  if (slot === 'head') return it.slot === 'head' && (p.head.includes(it.type) || (support === 'equip_heavy' && it.type === 'helm'));
  if (slot === 'body') return it.slot === 'body' && (p.body.includes(it.type) || (support === 'equip_heavy' && it.type === 'heavy'));
  if (slot === 'acc') return it.slot === 'acc';
  return false;
}
export const emptyEquip = () => ({ weapon: null, offhand: null, head: null, body: null, acc: null });

// ---------------------------------------------------------------- what rules.js reads
/** Aggregate of an equip map ({slot: itemId}) -> the `u.eq` rules.js consults. Unknown ids are ignored. */
export function gearSummary(equip) {
  const g = { weapon: null, offhand: null, items: [], wp: 0, hp: 0, mp: 0, atk: 0, mag: 0, def: 0, res: 0, spd: 0, eva: 0, move: 0, jump: 0, range: 0, weight: 0,
    element: null, onHit: null, strengthen: [], absorb: [], resist: [], immune: [], auto: [] };
  for (const s of SLOTS) {
    const it = ITEMS[equip?.[s]]; if (!it) continue; g.items.push(it);
    if (s === 'weapon' && it.slot === 'weapon') { g.weapon = it; g.element = it.element || null; g.onHit = it.onHit || null; g.range = it.range || 0; }
    else if (s === 'offhand') g.offhand = it;
    const main = s !== 'offhand' || it.slot !== 'weapon';   // a second weapon lends its WP to the off-hand strike only
    if (main) for (const k of ['hp', 'mp', 'atk', 'mag', 'def', 'res', 'spd', 'eva', 'move', 'jump']) g[k] += it[k] || 0;
    g.weight += it.weight || 0;
    for (const k of ['strengthen', 'absorb', 'resist', 'immune', 'auto']) for (const v of it[k] || []) if (!g[k].includes(v)) g[k].push(v);
  }
  return g;
}

// ---------------------------------------------------------------- scoring (Optimize, the AI shopper, enemy kits)
const isMagic = (cls) => CLASSES[cls] && CLASSES[cls].mag > CLASSES[cls].atk;
const AUTO_VAL = { reraise: 26, regen: 20, protect: 16, shell: 10, float: 4, haste: 30 };
/** How much a unit of `cls` wants `item` in `slot` (higher is better). Pure heuristic; ties keep the current item. */
export function itemValue(cls, id, slot) {
  const it = ITEMS[id]; if (!it) return 0; const mage = isMagic(cls);
  let v = 0;
  if (slot === 'weapon') v += (it.wp || 0) * (mage ? 3 : 12) + (it.range || 0) * 9 + (it.onHit ? 7 : 0) + (it.element ? 2 : 0);
  if (slot === 'offhand' && it.slot === 'weapon') v += (it.wp || 0) * 5;
  v += (it.hp || 0) * 0.55 + (it.mp || 0) * (mage ? 0.45 : 0.08) + (it.atk || 0) * (mage ? 1 : 5) + (it.mag || 0) * (mage ? 6 : 0.6)
    + (it.def || 0) * 5 + (it.res || 0) * 3.5 + (it.spd || 0) * 26 + (it.eva || 0) * 0.9 + (it.move || 0) * 13 + (it.jump || 0) * 3;
  for (const s of it.auto || []) v += AUTO_VAL[s] || 6;
  v += (it.immune || []).length * 2.5 + (it.absorb || []).length * 4 + (it.resist || []).length * 2 + (it.strengthen || []).length * (mage ? 5 : 2);
  v -= (it.weight || 0) * 5;
  return v;
}

// ---------------------------------------------------------------- starter kits & enemy kits
const byTier = (pred) => LIST.filter((it) => !it.rare && pred(it));
/** Best item of `slot` for `cls` from the non-rare table, at or under `tier`. */
function bestFor(cls, support, slot, tier, weapon = null) {
  let best = null, bv = -Infinity;
  for (const it of byTier((x) => x.tier <= tier)) {
    if (!canEquip(cls, support, it.id, slot, weapon)) continue;
    if (slot === 'offhand' && it.slot === 'weapon') continue;   // kits never hand out a second weapon
    const v = itemValue(cls, it.id, slot) + it.tier * 0.01; if (v > bv) { bv = v; best = it.id; }
  }
  return best;
}
/** A new recruit's kit: the job's tier-1 weapon, its shield if it carries one, and tier-1 body armour. */
export function starterKit(cls, support = CLASSES[cls]?.support) {
  const e = emptyEquip(); if (!PERMS[cls]) return e;
  const native = CLASSES[cls].weapon?.type;
  const w = LIST.find((it) => !it.rare && it.tier === 1 && it.slot === 'weapon' && it.type === native && canEquip(cls, support, it.id, 'weapon'));
  e.weapon = w ? w.id : bestFor(cls, support, 'weapon', 1);
  if (CLASSES[cls].shield) e.offhand = bestFor(cls, support, 'offhand', 1, e.weapon);
  e.body = bestFor(cls, support, 'body', 1);
  return e;
}
/** Enemy kit by level, mirroring what a company can buy at that point of the chapter: tier 1 to Lv 4, 2 to Lv 6, 3 from
 *  Lv 7. Weapon, class shield and body always; head from Lv 3; a stat accessory (Brawler's Cuff / Sorcerer's Band) from Lv 6. */
// Chapter II: tier 4 from Lv 14 (the Northreach shops open it after the foundry). Chapter I tops out at Lv 13, so it is untouched.
export function enemyTier(lvl) { return lvl >= 14 ? 4 : lvl >= 7 ? 3 : lvl >= 5 ? 2 : 1; }
export function enemyKit(cls, lvl, support = CLASSES[cls]?.support) {
  const e = emptyEquip(); if (!PERMS[cls]) return null;   // monsters fight with what they were born with
  const t = enemyTier(lvl); const k = starterKit(cls, support);
  e.weapon = LIST.filter((it) => !it.rare && it.tier <= t && it.slot === 'weapon' && canEquip(cls, support, it.id, 'weapon') && it.type === ITEMS[k.weapon]?.type)
    .sort((a, b) => b.tier - a.tier)[0]?.id || k.weapon;
  if (CLASSES[cls].shield) e.offhand = bestFor(cls, support, 'offhand', t, e.weapon);
  e.body = bestFor(cls, support, 'body', t);
  if (lvl >= 3) e.head = bestFor(cls, support, 'head', t);
  if (lvl >= 6) e.acc = isMagic(cls) ? (lvl >= 16 ? 'arcanist_ring' : 'sorcerers_band') : (lvl >= 16 ? 'knights_brooch' : 'brawlers_cuff');
  return e;
}

// ---------------------------------------------------------------- inventory operations on a save-shaped object
// sv.inventory = { [itemId]: count not equipped }; record.equip = { slot: itemId|null }. All functions mutate and
// return a boolean (or a list), never throw, so the shell screens and campaignsim share them verbatim.
export const invCount = (sv, id) => Math.max(0, sv.inventory?.[id] | 0);
export function invAdd(sv, id, n = 1) { if (!ITEMS[id] || n <= 0) return; sv.inventory ??= {}; sv.inventory[id] = invCount(sv, id) + n; }
export function invTake(sv, id, n = 1) { if (invCount(sv, id) < n) return false; sv.inventory[id] -= n; if (!sv.inventory[id]) delete sv.inventory[id]; return true; }
/** Units wearing `id` across the roster (for the shop's "Equipped" count). */
export const equippedCount = (sv, id) => (sv.roster || []).reduce((n, r) => n + SLOTS.filter((s) => r.equip?.[s] === id).length, 0);
export function ensureEquip(r) { if (!r.equip || typeof r.equip !== 'object') r.equip = emptyEquip(); for (const s of SLOTS) if (!(s in r.equip) || (r.equip[s] != null && !ITEMS[r.equip[s]])) r.equip[s] = null; return r.equip; }

export function unequip(sv, r, slot) { ensureEquip(r); const id = r.equip[slot]; if (!id) return false; r.equip[slot] = null; invAdd(sv, id); return true; }
/** Put `id` (taken from the inventory) into `slot`; the previous item goes back. A two-handed weapon empties the offhand. */
export function equipItem(sv, r, slot, id) {
  ensureEquip(r);
  if (id == null) return unequip(sv, r, slot);
  if (r.equip[slot] === id) return true;
  if (!canEquip(r.cls, r.support, id, slot, slot === 'offhand' ? r.equip.weapon : null)) return false;
  if (!invTake(sv, id)) return false;
  if (r.equip[slot]) invAdd(sv, r.equip[slot]);
  r.equip[slot] = id;
  if (slot === 'weapon' && r.equip.offhand && !canEquip(r.cls, r.support, r.equip.offhand, 'offhand', id)) unequip(sv, r, 'offhand');
  return true;
}
/** After a job or support change: anything the unit can no longer wear goes back to the inventory. Returns the ids removed. */
export function fitEquip(sv, r) {
  ensureEquip(r); const out = [];
  for (const s of SLOTS) { const id = r.equip[s]; if (id && !canEquip(r.cls, r.support, id, s, s === 'offhand' ? r.equip.weapon : null)) { unequip(sv, r, s); out.push(id); } }
  return out;
}
/** Optimize: for every slot, the best item among what it wears and what the inventory holds. Weapon first (the offhand depends on it). */
// QA #17: an item whose `boss` names a member of the company (the captain's Ember Oath Signet; Varg's own Magpie's Kris once
// Varg signs on) is that soldier's: Optimize never hands it to anyone else and never takes it off its owner.
const ownerOf = (sv, id) => { const b = ITEMS[id]?.boss; return b && (sv.roster || []).some((x) => x.name === b) ? b : null; };
export function optimize(sv, r, { keepWeapon = false } = {}) {
  ensureEquip(r); let changed = 0;
  for (const s of SLOTS) {
    if (s === 'weapon' && keepWeapon) continue;
    const cur = r.equip[s]; if (cur && ITEMS[cur]?.boss === r.name) continue;
    let best = cur, bv = cur ? itemValue(r.cls, cur, s) : 0;
    for (const id of Object.keys(sv.inventory || {})) {
      const own = ownerOf(sv, id); if (own && own !== r.name) continue;
      if (!invCount(sv, id) || !canEquip(r.cls, r.support, id, s, s === 'offhand' ? r.equip.weapon : null)) continue;
      const v = itemValue(r.cls, id, s); if (v > bv + 1e-9) { bv = v; best = id; }
    }
    if (best !== cur && best && equipItem(sv, r, s, best)) changed++;
  }
  return changed;
}
// ---- SHOP NUDGE (R16): the upgrades a sensible quartermaster would make right now, for the Formation / Depart warning,
// its 'Optimize from shop' shortcut, the defeat screen's advice and campaignsim's nudged profile. Greedy on value per
// florins like campaignsim's own shopper (weapons weighted up), chest items first (they are free), a piece taken off goes
// back to the chest and can be handed down to the next soldier. Pure: works on a scratch copy; applyPlan() commits.
//   plan: [{ rid, name, slot, id, from, price, gain }]   (price 0 = from the chest)
export function planUpgrades(sv, party, stock = [], { budget = sv.florins || 0, minGain = 2, maxSteps = 60 } = {}) {
  const inv = { ...(sv.inventory || {}) }; const eqs = new Map(party.map((r) => [r.id, { ...emptyEquip(), ...(r.equip || {}) }]));
  const shelf = [...new Set(stock)].filter((id) => ITEMS[id] && !ITEMS[id].rare); let florins = budget; const plan = [];
  for (let g = 0; g < maxSteps; g++) {
    let best = null;
    for (const r of party) {
      const e = eqs.get(r.id);
      for (const s of SLOTS) {
        const curId = e[s]; if (curId && ITEMS[curId]?.boss === r.name) continue;   // a soldier's own relic stays on
        const cur = curId ? itemValue(r.cls, curId, s) : 0;
        const tryId = (id, price) => {
          if (id === curId) return; const it = ITEMS[id]; if (!it || (s === 'offhand' && it.slot === 'weapon')) return;
          const own = ownerOf(sv, id); if (own && own !== r.name) return;
          if (!canEquip(r.cls, r.support, id, s, s === 'offhand' ? e.weapon : null)) return;
          const gain = itemValue(r.cls, id, s) - cur; if (gain < minGain) return;
          const score = price ? (gain * (s === 'weapon' ? 1.4 : 1)) / Math.sqrt(price) : 1e6 + gain;
          if (!best || score > best.score) best = { r, s, id, price, gain, score };
        };
        for (const id of Object.keys(inv)) if (inv[id] > 0) tryId(id, 0);
        for (const id of shelf) if (!(inv[id] > 0) && ITEMS[id].price <= florins) tryId(id, ITEMS[id].price);
      }
    }
    if (!best) break;
    const { r, s, id, price, gain } = best; const e = eqs.get(r.id);
    if (price) florins -= price; else { inv[id]--; if (!inv[id]) delete inv[id]; }
    if (e[s]) inv[e[s]] = (inv[e[s]] || 0) + 1;
    plan.push({ rid: r.id, name: r.name, slot: s, id, from: e[s] || null, price, gain: Math.round(gain) });
    e[s] = id;
    if (s === 'weapon' && e.offhand && !canEquip(r.cls, r.support, e.offhand, 'offhand', id)) { inv[e.offhand] = (inv[e.offhand] || 0) + 1; e.offhand = null; }
  }
  const souls = new Set(plan.map((p) => p.rid)).size, bought = plan.filter((p) => p.price);
  return { plan, cost: budget - florins, souls, shopSouls: new Set(bought.map((p) => p.rid)).size, bought: bought.map((p) => p.id) };
}
/** Commit a planUpgrades() plan to the save: buy each shop piece, then put it (or the chest piece) on. Returns the steps applied. */
export function applyPlan(sv, party, plan) {
  let n = 0;
  for (const p of plan) { const r = party.find((x) => x.id === p.rid); if (!r) continue; if (p.price && !buyItem(sv, p.id)) continue; if (equipItem(sv, r, p.slot, p.id)) n++; }
  return n;
}
/** Average item tier worn across a party's weapon and body (the two pieces the enemy kit always carries). */
export function partyTier(party) {
  const l = party.map((r) => { const w = ITEMS[r.equip?.weapon]?.tier || 0, b = ITEMS[r.equip?.body]?.tier || 0; return (w + b) / 2; });
  return l.length ? l.reduce((a, c) => a + c, 0) / l.length : 0;
}
export function buyItem(sv, id, n = 1) { const it = ITEMS[id]; if (!it || n <= 0 || sv.florins < it.price * n) return false; sv.florins -= it.price * n; invAdd(sv, id, n); return true; }
export function sellItem(sv, id, n = 1) { if (!invTake(sv, id, n)) return false; sv.florins += sellPrice(id) * n; return true; }

/** Stat deltas of putting `id` into `slot` for record `r` (for compare views): {hp, mp, atk, ... wp, range}. */
export function compareDelta(r, slot, id) {
  const cur = ITEMS[r.equip?.[slot]] || {}; const nx = ITEMS[id] || {}; const out = {};
  for (const k of ['wp', 'range', 'hp', 'mp', 'atk', 'def', 'mag', 'res', 'spd', 'eva', 'move', 'jump', 'weight']) {
    let a = cur[k] || 0, b = nx[k] || 0;
    if (slot === 'offhand' && k === 'wp') { a = cur.slot === 'weapon' ? a : 0; b = nx.slot === 'weapon' ? b : 0; }
    if (a !== b) out[k] = b - a;
  }
  return out;
}

// ---------------------------------------------------------------- text
const EL = { fire: 'Fire', ice: 'Ice', thunder: 'Thunder', water: 'Water', earth: 'Earth', holy: 'Holy', dark: 'Dark' };
const ST = { poison: 'Poison', blind: 'Blind', silence: 'Silence', sleep: 'Sleep', charm: 'Charm', fear: 'Fear', unarmed: 'Disarm', regen: 'Regen', protect: 'Protect', reraise: 'Reraise', shell: 'Shell', float: 'Float', haste: 'Haste', stop: 'Stop', slow: 'Slow' };
/** One-line effect summary, e.g. "WP 7 · Range +1 · HP +12 · Auto-Regen". */
export function describe(id) {
  const it = ITEMS[id]; if (!it) return '';
  const p = []; const sg = (v) => (v > 0 ? `+${v}` : `${v}`);
  if (it.wp) p.push(`WP ${it.wp}`);
  if (it.range) p.push(`Range ${sg(it.range)}`);
  for (const [k, l] of [['hp', 'HP'], ['mp', 'MP'], ['atk', 'ATK'], ['mag', 'MAG'], ['def', 'DEF'], ['res', 'RES'], ['spd', 'SPD'], ['eva', 'EVA'], ['move', 'Move'], ['jump', 'Jump']]) if (it[k]) p.push(`${l} ${sg(it[k])}`);
  if (it.element) p.push(`${EL[it.element]} strikes`);
  for (const e of it.strengthen || []) p.push(`${EL[e]} +25%`);
  for (const e of it.absorb || []) p.push(`Absorb ${EL[e]}`);
  for (const e of it.resist || []) p.push(`Halve ${EL[e]}`);
  if (it.onHit) p.push(`${ST[it.onHit.status] || it.onHit.status} on hit ${it.onHit.chance}%`);
  for (const s of it.auto || []) p.push(`Auto-${ST[s] || s}`);
  if (it.immune?.length) p.push(`Immune: ${it.immune.map((s) => ST[s] || s).join(', ')}`);
  if (it.weight) p.push(`Weight ${it.weight}`);
  return p.join(' · ');
}
/** Short class list that can use an item ("Knight, Paladin, ..."), from PERMS (supports not included). */
export function usersOf(id) {
  const it = ITEMS[id]; if (!it) return [];
  const slot = it.slot === 'shield' ? 'offhand' : it.slot;
  return Object.keys(PERMS).filter((c) => canEquip(c, null, id, slot));
}
