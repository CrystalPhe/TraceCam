# TraceCam

Put your phone on a stand or a cup above a sheet of paper, overlay a reference picture on the live camera view, and trace it by hand. TraceCam is a **web app (PWA)** that runs in Safari.

- Live rear-camera preview, full screen, never stretched
- Pick an image from Photos/Files; drag, pinch, twist, flip, rotate 90, fine-nudge, fit, reset
- Opacity slider (0-100%, default 50%) with 25/50/75/100 presets
- **Lock** the image so it can't move while you draw
- Focus mode (Hide controls), screen Keep-Awake, offline app shell
- Private: images and camera video never leave the phone. No analytics, no third-party scripts.

I created this mostly for personal use :) So that it's accessible on iPhone which is what I am using.

## Contents

1. [How it works](#how-it-works)
2. [Windows setup](#windows-setup)
3. [Run it on your PC](#run-it-on-your-pc)
4. [Publish with GitHub Pages](#publish-with-github-pages)
5. [Use it on your iPhone](#use-it-on-your-iphone)
6. [Updating the app](#updating-the-app)
7. [Troubleshooting](#troubleshooting)
8. [Limitations (read this)](#limitations-read-this)
9. [Project layout](#project-layout)

## How it works

**Architecture.** A static site: HTML + CSS + vanilla JavaScript ES modules. 

- The **stage** (`#stage`) is a full-screen box holding the `<video>` camera preview (`object-fit: cover`, so it fills the screen without stretching) and the overlay `<img>` on top. Both share the same box, so they share one coordinate space.
- The overlay's position is stored as the pixel offset of the image **centre** from the **stage centre**, plus `scale` (1 = fitted size when loaded), `rotation` (degrees) and `flip`. It is drawn with a single CSS `transform`. Changing opacity only changes the image's `opacity`; it never touches the transform.
- Gestures use Pointer Events. Whenever a finger is added/removed the gesture is re-baselined, so there are no jumps. A small dead zone stops pinching from accidentally rotating.
- `camera.js` owns the one camera stream (never duplicated), maps errors to friendly messages, releases the camera on `pagehide` and resumes when you return. `wakelock.js` holds the Screen Wake Lock and re-requests it when the page is visible again.
- `service-worker.js` caches only the app files (network-first, so you always get updates when online; falls back to cache offline). It never caches images or camera data.
- Preferences (opacity, keep-awake, nudge step, controls hidden/shown) are in `localStorage`. Images are **not** saved.

**Camera vs. image alignment.** The camera fills the screen and may crop its edges to avoid stretching. The overlay is positioned on the *screen*, which is exactly the cropped view you see, so what you see is what you trace. The app is **not** calibrated to the paper: if the phone or paper moves, or you rotate the phone (which re-crops the view), realign. A banner reminds you when the screen rotates.

## Windows setup

You need three free tools. Install each by running the installer and accepting the defaults.

1. **VS Code** (editor): <https://code.visualstudio.com/> - Download for Windows.
2. **Node.js LTS** (only used for the local test server and automated tests): <https://nodejs.org/> - choose "LTS".
3. **Git for Windows**: <https://git-scm.com/download/win>

Open a **new** PowerShell window (Start menu -> "PowerShell") and check:

```powershell
node --version
git --version
```

Both should print a version number. If you get "not recognized", close and reopen PowerShell (or restart the PC).

**Open the project in VS Code:** VS Code -> File -> Open Folder... -> choose the `TraceCam` folder. Open the built-in terminal with Ctrl + ` (backtick). It starts in the project folder.

## Run it on your PC

In the VS Code terminal (PowerShell):

```powershell
npm start
```

Then open <http://localhost:8080> in Chrome or Edge. Press `Ctrl + C` in the terminal to stop the server.

Run the automated tests:

```powershell
npm test
```

**Testing the layout on the desktop:** in Chrome/Edge press `F12`, click the "device toolbar" icon (phone/tablet), and choose any phone dimensions. You can pick a picture, drag it (mouse), zoom (scroll wheel), and use all buttons.

## Publish with GitHub Pages

Anyone can publish their own copy of TraceCam. You can either **fork** this repository (easiest) or clone it into a new repository that you own. Each copy gets its own URL and can be installed independently on an iPhone.

### Option A: Fork this repository

1. Sign in to <https://github.com>.
2. Open the TraceCam repository and click **Fork**.
3. Choose your account and keep the repository name, or choose another name.
4. Open your fork, then go to **Settings** -> **Pages**.
5. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
6. Select the branch containing the project (usually `master`) and folder `/ (root)`, then click **Save**.

### Option B: Clone and publish in your own repository

1. Sign up at <https://github.com/signup> if needed.
2. Create a new **Public** repository. Do not add a README or other files if you are uploading this project into it.
3. If you are starting from scratch, run these commands from the parent folder where you want the project to be downloaded. Replace `YOUR-USERNAME` and `YOUR-REPOSITORY`:

```powershell
git clone https://github.com/CrystalPhe/TraceCam.git
cd TraceCam
git remote remove origin
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
```

If you already have the project folder, run the `git remote` commands from that folder instead. If Git reports that no commit exists, create one first:

```powershell
git add .
git commit -m "TraceCam first version"
```

Then push the project:

```powershell
git push -u origin master
```

A browser window may ask you to sign in to GitHub. You can also use VS Code's **Source Control** panel or **GitHub Desktop** (<https://desktop.github.com/>).

### Find your published URL

1. In your repository, click **Settings** -> **Pages**.
2. If you have not already done so, choose **Deploy from a branch**, select the project branch (usually `master`) and `/ (root)`, then click **Save**.
3. Wait 1-2 minutes and refresh the page. GitHub displays your URL:

   `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

For a fork named `TraceCam`, the URL is usually:

`https://YOUR-USERNAME.github.io/TraceCam/`

You may optionally enter a domain you own in the **Custom domain** field. Leave it empty if you do not own a domain; the GitHub Pages URL works without one.

## Use it on your iPhone

1. Open **Safari** (use Safari itself, not an in-app browser from another app) and go to your published GitHub Pages URL. You need internet for this first visit.
2. Tap **Start camera**. Safari asks to use the camera: tap **Allow**. (If you chose "Don't Allow", see [Troubleshooting](#troubleshooting).)
3. Tap **Image...** (or "Choose image"), pick a picture from your Photos library.
4. Drag with one finger, pinch to resize, twist two fingers to rotate. Adjust **Image opacity**.
5. Line the image up with your paper, then tap **Lock** (it turns amber). Draw. Tap **Hide controls** for a clean view; **Show controls** brings them back. Tap **Unlock** to adjust again.

**Install to the Home Screen:**

1. In Safari tap the **Share** button (square with up-arrow).
2. Scroll and tap **Add to Home Screen** (you may need to tap "View More").
3. Keep the name "TraceCam" and tap **Add**.
4. Launch it from the new Home Screen icon. It opens full-screen. The installed app asks for camera permission **separately** from Safari the first time you start the camera.

Offline: after one successful online load the app files are cached, so the installed app opens without internet. Camera permission and the very first install always need an online HTTPS visit.

## Updating the app

1. Edit files in VS Code.
2. **Increase `VERSION` in `service-worker.js`** (for example `v1.0.1`) so phones know there's a new version.
3. Upload:

```powershell
git add .
git commit -m "Describe your change"
git push
```

4. Wait ~1 minute for GitHub Pages to rebuild. On the iPhone, open TraceCam: a banner says **"A new version of TraceCam is ready. Update"**. Tap it and the app reloads on the new version.

Still seeing the old version? Fully close the app (swipe it away in the app switcher) and reopen it. As a last resort: Settings -> Apps -> Safari -> Advanced -> Website Data -> search `github.io` -> delete, or delete the Home Screen icon and add it again.

## Troubleshooting

| Problem | What to do |
|---|---|
| "Camera permission denied" | iPhone Settings -> Apps -> Safari -> Camera -> **Ask** or **Allow**. Or in Safari tap the "aA" button -> **Website Settings** -> Camera -> **Allow**. Then tap Try again. |
| Installed app asks again / is denied | Permission is per app. Allow it when the installed app asks; if you denied, delete the Home Screen icon, re-add it, and allow. |
| "HTTPS required" | You opened an `http://` address or a file. Use the `https://...github.io/...` URL. |
| "Camera is busy" | Close FaceTime, other camera apps and other Safari tabs that use the camera. |
| Black screen after switching apps | Tap Options -> Stop camera, then Start camera. |
| No "Add to Home Screen" | Use Safari (not Chrome or an in-app browser). It's under Share -> View More if not shown. |
| Page 404 on GitHub | Pages takes 1-2 min after saving; check Settings -> Pages shows the green "live" box and the URL ends with `/TraceCam/`. |
| HEIC photo won't open | Re-pick it from Photos (iOS normally converts to JPEG) or use a JPEG/PNG. |
| `npm` not recognized | Reinstall Node.js, then open a *new* PowerShell window. |
| PowerShell says scripts are disabled | Run `npm.cmd start` instead of `npm start`. |
| Screen goes dark while tracing | Keep screen awake is best-effort. Also set Settings -> Display & Brightness -> Auto-Lock -> Never while tracing; turn off Low Power Mode. |

Diagnostic messages (never including your images) are written to the browser console. On a Mac you could read them through Safari Web Inspector; without a Mac, the on-screen messages are your main diagnostics.

## Limitations (read this)

- **Not tested on a real iPhone by the author.** The code follows documented iOS Safari behavior; automated and desktop tests are listed in [tests/README.md](tests/README.md), and a manual iPhone checklist is there for you to complete. Please report what differs.
- **Lock freezes the image, not the phone.** A web page can't disable iOS system gestures (e.g., swipe up for the Home Screen, Control Center).
- **Keep Awake isn't guaranteed.** iOS may release the wake lock (Low Power Mode, low battery, backgrounding). Wake Lock needs a fairly recent iOS; if unsupported, the app says so and you can change Auto-Lock in Settings.
- **iOS suspends background pages.** The camera is released when you leave and restarted when you return; iOS might ask permission again.
- **HEIC:** Safari usually converts Photos picks to JPEG automatically. If a HEIC file can't be decoded you get a message instead of a crash. This isn't claimed to work for every HEIC file.
- **Large images** are reduced so the longest side is at most 2560 px to protect memory; this does not affect tracing.
- **Alignment isn't calibrated.** The image is overlaid on the live view; perspective and position still depend on how your phone and paper are placed. Use a stable stand and a straight-down angle.
- **Camera cropping:** the camera view fills the screen, so the very edges of the camera frame may be off-screen.
- **Home Screen apps and camera on iOS** have had version-specific quirks. If the installed app can't open the camera but Safari can, use TraceCam in Safari.
- **Icons:** iOS uses `icons/apple-touch-icon.png` (180x180, no transparency, iOS rounds the corners). Android-style PNGs and the SVG are also provided; the SVG alone isn't used by iOS for the Home Screen.

## Project layout

I put the JavaScript modules in `js/` (instead of the project root) to keep the root tidy; `service-worker.js` and `manifest.webmanifest` stay at the root so they cover the whole site.

```
TraceCam/
  index.html              app page + iOS PWA meta tags
  styles.css              dark mobile-first UI, safe-area insets
  manifest.webmanifest    PWA metadata
  service-worker.js       offline app-shell cache + safe updates
  .nojekyll               tells GitHub Pages to serve files as-is
  js/
    app.js                wires UI, camera, gestures, lock, prefs
    camera.js             camera manager + error mapping
    gestures.js           drag / pinch / twist (Pointer Events)
    transform.js          pure math (unit-tested)
    image-loader.js       local decode + large-image downscale
    wakelock.js           Screen Wake Lock wrapper
    prefs.js              small localStorage preferences
  icons/                  icon.svg + PNG icons (incl. 180x180 Apple touch icon)
  scripts/                serve.mjs (dev server), generate-icons.mjs
  tests/                  automated tests + README with the manual iPhone checklist
  package.json            npm start / npm test / npm run icons
```

Regenerate the PNG icons after editing the design: `npm run icons`.

## Privacy

No analytics, tracking, accounts, microphone access, or uploads. Selected images are decoded in memory on your device and discarded when you replace/remove them or close the app. Camera frames are never stored. The only data saved is a few settings in your browser's local storage.
