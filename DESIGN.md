# Cinderbanner — Vertical Slice Design Document

Version 1.0 · 2026-09-04 · Scope: first playable prototype (2 teams × 5 units, one isometric map)

---

## Section 1: Design Philosophy

### 1.1 Our Game's Pillars

1. **Strategic Depth.** Every build and team composition choice carries a visible trade-off. Speed costs bulk, range costs damage, heavy armor costs Move, and AoE costs charge time. No stat or slot is free.
2. **Job Versatility.** Each of the 24 classes owns one tactical role and one signature verb (Jump, Steal, Earthsong, Fear, Throw). Roles overlap only where their execution differs, so two units in the same role still play differently.
3. **Balanced Progression.** Power is earned by breadth of learned abilities, not by stacking a single stat. Hard caps (Section 5) prevent any ability, reaction, or class pairing from dominating the five-versus-five format.

---

## Section 2: Game Mechanics & Core Systems

### 2.1 Turn Order (Charge-Time Battle)

- Every unit has a CT counter starting at 0. Each clock tick adds the unit's SPD to CT. When CT ≥ 100 the unit takes a turn; ties resolve by higher SPD, then by team initiative roll.
- On a turn a unit may Move and Act in either order. After the turn CT resets to 0 if the unit both moved and acted, to 20 if it did only one, and to 40 if it did neither (Wait).
- **Charged abilities** carry a CT value in ticks. The ability is queued on the target tile and resolves CT ticks later; the caster is Charging (cannot react, +25% damage taken) until then. CT 0 abilities resolve immediately.
- **Tempo cost of gear:** each 1 point of Weight over the class's carry limit adds +1 tick to the caster's reset delay after every turn.
- Clock ticks are simulated one at a time; the UI shows the next 8 turns as a timeline.

### 2.2 Stats

| Stat | Governs |
| :--- | :--- |
| HP | Health. 0 HP = KO; a KO'd unit is removed after 3 of its own turns unless revived (crystal rule). |
| MP | Resource for abilities. Units start battle at 50% max MP and regain 10% at the start of each of their turns. |
| ATK | Physical damage scalar. |
| DEF | Physical damage reduction (flat). |
| MAG | Magical damage and healing scalar. |
| RES | Magical damage reduction (flat). |
| SPD | CT gained per tick. Range 5–12. |
| MOVE | Tiles per Move action (Manhattan, respects height and terrain cost). |
| JUMP | Maximum height step in tile-heights a unit can climb in one step. |
| EVA | Percent chance to evade physical attacks from the front; halved from the side, zero from behind. |
| BRV | Bravery 30–90. Percent chance a Reaction ability triggers. |

**Damage formulas** (all rounded down, minimum 1):

```
Physical  = (ATK × WeaponPower ÷ 6) × AbilityMult − DEF
Magical   = (MAG × SpellPower ÷ 6) × AbilityMult − RES
Healing   = (MAG × SpellPower ÷ 6) × AbilityMult
Hit%      = AbilityAccuracy − targetEVA (front) | − ½EVA (side) | − 0 (back)
Elemental = ×1.5 weak, ×0.5 resist, ×0 immune, heals if absorb
Height    = attacker ≥1 tile above target: +10% dmg; ranged range +1 per height level above.
```

### 2.3 Ability Systems (hybrid)

**Learning.** Each job has an ability list bought with JP. Every action earns 10 JP for the current job (+50% with JP Boost); job level rises at 100 / 250 / 450 / 700 / 1000 cumulative JP (Lv 1–5). **Equipment teaching:** while a unit wears an item tagged with an ability it has not learned, JP toward that specific ability accrues at double rate; mastering it makes it permanent without the item. **Class change** is free between turns of a deployment phase and keeps everything learned.

**Slots per unit** (genre-standard layout):
1. **Primary Action set** — the current job's abilities (up to 6 learned, Section 5).
2. **Secondary Action set** — any one other job's learned set.
3. **Reaction (R)** — one; triggers automatically at BRV% when its condition fires.
4. **Support (S)** — one; always-on passive.
5. **Movement (M)** — one; alters Move or triggers during movement.

**Action Abilities** cost MP, have Range (R, tiles from user), Area (A, radius around the target tile; A0 = single tile), and CT. Abilities marked "line" hit every tile in a straight line of the stated length.

