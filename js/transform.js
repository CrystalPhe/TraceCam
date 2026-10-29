// Pure geometry helpers for the reference-image overlay. No DOM access here,
// so everything in this file can be unit-tested with plain Node.
//
// COORDINATE SYSTEM
// -----------------
// The overlay lives in the same box as the camera preview (the "stage", which
// is the full visible viewport). Positions are stored as a pixel offset of the
// image CENTRE from the CENTRE of the stage (x right, y down).
//   scale    1 = the "fit" size chosen when the image was loaded
//   rotation degrees, clockwise positive (same as CSS rotate())
//   flip     true = mirrored horizontally (applied before rotation, so the
//            rotation angle always means what you see on screen)

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 20;
export const FIT_MARGIN = 0.9; // fitted image fills 90% of the stage
export const MAX_IMAGE_DIMENSION = 2560; // longest side kept in memory
export const ROTATION_DEADZONE_DEG = 4; // ignore tiny twists while pinching

export const DEFAULT_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flip: false,
});

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Wrap an angle in degrees into the range (-180, 180]. */
export function normalizeDegrees(deg) {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/** Size an image so it fits inside the stage, preserving aspect ratio. */
export function fitSize(natW, natH, stageW, stageH, margin = FIT_MARGIN) {
  if (!(natW > 0 && natH > 0 && stageW > 0 && stageH > 0)) {
    return { w: 0, h: 0 };
  }
  const k = Math.min((stageW * margin) / natW, (stageH * margin) / natH);
  return { w: natW * k, h: natH * k };
}

/** Axis-aligned bounding box of a w x h rectangle rotated by rotationDeg. */
export function rotatedBounds(w, h, rotationDeg) {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
}

/** The scale at which the (possibly rotated) overlay just fits the stage. */
export function fitScale(baseW, baseH, rotationDeg, stageW, stageH, margin = FIT_MARGIN) {
  const b = rotatedBounds(baseW, baseH, rotationDeg);
  if (!(b.w > 0 && b.h > 0)) return 1;
  return clamp(
    Math.min((stageW * margin) / b.w, (stageH * margin) / b.h),
    MIN_SCALE,
    MAX_SCALE,
  );
}

/** Keep the image centre inside the stage so the image can't be lost off-screen. */
export function clampCenter(x, y, stageW, stageH) {
  return {
    x: clamp(x, -stageW / 2, stageW / 2),
    y: clamp(y, -stageH / 2, stageH / 2),
  };
}

/** Return a sanitised copy of a transform (finite numbers, limits applied). */
export function sanitizeTransform(t, stageW = Infinity, stageH = Infinity) {
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const c = clampCenter(num(t.x, 0), num(t.y, 0), stageW, stageH);
  return {
    x: c.x,
    y: c.y,
    scale: clamp(num(t.scale, 1), MIN_SCALE, MAX_SCALE),
    rotation: normalizeDegrees(num(t.rotation, 0)),
    flip: Boolean(t.flip),
  };
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function angle(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}
/** Shortest signed difference between two angles in radians. */
function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Compute the transform for an in-progress gesture.
 *
 * `start` is the transform captured when the gesture (re)started, `startPts`
 * are the finger positions at that moment, `curPts` the finger positions now.
 * Points are relative to the stage centre. One finger = drag. Two fingers =
 * drag + pinch scale + twist rotation around the point between the fingers,
 * so the part of the image under your fingers stays under your fingers.
 */
export function applyGesture(start, startPts, curPts, opts = {}) {
  const deadzone = opts.rotationDeadzoneDeg ?? ROTATION_DEADZONE_DEG;
  const out = { ...start };

  if (startPts.length === 1 && curPts.length >= 1) {
    out.x = start.x + (curPts[0].x - startPts[0].x);
    out.y = start.y + (curPts[0].y - startPts[0].y);
    return out;
  }
  if (startPts.length < 2 || curPts.length < 2) return out;

  const d0 = dist(startPts[0], startPts[1]);
  const d1 = dist(curPts[0], curPts[1]);
  const rawRatio = d0 > 0 ? d1 / d0 : 1;
  const newScale = clamp(start.scale * rawRatio, MIN_SCALE, MAX_SCALE);
  const ratio = newScale / start.scale;

  let dTheta = angleDelta(
    angle(startPts[0], startPts[1]),
    angle(curPts[0], curPts[1]),
  );
  const dz = (deadzone * Math.PI) / 180;
  dTheta = Math.abs(dTheta) <= dz ? 0 : dTheta - Math.sign(dTheta) * dz;

  const m0 = mid(startPts[0], startPts[1]);
  const m1 = mid(curPts[0], curPts[1]);
  const vx = start.x - m0.x;
  const vy = start.y - m0.y;
  const cos = Math.cos(dTheta);
  const sin = Math.sin(dTheta);
  out.x = m1.x + (vx * cos - vy * sin) * ratio;
  out.y = m1.y + (vx * sin + vy * cos) * ratio;
  out.scale = newScale;
  out.rotation = normalizeDegrees(start.rotation + (dTheta * 180) / Math.PI);
  return out;
}

/** Zoom by `factor` keeping the stage point (px, py) fixed (wheel / trackpad). */
export function zoomAbout(t, factor, px, py) {
  const scale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / t.scale;
  return {
    ...t,
    scale,
    x: px + (t.x - px) * ratio,
    y: py + (t.y - py) * ratio,
  };
}

/** The CSS transform string for the overlay element. See styles.css. */
export function cssTransform(t) {
  const r = Number(t.rotation.toFixed(3));
  return (
    `translate(calc(-50% + ${t.x.toFixed(2)}px), calc(-50% + ${t.y.toFixed(2)}px)) ` +
    `rotate(${r}deg) scale(${t.scale.toFixed(5)}) scaleX(${t.flip ? -1 : 1})`
  );
}

/** Scale (w,h) down so the longest side is at most `max`. Never upscales. */
export function limitedSize(w, h, max = MAX_IMAGE_DIMENSION) {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h, scaled: false };
  const k = max / longest;
  return { w: Math.round(w * k), h: Math.round(h * k), scaled: true };
}
