// "Vesk Hollow" -- Wendford Crossing's geometry in the Northreach winter, for story node c2 (The Bell Tithe: "Vesk
// Hollow rings its bell for its dead. Today the Crown has come to collect them."). The walled hill village under one
// bell tower: the watchtower by the south-west gate becomes the village belfry (same 2x2 footprint), the graveyard
// plateau keeps its stones, and the snow skin + 'snow' light replace the southern dusk. Gameplay is Wendford's, tile
// for tile (see _variant.js).
import * as WENDFORD from './wendford_crossing.js';
import { variant, fromLegacyLite } from './_variant.js';

export const DEF = variant(fromLegacyLite(WENDFORD, 'vesk_hollow', 'Vesk Hollow'), {
  id: 'vesk_hollow', name: 'Vesk Hollow', mood: 'snow',
  blurb: 'A walled hill village under one bell tower, snowed in. The Crown\'s wardens stand between the houses and the graves.',
  drop: ['flowers'],
  swap: (p) => (p.type === 'tower' ? { ...p, type: 'belfry', th: 3.6 } : null),
});
