// Finds coloured sticker dots in a small RGBA frame. Pure functions on
// {data, width, height} so they can be unit-tested without a browser.
//
// A dot is a patch of strongly coloured pixels (high chroma). White paper,
// pencil graphite and shadows are grey (low chroma), so they are ignored.

export const MIN_CHROMA = 50; // 0-255; below this a pixel counts as grey
export const MIN_DOT_PIXELS = 4;
const HUE_TOLERANCE = 30; // degrees

/** Chroma (colourfulness, 0-255) and hue (degrees) of an RGB pixel. */
export function chromaHue(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const c = max - min;
  if (c === 0) return { c: 0, h: 0 };
  let h;
  if (max === r) h = ((g - b) / c) % 6;
  else if (max === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { c, h };
}

export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Weighted centre of the pixels within radius r of (cx, cy) that pass `match`. */
function centroid(img, cx, cy, r, match) {
  const { data, width, height } = img;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  const r2 = r * r;
  let sx = 0, sy = 0, sw = 0, count = 0, sumC = 0, hx = 0, hy = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ddx = x + 0.5 - cx, ddy = y + 0.5 - cy;
      if (ddx * ddx + ddy * ddy > r2) continue;
      const o = (y * width + x) * 4;
      const { c, h } = chromaHue(data[o], data[o + 1], data[o + 2]);
      if (!match(c, h)) continue;
      sx += (x + 0.5) * c;
      sy += (y + 0.5) * c;
      sw += c;
      sumC += c;
      count++;
      const rad = (h * Math.PI) / 180;
      hx += Math.cos(rad);
      hy += Math.sin(rad);
    }
  }
  if (!count) return null;
  let hue = (Math.atan2(hy, hx) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { x: sx / sw, y: sy / sw, count, chroma: sumC / count, hue };
}

/** Radius that comfortably contains a dot of `count` pixels. */
function dotRadius(count) {
  return Math.max(3, 2 * Math.sqrt(count / Math.PI) + 2);
}

/**
 * Look for the most colourful blob near (cx, cy). Used while setting up, to
 * learn each sticker's colour and size. Returns null when nothing colourful
 * is there.
 */
export function calibrateDot(img, cx, cy, radius) {
  const { data, width, height } = img;
  let best = 0, bestHue = 0;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ddx = x + 0.5 - cx, ddy = y + 0.5 - cy;
      if (ddx * ddx + ddy * ddy > radius * radius) continue;
      const o = (y * width + x) * 4;
      const { c, h } = chromaHue(data[o], data[o + 1], data[o + 2]);
      if (c > best) { best = c; bestHue = h; }
    }
  }
  if (best < MIN_CHROMA) return null;
  const threshold = Math.max(MIN_CHROMA, best * 0.5);
  const match = (c, h) => c >= threshold && hueDistance(h, bestHue) <= HUE_TOLERANCE;
  const first = centroid(img, cx, cy, radius, match);
  if (!first || first.count < MIN_DOT_PIXELS) return null;
  // Second pass around the blob itself, so stray coloured pixels elsewhere
  // in the search window don't pull the centre off.
  const refined = centroid(img, first.x, first.y, dotRadius(first.count), match) || first;
  if (refined.count < MIN_DOT_PIXELS) return null;
  return refined;
}

/**
 * Find a known dot (colour/size from calibrateDot) near its predicted
 * position. Rejects blobs that are the wrong colour or far too big or small
 * (e.g. a hand passing over).
 */
export function findDot(img, cx, cy, radius, ref) {
  const threshold = Math.max(MIN_CHROMA * 0.8, ref.chroma * 0.5);
  const match = (c, h) => c >= threshold && hueDistance(h, ref.hue) <= HUE_TOLERANCE;
  const first = centroid(img, cx, cy, radius, match);
  if (!first) return null;
  const refined = centroid(img, first.x, first.y, dotRadius(ref.count), match) || first;
  if (refined.count < Math.max(MIN_DOT_PIXELS, ref.count * 0.25)) return null;
  if (refined.count > ref.count * 4) return null;
  return refined;
}

/** Search radius while tracking, in frame pixels. */
export function trackRadius(count) {
  return Math.min(40, Math.max(14, 4 * Math.sqrt(count / Math.PI)));
}
