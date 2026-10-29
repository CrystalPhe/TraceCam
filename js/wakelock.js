// Screen Wake Lock wrapper. Never throws; reports problems through onChange.
// iOS can still release the lock (low battery, Low Power Mode, page hidden),
// so this is best-effort, not a guarantee.

export class WakeLockManager {
  /** @param {{onChange?: (info: {active: boolean, reason?: string}) => void}} [opts] */
  constructor({ onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.sentinel = null;
    this.wanted = false;
    this._pending = null;
    this._onVisibility = () => {
      if (document.visibilityState === 'visible' && this.wanted) this._acquire();
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  static get supported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  get active() {
    return Boolean(this.sentinel && !this.sentinel.released);
  }

  /** Ask to keep the screen on. Re-acquired automatically after backgrounding. */
  enable() {
    this.wanted = true;
    return this._acquire();
  }

  disable() {
    this.wanted = false;
    return this._release();
  }

  async _acquire() {
    if (!WakeLockManager.supported) {
      this.onChange({ active: false, reason: 'unsupported' });
      return false;
    }
    if (this.active) return true;
    if (document.visibilityState !== 'visible') return false; // retried on visibilitychange
    if (this._pending) return this._pending;

    this._pending = (async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (!this.wanted) {
          // Turned off while the request was in flight.
          await sentinel.release().catch(() => {});
          return false;
        }
        this.sentinel = sentinel;
        sentinel.addEventListener('release', () => {
          if (this.sentinel === sentinel) this.sentinel = null;
          this.onChange({ active: false, reason: 'released' });
        });
        this.onChange({ active: true });
        return true;
      } catch (err) {
        console.warn('[TraceCam] Wake lock request failed:', err?.name, err?.message);
        this.onChange({ active: false, reason: 'failed' });
        return false;
      } finally {
        this._pending = null;
      }
    })();
    return this._pending;
  }

  async _release() {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch (err) {
        console.warn('[TraceCam] Wake lock release failed:', err);
      }
    }
    this.onChange({ active: false, reason: 'disabled' });
  }

  destroy() {
    document.removeEventListener('visibilitychange', this._onVisibility);
    return this.disable();
  }
}
