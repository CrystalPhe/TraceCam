// Structural checks: manifest valid, every cached/linked file exists, no external resources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('manifest has required PWA fields and existing icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'TraceCam');
  assert.equal(m.short_name, 'TraceCam');
  assert.equal(m.display, 'standalone');
  assert.ok(m.theme_color && m.background_color);
  for (const icon of m.icons) assert.ok(existsSync(join(root, icon.src)), icon.src);
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
});

test('service worker precache list only names existing files', () => {
  const src = read('service-worker.js');
  const list = src.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(files.length > 10);
  for (const f of files) assert.ok(f === './' || existsSync(join(root, f)), `missing ${f}`);
  // every JS module in js/ must be cached for offline use
  for (const js of readdirSync(join(root, 'js'))) assert.ok(files.includes(`js/${js}`), `js/${js} not precached`);
});

test('index.html links existing files, has iOS metadata, and no external resources', () => {
  const html = read('index.html');
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /accept="image\/\*"/);
  assert.doesNotMatch(html, /(src|href)="https?:\/\//);
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    assert.ok(existsSync(join(root, m[1])), `index.html references missing ${m[1]}`);
  }
});

test('every data-action in HTML has a handler in app.js', () => {
  const html = read('index.html');
  const app = read('js/app.js');
  const acts = new Set([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(acts.size >= 12);
  for (const a of acts) {
    const quoted = new RegExp(`['"]${a}['"]\\s*:|^\\s*${a}\\s*[(:]`, 'm');
    assert.match(app, quoted, `no handler for ${a}`);
  }
});

test('Apple touch icon is a 180x180 PNG', () => {
  const buf = readFileSync(join(root, 'icons/apple-touch-icon.png'));
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.equal(buf.readUInt32BE(16), 180);
  assert.equal(buf.readUInt32BE(20), 180);
});

test('source contains no analytics / third-party hosts', () => {
  for (const f of ['index.html', 'js/app.js', 'service-worker.js', 'styles.css']) {
    assert.doesNotMatch(read(f), /(googletagmanager|google-analytics|facebook|segment\.|sentry|cdn\.)/i, f);
  }
});
