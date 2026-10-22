// Airport lighting: runway edge/threshold/end/centreline lights, approach lighting with sequenced flashers,
// taxiway edge lights and functional PAPI (colour computed from the viewer's elevation angle).
import * as THREE from 'three';

let spriteTex = null;
export function lightSprite() {
  if (spriteTex) return spriteTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  spriteTex = new THREE.CanvasTexture(c);
  return spriteTex;
}

export const LIGHT_COLORS = {
  white: [1, 0.97, 0.85], yellow: [1, 0.8, 0.25], green: [0.2, 1, 0.35], red: [1, 0.12, 0.08], blue: [0.25, 0.4, 1], strobe: [1, 1, 1],
};

/** Accumulates light points (local three.js coords) and builds a Points object. */
export class LightSet {
  constructor() { this.pos = []; this.col = []; this.flash = []; }
  add(x, y, z, color, flashPhase = -1) { this.pos.push(x, y, z); const c = LIGHT_COLORS[color] || color; this.col.push(c[0], c[1], c[2]); this.flash.push(flashPhase); }
  build(size = 4) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('flash', new THREE.Float32BufferAttribute(this.flash, 1));
    g.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: lightSprite() }, uSize: { value: size }, uNight: { value: 1 }, uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader: `attribute float flash; attribute vec3 color; varying vec3 vCol; varying float vA;
        uniform float uSize; uniform float uNight; uniform float uTime; uniform float uPixelRatio;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          float d = -mv.z;
          float a = 1.0;
          if (flash >= 0.0) { float ph = fract(uTime * 2.0 - flash); a = ph < 0.08 ? 1.0 : 0.0; }
          vA = a * mix(0.22, 1.0, uNight);
          vCol = color;
          gl_PointSize = uPixelRatio * uSize * mix(0.45, 1.0, uNight) * clamp(900.0 / max(d, 1.0), 0.8, 3.5) * (flash >= 0.0 ? 1.8 : 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vCol; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a * vA < 0.02) discard;
          gl_FragColor = vec4(vCol * 1.6, t.a * vA);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    p.renderOrder = 5;
    return p;
  }
}

/** PAPI: 4 light units; colour per unit from viewer elevation angle above the unit. */
export class Papi {
  constructor(units /* [{pos: Vector3 local, threshold: deg}] */, runwayDirLocal) {
    this.units = units; this.dir = runwayDirLocal;
    const set = new LightSet();
    for (const u of units) set.add(u.pos.x, u.pos.y, u.pos.z, 'white');
    this.points = set.build(7);
    this.points.material.uniforms.uSize.value = 7;
    this.colors = this.points.geometry.getAttribute('color');
  }
  /** cameraLocal: camera position in the airport's local three.js frame. */
  update(cameraLocal) {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      const dx = cameraLocal.x - u.pos.x, dz = cameraLocal.z - u.pos.z, dy = cameraLocal.y - u.pos.y;
      const along = -(dx * this.dir.x + dz * this.dir.z); // positive in front of the unit (approach side)
      const ang = along > 0 ? (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI : -1;
      const c = ang > u.threshold ? LIGHT_COLORS.white : LIGHT_COLORS.red;
      this.colors.setXYZ(i, c[0], c[1], c[2]);
    }
    this.colors.needsUpdate = true;
  }
}
