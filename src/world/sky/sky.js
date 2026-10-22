// Sky, sun/moon lighting, fog/visibility, stars, time of day (real solar position) and environment map.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { DEG, RAD } from '../../geo/wgs84.js';
import { clamp, smoothstep } from '../../core/math.js';

/** Solar position (NOAA approximation). Returns elevation & azimuth (deg) for a UTC Date at lat/lon. */
export function sunPosition(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * DEG;
  const ha = lst - ra;
  const la = lat * DEG;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { elevation: el * RAD, azimuth: ((az * RAD) + 360) % 360 };
}

export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.sky = new Sky();
    this.sky.scale.setScalar(4.0e5);
    this.sky.material.depthWrite = false;
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4334, 0.6);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xb8c8d8, 0.00002);
    scene.fog = this.fog;
    this.stars = this.makeStars(); scene.add(this.stars);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    this.envTarget = null; this.envTimer = 0;
    this.night = 0; this.sunDir = new THREE.Vector3(0, 1, 0);
    this.visibility = 60000;
  }

  makeStars() {
    const n = 2500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos.set([Math.cos(a) * r * 3e5, Math.abs(z) * 3e5, Math.sin(a) * r * 3e5], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -1;
    return p;
  }

  /**
   * @param {Date} date UTC time @param {{lat,lon}} pos @param {THREE.Vector3} cameraPos
   * @param {{visibilityKm:number, cloudCover:number}} weather
   */
  update(date, pos, cameraPos, focus, weather, dt) {
    const s = sunPosition(date, pos.lat, pos.lon);
    this.sunElevation = s.elevation;
    const el = s.elevation * DEG, az = s.azimuth * DEG;
    // ENU (x=E, y=U, z=-N): azimuth clockwise from north
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    const cover = weather.cloudCover || 0;
    u.turbidity.value = 3 + cover * 8; u.rayleigh.value = 1.2 + cover * 1.5;
    this.sky.position.copy(cameraPos);
    this.stars.position.copy(cameraPos);
    const day = smoothstep(-6, 8, s.elevation);
    this.night = 1 - smoothstep(-8, 2, s.elevation);
    this.stars.material.opacity = this.night * (1 - cover);
    const warm = 1 - smoothstep(2, 20, s.elevation);
    this.sun.color.setRGB(1, 1 - 0.35 * warm, 1 - 0.6 * warm);
    this.sun.intensity = 2.6 * day * (1 - 0.65 * cover);
    this.hemi.intensity = 0.15 + 0.75 * day * (1 - 0.3 * cover);
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.65 + 0.2 * day, 0.85 + 0.1 * day).multiplyScalar(0.4 + 0.6 * day);
    this.hemi.groundColor.setRGB(0.3, 0.27, 0.22).multiplyScalar(0.2 + 0.8 * day);
    // Sun shadow camera follows the focus (aircraft).
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    // Visibility: exp2 fog where 2% contrast at visibility distance.
    this.visibility = (weather.visibilityKm ?? 60) * 1000;
    this.fog.density = Math.sqrt(-Math.log(0.02)) / this.visibility;
    const fogDay = new THREE.Color().setRGB(0.68 + 0.1 * cover, 0.76 + 0.05 * cover, 0.86 - 0.05 * cover);
    const fogDusk = new THREE.Color(0.85, 0.6, 0.45);
    const fogNight = new THREE.Color(0.03, 0.04, 0.07);
    const c = fogDay.lerp(fogDusk, warm * day * 0.6).lerp(fogNight, this.night);
    this.fog.color.copy(c);
    this.renderer.toneMappingExposure = 0.32 + 0.06 * day + 0.5 * this.night;
    // Environment map refresh (reflections on water / aircraft) every few seconds.
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 4;
      this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) this.envSky.material.uniforms[k].value = u[k].value;
      const old = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = 0.15 + 0.35 * day;
      old?.dispose();
    }
  }
}

export { clamp };
