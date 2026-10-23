// Dev-only exterior model viewer: /dev/models.html?id=a320&view=34&state=landing
import * as THREE from 'three';
import { AIRCRAFT } from '../src/aircraft/index.js';
import { Aircraft } from '../src/sim/aircraft.js';
import { createAircraftModel } from '../src/render/models/index.js';

const q = new URLSearchParams(location.search);
const id = q.get('id') || 'a320', view = q.get('view') || '34', state = q.get('state') || 'ground';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9cc0e0);
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x667055, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-30, 60, -20); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x55605a })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
const cfg = AIRCRAFT[id], ac = new Aircraft(cfg);
ac.placeOnGround(0, 0, 0); ac.setReadyState();
if (state === 'landing') { ac.flapDeg = cfg.aero.flaps.at(-1).deg; ac.spoilerPos = 1; ac.engines.forEach((e) => { e.reverser = 1; }); ac.controls.aileron = 0.6; ac.surf = { elevator: 0.5, aileron: 0.6 }; ac.controls.rudder = 0.6; }
if (state === 'flight') { ac.gearPos = 0; ac.engines.forEach((e) => { e.afterburner = true; e.n1 = 100; }); }
if (state === 'transit') { ac.gearPos = 0.5; ac.flapDeg = cfg.aero.flaps[1].deg; }
const model = createAircraftModel(cfg); scene.add(model.root);
model.update(ac, 0.016, 0.05, false);
const span = cfg.geometry.span, len = cfg.geometry.length, H = cfg.layout?.cgHeight ?? 1.2;
model.root.position.y = H;
const d = Math.max(span, len) * 1.05;
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 2000);
const views = { 34: [d * 0.75, d * 0.35, -d * 0.8], side: [d * 1.25, H, 0], top: [0.01, d * 1.6, 0], rear: [-d * 0.6, d * 0.25, d * 0.9], front: [0, H + 1, -d * 1.2], under: [d * 0.6, 0.6, -d * 0.6] };
cam.position.set(...views[view]); cam.lookAt(0, H * 0.9, 0);
renderer.render(scene, cam);
window.__done = true;
