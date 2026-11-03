// Image "look" helpers: the edge-outline filter plus the list of modes.
// The pure functions work on plain arrays so they can be unit-tested in Node.

export const FILTERS = ['color', 'gray', 'contrast', 'edges'];
export const GRID_SIZES = [0, 3, 4, 6]; // 0 = off
export const EDGE_MAX_DIMENSION = 1280; // outline is computed at this size

/** CSS filter string for the non-edge modes (edges are baked into the image). */
export function cssFilter(mode, invert) {
  const parts = [];
  if (mode === 'gray') parts.push('grayscale(1)');
  if (mode === 'contrast') parts.push('grayscale(1)', 'contrast(2.2)');
  if (invert) parts.push('invert(1)');
  return parts.length ? parts.join(' ') : 'none';
}

/** RGBA pixels -> luminance (0-255). Transparent pixels count as white paper. */
export function toGray(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    const lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    out[i] = lum * a + 255 * (1 - a);
  }
  return out;
}

/**
 * Sobel edge detector. Returns RGBA bytes: black pixels whose alpha is the
 * edge strength, so the result is a transparent image holding only outlines.
 */
export function sobelEdges(gray, width, height, { low = 12, high = 90, thicken = 1 } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  const at = (x, y) => gray[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) -
        2 * at(x - 1, y) + 2 * at(x + 1, y) -
        at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const m = Math.hypot(gx, gy) / 4; // a 0->255 step edge scores ~255
      const strength = Math.min(1, Math.max(0, (m - low) / (high - low)));
      out[(y * width + x) * 4 + 3] = Math.round(strength * 255);
    }
  }
  return thicken ? dilateAlpha(out, width, height, thicken) : out;
}

/** Grow every line by `radius` pixels (max filter on the alpha channel). */
export function dilateAlpha(rgba, width, height, radius = 1) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const a = rgba[(yy * width + xx) * 4 + 3];
          if (a > m) m = a;
        }
      }
      out[(y * width + x) * 4 + 3] = m;
    }
  }
  return out;
}

/** Build an outline image from an image URL. Returns a blob: URL the caller must revoke. */
export async function makeEdgeUrl(sourceUrl) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('edge source failed to load'));
    i.src = sourceUrl;
  });
  const k = Math.min(1, EDGE_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h);
  const edges = sobelEdges(toGray(src.data, w, h), w, h);
  ctx.putImageData(new ImageData(edges, w, h), 0, 0);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png'));
  canvas.width = canvas.height = 0;
  return URL.createObjectURL(blob);
}
