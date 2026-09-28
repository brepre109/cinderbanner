// World scale: 1 tile = 1 unit. Heights are integer "h" steps; 1h = HSTEP units.
export const TILE = 1;
export const HSTEP = 0.25;          // classic-like: a full tile width ≈ 4h
export const SPRITE_H = 1.55;       // human sprite height in world units
export const VIEW_TILES = 13;       // tiles visible across the short axis at zoom 1
export const DEBUG = new URLSearchParams(location.search).has('debug');