**Reaction Abilities** fire once per incoming event, after damage is applied, and cannot chain into another reaction.

**Support Abilities** are the only source of equipment-permission changes (Equip Heavy Armor, Dual Wield) and flat stat multipliers.

**Movement Abilities** either change MOVE/JUMP or resolve an effect at the end of movement. Only one triggers per turn.

**Edicts (optional Law, Phase 3).** Each battle draws one Edict card (e.g., "No abilities with CT > 3", "No attacks from behind"). Both teams see it; a team that has not broken it by battle end earns a Privilege bonus (+20% JP). Breaking it forfeits the bonus and disables Raise-type abilities for that team for the rest of the battle.

### 2.4 Status Effects (all must have a counter, Section 5)

Poison (−10% HP per turn), Blind (−50% Hit%), Silence (no MP abilities), Sleep (skip turns until hit, max 3), Slow (SPD ×0.5), Haste (SPD ×1.5), Stop (CT frozen, 2 turns), Immobilize, Disable (no Act), Fear (ATK/MAG −25%, no Reactions), Charm (acts for enemy 1 turn), Protect/Shell (+33% DEF/RES), Regen (+10% HP per turn), Reraise (revive once at 25% HP), Vanish (untargetable until acting), Float (ignore ground effects), Doom is **not** used.

---

## Section 3: Complete 24-Class Spec Sheet

Notation: MP cost / R range / A area radius / CT charge ticks. "WP" = equipped weapon power. Job levels reference the JP thresholds in 2.3. Stat scale: Low / Mid / High.

