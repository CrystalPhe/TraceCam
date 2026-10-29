// TraceCam main controller: wires the DOM to the camera, gestures and transform math.

import { CameraManager, checkCameraSupport } from './camera.js';
import { WakeLockManager } from './wakelock.js';
import { attachGestures } from './gestures.js';
import { loadImageFile, ImageLoadError } from './image-loader.js';
import { loadPrefs, savePrefs } from './prefs.js';
import {
  DEFAULT_TRANSFORM,
  FIT_MARGIN,
  clamp,
  cssTransform,
  fitScale,
  fitSize,
  sanitizeTransform,
} from './transform.js';

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'), video: $('camera'), overlay: $('overlay'), surface: $('surface'),
  status: $('status'), lockBtn: $('lockBtn'), focusBtn: $('focusBtn'),
  startCard: $('startCard'), startBtn: $('startBtn'), errorBox: $('errorBox'), installHint: $('installHint'),
  opacity: $('opacity'), opacityOut: $('opacityOut'),
  fileInput: $('fileInput'), camToggle: $('camToggle'), keepAwake: $('keepAwake'), wakeNote: $('wakeNote'),
  helpBtn: $('helpBtn'), helpClose: $('helpClose'), sheet: $('sheet'),
  realign: $('realign'), realignOk: $('realignOk'),
  toast: $('toast'), toastText: $('toastText'), toastAction: $('toastAction'),
};

