// Render the Redline SVG logos to PNG (and the macOS .icns) with Electron's own Chromium.
//   npx electron build/icon/render.cjs
// Outputs (all in build/):
//   icon/icon-1024.png        macOS-style app icon (white rounded square, shadow)
//   icon/icon-flat-1024.png   Windows / Linux icon (white rounded square, full bleed)
//   icon/logo-1024.png        logo mark, transparent, for light backgrounds
//   icon/logo-dark-1024.png   logo mark, transparent, for dark backgrounds
//   icon.icns                 macOS icon set built from icon-1024.png
//   ../app/assets/tray*.png   menu-bar / tray icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ICON = __dirname;
const BUILD = path.dirname(ICON);
const APP_ASSETS = path.join(BUILD, '..', 'app', 'assets');

// One offscreen window, resized per render; the SVG is drawn into a canvas at the exact pixel size.
let win;
async function render(svgFile, size, out) {
  const svg = fs.readFileSync(path.join(ICON, svgFile), 'utf8');
  if (!win) {
    win = new BrowserWindow({ width: 1100, height: 1100, show: false, webPreferences: { offscreen: true } });
    await win.loadURL('about:blank');
  }
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('svg failed to load'));
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
  })`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', path.relative(path.join(BUILD, '..'), out), size);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  await render('app-icon.svg', 1024, path.join(ICON, 'icon-1024.png'));
  await render('icon-flat.svg', 1024, path.join(ICON, 'icon-flat-1024.png'));
  await render('logo.svg', 1024, path.join(ICON, 'logo-1024.png'));
  await render('logo-dark.svg', 1024, path.join(ICON, 'logo-dark-1024.png'));
  // tray: macOS template images are black + alpha; @2x for retina
  await render('tray.svg', 18, path.join(APP_ASSETS, 'trayTemplate.png'));
  await render('tray.svg', 36, path.join(APP_ASSETS, 'trayTemplate@2x.png'));
  await render('icon-flat.svg', 32, path.join(APP_ASSETS, 'tray-color.png'));
  await render('icon-flat.svg', 64, path.join(APP_ASSETS, 'tray-color@2x.png'));
  await render('logo.svg', 256, path.join(APP_ASSETS, 'logo.png'));

  if (process.platform === 'darwin') {
    const set = path.join(BUILD, 'icon.iconset');
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set);
    for (const s of [16, 32, 128, 256, 512]) {
      await render('app-icon.svg', s, path.join(set, `icon_${s}x${s}.png`));
      await render('app-icon.svg', s * 2, path.join(set, `icon_${s}x${s}@2x.png`));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(BUILD, 'icon.icns')]);
    fs.rmSync(set, { recursive: true, force: true });
    console.log('wrote build/icon.icns');
  }
  app.quit();
});