| # | Class | Role | Core Stats | Weapons / Armor | Action Abilities | Reaction | Support | Movement | Unlock Req |
| :-- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Footman | Starter / Generalist | Mid HP, Low MP, Mid ATK, Low MAG, Mid SPD, MOVE 4, JUMP 2 | Sword, Dagger, Axe / Light armor, Hat | • Focus – self ATK +1 (stacks to +3). 0 MP, R0, CT0<br>• Yell – target SPD +1 for 3 turns. 4 MP, R3, A0<br>• Sling Stone – WP 3 physical, knockback 1 tile. 0 MP, R4<br>• First Aid – heal 15% HP, cure Poison/Blind. 0 MP, R1 | Counter Tackle – when hit by melee, tackle back for WP 3 | JP Boost – +50% JP earned | Move +1 | Default |
| 2 | Apothecary | Support / Items | Low HP, Low MP, Low ATK, Mid MAG, Mid SPD, MOVE 3, JUMP 2 | Dagger, Gun / Clothes, Hat | • Potion – heal 40 HP. Item, R1, A0<br>• Greater Potion – heal 100 HP. Item, R1<br>• Ember Plume – revive at 10% HP. Item, R1<br>• Remedy – cure all negative statuses. Item, R1<br>• Mana Tonic – restore 30 MP. Item, R1 | Reflex Tonic – when damaged, consume the weakest owned Potion on self | Throw Item – item range R1 → R4 | Scavenger – reveals hidden item on tile stopped on | Default |
| 3 | Knight | Tank | High HP, Low MP, High ATK, Low MAG, Low SPD, MOVE 3, JUMP 2 | Sword, Knight Sword, Shield / Heavy armor, Helm | • Rend Armor – WP ×0.5 dmg, target DEF −3. 4 MP, R1<br>• Rend Weapon – WP ×0.5, target ATK −3. 4 MP, R1<br>• Rend Speed – WP ×0.5, target SPD −2. 8 MP, R1<br>• Shield Bash – WP ×1.0 + knockback 1 (needs shield). 6 MP, R1 | Parry – nullify one physical hit | Equip Heavy Armor – any job may wear heavy armor | Bulwark Advance – ally adjacent at end of move gains DEF +2 until Knight's next turn | Footman Lv 2 |
| 4 | Archer | Ranged Physical DPS | Mid HP, Low MP, Mid ATK, Low MAG, High SPD, MOVE 3, JUMP 3 | Bow, Crossbow / Light armor, Hat | • Aim – WP ×1.5. 0 MP, R weapon, CT2<br>• Focused Shot – WP ×2.0, cannot miss. 6 MP, R weapon, CT4<br>• Leg Shot – WP ×0.8 + Immobilize 2 turns. 8 MP, R weapon<br>• Arm Shot – WP ×0.8 + Disable 1 turn. 8 MP, R weapon | Deflect Arrows – evade one ranged attack | Concentrate – attacks ignore target EVA | Jump +2 | Footman Lv 2 |
| 5 | Monk | Melee DPS / Brawler | High HP, Low MP, High ATK, Low MAG, Mid SPD, MOVE 4, JUMP 3 | Unarmed only / Clothes | • Ki Burst – WP 6 physical, line 3. 12 MP, CT0<br>• Ground Rend – WP 5 physical, line 5, ground targets only. 16 MP<br>• Inner Calm – heal 20% HP + 10% MP, self + adjacent allies. 0 MP, R0, A1<br>• Revive – revive adjacent ally at 20% HP. 10 MP, R1<br>• Whirl Fist – WP ×0.8 to all adjacent enemies. 6 MP, R0, A1 | Counter – attack the attacker if in weapon range | Martial Arts – unarmed WP = 4 + ATK÷4 | Fleet Foot – Move +1 and pass through allies | Knight Lv 2 |
| 6 | Cleric | Healer | Low HP, High MP, Low ATK, High MAG, Mid SPD, MOVE 3, JUMP 2 | Staff / Robe, Hat | • Cure – SP 8 heal. 6 MP, R4, A1, CT2<br>• Mending Light – SP 14 heal. 12 MP, R4, A2, CT3<br>• Raise – revive at 30% HP. 12 MP, R4, CT3<br>• Protect – DEF +33% 3 turns. 8 MP, R4, A1, CT2<br>• Purify – cure all negative statuses. 10 MP, R4, A1, CT1<br>• Holy – SP 20 holy dmg. 32 MP, R4, A0, CT5 | Regenerate – when damaged, gain Regen | Healing Boost – healing +25% | Pilgrim's Step – Move +1 when ending adjacent to an ally | Apothecary Lv 2 |
| 7 | Sorcerer | Magical DPS | Low HP, High MP, Low ATK, High MAG, Low SPD, MOVE 3, JUMP 2 | Rod / Robe, Hat | • Fire / Blizzard / Thunder – SP 10 elemental. 8 MP, R4, A1, CT2<br>• Blaze / Deep Frost / Stormfall – SP 16. 18 MP, R4, A2, CT3<br>• Poison – inflict Poison, 80% hit. 6 MP, R4, A1, CT1<br>• Flare – SP 26 non-elemental. 40 MP, R4, A0, CT6 | Magic Counter – when hit by a spell, cast the same spell back if learned | Arcane Focus – MAG +25% | Move-MP Up – regain 3 MP per tile moved | Apothecary Lv 2 |
| 8 | Chronomancer | Control / Tempo | Low HP, High MP, Low ATK, High MAG, High SPD, MOVE 3, JUMP 2 | Staff, Rod / Robe, Hat | • Haste – Haste 3 turns. 12 MP, R4, A1, CT3<br>• Slow – Slow 3 turns, 70% hit. 10 MP, R4, A1, CT3<br>• Stop – Stop 2 turns, 55% hit. 20 MP, R4, A0, CT4<br>• Quick – target's CT set to 100. 26 MP, R4, A0, CT2<br>• Gravity – dmg = 25% target max HP. 16 MP, R4, A1, CT3 | Mana Shield – damage is subtracted from MP first | Short Charge – all CT values halved (round up) | Teleport – move to any tile within MOVE ignoring terrain; each tile beyond MOVE costs 20% fail chance | Sorcerer Lv 2 |
| 9 | Thief | Utility / Mobility | Mid HP, Low MP, Mid ATK, Low MAG, High SPD, MOVE 5, JUMP 3 | Dagger / Clothes, Hat | • Steal Florins – take florins = target Lv × 10. 0 MP, R1, 90% hit<br>• Steal Weapon – remove target weapon (ATK → unarmed). 0 MP, R1, 45% hit<br>• Steal Accessory – remove accessory. 0 MP, R1, 55%<br>• Pilfer – transfer one positive status from target to self. 6 MP, R1, 70%<br>• Beguile – Charm 1 turn, 40% hit. 8 MP, R2 | Caution – when hit, gain DEF +33% until next turn | Nimble – EVA +10 | Move +2 | Archer Lv 2 |
| 10 | Earthshaper | Terrain Magic DPS | Mid HP, Mid MP, Mid ATK, Mid MAG, Mid SPD, MOVE 4, JUMP 3 | Sword, Axe / Light armor, Clothes | • Earthsong – SP 9 dmg, element + status by user's tile: grass Wildfire (fire/Blind), rock Tremor (earth/Immobilize), water Torrent (water/Slow), sand Sinkhole (earth/Stop 1), wood Will-o'-Wisp (fire/Confuse 1 turn). 0 MP, R5, A1, CT0<br>• Cataclysm – as Earthsong at SP 14, A2. 12 MP, R5, CT2<br>• Terraform – convert target tile to user's tile type. 8 MP, R3 | Tidal Retort – when hit, cast Earthsong at attacker | Nature's Blessing – ATK +1, MAG +1 while standing on natural terrain | Terrain Walker – ignore water, swamp, and lava movement penalties and damage | Monk Lv 2 |
| 11 | Wyrmlancer | Mobile Physical DPS | High HP, Low MP, High ATK, Low MAG, Mid SPD, MOVE 3, JUMP 4 | Spear / Heavy armor, Helm | • Jump – leave map; land on target tile after CT for WP ×1.5; untargetable while airborne. 0 MP, R4, CT3<br>• Leech Lance – WP ×0.8 dmg, heal self 50% of dmg dealt. 8 MP, R2 (spear reach)<br>• Fire Breath – SP 8 fire, line 3. 12 MP, CT0<br>• Wyrmkiller – WP ×2.0 vs dragon-type, ×1.0 otherwise. 4 MP, R2 | Dragonheart – when hit below 25% HP, gain Reraise | Equip Spears – any job may wield spears | Ignore Height – JUMP unlimited | Thief Lv 2 |
| 12 | Ninja | Fast Melee DPS | Mid HP, Low MP, High ATK, Low MAG, High SPD, MOVE 4, JUMP 4 | Dagger, Ninja Blade, Flail / Clothes | • Throw – hurl a stocked weapon for its WP. 0 MP, R4<br>• Fire Veil – SP 8 fire + Blind 50%. 10 MP, R3, A0<br>• Earth Veil – SP 8 earth + Slow 50%. 12 MP, R3, A0<br>• Unspell – remove all positive statuses. 8 MP, R3<br>• Vanish – self gains Vanish. 10 MP, R0 | Shadowstep – when hit by melee, gain Vanish | Dual Wield – attack with both weapons (second at ×0.5) | Shinobi Stride – Jump +3, no fall damage | Archer Lv 3, Thief Lv 3, Earthshaper Lv 2 |
| 13 | Blademaster | Melee / Magic Hybrid | High HP, Mid MP, High ATK, Mid MAG, Low SPD, MOVE 3, JUMP 2 | Katana / Heavy armor, Helm | • Wrath Draw – SP 10 non-elemental to enemies only. 10 MP, R0, A2, CT0<br>• Rain Blade – SP 10 heal to allies only. 12 MP, R0, A2<br>• Blade Veil – Protect + Shell to allies. 14 MP, R0, A2<br>• Night Edge – SP 14 dmg + Fear 50%. 20 MP, R0, A2, CT2 | Blade Catch – nullify one weapon attack | Doublehand – two-handed weapon WP ×1.5 (no shield) | Unyielding Step – cannot be knocked back; Move +1 on flat ground | Knight Lv 3, Monk Lv 2, Wyrmlancer Lv 1 |
| 14 | Conjurer | AoE Magic | Low HP, High MP, Low ATK, High MAG, Low SPD, MOVE 3, JUMP 2 | Rod, Staff / Robe, Hat | • Pyrelord / Frost Maiden / Storm Elder – SP 16 fire / ice / lightning, enemies only. 24 MP, R4, A2, CT4<br>• Hearthling – SP 10 heal, allies only. 16 MP, R4, A2, CT3<br>• Gemfox – Reflect 3 turns, allies only. 20 MP, R4, A2, CT3<br>• Wyrm Sovereign – SP 28 non-elemental, enemies only. 60 MP, R4, A3, CT8 | MP Restore – when damaged, restore 20% MP | Half MP – ability MP costs ×0.5 | Float – hover: immune to ground effects and Earthsong statuses; Jump +1 | Chronomancer Lv 2 |
| 15 | Mystic | Debuffer | Low HP, High MP, Low ATK, High MAG, Mid SPD, MOVE 3, JUMP 2 | Staff, Pole, Book / Robe, Hat | • Blind – Blind 3 turns, 85%. 6 MP, R4, A1, CT2<br>• Silence – Silence 3 turns, 75%. 8 MP, R4, A1, CT2<br>• Sleep – Sleep, 65%. 12 MP, R4, A1, CT3<br>• Life Drain – drain 25% target max HP. 16 MP, R4, A0, CT3<br>• Dispel – remove all positive statuses. 10 MP, R4, A1, CT1 | Mana Siphon – when targeted by a spell, gain its MP cost | Defense Boost – DEF +20% | Spirit Walk – Move +1, may pass through enemies | Cleric Lv 2 |
| 16 | Paladin | Holy Tank / Support | High HP, Mid MP, High ATK, Mid MAG, Low SPD, MOVE 3, JUMP 2 | Knight Sword, Shield / Heavy armor, Helm | • Nurse – heal 20% HP + cure Poison/Blind, self + adjacent. 8 MP, R0, A1<br>• Cover – until next turn, adjacent allies' damage is redirected to Paladin. 6 MP, R0<br>• Holy Blade – WP ×1.5 holy. 12 MP, R1<br>• Saint Cross – SP 12 holy to adjacent enemies. 16 MP, R0, A1 | Guardian – when adjacent ally is hit, take the hit instead | Equip Shields – any job may equip shields | Heavy Stride – no Move penalty from heavy armor weight | Master 2 Knight action abilities |
| 17 | Battlemage | Hybrid Caster | Mid HP, Mid MP, Mid ATK, Mid MAG, Mid SPD, MOVE 4, JUMP 2 | Rapier, Rod / Clothes, Hat | • Fire / Blizzard / Thunder – SP 8. 6 MP, R4, A1, CT1<br>• Cure – SP 6 heal. 6 MP, R4, A1, CT1<br>• Sleep – 55%. 10 MP, R4, A0, CT2<br>• Barrier – Protect + Shell single target. 12 MP, R3, CT2 | Riposte – counter melee hits with a rapier strike (WP ×0.8) | Doublecast – may cast two CT ≤1 spells in one action for total MP ×1.5 | Runner's Grace – Move +1, treat height ≤1 as flat | Sorcerer Lv 2, Cleric Lv 2 |
| 18 | Beastsage | Adaptive Caster | Mid HP, Mid MP, Mid ATK, Mid MAG, Mid SPD, MOVE 3, JUMP 2 | Saber / Clothes, Hat | • Brute Jab – WP ×1.5 physical. 4 MP, R1<br>• Stalwart Ward – Protect + Shell self. 12 MP, R0<br>• Soothing Gale – heal allies for user's current HP %. 20 MP, R0, A2<br>• Rancid Breath – 3 random negative statuses, 50% each. 20 MP, R2, A1<br>• (Learned) – any monster ability witnessed while Learn is equipped | Bestial Instinct – when hit by a monster, counter with a random learned Blue spell | Learn – acquire a monster ability when hit by it | Beast Path – pass through monster units; Move +1 in wilderness maps | Sorcerer Lv 1, Cleric Lv 1 |
| 19 | Gunner | Long-Range Status DPS | Low HP, Low MP, Mid ATK, Low MAG, Mid SPD, MOVE 3, JUMP 2 | Gun / Clothes, Hat | • Fireshot / Boltshot / Iceshot – gun WP fixed dmg (ignores ATK) elemental. 6 MP, R6<br>• Stopshot – Stop 1 turn, 40%. 12 MP, R6<br>• Blindshot – Blind, 70%. 6 MP, R6<br>• Chargeshot – WP ×1.5. 4 MP, R6, CT2 | Return Fire – counter ranged attacks with a basic shot | Eye for Distance – gun range +1 | Gunslinger's Perch – Move +1 when starting the turn ≥2 height above the lowest tile | Apothecary Lv 2 |
| 20 | Juggler | Trickster / Tempo | Low HP, Low MP, Mid ATK, Mid MAG, High SPD, MOVE 4, JUMP 3 | Dagger / Clothes, Hat | • Ring – Stop 1 turn, 45%. 10 MP, R4<br>• Dagger – WP ×0.8 + Immobilize 60%. 6 MP, R4<br>• Firebomb – SP 8 fire. 12 MP, R4, A1<br>• Ball – Confuse 1 turn, 50%. 10 MP, R4<br>• Smile – ally's CT set to 100. 24 MP, R3, CT2 | Catch – catch a thrown weapon/item and add it to inventory | Trickster – status-inflicting abilities +20% hit | Acrobat – Jump +2, no fall damage | Thief Lv 2 |
| 21 | Assassin | Glass-Cannon Striker | Low HP, Mid MP, High ATK, Mid MAG, High SPD, MOVE 4, JUMP 3 | Katana, Bow / Clothes | • Shadowbind – Stop 2 turns, 50%. 12 MP, R4<br>• Nightmare – Sleep + Poison, 55%. 16 MP, R4<br>• Mute Needle – Silence, 75%. 8 MP, R4<br>• Chill Needle – Slow + WP ×0.6 dmg. 10 MP, R1<br>• Ruin Strike – WP ×2.5 non-elemental. 40 MP, R1, CT4 | Reflex – evade one physical attack | Assassinate – attacks from behind deal +50% | Shadow Step – Move +1; enemies get no Counter-type reaction against an attack made after moving ≥3 tiles | Ninja Lv 2, Thief Lv 3 |
| 22 | Dread Knight | Debuff Tank | High HP, Low MP, High ATK, Low MAG, Low SPD, MOVE 3, JUMP 2 | Axe, Sword, Hammer / Heavy armor, Helm | • Fearful Impact – Fear 3 turns to adjacent enemies, 80%. 8 MP, R0, A1<br>• Dread Strike – WP ×1.0 + Fear 60%. 6 MP, R1<br>• Soul Reave – WP ×1.2 dark, heal self 50% of dmg. 12 MP, R1<br>• Intimidate – toggle aura: enemies ending a turn adjacent lose 1 ATK (stack 3). 0 MP, R0 | Frightful Presence – melee attacker gains Fear | Fortify – DEF +20% | Menacing Advance – enemies adjacent at end of move lose 10 CT | Knight Lv 3 |
| 23 | Runesword | Magic-Sword Support | Mid HP, Mid MP, Mid ATK, Mid MAG, Mid SPD, MOVE 4, JUMP 3 | Sword, Spear, Shield / Light armor | • Spellstrike – weapon attack with element of equipped rune (WP ×1.0 + SP 4). 6 MP, R weapon<br>• Rune Shield – Shell self + adjacent allies. 10 MP, R0, A1<br>• Heal – SP 8 heal single. 8 MP, R3, CT1<br>• Fire / Ice / Lightning – SP 8. 8 MP, R4, A0, CT1 | Spell Ward – halve one incoming magical hit | Rampart Aura – enemies cannot pass through tiles adjacent to you | Vanguard – Move +1 when an ally is within 2 tiles at turn start | Knight Lv 2, Sorcerer Lv 1 |
| 24 | Warlock | Dark Debuffer | Low HP, High MP, Low ATK, High MAG, Low SPD, MOVE 3, JUMP 2 | Rod, Book, Whip / Robe, Hat | • Word of Pain – SP 10 dark + Poison 70%. 12 MP, R4, A1, CT2<br>• Meditate – restore 30% own MP. 0 MP, R0<br>• Curse – target healing received −50%, BRV −20 for 3 turns. 10 MP, R4, CT2<br>• Charm – Charm 1 turn, 40%. 16 MP, R4, CT3<br>• Hex – target's next queued ability CT doubled. 8 MP, R4 | Malediction – melee attacker gains Poison | Arcane Reservoir – max MP +30% | Fell Approach – enemies passed adjacent to during move take 1 Poison tick | Mystic Lv 2, Sorcerer Lv 2 |

