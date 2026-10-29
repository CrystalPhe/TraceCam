// Pointer-event gestures for the overlay: one finger drags, two fingers
// pinch + twist. Works with mouse/trackpad too so it can be tried on a PC.

import { applyGesture, zoomAbout } from './transform.js';

/**
 * @param {HTMLElement} surface  element that receives the touches (above the camera, below the controls)
 * @param {object} api
 * @param {() => object} api.getTransform
 * @param {(t: object) => void} api.setTransform
 * @param {() => boolean} api.isEnabled  false while locked or when there is no image
 * @param {(active: boolean) => void} [api.onActive]
 */
export function attachGestures(surface, api) {
  const pointers = new Map(); // pointerId -> {x, y} in client px, insertion-ordered
  const ac = new AbortController();
  const { signal } = ac;
  let base = null; // { transform, pts } captured whenever the finger count changes

  const centre = () => {
    const r = surface.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  // The first two fingers drive the gesture; extras are ignored.
  const activePoints = () => {
    const c = centre();
    return [...pointers.values()].slice(0, 2).map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  };

  // Re-baseline whenever fingers are added or removed. This is what prevents
  // the image from jumping when going from one finger to two (or back).
  const rebase = () => {
    base = pointers.size ? { transform: { ...api.getTransform() }, pts: activePoints() } : null;
    api.onActive?.(pointers.size > 0);
  };

  const onDown = (e) => {
    if (!api.isEnabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      /* pointer may already be gone */
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    rebase();
  };

  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    if (!api.isEnabled()) {
      cancel();
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!base) return;
    const cur = activePoints();
    if (cur.length !== base.pts.length) {
      rebase();
      return;
    }
    api.setTransform(applyGesture(base.transform, base.pts, cur));
  };

  const onUp = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try {
      surface.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    rebase();
  };

  const onWheel = (e) => {
    if (!api.isEnabled()) return;
    e.preventDefault();
    const c = centre();
    // ctrlKey = trackpad pinch; plain wheel zooms too.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    api.setTransform(zoomAbout(api.getTransform(), factor, e.clientX - c.x, e.clientY - c.y));
  };

  function cancel() {
    pointers.clear();
    rebase();
  }

  surface.addEventListener('pointerdown', onDown, { signal });
  surface.addEventListener('pointermove', onMove, { signal });
  surface.addEventListener('pointerup', onUp, { signal });
  surface.addEventListener('pointercancel', onUp, { signal });
  surface.addEventListener('lostpointercapture', onUp, { signal });
  surface.addEventListener('wheel', onWheel, { signal, passive: false });
  // Stop Safari's own pinch-zoom / page gestures from fighting ours.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    surface.addEventListener(type, (e) => e.preventDefault(), { signal });
  }
  surface.addEventListener('touchmove', (e) => e.preventDefault(), { signal, passive: false });
  surface.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

  return {
    /** Abort any gesture in progress (used when the overlay gets locked). */
    cancel,
    destroy() {
      ac.abort();
      pointers.clear();
      base = null;
    },
  };
}
