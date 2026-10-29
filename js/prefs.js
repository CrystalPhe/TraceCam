// Lightweight preferences kept in localStorage. Only small settings are saved,
// never images or camera frames.

const KEY = 'tracecam.prefs.v1';

export const DEFAULT_PREFS = Object.freeze({
  opacity: 50, // percent
  keepAwake: true,
  nudgeStep: 1, // legacy preference; nudging is now fixed at 1 px
  ui: 'full', // 'full' | 'focus'
});

/** Validate untrusted data (from storage) and fill in defaults. */
export function sanitizePrefs(raw) {
  const p = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return p;
  if (Number.isFinite(raw.opacity)) {
    p.opacity = Math.min(100, Math.max(0, Math.round(raw.opacity)));
  }
  if (typeof raw.keepAwake === 'boolean') p.keepAwake = raw.keepAwake;
  if (raw.ui === 'full' || raw.ui === 'focus') p.ui = raw.ui;
  return p;
}

export function loadPrefs(storage = globalThis.localStorage) {
  try {
    const text = storage.getItem(KEY);
    return sanitizePrefs(text ? JSON.parse(text) : null);
  } catch (err) {
    // Private mode / blocked storage / corrupt JSON: just use defaults.
    console.warn('[TraceCam] Could not read saved settings:', err?.name || err);
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(sanitizePrefs(prefs)));
    return true;
  } catch (err) {
    console.warn('[TraceCam] Could not save settings:', err?.name || err);
    return false;
  }
}
