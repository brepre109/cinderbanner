// "The Tithe Road" -- Aqueduct Span's road and bridges in the Northreach winter, for story node c3 ("A tithe-wagon of
// the dead rolls for Karsmoor under Crown guard."). Same ground, same routes (see _variant.js); snow skin, ice-cold
// water, winter light.
import { DEF as BASE } from './aqueduct_span.js';
import { variant } from './_variant.js';

export const DEF = variant(BASE, {
  id: 'tithe_road', name: 'The Tithe Road', mood: 'snow',
  blurb: 'The old aqueduct road under snow, where the Crown\'s tithe-wagons cross for Karsmoor.',
  drop: ['flowers'],
});
