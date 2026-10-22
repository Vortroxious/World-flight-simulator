// Floating origin: the render scene is a local ENU tangent frame (three.js axes x=East, y=Up, z=-North)
// re-centred near the aircraft so float32 vertex/matrix precision is never an issue anywhere on Earth.
import * as THREE from 'three';
import { LocalFrame, geodeticToEcef } from '../geo/wgs84.js';

export const enuToThree = (e, n, u, out = new THREE.Vector3()) => out.set(e, u, -n);

export class FloatingOrigin {
  constructor() {
    this.frame = new LocalFrame(0, 0, 0);
    this.version = 0;
    this.attached = new Set();
    this._t = [0, 0, 0];
  }

  set(lat, lon) {
    this.frame.set(lat, lon, 0);
    this.version++;
    for (const o of this.attached) this.place(o, o.userData.geoFrame);
  }

  /** Distance (m, horizontal) from origin to a geodetic point. */
  distanceTo(lat, lon) {
    const p = this.frame.toEnu(lat, lon, 0, this._t);
    return Math.hypot(p[0], p[1]);
  }

  /** Three.js position of a geodetic point. */
  toThree(lat, lon, h, out = new THREE.Vector3()) {
    const p = this.frame.toEnu(lat, lon, h, this._t);
    return out.set(p[0], p[2], -p[1]);
  }

  /** Convert an ENU direction expressed at geodetic point frame `f` into three.js world axes. */
  dirToThree(f, e, n, u, out = new THREE.Vector3()) {
    const m = f.m;
    const dx = m[0] * e + m[3] * n + m[6] * u, dy = m[1] * e + m[4] * n + m[7] * u, dz = m[2] * e + m[5] * n + m[8] * u;
    const d = this.frame.dirToEnu(dx, dy, dz, this._t);
    return out.set(d[0], d[2], -d[1]);
  }

  /** Matrix mapping a local frame's three.js coordinates into the scene. */
  matrixFor(f, out = new THREE.Matrix4()) {
    const p = this.frame.ecefToEnu(f.origin[0], f.origin[1], f.origin[2], this._t);
    const pos = new THREE.Vector3(p[0], p[2], -p[1]);
    const x = this.dirToThree(f, 1, 0, 0), y = this.dirToThree(f, 0, 0, 1), z = this.dirToThree(f, 0, -1, 0);
    return out.makeBasis(x, y, z).setPosition(pos);
  }

  place(obj, f) {
    obj.matrixAutoUpdate = false;
    this.matrixFor(f, obj.matrix);
    obj.matrixWorldNeedsUpdate = true;
  }

  /** Keep `obj` (authored in local frame `f`) positioned across origin shifts. */
  attach(obj, f) {
    obj.userData.geoFrame = f;
    this.place(obj, f);
    this.attached.add(obj);
    return obj;
  }
  detach(obj) { this.attached.delete(obj); }
}

export { LocalFrame, geodeticToEcef };
