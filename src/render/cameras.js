// Camera rig: cockpit (free-look, instrument zoom, buffet shake), chase, orbit, tower and replay views.
import * as THREE from 'three';
import { clamp } from '../core/math.js';

export const VIEWS = ['cockpit', 'chase', 'orbit', 'tower'];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'cockpit';
    this.look = { yaw: 0, pitch: -0.1 };
    this.fov = { cockpit: 68, chase: 60, orbit: 55, tower: 40 };
    this.orbit = { az: 0.6, el: 0.25, dist: 22 };
    this.eye = new THREE.Vector3(-0.3, 0.62, -0.42);
    this.instrumentView = false;
    this.chasePos = null;
    this.towerPos = null;
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3();
    this.shake = 0;
  }

  setMode(m) { this.mode = m; this.chasePos = null; if (m !== 'cockpit') this.instrumentView = false; }
  next() { this.setMode(VIEWS[(VIEWS.indexOf(this.mode) + 1) % VIEWS.length]); }
  get isCockpit() { return this.mode === 'cockpit'; }

  freeLook(dx, dy) {
    if (this.mode === 'cockpit') {
      this.look.yaw = clamp(this.look.yaw - dx * 0.004, -2.6, 2.6);
      this.look.pitch = clamp(this.look.pitch - dy * 0.004, -1.2, 1.1);
      this.instrumentView = false;
    } else {
      this.orbit.az -= dx * 0.006; this.orbit.el = clamp(this.orbit.el + dy * 0.004, -0.2, 1.45);
      if (this.mode === 'chase') this.mode = 'orbit';
    }
  }
  zoom(delta) {
    if (this.mode === 'cockpit' || this.mode === 'tower') this.fov[this.mode] = clamp(this.fov[this.mode] * (1 + delta * 0.08), 12, 95);
    else this.orbit.dist = clamp(this.orbit.dist * (1 + delta * 0.1), 6, 600);
  }
  resetView() { this.look.yaw = 0; this.look.pitch = -0.1; this.fov.cockpit = 68; this.instrumentView = false; }
  toggleInstrumentView() { this.mode = 'cockpit'; this.instrumentView = !this.instrumentView; }

  /**
   * @param {THREE.Object3D} root aircraft root (world transform set)
   * @param {object} ac aircraft (for shake cues)
   */
  update(dt, root, ac, opts = {}) {
    const cam = this.camera;
    root.updateMatrixWorld();
    const pos = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
    const rq = new THREE.Quaternion().setFromRotationMatrix(root.matrixWorld);
    const up = opts.up || new THREE.Vector3(0, 1, 0);
    let fov;
    if (this.mode === 'cockpit') {
      // Buffet near the stall and rumble on rough ground.
      const gs = Math.hypot(ac.v[0], ac.v[1]);
      const rough = ac.onGround ? clamp(gs / 30, 0, 1) * (ac.lastSurface === 'runway' ? 0.15 : 0.6) : 0;
      this.shake = clamp((ac.stall || 0) * 1.2 + rough + (opts.impactShake || 0), 0, 2);
      const t = performance.now() / 1000;
      const sx = this.shake * 0.004 * Math.sin(t * 37.1), sy = this.shake * 0.004 * Math.sin(t * 43.7 + 1);
      let yaw = this.look.yaw, pitch = this.look.pitch;
      fov = this.fov.cockpit;
      if (this.instrumentView) { yaw = 0.0; pitch = -0.42; fov = 34; }
      const eye = this.eye.clone(); eye.x += sx; eye.y += sy;
      cam.position.copy(eye.applyMatrix4(root.matrixWorld));
      this._e.set(pitch, yaw, 0, 'YXZ');
      cam.quaternion.copy(rq).multiply(this._q.setFromEuler(this._e));
      cam.near = 0.04;
    } else if (this.mode === 'chase') {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rq);
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      const target = pos.clone().addScaledVector(fwd, -16).addScaledVector(up, 4.5);
      if (!this.chasePos) this.chasePos = target.clone();
      this.chasePos.lerp(target, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.chasePos);
      cam.up.copy(up); cam.lookAt(pos.clone().addScaledVector(up, 1));
      fov = this.fov.chase; cam.near = 0.3;
    } else if (this.mode === 'orbit') {
      const o = this.orbit;
      // orbit in world ENU-ish axes around the aircraft
      const off = new THREE.Vector3(Math.sin(o.az) * Math.cos(o.el), Math.sin(o.el), Math.cos(o.az) * Math.cos(o.el)).multiplyScalar(o.dist);
      cam.position.copy(pos).add(off);
      if (opts.groundAt) { const gy = opts.groundAt(cam.position); if (cam.position.y < gy + 1.5) cam.position.y = gy + 1.5; }
      cam.up.copy(up); cam.lookAt(pos);
      fov = this.fov.orbit; cam.near = 0.3;
    } else { // tower / flyby
      if (!this.towerPos || this.towerPos.distanceTo(pos) > 3000) {
        const v = opts.velocity || new THREE.Vector3(0, 0, -1);
        this.towerPos = opts.towerPosition && opts.towerPosition.distanceTo(pos) < 3000 ? opts.towerPosition.clone() : pos.clone().addScaledVector(v.clone().normalize(), 600).add(new THREE.Vector3(60, 25, 40));
      }
      cam.position.copy(this.towerPos);
      cam.up.copy(up); cam.lookAt(pos);
      const d = this.towerPos.distanceTo(pos);
      fov = clamp((Math.atan2(25, d) * 2 * 180) / Math.PI, 2, this.fov.tower);
      cam.near = 1;
    }
    if (Math.abs(cam.fov - fov) > 0.01 || cam.userData.near !== cam.near) { cam.fov = fov; cam.userData.near = cam.near; cam.updateProjectionMatrix(); }
  }
}
