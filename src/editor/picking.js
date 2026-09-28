import * as THREE from 'three';
import { HSTEP } from '../core/config.js';
import { DIRS as CAM_DIRS, screenToTile } from '../render/camera.js';

// Tile-under-cursor for the editor (PLAN 6.6). player.js's recipe verbatim, plus the three
// corrections an editor needs and a game does not.
//
// Kept from player.js: raycast `scene.getObjectByName('terrain').children` recursively, drop
// `skirt` hits (the unlit black diorama underside; hitting it yields nonsense tiles), and nudge the
// hit point by -0.01 * face normal before Math.floor. That nudge is the whole trick: a hit exactly
// on a vertical cliff face lies on an integer tile boundary and floor() would credit the neighbour.
//
// Changed:
//  1. NDC from canvas.getBoundingClientRect(), not clientWidth/Height. The editor canvas is inset
//     between docks, so clientX is offset by the rail and the menubar; player.js's version is only
//     correct because #gl is `inset:0`.
//  2. Height comes from the DOCUMENT, never from the mesh. Mid-stroke the mesh is stale BY DESIGN
//     (the ghost is the current truth), so reading h off geometry would read the previous edit.
//  3. Stroke-locked picking plane. On pointerdown we capture the hit tile's h0 and, for the rest of
//     the stroke, intersect a horizontal plane at Y(h0) instead of the terrain. Without this, a
//     raise brush lifts the ground under the cursor, the next ray hits the new higher surface
//     nearer the camera, and the brush walks away from the pointer — the classic runaway. It also
//     removes the stroke's dependency on geometry that is not being rebuilt anyway.

/** Screen up/right/down/left as tile deltas AT YAW INDEX 0 (player.js). Rotate with the camera. */
export const DIRS = CAM_DIRS;
/**
 * @returns {[number,number]} the tile delta for screen direction `dir` at `yawIndex`.
 * Delegates to camera.screenToTile so the editor cursor and the game cursor cannot drift apart: the camera now has
 * eight yaw stops, and the old local `+ yawIndex` form both ignored the four new ones and turned the wrong way.
 */
export function screenDir(dir, yawIndex = 0) { return screenToTile(dir, yawIndex); }

export class TilePicker {
  /**
   * @param {{canvas:HTMLCanvasElement, camera:{cam:THREE.Camera}, scene:THREE.Scene, map?:object}} o
   */
  constructor({ canvas, camera, scene, map = null }) {
    this.canvas = canvas; this.camera = camera; this.scene = scene; this.map = map;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.point = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hits = [];
    this.locked = null;                 // { h } while a stroke owns the picking plane
    this.hover = null;                  // { x, z, h, wx, wz } or null
  }

  /** The compiled MAP the doc currently produces. Heights are read from here, never from geometry. */
  setMap(map) { this.map = map; return this; }

  /** Normalised device coords from the canvas RECT, so an inset viewport picks correctly. */
  setPointer(ev) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return this;
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    return this;
  }

  /** A raycaster aimed at the last pointer position — the handle prop picking and gizmos share. */
  ray(ev) {
    if (ev) this.setPointer(ev);
    this.raycaster.setFromCamera(this.ndc, this.camera.cam);
    return this.raycaster;
  }

  /** Nearest prop under the cursor, walked up to the group props.js tagged with `userData.prop`. */
  pickProp(propsGroup, ev) {
    if (!propsGroup) return null;
    const hits = this.ray(ev).intersectObjects(propsGroup.children, true);
    for (const h of hits) {
      for (let o = h.object; o && o !== propsGroup; o = o.parent) {
        if (o.userData && o.userData.prop) return { prop: o.userData.prop, object: o, distance: h.distance, point: h.point };
      }
    }
    return null;
  }

  /**
   * @param {PointerEvent|MouseEvent} [ev]
   * @returns {{x:number,z:number,h:number,wx:number,wz:number,locked:boolean}|null} null off-board
   */
  pick(ev) {
    const ray = this.ray(ev);
    let wx, wz;
    if (this.locked) {
      // Plane at the height the stroke started on. constant = -d for `normal.dot(p) + constant = 0`.
      this._plane.constant = -this.locked.h * HSTEP;
      if (!ray.ray.intersectPlane(this._plane, this.point)) { this.hover = null; return null; }
      wx = this.point.x; wz = this.point.z;
    } else {
      const terrain = this.scene.getObjectByName('terrain');
      if (!terrain) { this.hover = null; return null; }
      this._hits.length = 0;
      ray.intersectObjects(terrain.children, true, this._hits);
      let hit = null;
      for (const h of this._hits) if (!h.object.name.includes('skirt')) { hit = h; break; }
      if (!hit) { this.hover = null; return null; }
      const n = hit.face ? hit.face.normal : null;
      wx = hit.point.x - (n ? n.x : 0) * 0.01;
      wz = hit.point.z - (n ? n.z : 0) * 0.01;
      this.point.copy(hit.point);
    }
    const x = Math.floor(wx), z = Math.floor(wz);
    const t = this.map && this.map.at ? this.map.at(x, z) : null;
    if (!t) { this.hover = null; return null; }
    this.hover = { x, z, h: t.h, wx, wz, locked: !!this.locked };
    return this.hover;
  }

  /**
   * Lock the picking plane for a drag. Call from pointerdown, after one pick().
   * @param {number} [h] override height in h steps; defaults to the tile under the cursor
   * @returns {boolean} false when there was nothing to lock onto (click off the board)
   */
  beginStroke(h) {
    const base = h !== undefined ? h : (this.hover ? this.hover.h : (this.pick() ? this.hover.h : null));
    if (base === null || base === undefined) return false;
    this.locked = { h: base };
    return true;
  }

  endStroke() { this.locked = null; }

  /** Height of the tile under the cursor, in h steps, or null. Reads the doc, not the mesh. */
  get hoverH() { return this.hover ? this.hover.h : null; }
  /** World Y of the hovered surface, for placing gizmos. */
  get hoverY() { return this.hover ? this.hover.h * HSTEP : null; }
}
