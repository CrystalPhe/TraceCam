// Camera manager: one getUserMedia stream at a time, with clean start/stop,
// resume-after-background and friendly error mapping.

/** Turn a getUserMedia / playback failure into a message a person can act on. */
export function mapCameraError(err) {
  const name = err?.name || 'Error';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        code: 'denied',
        title: 'Camera permission denied',
        message:
          'TraceCam can’t see the camera. On iPhone open Settings → Safari → Camera and choose Ask or Allow, ' +
          'or tap the “aa” button in Safari’s address bar → Website Settings → Camera → Allow. ' +
          'Then tap Try again. (If you installed TraceCam to the Home Screen, the permission is asked separately for the installed app.)',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        code: 'notfound',
        title: 'No camera found',
        message: 'This device didn’t report a usable camera. Try a different browser or device.',
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        code: 'inuse',
        title: 'Camera is busy',
        message:
          'Another app or browser tab is using the camera. Close FaceTime, other camera apps or other Safari tabs using the camera, then tap Try again.',
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        code: 'overconstrained',
        title: 'Camera settings not supported',
        message: 'The camera couldn’t start with the requested settings. Tap Try again.',
      };
    case 'SecurityError':
      return {
        code: 'insecure',
        title: 'Camera blocked',
        message: 'The browser blocked camera access for this page. Open TraceCam over HTTPS (your GitHub Pages address).',
      };
    case 'TrackEnded':
      return {
        code: 'ended',
        title: 'Camera stopped',
        message: 'The camera was interrupted (for example by a phone call or another app). Tap Try again to restart it.',
      };
    case 'PlaybackError':
      return {
        code: 'playback',
        title: 'Couldn’t show the camera',
        message: 'The camera started but the preview couldn’t play. Tap Try again.',
      };
    default:
      return {
        code: 'unknown',
        title: 'Camera error',
        message: `Something unexpected stopped the camera (${name}). Tap Try again, or reload the page.`,
      };
  }
}

/** Check browser support before asking for permission. */
export function checkCameraSupport(env = globalThis) {
  const secure = env.isSecureContext !== false;
  if (!secure) {
    return {
      ok: false,
      error: {
        code: 'insecure',
        title: 'HTTPS required',
        message:
          'Camera access only works on secure pages. Open TraceCam through its https:// address (or localhost while developing), not http:// or a file.',
      },
    };
  }
  if (!env.navigator?.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      error: {
        code: 'unsupported',
        title: 'Camera not supported',
        message:
          'This browser doesn’t offer camera access. Use Safari on an iPhone running a recent iOS version.',
      },
    };
  }
  return { ok: true };
}

function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch (err) {
      console.warn('[TraceCam] track.stop failed:', err);
    }
  }
}

const OVERCONSTRAINED = new Set(['OverconstrainedError', 'ConstraintNotSatisfiedError']);

export class CameraManager {
  /**
   * @param {HTMLVideoElement} video
   * @param {{onState?: (state: 'idle'|'starting'|'running'|'error', info?: object) => void}} [opts]
   */
  constructor(video, { onState } = {}) {
    this.video = video;
    this.onState = onState || (() => {});
    this.state = 'idle';
    this.stream = null;
    this._gen = 0; // bumped on every stop so late async results are discarded
    this._wanted = false; // the user wants the camera on (survives backgrounding)
    this._starting = null;
    this._onTrackEnded = this._onTrackEnded.bind(this);

    video.muted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.playsInline = true;
    video.autoplay = true;
  }

  get running() {
    return this.state === 'running';
  }

  get wanted() {
    return this._wanted;
  }

  _setState(state, info) {
    this.state = state;
    this.onState(state, info);
  }

  _tracksLive() {
    const tracks = this.stream?.getVideoTracks() ?? [];
    return tracks.length > 0 && tracks.every((t) => t.readyState === 'live');
  }

  /** Start the camera. Safe to call repeatedly: never opens a second stream. */
  start() {
    this._wanted = true;
    if (this._starting) return this._starting;
    if (this.state === 'running' && this._tracksLive()) {
      return this.video.play().then(() => true, () => true);
    }
    this._starting = this._start().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  async _start() {
    const support = checkCameraSupport();
    if (!support.ok) {
      this._setState('error', support.error);
      return false;
    }
    this._release(); // drop any dead stream first
    const gen = ++this._gen;
    this._setState('starting');

    let stream = null;
    try {
      const gum = (c) => navigator.mediaDevices.getUserMedia(c);
      try {
        stream = await gum({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (err) {
        if (!OVERCONSTRAINED.has(err?.name)) throw err;
        stream = await gum({ video: true, audio: false });
      }

      if (gen !== this._gen) {
        // stop() was called while the permission prompt was open.
        stopStream(stream);
        return false;
      }

      this.stream = stream;
      for (const t of stream.getVideoTracks()) t.addEventListener('ended', this._onTrackEnded);
      this.video.srcObject = stream;
      try {
        await this.video.play();
      } catch (playErr) {
        console.warn('[TraceCam] video.play() failed:', playErr);
        const e = new Error('Video playback failed');
        e.name = 'PlaybackError';
        throw e;
      }
      if (gen !== this._gen) return false;
      this._setState('running');
      return true;
    } catch (err) {
      console.warn('[TraceCam] Camera start failed:', err?.name, err?.message);
      if (stream && stream !== this.stream) stopStream(stream);
      if (gen === this._gen) {
        this._release();
        this._setState('error', mapCameraError(err));
      }
      return false;
    }
  }

  _onTrackEnded() {
    if (!this.stream) return;
    console.warn('[TraceCam] Camera track ended unexpectedly');
    this._release();
    this._setState('error', mapCameraError({ name: 'TrackEnded' }));
  }

  _release() {
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      for (const t of stream.getVideoTracks()) t.removeEventListener('ended', this._onTrackEnded);
    }
    stopStream(stream);
    try {
      this.video.pause();
    } catch {
      /* element may already be torn down */
    }
    this.video.srcObject = null;
  }

  /** The user explicitly turned the camera off. */
  stop() {
    this._wanted = false;
    this._gen++;
    this._release();
    this._setState('idle');
  }

  /** The page is going away (pagehide): free the camera but remember we want it. */
  suspend() {
    if (!this._wanted) return;
    this._gen++;
    this._release();
    this._setState('idle');
  }

  /**
   * Called when the page becomes visible again. Reuses a healthy stream,
   * otherwise starts a new one - never both.
   */
  async resume() {
    if (!this._wanted) return false;
    if (this.state === 'running' && this._tracksLive()) {
      try {
        await this.video.play();
      } catch (err) {
        console.warn('[TraceCam] resume play() failed:', err);
      }
      return true;
    }
    if (this.state === 'starting') return this._starting;
    return this.start();
  }
}
