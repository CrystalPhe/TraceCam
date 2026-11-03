// Pure math for dot tracking: fitting a transform between two sets of dot
// positions, mapping between camera-frame and screen coordinates, and turning
// the result into CSS. No DOM access, so it is unit-tested in Node.
//
// Matrices are 3x3, row-major, as flat arrays of 9 numbers:
//   [a, b, c,
//    d, e, f,
//    g, h, i]   maps (x, y) -> ((a x + b y + c) / w, (d x + e y + f) / w), w = g x + h y + i

import { normalizeDegrees } from './transform.js';

export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const MIN_AREA_RATIO = 0.3; // reject fits that shrink/grow the dot shape too much
const MAX_AREA_RATIO = 3;

export function applyH(H, p) {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

export function mul3(A, B) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return out;
}

/** Solve A x = b (A n x n, row arrays) by Gaussian elimination. Null if singular. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Exact perspective transform from 4 point pairs. */
export function solveHomography(src, dst) {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

/** Exact affine transform (move, rotate, scale, shear) from 3 point pairs. */
export function solveAffine(src, dst) {
  if (src.length !== 3 || dst.length !== 3) return null;
  const A = src.map((p) => [p.x, p.y, 1]);
  const r1 = solveLinear(A, dst.map((p) => p.x));
  const r2 = solveLinear(A, dst.map((p) => p.y));
  return r1 && r2 ? [...r1, ...r2, 0, 0, 1] : null;
}

/** Least-squares move + rotate + uniform scale from 2 or more point pairs. */
export function fitSimilarity(src, dst) {
  const n = src.length;
  if (n < 2 || dst.length !== n) return null;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i].x; sy += src[i].y; dx += dst[i].x; dy += dst[i].y;
  }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i].x - sx, y = src[i].y - sy;
    const X = dst[i].x - dx, Y = dst[i].y - dy;
    num1 += x * X + y * Y;
    num2 += x * Y - y * X;
    den += x * x + y * y;
  }
  if (den < 1e-9) return null;
  const a = num1 / den;
  const b = num2 / den;
  return [a, -b, dx - (a * sx - b * sy), b, a, dy - (b * sx + a * sy), 0, 0, 1];
}

/** Signed area of a polygon (shoelace). */
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function isConvex(pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * Reject fits that would wildly distort the image: flipped, collapsed,
 * hugely scaled, or (for 4 points) a non-convex quadrilateral.
 */
export function isPlausible(H, src) {
  if (!H || H.some((v) => !Number.isFinite(v))) return false;
  const mapped = src.map((p) => applyH(H, p));
  if (mapped.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  for (const p of src) if (H[6] * p.x + H[7] * p.y + H[8] <= 0) return false; // behind the camera
  if (src.length >= 3) {
    const a0 = polygonArea(src);
    const a1 = polygonArea(mapped);
    if (Math.abs(a0) < 1e-6) return false;
    const ratio = a1 / a0; // negative = mirrored
    if (!(ratio >= MIN_AREA_RATIO && ratio <= MAX_AREA_RATIO)) return false;
    if (src.length >= 4 && !isConvex(mapped)) return false;
  } else {
    const s = Math.hypot(H[0], H[3]);
    if (!(s * s >= MIN_AREA_RATIO && s * s <= MAX_AREA_RATIO)) return false;
  }
  return true;
}

/**
 * Best transform for however many dots are visible:
 * 4 -> perspective, 3 -> affine, 2 -> similarity, fewer -> null (hold still).
 * Falls back to a similarity fit if the richer model looks implausible.
 */
export function estimateTransform(src, dst) {
  const n = Math.min(src.length, dst.length);
  if (n < 2) return null;
  let H = null;
  if (n === 4) H = solveHomography(src, dst);
  else if (n === 3) H = solveAffine(src, dst);
  if (H && isPlausible(H, src)) return H;
  const S = fitSimilarity(src, dst);
  return S && isPlausible(S, src) ? S : null;
}

/**
 * Which part of the camera frame is visible when a vw x vh video is shown
 * with `object-fit: cover` in a W x H box. Returns the crop in video pixels.
 */
export function coverCrop(vw, vh, W, H) {
  const k = Math.max(W / vw, H / vh);
  const sw = W / k;
  const sh = H / k;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh, k };
}

/** Matrix taking video-pixel coordinates to screen (stage) coordinates. */
export function videoToStage(crop) {
  return [crop.k, 0, -crop.sx * crop.k, 0, crop.k, -crop.sy * crop.k, 0, 0, 1];
}

/** Inverse of videoToStage. */
export function stageToVideo(crop) {
  return [1 / crop.k, 0, crop.sx, 0, 1 / crop.k, crop.sy, 0, 0, 1];
}

/** CSS matrix3d() for a 3x3 homography (use with transform-origin: 0 0). */
export function cssMatrix3d(H) {
  const n = H[8];
  const [a, b, c, d, e, f, g, h, i] = H.map((v) => v / n);
  const m = [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i];
  return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(10)))).join(', ')})`;
}

/**
 * Fold a similarity S (in the lock-time stage coordinates, top-left origin)
 * into the overlay transform t, so the image stays put when tracking ends.
 * `from` is the stage size at lock time, `to` the stage size now.
 */
export function bakeSimilarity(t, S, from, to = from) {
  const cx = from.w / 2 + t.x;
  const cy = from.h / 2 + t.y;
  const p = applyH(S, { x: cx, y: cy });
  return {
    ...t,
    x: p.x - to.w / 2,
    y: p.y - to.h / 2,
    scale: t.scale * Math.hypot(S[0], S[3]),
    rotation: normalizeDegrees(t.rotation + (Math.atan2(S[3], S[0]) * 180) / Math.PI),
  };
}
