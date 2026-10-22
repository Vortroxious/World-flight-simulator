// Visual crash effects: smoke/fire particles and physically integrated debris from detached components.
// Each effect lives in a local ENU frame attached to the floating origin.
import * as THREE from 'three';
import { LocalFrame } from '../geo/wgs84.js';
import { lightSprite } from '../world/airports/lighting.js';

export class Effects {
  constructor(scene, origin, ground) {
    this.scene = scene; this.origin = origin; this.ground = ground;
    this.debris = []; this.emitters = [];
  }

  /** Spawn a debris piece from a model part. worldVel: three.js velocity (m/s). */
  addDebris(part, worldVel) {
    part.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    part.matrixWorld.decompose(wp, wq, ws);
    const g = this.origin.frame.enuToGeodetic(wp.x, -wp.z, wp.y);
    const frame = new LocalFrame(g.lat, g.lon, 0);
    const holder = new THREE.Group();
    this.origin.attach(holder, frame);
    this.scene.add(holder);
    const clone = part.clone(true);
    clone.visible = true;
    clone.position.set(0, g.h, 0);
    // orientation: world quaternion relative to frame (approximately equal near origin)
    clone.quaternion.copy(wq);
    holder.add(clone);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(0.3, Math.min(size.x, size.y, size.z) / 2);
    this.debris.push({
      holder, obj: clone, frame, v: worldVel.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4)),
      w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6), r, rest: false, drag: 0.02 + 0.3 / Math.max(1, size.length()),
    });
  }

  /** Smoke/fire emitter that follows a callback position (three.js world) or stays at a point. */
  addEmitter(kind, getPos, rate = 40) {
    const n = 600;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    const fire = kind === 'fire';
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: lightSprite() }, uColor: { value: new THREE.Color(fire ? 0xff7a20 : 0x2b2b2b) } },
      vertexShader: `attribute float alpha; attribute float size; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * 600.0 / max(-mv.z, 0.5); gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    this.scene.add(pts);
    const em = { kind, pts, getPos, rate, n, parts: Array.from({ length: n }, () => ({ life: 0 })), acc: 0, i: 0, active: true };
    this.emitters.push(em);
    return em;
  }

  update(dt, wind = new THREE.Vector3()) {
    for (const d of this.debris) {
      if (d.rest) continue;
      d.v.y -= 9.81 * dt;
      d.v.multiplyScalar(1 - d.drag * dt * d.v.length() * 0.05);
      const p = d.obj.position.addScaledVector(d.v, dt);
      d.obj.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(d.w.x * dt, d.w.y * dt, d.w.z * dt)));
      const g = d.frame.enuToGeodetic(p.x, -p.z, 0);
      const s = this.ground.sample(g.lat, g.lon, {});
      const gh = (s.surface === 'water' ? 0 : s.h) + d.r * 0.5;
      const curvDrop = (p.x * p.x + p.z * p.z) / (2 * 6371000);
      if (p.y + curvDrop < gh) {
        p.y = gh - curvDrop;
        if (s.surface === 'water') { d.v.multiplyScalar(0.2); d.v.y = Math.max(d.v.y, -0.3); d.sinking = (d.sinking || 0) + dt; if (d.sinking > 20) d.rest = true; }
        else { d.v.y = -d.v.y * 0.25; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); }
        if (d.v.length() < 0.5) d.rest = true;
      }
    }
    for (const em of this.emitters) {
      const pos = em.getPos?.();
      if (em.active && pos) {
        em.acc += em.rate * dt;
        while (em.acc > 1) {
          em.acc -= 1;
          const p = em.parts[em.i]; em.i = (em.i + 1) % em.n;
          p.life = em.kind === 'fire' ? 0.6 + Math.random() * 0.6 : 5 + Math.random() * 6;
          p.max = p.life;
          p.x = pos.x + (Math.random() - 0.5) * 1.5; p.y = pos.y + Math.random(); p.z = pos.z + (Math.random() - 0.5) * 1.5;
          p.vx = (Math.random() - 0.5) * 1.2; p.vy = em.kind === 'fire' ? 3 + Math.random() * 2 : 2 + Math.random() * 2; p.vz = (Math.random() - 0.5) * 1.2;
        }
      }
      const pa = em.pts.geometry.attributes.position, al = em.pts.geometry.attributes.alpha, sz = em.pts.geometry.attributes.size;
      for (let i = 0; i < em.n; i++) {
        const p = em.parts[i];
        if (p.life > 0) {
          p.life -= dt;
          p.x += (p.vx + wind.x * 0.8) * dt; p.y += p.vy * dt; p.z += (p.vz + wind.z * 0.8) * dt;
          const t = 1 - p.life / p.max;
          pa.setXYZ(i, p.x, p.y, p.z);
          al.setX(i, em.kind === 'fire' ? (1 - t) * 0.9 : Math.min(1, t * 4) * (1 - t) * 0.55);
          sz.setX(i, em.kind === 'fire' ? 1.2 + t * 1.5 : 1.5 + t * 9);
        } else al.setX(i, 0);
      }
      pa.needsUpdate = al.needsUpdate = sz.needsUpdate = true;
    }
  }

  /** Shift particle positions after a floating-origin recentre (dx in three.js coords). */
  shift(delta) {
    for (const em of this.emitters) for (const p of em.parts) if (p.life > 0) { p.x -= delta.x; p.y -= delta.y; p.z -= delta.z; }
  }

  clear() {
    for (const d of this.debris) { this.origin.detach(d.holder); this.scene.remove(d.holder); }
    for (const em of this.emitters) { this.scene.remove(em.pts); em.pts.geometry.dispose(); em.pts.material.dispose(); }
    this.debris = []; this.emitters = [];
  }
}
