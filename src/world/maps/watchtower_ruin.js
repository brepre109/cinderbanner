// "Watchtower Ruin" -- Hearthmoor Flats at dusk, for side node s2 ("Risen dead haunt the old watchtower."). The ruined
// watchtower on the south-west rise is Hearthmoor's own; the flats keep their gameplay (see _variant.js) and lose the
// golden morning for the shipped dusk rig, so the dead walk in the last light.
import { DEF as BASE } from './hearthmoor_flats.js';
import { variant } from './_variant.js';

export const DEF = variant(BASE, {
  id: 'watchtower_ruin', name: 'Watchtower Ruin', mood: 'dusk',
  blurb: 'The old watchtower over the flats at dusk. The Choir left a cantor here to keep the dead singing.',
  drop: ['flowers'],
});
