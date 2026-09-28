// "Gaol Shore" -- Hearthmoor Flats' river pasture in the Northreach winter, for side node s4 (Varg's Wager: "Crown
// gaolers mean to hang a thief on the lakeshore."). Same ground, same routes (see _variant.js).
import { DEF as BASE } from './hearthmoor_flats.js';
import { variant } from './_variant.js';

export const DEF = variant(BASE, {
  id: 'varg_shore', name: 'Gaol Shore', mood: 'snow',
  blurb: 'A frozen shore and a slow black river, and a Crown gallows waiting on it.',
  drop: ['flowers'],
});