const app = {
  prefs: loadPrefs(),
  t: { ...DEFAULT_TRANSFORM },
  base: { w: 0, h: 0 }, // overlay element size in CSS px at scale 1
  nat: { w: 0, h: 0 },
  imageUrl: null,
  hasImage: false,
  locked: false,
  focus: false,
  orientation: null,
  camState: 'idle',
  wakeNote: '',
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const stageSize = () => {
  const r = el.stage.getBoundingClientRect();
  return { w: r.width, h: r.height };
};
const isPortrait = () => {
  const s = stageSize();
  return s.h >= s.w;
};

let toastTimer = 0;
function toast(message, { duration = 4500, action } = {}) {
  clearTimeout(toastTimer);
  el.toastText.textContent = message;
  if (action) {
    el.toastAction.textContent = action.label;
    el.toastAction.hidden = false;
    el.toastAction.onclick = () => {
      el.toast.hidden = true;
      action.run();
    };
  } else {
    el.toastAction.hidden = true;
    el.toastAction.onclick = null;
  }
  el.toast.hidden = false;
  if (duration > 0) toastTimer = setTimeout(() => { el.toast.hidden = true; }, duration);
}

function persist() {
  savePrefs(app.prefs);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function render() {
  el.overlay.style.transform = cssTransform(app.t);
}

function setTransform(next) {
  if (!app.hasImage) return;
  const s = stageSize();
  app.t = sanitizeTransform(next, s.w, s.h);
  render();
  syncControls();
}

function renderOpacity() {
  const v = app.prefs.opacity;
  el.overlay.style.opacity = String(v / 100);
  el.opacity.value = String(v);
  el.opacity.setAttribute('aria-valuetext', `${v} percent`);
  el.opacityOut.textContent = `${v}%`;
}

function updateStatus() {
  const parts = [];
  parts.push(app.camState === 'running' ? 'Camera on' : app.camState === 'starting' ? 'Starting camera…' : 'Camera off');
  if (app.hasImage) parts.push(app.locked ? 'Image LOCKED' : 'Image unlocked');
  el.status.textContent = parts.join(' · ');
}

function syncControls() {
  document.body.dataset.locked = String(app.locked);
  document.body.dataset.hasImage = String(app.hasImage);
  document.body.dataset.focus = String(app.focus);
  document.body.dataset.camera = app.camState;

  el.lockBtn.textContent = app.locked ? 'Unlock' : 'Lock';
  el.lockBtn.setAttribute('aria-pressed', String(app.locked));
  el.lockBtn.disabled = !app.hasImage;
  el.focusBtn.textContent = app.focus ? 'Show controls' : 'Hide controls';
  el.focusBtn.setAttribute('aria-pressed', String(app.focus));

  // Buttons that move the image are inert while locked or without an image.
  const canEdit = app.hasImage && !app.locked;
  document.querySelectorAll('[data-action]').forEach((b) => {
    const a = b.dataset.action;
    b.disabled = a === 'remove' ? !app.hasImage : !canEdit;
  });
  document.querySelector('[data-action="flip"]').setAttribute('aria-pressed', String(app.t.flip));
  document.querySelectorAll('[data-step]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.step) === app.prefs.nudgeStep));
  });

  el.camToggle.textContent = app.camState === 'running' || app.camState === 'starting' ? 'Stop camera' : 'Start camera';
  el.keepAwake.checked = app.prefs.keepAwake;
  updateStatus();
}

/* ------------------------------------------------------------------ */
/* Reference image                                                     */
/* ------------------------------------------------------------------ */

function layoutBase() {
  const s = stageSize();
  const b = fitSize(app.nat.w, app.nat.h, s.w, s.h, FIT_MARGIN);
  app.base = b;
  el.overlay.style.width = `${b.w}px`;
  el.overlay.style.height = `${b.h}px`;
}

async function chooseFile(file) {
  if (!file) return;
  let result;
  try {
    result = await loadImageFile(file);
  } catch (err) {
    if (!(err instanceof ImageLoadError)) console.error('[TraceCam] Unexpected image error:', err);
    toast(err instanceof ImageLoadError ? err.message : 'Something went wrong opening that image.', { duration: 8000 });
    return;
  }

  const previousUrl = app.imageUrl;
  app.imageUrl = result.url;
  app.nat = { w: result.width, h: result.height };
  el.overlay.src = result.url;
  try {
    await el.overlay.decode();
  } catch (err) {
    console.warn('[TraceCam] overlay decode failed:', err?.message);
    // Roll back to the previous image state rather than showing a broken overlay.
    URL.revokeObjectURL(result.url);
    app.imageUrl = previousUrl;
    if (previousUrl) el.overlay.src = previousUrl;
    toast('That image couldn’t be displayed. Try another one.', { duration: 6000 });
    return;
  }
  // Safe to free the old image only after the new one is on screen.
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  const wasLocked = app.locked;
  app.hasImage = true;
  app.locked = false;
  el.overlay.hidden = false;
  layoutBase();
  app.t = { ...DEFAULT_TRANSFORM };
  render();
  syncControls();
  if (wasLocked) toast('New image loaded – overlay unlocked.');
  else if (result.downscaled) toast('Large image reduced to save memory.');
}

function removeImage() {
  if (app.imageUrl) URL.revokeObjectURL(app.imageUrl);
  app.imageUrl = null;
  app.hasImage = false;
  app.locked = false;
  el.overlay.hidden = true;
  el.overlay.removeAttribute('src');
  app.t = { ...DEFAULT_TRANSFORM };
  gestures.cancel();
  syncControls();
}

/* ------------------------------------------------------------------ */
/* Image actions (every button in the panel maps to one entry here)    */
/* ------------------------------------------------------------------ */

const nudge = (dx, dy) => () => setTransform({ ...app.t, x: app.t.x + dx * app.prefs.nudgeStep, y: app.t.y + dy * app.prefs.nudgeStep });

const actions = {
  remove: removeImage,
  fit() {
    const s = stageSize();
    setTransform({ ...app.t, x: 0, y: 0, scale: fitScale(app.base.w, app.base.h, app.t.rotation, s.w, s.h, FIT_MARGIN) });
  },
  reset() {
    layoutBase(); // re-fit to the current screen shape too
    setTransform({ ...DEFAULT_TRANSFORM });
  },
  'rotate-left': () => setTransform({ ...app.t, rotation: app.t.rotation - 90 }),
  'rotate-right': () => setTransform({ ...app.t, rotation: app.t.rotation + 90 }),
  'rot-minus': () => setTransform({ ...app.t, rotation: app.t.rotation - 1 }),
  'rot-plus': () => setTransform({ ...app.t, rotation: app.t.rotation + 1 }),
  'size-minus': () => setTransform({ ...app.t, scale: app.t.scale / 1.02 }),
  'size-plus': () => setTransform({ ...app.t, scale: app.t.scale * 1.02 }),
  flip: () => setTransform({ ...app.t, flip: !app.t.flip }),
  'nudge-up': nudge(0, -1),
  'nudge-down': nudge(0, 1),
  'nudge-left': nudge(-1, 0),
  'nudge-right': nudge(1, 0),
};

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const run = actions[btn.dataset.action];
    if (!run) return console.error('[TraceCam] No handler for', btn.dataset.action);
    if (btn.dataset.action !== 'remove' && app.locked) return; // locked: ignore
    run();
  });
});

