import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRANSFORM, MIN_SCALE, MAX_SCALE,
  applyGesture, clamp, clampCenter, cssTransform, fitScale, fitSize,
  limitedSize, normalizeDegrees, rotatedBounds, sanitizeTransform, zoomAbout,
} from '../js/transform.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const T = (o = {}) => ({ ...DEFAULT_TRANSFORM, ...o });

test('clamp and normalizeDegrees', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(normalizeDegrees(270), -90);
  assert.equal(normalizeDegrees(-270), 90);
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(180), 180);
});

test('fitSize preserves aspect ratio and fits inside the stage', () => {
  const s = fitSize(4000, 2000, 400, 800, 0.9);
  near(s.w / s.h, 2);
  near(s.w, 360);
  const tall = fitSize(1000, 4000, 400, 800, 0.9);
  near(tall.h, 720);
  near(tall.w / tall.h, 0.25);
  assert.deepEqual(fitSize(0, 10, 100, 100), { w: 0, h: 0 });
});

test('rotatedBounds swaps width and height at 90 degrees', () => {
  const b = rotatedBounds(200, 100, 90);
  near(b.w, 100); near(b.h, 200);
  const c = rotatedBounds(200, 100, 0);
  near(c.w, 200); near(c.h, 100);
});

test('fitScale accounts for rotation', () => {
  near(fitScale(360, 180, 0, 400, 800, 0.9), 1);
  // rotated 90deg the 360-wide image becomes 360 tall, so it can grow to 720/360
  near(fitScale(360, 180, 90, 400, 800, 0.9), 2);
  assert.equal(fitScale(0, 0, 0, 400, 800), 1);
});

test('limitedSize downsizes only when too large', () => {
  assert.deepEqual(limitedSize(1000, 800, 2560), { w: 1000, h: 800, scaled: false });
  const r = limitedSize(5120, 2560, 2560);
  assert.deepEqual(r, { w: 2560, h: 1280, scaled: true });
});

test('one-finger drag moves the image by the finger delta', () => {
  const out = applyGesture(T({ x: 10, y: 20 }), [{ x: 0, y: 0 }], [{ x: 30, y: -5 }]);
  assert.equal(out.x, 40);
  assert.equal(out.y, 15);
  assert.equal(out.scale, 1);
});

test('two-finger pinch scales around the midpoint', () => {
  const start = T({ x: 100, y: 0 });
  const a = [{ x: -50, y: 0 }, { x: 50, y: 0 }]; // midpoint at origin
  const b = [{ x: -100, y: 0 }, { x: 100, y: 0 }]; // spread 2x
  const out = applyGesture(start, a, b);
  near(out.scale, 2);
  near(out.x, 200); // offset from midpoint doubles
  near(out.y, 0);
  near(out.rotation, 0);
});

test('pinch respects min / max scale', () => {
  const a = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  const huge = applyGesture(T(), a, [{ x: -1e6, y: 0 }, { x: 1e6, y: 0 }]);
  assert.equal(huge.scale, MAX_SCALE);
  const tiny = applyGesture(T(), [{ x: -100, y: 0 }, { x: 100, y: 0 }], [{ x: -0.01, y: 0 }, { x: 0.01, y: 0 }]);
  assert.equal(tiny.scale, MIN_SCALE);
});

test('twist rotates (after the dead zone) and image point under fingers stays put', () => {
  const start = T({ x: 0, y: 0 });
  const a = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
  const angle = (45 * Math.PI) / 180;
  const b = [
    { x: -100 * Math.cos(angle), y: -100 * Math.sin(angle) },
    { x: 100 * Math.cos(angle), y: 100 * Math.sin(angle) },
  ];
  const out = applyGesture(start, a, b, { rotationDeadzoneDeg: 0 });
  near(out.rotation, 45, 1e-6);
  // centre coincided with midpoint, so it stays put
  near(out.x, 0); near(out.y, 0);

  // with a dead zone, a 45deg twist yields 45 - dz
  const dz = applyGesture(start, a, b, { rotationDeadzoneDeg: 4 });
  near(dz.rotation, 41, 1e-6);
});

test('small twist inside the dead zone does not rotate', () => {
  const a = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
  const ang = (2 * Math.PI) / 180;
  const b = [{ x: -100 * Math.cos(ang), y: -100 * Math.sin(ang) }, { x: 100 * Math.cos(ang), y: 100 * Math.sin(ang) }];
  assert.equal(applyGesture(T(), a, b).rotation, 0);
});

test('re-baselining (1 finger -> 2 fingers) produces no jump', () => {
  // Drag first, then add a second finger without moving: transform must not change.
  const afterDrag = applyGesture(T(), [{ x: 0, y: 0 }], [{ x: 40, y: 10 }]);
  const pts = [{ x: 40, y: 10 }, { x: 140, y: 10 }];
  const same = applyGesture(afterDrag, pts, pts);
  near(same.x, afterDrag.x); near(same.y, afterDrag.y);
  near(same.scale, afterDrag.scale); near(same.rotation, afterDrag.rotation);
});

test('zoomAbout keeps the anchor point fixed', () => {
  const t = T({ x: 50, y: 50 });
  const out = zoomAbout(t, 2, 10, 10);
  near(out.scale, 2);
  near(out.x, 10 + (50 - 10) * 2);
});

test('clampCenter and sanitizeTransform keep image reachable and values finite', () => {
  assert.deepEqual(clampCenter(1000, -1000, 400, 800), { x: 200, y: -400 });
  const t = sanitizeTransform({ x: NaN, y: Infinity, scale: 999, rotation: 540, flip: 1 }, 400, 800);
  assert.equal(t.x, 0);
  assert.equal(t.y, 0); // non-finite values fall back to 0
  assert.equal(t.scale, MAX_SCALE);
  assert.equal(t.rotation, 180);
  assert.equal(t.flip, true);
});

test('cssTransform formats rotation, scale and flip', () => {
  const s = cssTransform(T({ x: 5, y: -3, scale: 2, rotation: 90, flip: true }));
  assert.match(s, /translate\(calc\(-50% \+ 5\.00px\), calc\(-50% \+ -3\.00px\)\)/);
  assert.match(s, /rotate\(90deg\)/);
  assert.match(s, /scale\(2\.00000\)/);
  assert.match(s, /scaleX\(-1\)/);
  assert.match(cssTransform(T()), /scaleX\(1\)/);
});

test('rotate 90 left/right and flip round-trip', () => {
  let t = T();
  t = { ...t, rotation: normalizeDegrees(t.rotation + 90) };
  t = { ...t, rotation: normalizeDegrees(t.rotation - 90) };
  assert.equal(t.rotation, 0);
  const flipped = { ...t, flip: !t.flip };
  assert.equal(!flipped.flip, t.flip);
});
