// "Rimewood" -- Highland Terraces above the treeline in the Northreach winter, for side node s3 (Rimewood Hunt: "The
// pack is gathering above the treeline."). Same terraces, same routes (see _variant.js); snow skin, winter light.
import { DEF as BASE } from './highland_terraces.js';
import { variant } from './_variant.js';

export const DEF = variant(BASE, {
  id: 'rimewood', name: 'Rimewood', mood: 'snow',
  blurb: 'Snowbound terraces above the Rimewood treeline, where the trappers\' wendigo pack lies up.',
  drop: ['flowers'],
});