**Balance guidelines for the sheet**

- Each class exposes one **signature verb** listed first in its Action column. Prototype testing prioritizes that ability.
- Low-HP casters carry CT ≥ 2 on every damaging spell so melee has a reaction window; instant (CT 0) damage is reserved for melee-range and 0-MP abilities.
- Status hit chances sit between 40% (Stop, Charm) and 85% (Blind). Every status listed has a counter: Purify, Remedy, Dispel/Unspell, First Aid, Nurse, or Inner Calm.
- "Enemies only" AoE (Blademaster, Conjurer) costs ≥1.5× the MP of an equivalent friendly-fire spell.
- Reaction proc rate is BRV%, so glass cannons (Assassin, Ninja) are tuned at BRV 60 while tanks (Knight, Paladin, Dread Knight) sit at BRV 75.

---

## Section 4: Animation & Production Specification (Art Team)

### 4.1 Visual Style

- **Genre look:** high-fantasy pixel art in the classic tactics idiom: chunky readable silhouettes, dark 1-px outline, 3-tone shading per material.
- **Cell size:** 48 × 48 px per frame. Character body occupies ≈ 24 w × 36 h with the feet anchor at (24, 44). Weapons and effects may exceed the body but never the cell.
- **Palette:** 16 colours per sprite (index 0 = transparent), indexed PNG. Palette rows: 3 skin, 3 primary cloth, 3 secondary cloth, 2 metal, 2 leather/hair, 1 outline, 1 highlight. Team B is a palette swap of rows "primary cloth" only.
- **Facings:** draw **2** facings (front-left, back-left); the engine mirrors horizontally to produce the 4 isometric directions.
- **Grid:** 2:1 isometric, tile 32 × 16 px, 8 px per height step. Sprite z-sort by (row + col + height).
- **Portrait:** 48 × 48 px, 16 colours, 2 per class (Team A / Team B palette), no animation.

