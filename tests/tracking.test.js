import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY, applyH, mul3, solveHomography, solveAffine, fitSimilarity, estimateTransform,
  isPlausible, coverCrop, videoToStage, stageToVideo, cssMatrix3d, bakeSimilarity,
} from '../js/tracking-math.js';
import { chromaHue, hueDistance, calibrateDot, findDot, trackRadius } from '../js/dot-detect.js';
import { DEFAULT_TRANSFORM } from '../js/transform.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const nearPt = (p, q, eps = 1e-6) => { near(p.x, q.x, eps); near(p.y, q.y, eps); };
const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

/* ---------------- tracking math ---------------- */

test('homography maps all 4 points exactly, including perspective', () => {
  const dst = [{ x: 10, y: 5 }, { x: 120, y: 0 }, { x: 115, y: 110 }, { x: 0, y: 100 }];
  const H = solveHomography(SQUARE, dst);
  SQUARE.forEach((p, i) => nearPt(applyH(H, p), dst[i], 1e-6));
  assert.ok(isPlausible(H, SQUARE));
});

test('affine from 3 points and similarity from 2 points', () => {
  const src = SQUARE.slice(0, 3);
  const dst = src.map((p) => ({ x: 2 * p.x + 5, y: p.y - 3 + 0.5 * p.x }));
  const A = solveAffine(src, dst);
  src.forEach((p, i) => nearPt(applyH(A, p), dst[i]));

  // 90 degrees rotation, scale 2, shift (7, 9)
  const rot = (p) => ({ x: -2 * p.y + 7, y: 2 * p.x + 9 });
  const S = fitSimilarity(SQUARE.slice(0, 2), SQUARE.slice(0, 2).map(rot));
  nearPt(applyH(S, { x: 30, y: 40 }), rot({ x: 30, y: 40 }));
});

test('estimateTransform picks the model from the number of visible dots', () => {
  const shift = (p) => ({ x: p.x + 12, y: p.y - 7 });
  for (const n of [4, 3, 2]) {
    const src = SQUARE.slice(0, n);
    const H = estimateTransform(src, src.map(shift));
    nearPt(applyH(H, { x: 50, y: 50 }), { x: 62, y: 43 }, 1e-6);
  }
  assert.equal(estimateTransform(SQUARE.slice(0, 1), SQUARE.slice(0, 1)), null);
});

test('estimateTransform rejects swapped / collapsed dots', () => {
  // Two dots swapped -> twisted quadrilateral; mirrored similarity fit is rejected too.
  const swapped = [SQUARE[1], SQUARE[0], SQUARE[2], SQUARE[3]];
  const H = estimateTransform(SQUARE, swapped);
  if (H) assert.ok(isPlausible(H, SQUARE));
  const collapsed = SQUARE.map(() => ({ x: 50, y: 50 }));
  assert.equal(estimateTransform(SQUARE, collapsed), null);
  // Scale 10x is implausible for a phone on a stand
  assert.equal(estimateTransform(SQUARE, SQUARE.map((p) => ({ x: p.x * 10, y: p.y * 10 }))), null);
});

test('coverCrop matches object-fit: cover', () => {
  // 1920x1080 landscape video in a 375x812 portrait box: height-limited
  const c = coverCrop(1920, 1080, 375, 812);
  near(c.k, 812 / 1080);
  near(c.sh, 1080);
  near(c.sw, 375 / c.k);
  near(c.sx, (1920 - c.sw) / 2);
  near(c.sy, 0);
  const V2S = videoToStage(c);
  nearPt(applyH(V2S, { x: c.sx, y: c.sy }), { x: 0, y: 0 });
  nearPt(applyH(V2S, { x: c.sx + c.sw, y: c.sy + c.sh }), { x: 375, y: 812 });
  const round = mul3(V2S, stageToVideo(c));
  round.forEach((v, i) => near(v, IDENTITY[i], 1e-9));
});

test('cssMatrix3d is column-major and identity-safe', () => {
  assert.equal(cssMatrix3d(IDENTITY), 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)');
  assert.equal(cssMatrix3d([1, 0, 5, 0, 1, 7, 0, 0, 1]), 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 7, 0, 1)');
});

test('bakeSimilarity keeps the image where tracking put it', () => {
  const t = { ...DEFAULT_TRANSFORM, x: 10, y: -20, scale: 1, rotation: 0 };
  const stage = { w: 400, h: 800 };
  // shift by (30, 40), rotate 90 about the origin, scale 1
  const S = [0, -1, 30, 1, 0, 40, 0, 0, 1];
  const out = bakeSimilarity(t, S, stage);
  const c = applyH(S, { x: 210, y: 380 });
  near(out.x, c.x - 200);
  near(out.y, c.y - 400);
  near(out.rotation, 90);
  near(out.scale, 1);
  // a different stage size afterwards keeps the same screen position
  const moved = bakeSimilarity(t, IDENTITY, stage, { w: 400, h: 700 });
  near(moved.y + 350, -20 + 400);
});

/* ---------------- dot detection ---------------- */

function makeFrame(w, h, dots = [], extra) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data.set([235, 232, 225, 255], i * 4); // off-white paper
  }
  // grey pencil scribble across the page
  for (let x = 0; x < w; x++) data.set([90, 90, 92, 255], ((h >> 1) * w + x) * 4);
  for (const d of dots) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((x + 0.5 - d.x) ** 2 + (y + 0.5 - d.y) ** 2 <= d.r * d.r) data.set([...d.rgb, 255], (y * w + x) * 4);
      }
    }
  }
  if (extra) extra(data, w, h);
  return { data, width: w, height: h };
}
const BLUE = [40, 90, 220];
const GREEN = [40, 190, 80];

test('chromaHue and hueDistance', () => {
  assert.equal(chromaHue(128, 128, 128).c, 0);
  near(chromaHue(255, 0, 0).h, 0);
  near(chromaHue(0, 255, 0).h, 120);
  near(chromaHue(0, 0, 255).h, 240);
  assert.equal(hueDistance(350, 10), 20);
});

test('calibrateDot finds a sticker and ignores paper and pencil', () => {
  const img = makeFrame(120, 120, [{ x: 40.5, y: 30.5, r: 4, rgb: BLUE }]);
  const d = calibrateDot(img, 45, 35, 20);
  assert.ok(d);
  near(d.x, 40.5, 0.3);
  near(d.y, 30.5, 0.3);
  assert.ok(d.count >= 40 && d.count <= 60);
  assert.ok(hueDistance(d.hue, 224) < 10);
  assert.equal(calibrateDot(img, 90, 60, 20), null); // only pencil there
});

test('findDot follows a moved sticker and rejects wrong colour or a big blob', () => {
  const ref = calibrateDot(makeFrame(120, 120, [{ x: 40, y: 30, r: 4, rgb: BLUE }]), 40, 30, 20);
  const moved = makeFrame(120, 120, [{ x: 46, y: 33, r: 4, rgb: BLUE }]);
  const d = findDot(moved, 40, 30, trackRadius(ref.count), ref);
  near(d.x, 46, 0.3);
  near(d.y, 33, 0.3);

  const green = makeFrame(120, 120, [{ x: 40, y: 30, r: 4, rgb: GREEN }]);
  assert.equal(findDot(green, 40, 30, 16, ref), null);

  const hand = makeFrame(120, 120, [{ x: 40, y: 30, r: 30, rgb: BLUE }]);
  assert.equal(findDot(hand, 40, 30, 16, ref), null);
});
