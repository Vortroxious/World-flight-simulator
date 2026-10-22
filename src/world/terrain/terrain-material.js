// Terrain and water materials (PBR MeshStandardMaterial extended with procedural detail in the shader).
import * as THREE from 'three';
import { valueNoise } from '../../core/math.js';

let noiseTex = null;
/** Tileable 256x256 multi-octave noise texture (generated, no external assets). */
export function noiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  const tileNoise = (x, y, period, seed) => {
    // periodic value noise via wrapped lattice
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const h = (a, b) => valueNoise(((a % period) + period) % period, ((b % period) + period) % period, seed);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return h(xi, yi) * (1 - u) * (1 - v) + h(xi + 1, yi) * u * (1 - v) + h(xi, yi + 1) * (1 - u) * v + h(xi + 1, yi + 1) * u * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let a = 0, b = 0, amp = 0.5, f = 8;
    for (let o = 0; o < 4; o++) { a += amp * tileNoise((x / N) * f, (y / N) * f, f, 1 + o); b += amp * tileNoise((x / N) * f, (y / N) * f, f, 17 + o); amp *= 0.5; f *= 2; }
    const i = (y * N + x) * 4;
    data[i] = a * 255; data[i + 1] = b * 255; data[i + 2] = tileNoise((x / N) * 32, (y / N) * 32, 32, 40) * 255; data[i + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter; noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true; noiseTex.needsUpdate = true;
  return noiseTex;
}

export function createTerrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uNoise;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dCam = length(vWPos - cameraPosition);
        float n1 = texture2D(uNoise, vWPos.xz / 61.0).r;
        float n2 = texture2D(uNoise, vWPos.xz / 487.0).g;
        float n3 = texture2D(uNoise, vWPos.xz / 9.0).b;
        float near = 1.0 - smoothstep(300.0, 3000.0, dCam);
        diffuseColor.rgb *= mix(1.0, 0.82 + 0.36 * n2, 0.8) * mix(1.0, 0.8 + 0.4 * n1, 0.5 + 0.5 * near) * mix(1.0, 0.85 + 0.3 * n3, near);`);
  };
  return m;
}

export function createWaterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x1b3a4a, roughness: 0.08, metalness: 0.15, envMapIntensity: 1.0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noiseTexture() };
    shader.uniforms.uTime = { value: 0 };
    m.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uNoise;\nuniform float uTime;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float dCam = length(vWPos - cameraPosition);
          float fade = 1.0 - smoothstep(800.0, 9000.0, dCam);
          vec2 p1 = vWPos.xz / 23.0 + vec2(uTime * 0.021, uTime * 0.013);
          vec2 p2 = vWPos.xz / 71.0 - vec2(uTime * 0.008, uTime * 0.017);
          vec2 d = (texture2D(uNoise, p1).rg - 0.5) * 0.9 + (texture2D(uNoise, p2).rg - 0.5) * 0.7;
          vec3 pert = vec3(d.x, 0.0, d.y) * 0.35 * fade;
          normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);
        }`);
  };
  return m;
}
