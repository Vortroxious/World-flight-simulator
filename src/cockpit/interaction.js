// Mouse interaction with cockpit controls (raycast), tooltips, free look and zoom.
import * as THREE from 'three';

export class CockpitInteraction {
  constructor(canvas, camera, rig, tooltip) {
    this.canvas = canvas; this.camera = camera; this.rig = rig; this.tooltip = tooltip;
    this.ray = new THREE.Raycaster();
    this.controls = [];
    this.hover = null; this.active = null; this.button = -1; this.dragged = 0;
    this.last = { x: 0, y: 0 };
    this.highlight = new THREE.BoxHelper(undefined, 0x66ccff);
    this.highlight.visible = false;
    this.enabled = true;
    this.onLookDrag = null; this.onAction = null;
    this.h = { ctx: (e) => e.preventDefault(), down: (e) => this.down(e), up: (e) => this.up(e), move: (e) => this.move(e), wheel: (e) => this.wheel(e) };
    canvas.addEventListener('contextmenu', this.h.ctx);
    canvas.addEventListener('pointerdown', this.h.down);
    window.addEventListener('pointerup', this.h.up);
    canvas.addEventListener('pointermove', this.h.move);
    canvas.addEventListener('wheel', this.h.wheel, { passive: false });
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('contextmenu', this.h.ctx); c.removeEventListener('pointerdown', this.h.down); window.removeEventListener('pointerup', this.h.up);
    c.removeEventListener('pointermove', this.h.move); c.removeEventListener('wheel', this.h.wheel);
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  setControls(list) { this.controls = list; }

  pick(e) {
    if (!this.enabled || !this.rig.isCockpit || !this.controls.length) return null;
    const r = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(p, this.camera);
    this.ray.near = 0.02; this.ray.far = 3;
    const hit = this.ray.intersectObjects(this.controls, false)[0];
    return hit ? hit.object : null;
  }

  down(e) {
    this.button = e.button; this.dragged = 0; this.last = { x: e.clientX, y: e.clientY };
    const obj = this.pick(e);
    if (obj) {
      this.active = obj;
      obj.userData.ctl.down?.(e.button, e);
      this.canvas.setPointerCapture?.(e.pointerId);
    }
  }
  up(e) {
    if (this.active) {
      const ctl = this.active.userData.ctl;
      if (this.dragged < 4) { ctl.click?.(e.button, e); this.onAction?.(); }
      ctl.up?.(e.button, e);
    }
    this.active = null; this.button = -1;
  }
  move(e) {
    const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };
    if (this.button >= 0) this.dragged += Math.abs(dx) + Math.abs(dy);
    if (this.active && this.button === 0) { this.active.userData.ctl.drag?.(dx, dy); this.updateTooltip(e, this.active); return; }
    if (this.button === 2 || (this.button === 0 && !this.active && !this.rig.isCockpit) || (this.button === 1)) { this.rig.freeLook(dx, dy); return; }
    const obj = this.pick(e);
    this.setHover(obj);
    this.updateTooltip(e, obj);
  }
  wheel(e) {
    e.preventDefault();
    const obj = this.pick(e);
    const d = e.deltaY > 0 ? -1 : 1;
    if (obj && obj.userData.ctl.wheel) { obj.userData.ctl.wheel(d, e); this.updateTooltip(e, obj); this.onAction?.(); }
    else this.rig.zoom(-d);
  }
  setHover(obj) {
    if (obj === this.hover) return;
    this.hover = obj;
    this.canvas.style.cursor = obj ? 'pointer' : '';
    if (obj) { this.highlight.setFromObject(obj); this.highlight.visible = true; } else this.highlight.visible = false;
  }
  updateTooltip(e, obj) {
    if (!this.tooltip) return;
    if (!obj) { this.tooltip.style.display = 'none'; return; }
    const ctl = obj.userData.ctl;
    this.tooltip.textContent = `${ctl.label}${ctl.value ? ': ' + ctl.value() : ''}`;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = e.clientX + 14 + 'px'; this.tooltip.style.top = e.clientY + 12 + 'px';
  }
  refreshHighlight() { if (this.hover && this.highlight.visible) this.highlight.setFromObject(this.hover); }
}
