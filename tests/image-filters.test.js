import test from 'node:test';
import assert from 'node:assert/strict';
import { cssFilter, toGray, sobelEdges, FILTERS, GRID_SIZES } from '../js/image-filters.js';
import { sanitizePrefs } from '../js/prefs.js';

test('cssFilter builds the expected filter strings', () => {
  assert.equal(cssFilter('color', false), 'none');
  assert.equal(cssFilter('gray', false), 'grayscale(1)');
  assert.match(cssFilter('contrast', false), /grayscale\(1\) contrast\(/);
  assert.equal(cssFilter('edges', true), 'invert(1)');
  assert.equal(cssFilter('color', true), 'invert(1)');
});

test('toGray treats transparent pixels as white', () => {
  const g = toGray(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]), 2, 1);
  assert.equal(g[0], 0);
  assert.equal(g[1], 255);
});

test('sobelEdges marks a vertical step edge and ignores flat areas', () => {
  const w = 8, h = 6;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = x < 4 ? 0 : 255;
  const out = sobelEdges(gray, w, h);
  const alpha = (x, y) => out[(y * w + x) * 4 + 3];
  assert.equal(alpha(3, 3), 255);
  assert.equal(alpha(4, 3), 255);
  assert.equal(alpha(1, 3), 0);
  assert.equal(alpha(6, 3), 0);
  assert.equal(out[(3 * w + 3) * 4], 0); // outline pixels are black
  assert.equal(sobelEdges(new Float32Array(9).fill(128), 3, 3).every((v) => v === 0), true);
});

test('look preferences are validated', () => {
  assert.deepEqual(FILTERS, ['color', 'gray', 'contrast', 'edges']);
  const p = sanitizePrefs({ filter: 'edges', invert: true, grid: 4 });
  assert.equal(p.filter, 'edges');
  assert.equal(p.invert, true);
  assert.equal(p.grid, 4);
  const bad = sanitizePrefs({ filter: 'sepia', invert: 'x', grid: 5 });
  assert.equal(bad.filter, 'color');
  assert.equal(bad.invert, false);
  assert.equal(bad.grid, 0);
  assert.ok(GRID_SIZES.includes(0));
});