/* ------------------------------------------------------------------ */
/* Lock, focus mode, opacity, steps                                    */
/* ------------------------------------------------------------------ */

function setLocked(value) {
  if (value && !app.hasImage) return;
  app.locked = value;
  if (value) gestures.cancel();
  syncControls();
}
el.lockBtn.addEventListener('click', () => setLocked(!app.locked));

function setFocus(value) {
  app.focus = value;
  app.prefs.ui = value ? 'focus' : 'full';
  persist();
  syncControls();
}
el.focusBtn.addEventListener('click', () => setFocus(!app.focus));

function setOpacity(percent) {
  app.prefs.opacity = clamp(Math.round(Number(percent)), 0, 100);
  renderOpacity();
}
el.opacity.addEventListener('input', () => setOpacity(el.opacity.value));
el.opacity.addEventListener('change', persist);
document.querySelectorAll('[data-opacity]').forEach((b) =>
  b.addEventListener('click', () => { setOpacity(b.dataset.opacity); persist(); }));

document.querySelectorAll('[data-step]').forEach((b) =>
  b.addEventListener('click', () => {
    app.prefs.nudgeStep = Number(b.dataset.step);
    persist();
    syncControls();
  }));

/* ------------------------------------------------------------------ */
/* File picking                                                        */
/* ------------------------------------------------------------------ */

el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files?.[0];
  el.fileInput.value = ''; // allow choosing the same file again
  await chooseFile(file);
});

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

const wake = new WakeLockManager({
  onChange({ active, reason }) {
    if (active) app.wakeNote = 'Screen wake lock is active.';
    else if (reason === 'unsupported') app.wakeNote = 'This browser can’t keep the screen awake. Adjust Auto-Lock in iPhone Settings → Display & Brightness.';
    else if (reason === 'failed') app.wakeNote = 'The browser refused to keep the screen awake (low battery or Low Power Mode?).';
    else if (reason === 'released') app.wakeNote = 'iOS released the wake lock; it will be requested again when possible.';
    else app.wakeNote = '';
    el.wakeNote.textContent = app.wakeNote;
    el.wakeNote.hidden = !app.wakeNote;
  },
});

const camera = new CameraManager(el.video, {
  onState(state, info) {
    app.camState = state;
    if (state === 'error') {
      el.errorBox.hidden = false;
      el.errorBox.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = info.title;
      el.errorBox.append(strong, info.message);
      el.startBtn.textContent = 'Try again';
      wake.disable();
    } else {
      el.errorBox.hidden = true;
      el.startBtn.textContent = 'Start camera';
    }
    el.startBtn.disabled = state === 'starting';
    if (state === 'running' && app.prefs.keepAwake) wake.enable();
    if (state === 'idle') wake.disable();
    syncControls();
  },
});