### 4.2 Mandatory Animation List (per class, per facing)

| Group | Animation | Frames | FPS | Notes |
| :--- | :--- | :---: | :---: | :--- |
| Core | Idle | 2 | 4 | Breathing bob 1 px |
| Core | Walk | 4 | 8 | Loop; step cycle 2 px per frame |
| Core | Critical (HP < 25%) idle | 2 | 3 | Kneeling / hunched |
| Core | Death | 3 | 6 | Ends on KO frame |
| Core | KO (lying) | 1 | — | Held until revive |
| Core | Evade | 1 | — | Lean-back frame, 6 ticks |
| Core | Defend / Wait | 1 | — | Guard pose |
| Battle | Melee Attack — upper | 3 | 10 | Anticipation, strike, recover |
| Battle | Melee Attack — lower | 3 | 10 | For targets at lower height |
| Battle | Ranged Attack | 3 | 10 | Draw, release, recover |
| Battle | Cast Start / Charging | 2 | 4 | Loop for whole CT period |
| Battle | Cast | 3 | 8 | Raise, flash, release |
| Battle | Cast Complete | 1 | — | Held 6 ticks |
| Battle | Take Hit — light | 1 | — | Flinch, 6 ticks |
| Battle | Take Hit — heavy | 2 | 8 | Stagger 2 px back |
| Battle | Jump Up / Land | 2 | 8 | Wyrmlancer reuses for all classes on height changes |
| Battle | Victory | 2 | 4 | Post-battle loop |
| UI | Portrait | 1 | — | 48 × 48, both teams |

