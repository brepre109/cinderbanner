// The battle map each story scene takes place on, as a still of its diorama (captured by shots/stage15/capmaps.mjs:
// the map's wide preset, no units, no HUD). Story scenes use it instead of a blurred crop of the painted realm map.
import { NODE } from '../data.js';
import { nodeImg } from '../regions.js';
const IMGS = import.meta.glob('./maps/*.jpg', { eager: true, query: '?url', import: 'default' });
const byMap = Object.fromEntries(Object.entries(IMGS).map(([p, u]) => [p.replace(/^.*\/(.*)\.jpg$/, '$1'), u]));
/** Backdrop for a node (its battle map), falling back to the painted region. */
export const backdropOf = (b) => (b && byMap[b.map]) || nodeImg(b);
export const hasBackdrop = (b) => !!(b && byMap[b.map]);
export { NODE };