async function startCamera() {
  // Called from a tap, so iOS allows the permission prompt and wake lock.
  if (app.prefs.keepAwake) wake.enable();
  await camera.start();
}
el.startBtn.addEventListener('click', startCamera);
el.camToggle.addEventListener('click', () => {
  if (app.camState === 'running' || app.camState === 'starting') camera.stop();
  else startCamera();
});

el.keepAwake.addEventListener('change', () => {
  app.prefs.keepAwake = el.keepAwake.checked;
  persist();
  if (app.prefs.keepAwake) {
    if (camera.running) wake.enable();
    else if (!WakeLockManager.supported) wake.enable(); // reports "unsupported"
  } else {
    wake.disable();
  }
});

// iOS suspends pages in the background: free the camera on pagehide, and
// reuse-or-restart (never duplicate) when we come back.
window.addEventListener('pagehide', () => camera.suspend());
window.addEventListener('pageshow', () => camera.resume());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') camera.resume();
});

/* ------------------------------------------------------------------ */
/* Orientation / resize                                                */
/* ------------------------------------------------------------------ */

function onResize() {
  const portrait = isPortrait();
  if (app.orientation !== null && portrait !== app.orientation && app.hasImage) {
    el.realign.hidden = false;
  }
  app.orientation = portrait;
  // Keep the centre on-screen but never reset scale / rotation / flip.
  if (app.hasImage) setTransform(app.t);
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(onResize, 120);
});
el.realignOk.addEventListener('click', () => { el.realign.hidden = true; });

/* ------------------------------------------------------------------ */
/* Help sheet                                                          */
/* ------------------------------------------------------------------ */

const openHelp = () => { el.sheet.hidden = false; el.helpClose.focus(); };
const closeHelp = () => { el.sheet.hidden = true; el.helpBtn.focus(); };
el.helpBtn.addEventListener('click', openHelp);
el.helpClose.addEventListener('click', closeHelp);
el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.sheet.hidden) closeHelp(); });

/* ------------------------------------------------------------------ */
/* Gestures                                                            */
/* ------------------------------------------------------------------ */

const gestures = attachGestures(el.surface, {
  getTransform: () => app.t,
  setTransform,
  isEnabled: () => app.hasImage && !app.locked,
});

/* ------------------------------------------------------------------ */
/* Service worker (offline app shell + safe updates)                   */
/* ------------------------------------------------------------------ */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const ok = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!ok) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  const offerUpdate = (worker) =>
    toast('A new version of TraceCam is ready.', {
      duration: 0,
      action: { label: 'Update', run: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
    });

  navigator.serviceWorker
    .register('service-worker.js')
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      // Look for a new version whenever the app returns to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('[TraceCam] Service worker registration failed:', err?.message));
}

/* ------------------------------------------------------------------ */
/* Start-up                                                            */
/* ------------------------------------------------------------------ */

window.addEventListener('online', () => toast('Back online.', { duration: 2500 }));
window.addEventListener('offline', () => toast('You’re offline. TraceCam still works if it was loaded before.', { duration: 4000 }));
window.addEventListener('unhandledrejection', (e) => console.error('[TraceCam] Unhandled rejection:', e.reason));

function init() {
  app.focus = app.prefs.ui === 'focus';
  renderOpacity();
  app.orientation = isPortrait();

  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  el.installHint.hidden = !(ios && !standalone);

  const support = checkCameraSupport();
  if (!support.ok) {
    el.errorBox.hidden = false;
    const strong = document.createElement('strong');
    strong.textContent = support.error.title;
    el.errorBox.append(strong, support.error.message);
    el.startBtn.disabled = true;
  }
  if (!WakeLockManager.supported) {
    el.wakeNote.textContent = 'This browser can’t keep the screen awake; adjust Auto-Lock in iPhone Settings if the screen sleeps.';
    el.wakeNote.hidden = false;
  }
  syncControls();
  registerServiceWorker();
}

init();