Totals per class: 36 frames × 2 facings = **72 frames**, plus 2 portraits. Sheet layout: one PNG per class, rows = animations in the order above, columns = frames, both facings stacked (front-left rows 1–18, back-left rows 19–36). Filename: `NN_classname_sheet.png`; JSON atlas exported alongside (Aseprite "Array" format).

Shared effect sheets (not per class): 12 spell VFX (Fire, Ice, Thunder, Cure, Holy, Dark, Earth, Water, Buff, Debuff, Summon, Hit spark), each 64 × 64, 6 frames, 12 FPS.

### 4.3 Production Guidance

1. **Tools.** Aseprite (primary: indexed palettes, tags per animation, JSON export). Piskel or LibreSprite for contributors without a licence. Tiled for maps.
2. **Base sprite first.** Build one 48 × 48 "mannequin" per body type (light / medium / heavy) with the full 36-frame set. Every class is then a costume pass over the mannequin, which locks proportions and timing across all 24 classes.
3. **Pipeline per class.** (a) Rough blocking in 3 flat colours, both facings, all key poses. (b) Detail pass: outline, shading, weapon. (c) Animate in-betweens using onion skin. (d) Palette lock: reduce to the shared 16-colour rows, verify with Aseprite's palette panel. (e) Export sheet + JSON; run the manifest script to confirm 72 frames present.
4. **Consistency rules.** Same light source (upper-left) on all assets. Anchor point never moves between frames. Weapons never cross the outline of the head in Idle. Team swap rows must not be reused for skin or metal.
5. **AI-assisted concepting (optional).** Generate reference concept images with the image model pipeline already in use in the parent `sprites/` folder, then quantise to 15-bit / 16-colour before hand-cleaning in Aseprite. Generated output is reference only; final frames are hand-corrected to the mannequin timing.
6. **Review gate.** A frame set passes when it reads correctly at 1× on a 320 × 240 viewport and the walk loop has no foot slide.

