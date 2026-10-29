// Decode a user-picked image file locally. Nothing is uploaded or stored.
// Very large photos are downscaled once so they don't exhaust iPhone memory.

import { limitedSize, MAX_IMAGE_DIMENSION } from './transform.js';

export class ImageLoadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImageLoadError';
    this.code = code;
  }
}

const HEIC_RE = /\.(heic|heif)$/i;

export function isHeic(file) {
  return /image\/hei[cf]/i.test(file.type || '') || HEIC_RE.test(file.name || '');
}

function decode(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = url;
  });
}

/**
 * @param {File} file
 * @returns {Promise<{url: string, width: number, height: number, downscaled: boolean}>}
 *   `url` is a blob: URL the caller owns and must revoke with URL.revokeObjectURL.
 */
export async function loadImageFile(file) {
  if (!file || file.size === 0) {
    throw new ImageLoadError('empty', 'That file is empty. Please choose a different image.');
  }
  if (file.type && !file.type.startsWith('image/') && !isHeic(file)) {
    throw new ImageLoadError('type', 'That file isn’t an image. Choose a photo or picture (JPEG, PNG, WebP…).');
  }

  const url = URL.createObjectURL(file);
  let img;
  try {
    img = await decode(url);
  } catch (err) {
    URL.revokeObjectURL(url);
    console.warn('[TraceCam] Image decode failed:', file.type || '(no type)', err.message);
    if (isHeic(file)) {
      throw new ImageLoadError(
        'heic',
        'This HEIC photo couldn’t be opened. Choose it again from Photos (iOS normally converts it to JPEG), ' +
          'or pick a JPEG/PNG version of the picture.',
      );
    }
    throw new ImageLoadError('decode', 'This image is corrupted or in a format Safari can’t display. Try a JPEG or PNG.');
  }

  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  if (!natW || !natH) {
    URL.revokeObjectURL(url);
    throw new ImageLoadError('decode', 'The image has no visible size. Try a different file.');
  }

  const target = limitedSize(natW, natH, MAX_IMAGE_DIMENSION);
  if (!target.scaled) return { url, width: natW, height: natH, downscaled: false };

  // Downscale through a canvas; keep PNG/WebP/GIF as PNG so transparency survives.
  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.w;
    canvas.height = target.h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, target.w, target.h);
    const keepAlpha = /png|webp|gif/i.test(file.type || '');
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        keepAlpha ? 'image/png' : 'image/jpeg',
        0.92,
      );
    });
    canvas.width = canvas.height = 0; // release the canvas backing store
    URL.revokeObjectURL(url);
    return { url: URL.createObjectURL(blob), width: target.w, height: target.h, downscaled: true };
  } catch (err) {
    // Downscale failed (memory?). Fall back to the original; it did decode fine.
    console.warn('[TraceCam] Downscale failed, using original:', err.message);
    return { url, width: natW, height: natH, downscaled: false };
  }
}
