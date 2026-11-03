// Dot tracking: four on-screen indicators that you line up with four coloured
// stickers on the paper. While locked, the stickers are found in each camera
// frame and the overlay layer is warped so the image follows the paper.
//
// Coordinates:
//   stage  - CSS px in the full-screen box (top-left origin)
//   frame  - pixels of the small analysis canvas (= the visible part of the video, shrunk)
//   video  - pixels of the camera frame. Tracking is done here, so it keeps
//            working if the screen size changes (e.g. Safari's toolbar hiding).

import { calibrateDot, findDot, trackRadius } from './dot-detect.js';
import {
  IDENTITY, applyH, coverCrop, cssMatrix3d, estimateTransform, fitSimilarity,
  mul3, stageToVideo, videoToStage,
} from './tracking-math.js';

export const DOT_MODES = ['off', 'rect', 'custom'];
const RECT = [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]];
const FRAME_LONG_SIDE = 400; // analysis canvas size (px on the long side)
const FRAME_INTERVAL_MS = 66; // ~15 detections per second
const SETUP_RADIUS = 0.1; // search radius around an indicator, fraction of the long side
const SMOOTHING = 0.5; // 0..1, higher follows faster, lower is steadier
const DEADBAND_PX = 0.4; // ignore sub-pixel flicker (video px)

export class DotsController {
  /**
   * @param {object} o
   * @param {HTMLElement} o.stage
   * @param {HTMLElement} o.layer      element holding the image + grid; gets the tracking warp
   * @param {HTMLElement} o.container  element that receives indicators and markers
   * @param {HTMLVideoElement} o.video
   * @param {() => void} o.onUpdate    called when detection status changes
   */
  constructor({ stage, layer, container, video, onUpdate }) {
    this.stage = stage;
    this.layer = layer;
    this.container = container;
    this.video = video;
    this.onUpdate = onUpdate || (() => {});
    this.mode = 'off';
    this.active = false; // camera running
    this.custom = RECT.map(([u, v]) => ({ u, v })); // session-only positions
    this.found = [null, null, null, null]; // setup detections
    this.track = null; // tracking state while locked
    this.lastFrame = null;
    this._raf = 0;
    this._last = 0;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.indicators = [];
    this.marks = [];
    for (let i = 0; i < 4; i++) {
      const ind = document.createElement('div');
      ind.className = 'dot-ind';
      ind.dataset.index = String(i + 1);
      ind.setAttribute('role', 'presentation');
      this._makeDraggable(ind, i);
      const mark = document.createElement('div');
      mark.className = 'dot-mark';
      mark.hidden = true;
      container.append(ind, mark);
      this.indicators.push(ind);
      this.marks.push(mark);
    }
    this._layout();
  }

  get tracking() {
    return Boolean(this.track);
  }

  get foundCount() {
    return this.found.filter(Boolean).length;
  }

  get visibleCount() {
    return this.track ? this.track.visible : 0;
  }

  get ready() {
    return this.mode !== 'off' && this.foundCount === 4;
  }

  positions() {
    return this.mode === 'rect' ? RECT.map(([u, v]) => ({ u, v })) : this.custom;
  }

  setMode(mode) {
    if (!DOT_MODES.includes(mode)) mode = 'off';
    if (this.track) this.stopTracking();
    this.mode = mode;
    this.found = [null, null, null, null];
    this._layout();
    this._updateLoop();
    this.onUpdate();
  }

  setActive(on) {
    this.active = on;
    if (!on) this.found = [null, null, null, null];
    this._layout();
    this._updateLoop();
    this.onUpdate();
  }

