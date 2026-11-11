// Local-only macOS build (`npm run mac:build` / `npm run mac:install`).
// Produces a Redline.app that is just a launcher: it loads app/main.js from THIS checkout,
// so code edits apply on the next app restart and the Screen Recording grant stays with "Redline".
// Not for distribution: it only works on the machine (and repo path) it was built on.
// Release builds use the "build" section of package.json instead.
const base = require('../package.json').build;

module.exports = {
  ...base,
  publish: null,
  directories: { ...base.directories, output: 'dist/local' },
  asar: false,
  files: ['package.json', 'build/mac-loader.cjs', '!node_modules/**'],
  extraMetadata: { main: 'build/mac-loader.cjs', redlineSrc: process.cwd() },
  mac: { ...base.mac, target: [{ target: 'dir', arch: [process.arch] }] },
};
