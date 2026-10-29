# TraceCam testing

Three clearly separate kinds of testing. **Only the third kind can prove anything about an iPhone.**

## 1. Automated tests (Node, run on your PC)

```powershell
npm test
```

Covers pure logic only: transform math (drag, pinch, twist, limits, no-jump re-baselining, fit), image-size limiting, camera error mapping, support detection, preference validation, and project structure (manifest valid, every cached/linked file exists, every button has a handler, no external hosts).

They do **not** test the camera, touch input or Safari.

## 2. Desktop-browser checks (Chrome/Edge at http://localhost:8080)

Done during development in an embedded desktop browser, using a synthetic image and scripted pointer events:

- [x] Page loads with no console errors; service worker registers and caches the 16 shell files.
- [x] Choosing an image shows it, fitted with its aspect ratio kept.
- [x] Drag moves it; Rotate 90 and Flip change the transform; opacity slider and percentage update.
- [x] Lock: drag and Reset are ignored while locked; Unlock restores them.
- [x] Mobile-width (375x812) layout renders correctly.

Not exercised on desktop: a real camera stream, real two-finger pinch/twist, HEIC, wake lock, Home Screen install. (You can repeat the checks yourself: with a mouse, drag to move and use the scroll wheel to zoom.)

## 3. Manual iPhone checklist (NOT yet performed)

Nothing below has been tested on a real iPhone by the author. Tick these yourself after deploying; note your iOS version.

Device: ____________  iOS: ________  Date: ________

**Camera**
- [ ] Opening the page does NOT ask for camera access until you tap Start camera.
- [ ] Start camera asks permission; Allow shows the rear camera full-screen, not stretched.
- [ ] Stop camera (Options) turns the camera off (green dot disappears); Start camera brings it back.
- [ ] Deny permission: clear message + Try again works after allowing in Settings.
- [ ] Open another camera app first, then Start: "Camera is busy" message appears.
- [ ] Switch to another app / lock the phone for 30 s, return: camera resumes, no frozen frame, no duplicate stream.

**Image**
- [ ] Image... opens the Photos picker. JPEG photo loads, aspect ratio correct.
- [ ] Transparent PNG shows no background box.
- [ ] HEIC photo: loads (iOS usually converts) or shows the helpful message, never crashes.
- [ ] A very large photo (12 MP+) loads without the page reloading.
- [ ] Replace with a second image; Remove clears it.
- [ ] A non-image file (from Files) shows an error.

**Opacity / gestures**
- [ ] Slider 0% to 100% works smoothly; presets work; percentage matches.
- [ ] One finger drags; pinch resizes without jumping; two-finger twist rotates.
- [ ] Switching 1 finger to 2 fingers and back causes no jump.
- [ ] The page never scrolls, zooms or navigates back while tracing.
- [ ] Buttons Fit, Reset, rotate 90 left/right, Flip, nudge arrows, +/-1 degree, size +/- all work.

**Lock / focus**
- [ ] Lock makes the state obvious (amber button); drags/pinches/buttons no longer move the image; opacity still works.
- [ ] Unlock keeps the alignment.
- [ ] Hide controls clears the screen; Show controls and Lock/Unlock remain reachable.

**Layout**
- [ ] Portrait and landscape: nothing hidden under the notch / Dynamic Island / Home indicator.
- [ ] Rotating shows the "realign" notice and keeps scale/rotation/flip.
- [ ] Small iPhone (SE-size) and large iPhone (Pro Max): all controls reachable.

**Keep awake**
- [ ] With Keep screen awake on, the screen stays on for longer than your Auto-Lock time.
- [ ] Turning it off lets the screen sleep normally.

**PWA**
- [ ] Share -> Add to Home Screen; the icon looks right; it launches full-screen (no Safari bars).
- [ ] The installed app asks for camera permission (separately from Safari) and works.
- [ ] Turn on Airplane Mode and relaunch the installed app: it still opens (after at least one online load).
- [ ] After you publish an update, the app shows "A new version is ready" and Update works.