  /** Begin tracking from the current setup detections. False if not all 4 dots are seen. */
  startTracking() {
    if (!this.ready || !this.lastFrame) return false;
    const crop = this.lastFrame.crop;
    const ref = this.found.map((f) => ({ ...f.video }));
    const lockStage = { w: this.lastFrame.W, h: this.lastFrame.H };
    this.track = {
      ref,
      info: this.found.map((f) => ({ hue: f.hue, chroma: f.chroma, count: f.count })),
      cur: ref.map((p) => ({ ...p })),
      seen: [true, true, true, true],
      H: IDENTITY.slice(), // video -> video since lock
      lockCrop: crop,
      lockStage,
      visible: 4,
    };
    // Freeze the layer at its lock-time size so the warp is in fixed coordinates.
    Object.assign(this.layer.style, {
      inset: 'auto', left: '0px', top: '0px',
      width: `${lockStage.w}px`, height: `${lockStage.h}px`, transformOrigin: '0 0',
    });
    this._render();
    this._layout();
    this.onUpdate();
    return true;
  }

  /**
   * Stop tracking. Returns the move/rotate/scale that tracking had applied (in
   * lock-time stage px) so the caller can keep the image where it is now.
   */
  stopTracking() {
    const tr = this.track;
    if (!tr) return null;
    const M = this._displayMatrix();
    const lockPts = tr.ref.map((p) => applyH(videoToStage(tr.lockCrop), p));
    const S = fitSimilarity(lockPts, lockPts.map((p) => applyH(M, p)));

    // Custom indicators move to where the stickers are now.
    if (this.mode === 'custom' && this.lastFrame) {
      const V2S = videoToStage(this.lastFrame.crop);
      this.custom = tr.ref.map((p) => {
        const s = applyH(V2S, applyH(tr.H, p));
        return { u: clamp01(s.x / this.lastFrame.W), v: clamp01(s.y / this.lastFrame.H) };
      });
    }
    this.track = null;
    this.layer.style.cssText = '';
    for (const m of this.marks) m.hidden = true;
    this._layout();
    this.onUpdate();
    return S ? { S, from: tr.lockStage } : null;
  }

