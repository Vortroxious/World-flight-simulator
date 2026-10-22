// Procedural runway surface texture with FAA/ICAO-style markings baked in (avoids z-fighting decals).
// Texture u = across runway (0 = left edge looking from end A), v = along runway from end A (0) to end B (1).
import * as THREE from 'three';

const PAVED = /ASP|CON|PEM|BIT|TAR|ASF|PAV|MAC|COP/;

export function isPaved(surf) { return !surf || PAVED.test(surf); }

function drawDesignator(ctx, text, cx, cy, w, h) {
  // Block digits via font; height h (px along runway), width w across.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(w / (text.length * 0.62 * 100), h / 100);
  ctx.font = 'bold 100px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * @param {{len:number, wid:number, le:string, he:string, surf:string, dispA:number, dispB:number, precision:boolean}} r
 */
export function runwayTexture(r) {
  const paved = isPaved(r.surf);
  const H = 4096;
  const W = 256;
  const pxM = H / r.len; // px per metre along
  const pxW = W / r.wid; // px per metre across
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // Base surface with subtle variation (rubber deposits in touchdown zones).
  ctx.fillStyle = paved ? (/CON/.test(r.surf || '') ? '#6c6c69' : '#3a3b3c') : '#5b6a3a';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    const y = Math.random() * H, x = Math.random() * W;
    ctx.fillStyle = `rgba(${paved ? '0,0,0' : '40,30,10'},${Math.random() * 0.08})`;
    ctx.fillRect(x, y, 2 + Math.random() * 6, 2 + Math.random() * 12);
  }
  if (!paved) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  const tdz = (v0, dir) => {
    const g = ctx.createLinearGradient(0, v0, 0, v0 + dir * 600 * pxM);
    g.addColorStop(0, 'rgba(10,10,10,0.55)'); g.addColorStop(1, 'rgba(10,10,10,0)');
    ctx.fillStyle = g; ctx.fillRect(W * 0.25, Math.min(v0, v0 + dir * 600 * pxM), W * 0.5, 600 * pxM);
  };
  // v pixel for metres from end A
  const V = (m) => H - m * pxM; // canvas y=0 at top -> we flip so end A at bottom (v=0 at bottom with flipY)
  tdz(V(r.dispA + 30), -1); tdz(V(r.len - r.dispB - 30), 1);
  ctx.fillStyle = '#e8e8e2';
  const big = r.wid >= 30;
  const edge = Math.max(1, 0.9 * pxW);
  if (big) { ctx.fillRect(0, 0, edge, H); ctx.fillRect(W - edge, 0, edge, H); }

  // Centreline: 36 m stripes, 24 m gaps between the designators.
  const startC = r.dispA + (big ? 120 : 60), endC = r.len - r.dispB - (big ? 120 : 60);
  for (let m = startC; m + 36 < endC; m += 60) ctx.fillRect(W / 2 - Math.max(1, 0.45 * pxW), V(m + 36), Math.max(2, 0.9 * pxW), 36 * pxM);

  const end = (atA) => {
    const disp = atA ? r.dispA : r.dispB;
    const dir = atA ? 1 : -1; // metres increase into runway from this end
    const m0 = atA ? disp : r.len - disp;
    const at = (m) => (atA ? m0 + m : m0 - m);
    // Displaced threshold: arrows down the centre of the displaced area + threshold bar.
    if (disp > 20) {
      for (let m = 15; m < disp - 15; m += 40) {
        const y = V(atA ? m : r.len - m);
        ctx.fillRect(W / 2 - 0.45 * pxW, Math.min(y, y + dir * -20 * pxM), 0.9 * pxW, 20 * pxM);
      }
      ctx.fillRect(0, V(at(0)) - 1.5 * pxM, W, 3 * pxM);
    }
    // Threshold piano keys: 8-16 stripes, 45 m long, starting 6 m in.
    const nStr = big ? Math.min(16, Math.max(8, Math.round(r.wid / 3.7))) : 4;
    const sw = (r.wid - 6) / (nStr * 2 - 1);
    for (let i = 0; i < nStr; i++) {
      const x = (3 + i * 2 * sw + (i >= nStr / 2 ? sw : 0)) * pxW;
      const y0 = V(at(6)), y1 = V(at(6 + 45));
      ctx.fillRect(x, Math.min(y0, y1), sw * pxW, Math.abs(y1 - y0));
    }
    // Designator (reads correctly from the approach end).
    const des = atA ? r.le : r.he;
    ctx.save();
    const yD = V(at(84)); // letter at ~72 m (nearer the threshold), number at ~96 m
    ctx.translate(W / 2, yD);
    if (!atA) ctx.rotate(Math.PI);
    const lines = des.match(/^(\d+)([LRC]?)$/) ? [des.replace(/[LRC]$/, ''), des.slice(-1).match(/[LRC]/)?.[0]].filter(Boolean) : [des];
    if (lines.length === 2) {
      drawDesignator(ctx, lines[1], 0, 12 * pxM, Math.min(W * 0.3, 6 * pxW), 18 * pxM);
      drawDesignator(ctx, lines[0], 0, -12 * pxM, Math.min(W * 0.6, 12 * pxW), 18 * pxM);
    } else drawDesignator(ctx, lines[0], 0, 0, Math.min(W * 0.6, 12 * pxW), 18 * pxM);
    ctx.restore();
    if (!big) return;
    // Aiming point (305 m) and touchdown-zone bars every 150 m.
    const aim = at(305);
    for (const s of [-1, 1]) ctx.fillRect(W / 2 + s * (5.5 + 4.5) * pxW - 4.5 * pxW, Math.min(V(aim), V(aim + dir * 45)), 9 * pxW, 45 * pxM);
    if (r.precision) {
      for (const [m, bars] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) {
        for (const s of [-1, 1]) for (let b = 0; b < bars; b++) {
          const x = W / 2 + s * (5.5 + 1 + b * 2.7) * pxW - (s < 0 ? 1.8 * pxW : 0);
          ctx.fillRect(x, Math.min(V(at(m)), V(at(m + dir * 22))), 1.8 * pxW, 22 * pxM);
        }
      }
    }
  };
  end(true); end(false);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
