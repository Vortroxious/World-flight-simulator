// Hand-modelled landmark structures at real coordinates (original geometry). Each is collidable.
import * as THREE from 'three';
import { LocalFrame } from '../../geo/wgs84.js';
import { ObstacleGroup } from '../../sim/collision/obstacles.js';

const curv = (e, n) => (e * e + n * n) / (2 * 6371000);

/** Golden Gate Bridge-style suspension bridge: towers at real positions, 1280 m main span, 67 m deck. */
export function goldenGateBridge(origin, collision) {
  const south = [37.81035, -122.47716], north = [37.82572, -122.47898];
  const frame = new LocalFrame((south[0] + north[0]) / 2, (south[1] + north[1]) / 2, 0);
  const A = frame.toEnu(south[0], south[1], 0), B = frame.toEnu(north[0], north[1], 0);
  const span = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const d = [(B[0] - A[0]) / span, (B[1] - A[1]) / span], r = [d[1], -d[0]];
  const heading = Math.atan2(d[0], d[1]);
  const g = new THREE.Group(); g.name = 'Golden Gate Bridge';
  const orange = new THREE.MeshStandardMaterial({ color: 0xb8432f, roughness: 0.6, metalness: 0.2 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x6d2f25, roughness: 0.8 });
  const obstacles = new ObstacleGroup(frame.lat, frame.lon, 40);
  const P = (along, across) => [d[0] * along + r[0] * across, d[1] * along + r[1] * across];
  const box = (along, across, u, w, l, h, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    const p = P(along, across);
    m.position.set(p[0], u + h / 2 - curv(p[0], p[1]), -p[1]);
    m.rotation.y = -heading;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    obstacles.addBox(p[0], p[1], w / 2, l / 2, heading, u, h);
    return m;
  };
  const side = 343, half = span / 2, deckH = 67, towerH = 227;
  // Deck (main + side spans + approach viaducts)
  box(0, 0, deckH - 7.6, 27, span + side * 2 + 300, 7.6, deckMat);
  // Towers: two legs + portal struts
  for (const t of [-half, half]) {
    for (const s of [-1, 1]) box(t, s * 17, 0, 10, 14, towerH, orange);
    for (const hh of [deckH + 25, 120, 160, 200, towerH - 6]) box(t, 0, hh, 38, 6, 6, orange);
  }
  // Main cables (parabolic) and side-span cables to anchorages; suspender ropes.
  const cable = (pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([a, s, h]) => { const p = P(a, s); return new THREE.Vector3(p[0], h - curv(p[0], p[1]), -p[1]); }));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.9, 6), orange); m.castShadow = true; g.add(m);
  };
  for (const s of [-17, 17]) {
    const main = [];
    for (let i = 0; i <= 32; i++) { const a = -half + (i / 32) * span; const t = a / half; main.push([a, s, deckH + 4 + (towerH - 4 - deckH - 4) * t * t]); }
    cable(main);
    cable([[-half, s, towerH - 4], [-half - side * 0.5, s, deckH + 45], [-half - side - 60, s, deckH - 5]]);
    cable([[half, s, towerH - 4], [half + side * 0.5, s, deckH + 45], [half + side + 60, s, deckH - 5]]);
    const ropes = [];
    for (let a = -half + 15; a < half; a += 15) { const t = a / half, top = deckH + 4 + (towerH - 8 - deckH) * t * t; const p = P(a, s); ropes.push(p[0], deckH - curv(p[0], p[1]), -p[1], p[0], top - curv(p[0], p[1]), -p[1]); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(ropes, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8a3a2a })));
  }
  // Aircraft warning lights on tower tops.
  origin.attach(g, frame);
  collision.add(obstacles);
  return { group: g, obstacles, frame };
}
