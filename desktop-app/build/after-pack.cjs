// electron-builder afterPack hook.
// Without an Apple Developer ID we still need a valid (ad-hoc) signature on macOS:
// Apple Silicon refuses to run unsigned code, and editing Info.plist breaks Electron's own signature.
// Runs before the DMG is created, so the signed .app is what ends up inside it.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const { productFilename, id } = ctx.packager.appInfo;
  const appPath = path.join(ctx.appOutDir, `${productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', id, appPath], { stdio: 'inherit' });
};