---

## Section 5: Balance Rules, Restrictions & Implementation Roadmap

### 5.1 Balance Rules

1. No instant-death, petrify, or Doom abilities. Maximum single-hit damage is capped at 150% of the target's max HP only via CT ≥ 4 abilities.
2. Each class has at most 6 Action abilities; a unit may equip at most 12 Action abilities across primary + secondary sets.
3. Every status effect has at least two counters in the 24-class roster (Section 3 guidelines).
4. Reaction abilities cannot trigger other reactions. One Movement ability effect per turn.
5. Buffs and debuffs last 3 turns and do not stack beyond the listed cap (Focus +3, Intimidate 3).
6. No ability ignores both EVA and DEF/RES at once. Concentrate ignores EVA only; Focused Shot ignores EVA only.
7. Stat-modifying abilities (Rend, Yell, Focus) are bounded at ±3 on ATK/MAG, ±2 on SPD, and reset at battle end.
8. Enemy-only AoE requires CT ≥ 3 or MP ≥ 24.
9. Haste and Slow cancel each other; Stop cannot be applied to a unit already Stopped or Charging a CT ≥ 6 ability.
10. Equip-permission supports (Heavy Armor, Spears, Shields, Dual Wield) impose the item's Weight, so the tempo cost in 2.1 still applies.