  /** Re-place indicators after a resize (they are stored as fractions). */
  resize() {
    this._layout();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  /* ---------------------------------------------------------------- */

  _layout() {
    const show = this.mode !== 'off' && !this.track;
    const pos = this.positions();
    this.indicators.forEach((ind, i) => {
      ind.hidden = !show;
      ind.style.left = `${pos[i].u * 100}%`;
      ind.style.top = `${pos[i].v * 100}%`;
      ind.classList.toggle('ok', Boolean(this.found[i]));
      ind.classList.toggle('missing', this.active && !this.found[i]);
    });
  }

  _updateLoop() {
    const want = this.active && (this.mode !== 'off' || this.track);
    if (want && !this._raf) {
      const tick = (now) => {
        this._raf = requestAnimationFrame(tick);
        if (now - this._last < FRAME_INTERVAL_MS) return;
        this._last = now;
        try {
          this._process();
        } catch (err) {
          console.error('[TraceCam] Dot tracking error:', err);
        }
      };
      this._raf = requestAnimationFrame(tick);
    } else if (!want && this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  /** Copy the visible part of the camera into the small analysis canvas. */
  _grab() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
    const r = this.stage.getBoundingClientRect();
    const W = r.width, H = r.height;
    if (!W || !H) return null;
    const crop = coverCrop(v.videoWidth, v.videoHeight, W, H);
    const s = FRAME_LONG_SIDE / Math.max(W, H);
    const cw = Math.max(1, Math.round(W * s));
    const ch = Math.max(1, Math.round(H * s));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.ctx.drawImage(v, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cw, ch);
    const img = this.ctx.getImageData(0, 0, cw, ch);
    // frame px <-> video px
    const fx = crop.sw / cw, fy = crop.sh / ch;
    return {
      img, W, H, crop, cw, ch,
      toVideo: (p) => ({ x: crop.sx + p.x * fx, y: crop.sy + p.y * fy }),
      toFrame: (p) => ({ x: (p.x - crop.sx) / fx, y: (p.y - crop.sy) / fy }),
    };
  }

  _process() {
    const frame = this._grab();
    if (!frame) return;
    this.lastFrame = frame;
    if (this.track) this._trackFrame(frame);
    else if (this.mode !== 'off') this._setupFrame(frame);
  }

  _setupFrame(frame) {
    const R = SETUP_RADIUS * Math.max(frame.cw, frame.ch);
    const pos = this.positions();
    let changed = false;
    this.found = pos.map(({ u, v }, i) => {
      const d = calibrateDot(frame.img, u * frame.cw, v * frame.ch, R);
      if (Boolean(d) !== Boolean(this.found[i])) changed = true;
      return d ? { ...d, video: frame.toVideo(d) } : null;
    });
    this._layout();
    if (changed) this.onUpdate();
  }

  _trackFrame(frame) {
    const tr = this.track;
    const src = [];
    const dst = [];
    tr.ref.forEach((ref, i) => {
      const predicted = frame.toFrame(applyH(tr.H, ref));
      const d = findDot(frame.img, predicted.x, predicted.y, trackRadius(tr.info[i].count), tr.info[i]);
      tr.seen[i] = Boolean(d);
      if (!d) return;
      const meas = frame.toVideo(d);
      const cur = tr.cur[i];
      const dist = Math.hypot(meas.x - cur.x, meas.y - cur.y);
      if (dist > DEADBAND_PX) {
        cur.x += (meas.x - cur.x) * SMOOTHING;
        cur.y += (meas.y - cur.y) * SMOOTHING;
      }
      src.push(ref);
      dst.push({ ...cur });
    });
    const prevVisible = tr.visible;
    tr.visible = src.length;
    const H = estimateTransform(src, dst);
    if (H) tr.H = H; // fewer than 2 dots: hold the last good position
    this._render();
    if (prevVisible !== tr.visible) this.onUpdate();
  }

  /** Lock-time stage coords -> current stage coords. */
  _displayMatrix() {
    const tr = this.track;
    const crop = this.lastFrame ? this.lastFrame.crop : tr.lockCrop;
    return mul3(videoToStage(crop), mul3(tr.H, stageToVideo(tr.lockCrop)));
  }

  _render() {
    const tr = this.track;
    if (!tr) return;
    this.layer.style.transform = cssMatrix3d(this._displayMatrix());
    const V2S = this.lastFrame ? videoToStage(this.lastFrame.crop) : videoToStage(tr.lockCrop);
    tr.cur.forEach((p, i) => {
      const s = applyH(V2S, p);
      const m = this.marks[i];
      m.hidden = !tr.seen[i];
      m.style.left = `${s.x}px`;
      m.style.top = `${s.y}px`;
    });
  }

  _makeDraggable(ind, i) {
    let dragging = false;
    const move = (e) => {
      const r = this.stage.getBoundingClientRect();
      this.custom[i] = {
        u: clamp01((e.clientX - r.left) / r.width, 0.02),
        v: clamp01((e.clientY - r.top) / r.height, 0.02),
      };
      this._layout();
    };
    ind.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'custom' || this.track) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      ind.classList.add('dragging');
      try { ind.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    ind.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      move(e);
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      ind.classList.remove('dragging');
      try { ind.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this._snap(i);
    };
    ind.addEventListener('pointerup', end);
    ind.addEventListener('pointercancel', end);
  }

  /** After a drag, centre the indicator on the sticker it was dropped near. */
  _snap(i) {
    const f = this.lastFrame;
    if (!f) return;
    const { u, v } = this.custom[i];
    const d = calibrateDot(f.img, u * f.cw, v * f.ch, SETUP_RADIUS * Math.max(f.cw, f.ch));
    if (d) this.custom[i] = { u: d.x / f.cw, v: d.y / f.ch };
    this._layout();
  }
}

function clamp01(v, margin = 0) {
  return Math.min(1 - margin, Math.max(margin, v));
}
