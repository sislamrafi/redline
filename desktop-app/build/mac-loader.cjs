// Entry point of the packaged Redline.app (macOS).
//
// The .app bundle gives Redline its own identity (bundle id com.redline.app), so macOS
// grants Screen Recording to "Redline" instead of to Terminal / Claude / VS Code.
// It does NOT contain the app code: it loads app/main.js from your source checkout,
// so edits to the repo take effect on the next app restart without rebuilding.
//
// Source folder: $REDLINE_SRC if set, otherwise the path baked in at build time
// (package.json "redlineSrc", written by `npm run mac:build`).
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, dialog } = require('electron');

const baked = require(path.join(__dirname, '..', 'package.json')).redlineSrc;
const src = process.env.REDLINE_SRC || baked;
const entry = src && path.join(src, 'app', 'main.js');

if (!entry || !fs.existsSync(entry)) {
  app.whenReady().then(() => {
    dialog.showErrorBox('Redline', `Can't find the Redline source at:\n${entry || '(not set)'}\n\n` +
      'Rebuild with `npm run mac:build` from the repo, or set REDLINE_SRC.');
    app.quit();
  });
} else {
  import(pathToFileURL(entry).href).catch((err) => {
    app.whenReady().then(() => {
      dialog.showErrorBox('Redline failed to start', String(err && err.stack || err));
      app.quit();
    });
  });
}