### 5.2 Power Curve

- Level 1–20 for the vertical slice. Base stats grow +15% total over 20 levels (linear +0.75% per level); class multipliers apply on top (Low 0.8, Mid 1.0, High 1.25).
- Class abilities unlock at job levels 1, 2, 3, 4, 5 (JP 100 / 250 / 450 / 700 / 1000). Signature ability is always Lv 1.
- Weapon Power tiers: 4 / 6 / 8 / 10 at unit levels 1 / 6 / 12 / 18. Spell Power tiers as listed in Section 3.
- Expected time-to-kill for a Mid ATK unit against a Mid HP unit of equal level: 4 hits. Tank vs. tank: 7 hits. Glass cannon vs. caster: 2 hits.
- A five-unit battle at equal level should conclude in 8–14 rounds (≈ 60–110 unit turns).

### 5.3 Implementation Roadmap

**Phase 1 — Prototype (weeks 1–4).**
Deliver the rulebook in Section 2 as code: CT timeline, stats, damage formulas, five ability slots, status table, one 12 × 12 flat-plus-two-height map. Implement Footman, Apothecary, Knight, Archer, Cleric, Sorcerer with all listed abilities. Placeholder art: mannequin sprites with class colour swap. Exit criterion: a full 5v5 auto-battle between two AI teams completes with no rule violation logged.

**Phase 2 — Vertical Slice (weeks 5–10).**
Implement the remaining 18 classes, job-unlock tree, JP/equipment-teaching learning, class change in the deployment screen, one full authored battle map with water, grass, rock, sand, wood tiles (Earthsong table), and monster units for Beastsage Learn. Placeholder sprites for every animation in 4.2 (mannequin + costume silhouette). Exit criterion: any of the 24 classes is playable end-to-end by a human player against AI.

**Phase 3 — Polish & Balance (weeks 11–16).**
Finalise all 24 sprite sheets and portraits, spell VFX, and the Edict system. Internal playtest with a scripted matrix: each class vs. each class in a 1v1 arena (576 matches) plus 40 curated 5v5 team compositions. Tune to the 5.2 time-to-kill and round-count targets; any ability with a >60% win-rate delta in the matrix is reworked. Exit criterion: no class in the top or bottom 10% of win rate across both matrices for two consecutive tuning passes.
