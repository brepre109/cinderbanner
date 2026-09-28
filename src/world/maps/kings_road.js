// "The King's Road" -- Ravenscar Ascent's cliff road in the Northreach winter, for story node c6 ("Crown executioners
// hunt the captain on the road to the capital."). b6 keeps the moonlit original; c6 gets this snowbound day. Same
// ground, same routes (see _variant.js).
import { DEF as BASE } from './ravenscar_ascent.js';
import { variant } from './_variant.js';

export const DEF = variant(BASE, {
  id: 'kings_road', name: 'The King\'s Road', mood: 'snow',
  blurb: 'The cliff road to Aurelmont under snow, the capital\'s walls at its head.',
  drop: ['flowers'],
});
