// The painted region behind each chapter (world map, story scenes, results, shops). Both images are 1376 x 768 (data.js MAP_IMG).
import mapImg1 from './assets/worldmap.jpg';
import mapImg2 from './assets/worldmap2.jpg';
import { chOf } from './data.js';
/** Image for chapter/region `ch`. */
export const regionImg = (ch) => (ch === 2 ? mapImg2 : mapImg1);
/** Image for a node / town (its `ch`). */
export const nodeImg = (n) => regionImg(chOf(n));
