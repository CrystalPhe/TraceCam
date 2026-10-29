import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCameraError, checkCameraSupport } from '../js/camera.js';
import { sanitizePrefs, loadPrefs, savePrefs, DEFAULT_PREFS } from '../js/prefs.js';

test('mapCameraError maps standard DOMException names', () => {
  assert.equal(mapCameraError({ name: 'NotAllowedError' }).code, 'denied');
  assert.equal(mapCameraError({ name: 'NotFoundError' }).code, 'notfound');
  assert.equal(mapCameraError({ name: 'NotReadableError' }).code, 'inuse');
  assert.equal(mapCameraError({ name: 'OverconstrainedError' }).code, 'overconstrained');
  assert.equal(mapCameraError({ name: 'SecurityError' }).code, 'insecure');
  assert.equal(mapCameraError({ name: 'TrackEnded' }).code, 'ended');
  assert.equal(mapCameraError(null).code, 'unknown');
  for (const n of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'Weird']) {
    const e = mapCameraError({ name: n });
    assert.ok(e.title && e.message);
  }
});

test('checkCameraSupport detects insecure contexts and missing API', () => {
  assert.equal(checkCameraSupport({ isSecureContext: false, navigator: {} }).error.code, 'insecure');
  assert.equal(checkCameraSupport({ isSecureContext: true, navigator: {} }).error.code, 'unsupported');
  assert.equal(
    checkCameraSupport({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } } }).ok,
    true,
  );
});

test('sanitizePrefs applies defaults and rejects bad values', () => {
  assert.deepEqual(sanitizePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(sanitizePrefs('x'), DEFAULT_PREFS);
  const p = sanitizePrefs({ opacity: 250, keepAwake: 'yes', nudgeStep: 7, ui: 'weird' });
  assert.equal(p.opacity, 100);
  assert.equal(p.keepAwake, DEFAULT_PREFS.keepAwake);
  assert.equal(p.nudgeStep, DEFAULT_PREFS.nudgeStep);
  assert.equal(p.ui, 'full');
  assert.equal(sanitizePrefs({ opacity: -5 }).opacity, 0);
  assert.equal(sanitizePrefs({ opacity: 33.6 }).opacity, 34);
  assert.equal(sanitizePrefs({ nudgeStep: 20, ui: 'focus', keepAwake: false }).ui, 'focus');
});

test('loadPrefs / savePrefs round-trip and survive broken storage', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(savePrefs({ ...DEFAULT_PREFS, opacity: 80 }, storage), true);
  assert.equal(loadPrefs(storage).opacity, 80);

  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(loadPrefs(broken), DEFAULT_PREFS);
    assert.equal(savePrefs(DEFAULT_PREFS, broken), false);
    assert.deepEqual(loadPrefs({ getItem: () => '{not json' }), DEFAULT_PREFS);
  } finally {
    console.warn = warn;
  }
});
