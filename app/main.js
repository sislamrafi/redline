// Electron tray app: press the hotkey → freeze-frame the screen under the cursor →
// mark it up → save an edit request that the MCP server serves to agents.
// A second hotkey opens the history: browse, re-open, edit, confirm or delete requests.
//
//   npm run app                    start (tray icon "✎", hotkeys registered)
//   npm run app -- --capture       ask the running instance to capture now (for Raycast/Alfred/etc.)
//   npm run app -- --history       ask the running instance to open the history
//   npm run app -- --selftest      headless render test with a demo screenshot, then quit

import { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, screen, Tray, Menu, nativeImage, shell, Notification, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureDirs, newId, requestDir, readRequest, writeRequest, listRequests, deleteRequest,
  updateStatus, deriveStatus, progress, REQUESTS_DIR,
} from '../shared/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOTKEY = process.env.REDLINE_HOTKEY || process.env.ANNOTATE_HOTKEY || 'Alt+Shift+M';
const HISTORY_HOTKEY = process.env.REDLINE_HISTORY_HOTKEY || process.env.ANNOTATE_HISTORY_HOTKEY || 'Alt+Shift+H';
const SELFTEST = process.argv.includes('--selftest');
const pretty = (k) => k.replace('Alt', '⌥').replace('Shift', '⇧').replace('CommandOrControl', '⌘').replaceAll('+', '');

let tray = null;
let overlay = null;
let busy = false;

app.setName('Redline');
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--capture')) startCapture();
  if (argv.includes('--history')) openHistory();
});

app.whenReady().then(async () => {
  ensureDirs();
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  if (SELFTEST) return runSelfTest();

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Redline');
  refreshTrayMenu();
  watchStore();

  for (const [key, fn] of [[HOTKEY, startCapture], [HISTORY_HOTKEY, openHistory]]) {
    const ok = globalShortcut.register(key, fn);
    console.log(ok ? `[redline] hotkey ${key} registered` : `[redline] could not register ${key} (in use?)`);
  }
  console.log(`[redline] requests saved under ${REQUESTS_DIR}`);
  if (process.platform === 'darwin') console.log(`[redline] screen recording permission: ${systemPreferences.getMediaAccessStatus('screen')}`);
  if (process.argv.includes('--capture')) startCapture();
  if (process.argv.includes('--history')) openHistory();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* stay alive in tray */ });

function refreshTrayMenu() {
  if (!tray) return;
  const all = listRequests();
  const active = all.filter((r) => ['open', 'in_progress', 'partial'].includes(r.status));
  const review = all.filter((r) => r.status === 'review');
  tray.setTitle(`✎${active.length ? ` ${active.length}` : ''}${review.length ? ` · ${review.length}?` : ''}`);
  const item = (r) => ({ label: `  ${(r.title || r.id).slice(0, 48)}  (${progress(r)})`, click: () => openHistory(r.id) });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Mark up screen\t${pretty(HOTKEY)}`, click: startCapture },
    { label: `History…\t${pretty(HISTORY_HOTKEY)}`, click: () => openHistory() },
    { type: 'separator' },
    { label: `${active.length} to do`, enabled: false },
    ...active.slice(0, 6).map(item),
    { label: `${review.length} waiting for your confirmation`, enabled: false },
    ...review.slice(0, 6).map(item),
    { type: 'separator' },
    { label: 'Open requests folder', click: () => shell.openPath(REQUESTS_DIR) },
    { label: 'Quit', role: 'quit' },
  ]));
}

// Agents update request.json through the MCP server (another process): reflect that live.
function watchStore() {
  let t = null;
  try {
    fs.watch(REQUESTS_DIR, { recursive: true }, (_ev, file) => {
      if (file && !file.endsWith('request.json')) return;
      clearTimeout(t);
      t = setTimeout(() => {
        refreshTrayMenu();
        overlay?.webContents.send('history:changed');
      }, 250);
    });
  } catch (err) { console.warn('[redline] cannot watch store', err.message); }
}

// ---------- context about what's on screen (best effort, never blocks capture) ----------

function osa(script, timeout = 1500) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

function frontAppViaLsappinfo() {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', 'lsappinfo info -only name "$(lsappinfo front)"'], { timeout: 1500 }, (err, out) => {
      const m = !err && out.match(/="(.+)"/);
      resolve(m ? m[1] : null);
    });
  });
}

async function frontmostContext() {
  if (process.platform !== 'darwin') return {};
  const appName = await osa('tell application "System Events" to get name of first application process whose frontmost is true')
    || await frontAppViaLsappinfo(); // needs no Automation permission
  const windowTitle = appName
    ? await osa(`tell application "System Events" to tell process "${appName}" to get name of front window`)
    : null;
  let url = null;
  const chromium = ['Google Chrome', 'Brave Browser', 'Microsoft Edge', 'Arc', 'Chromium', 'Vivaldi'];
  if (chromium.includes(appName)) url = await osa(`tell application "${appName}" to get URL of active tab of front window`);
  else if (appName === 'Safari') url = await osa('tell application "Safari" to get URL of front document');
  return { app: appName, windowTitle, url };
}

// ---------- capture + overlay ----------

async function startCapture() {
  if (busy) return;
  busy = true;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [context, png] = await Promise.all([frontmostContext(), captureDisplay(display)]);
    openOverlay(display, {
      mode: 'new',
      screenshot: `data:image/png;base64,${png.toString('base64')}`,
      context: { ...context, scaleFactor: display.scaleFactor, displayBounds: display.bounds },
    });
  } catch (err) {
    busy = false;
    console.error('[redline] capture failed', err.message || err);
    if (err.message === 'PERMISSION') explainPermission();
    else new Notification({ title: 'Redline: capture failed', body: String(err.message || err) }).show();
  }
}

function openHistory(id) {
  if (overlay) { // already open: just switch to it
    overlay.webContents.send('history:open', { id });
    overlay.focus();
    return;
  }
  if (busy) return;
  busy = true;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  openOverlay(display, { mode: 'history', loadId: id || listRequests()[0]?.id || null, context: { scaleFactor: display.scaleFactor } });
}

async function captureDisplay(display) {
  // 1) Electron's capturer (fast, exact display match).
  try {
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (src && !src.thumbnail.isEmpty()) return src.thumbnail.toPNG();
  } catch (err) {
    console.warn('[redline] desktopCapturer failed, trying screencapture:', err.message);
  }
  // 2) macOS `screencapture` CLI (works when the launching app has the permission).
  if (process.platform === 'darwin') {
    const file = path.join(app.getPath('temp'), `redline-${Date.now()}.png`);
    const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id) + 1;
    const ok = await new Promise((resolve) =>
      execFile('screencapture', ['-x', '-t', 'png', ...(idx > 0 ? ['-D', String(idx)] : []), file], { timeout: 8000 }, (err) => resolve(!err)));
    if (ok && fs.existsSync(file) && fs.statSync(file).size > 0) {
      const buf = fs.readFileSync(file);
      fs.rmSync(file, { force: true });
      return buf;
    }
  }
  throw new Error('PERMISSION');
}

function explainPermission() {
  const status = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'n/a';
  console.error(`[redline] screen recording permission status: ${status}`);
  new Notification({
    title: 'Redline needs Screen Recording permission',
    body: 'Turn on "Electron" in Privacy & Security → Screen & System Audio Recording, then quit & restart the app.',
  }).show();
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
}

function openOverlay(display, init) {
  const { x, y, width, height } = display.bounds;
  overlay = new BrowserWindow({
    x, y, width, height,
    frame: false, transparent: false, backgroundColor: '#000000',
    resizable: false, movable: false, fullscreenable: false, hasShadow: false,
    enableLargerThanScreen: true, skipTaskbar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: !init.selftest },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'editor.html'));
  overlay.webContents.once('did-finish-load', () => {
    overlay.webContents.send('init', init);
    if (init.selftest) return;
    overlay.show();
    overlay.focus();
    app.focus({ steal: true });
  });
  overlay.on('closed', () => { overlay = null; busy = false; });
}

// ---------- save / update ----------

const dataUrlToBuf = (d) => Buffer.from(d.split(',')[1], 'base64');
const toDataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

function writeImages(dir, payload) {
  const annotated = dataUrlToBuf(payload.annotated);
  fs.writeFileSync(path.join(dir, 'annotated.png'), annotated);
  // Downscaled preview: VL models resize big images anyway; this keeps payloads small.
  const img = nativeImage.createFromBuffer(annotated);
  const { width } = img.getSize();
  fs.writeFileSync(path.join(dir, 'preview.png'), (width > 1600 ? img.resize({ width: 1600, quality: 'best' }) : img).toPNG());
  fs.writeFileSync(path.join(dir, 'thumb.png'), img.resize({ width: 360, quality: 'good' }).toPNG());
  fs.rmSync(path.join(dir, 'crops'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'crops'), { recursive: true });
  for (const m of payload.marks) {
    if (m.cropDataUrl) fs.writeFileSync(path.join(dir, 'crops', `mark-${m.n}.png`), dataUrlToBuf(m.cropDataUrl));
    delete m.cropDataUrl;
  }
}

function saveRequest(payload) {
  const existing = payload.id ? readRequest(payload.id) : null;
  const id = existing ? existing.id : newId();
  const dir = requestDir(id);
  fs.mkdirSync(dir, { recursive: true });
  if (!existing) fs.writeFileSync(path.join(dir, 'screenshot.png'), dataUrlToBuf(payload.screenshot));
  writeImages(dir, payload);

  const now = new Date().toISOString();
  const firstLine = (payload.note || payload.marks.find((m) => m.comment)?.comment || '').split('\n')[0].trim();
  for (const m of payload.marks) m.status ||= 'open';
  const req = {
    ...(existing || {}),
    id,
    createdAt: existing?.createdAt || now,
    title: firstLine.slice(0, 80) || `${payload.marks.length} mark(s)`,
    note: payload.note || '',
    context: existing?.context || payload.context || {},
    image: payload.image,
    marks: payload.marks,
    files: {
      screenshot: 'screenshot.png', annotated: 'annotated.png', preview: 'preview.png',
      crops: payload.marks.filter((m) => m.crop).map((m) => `crops/mark-${m.n}.png`),
    },
  };
  req.status = deriveStatus(req.marks);
  (req.history ||= []).push({ at: now, by: 'user', status: req.status, note: existing ? 'edited in app' : 'created' });
  writeRequest(req);
  return req;
}

ipcMain.handle('save', (_e, payload) => {
  const isUpdate = !!payload.id;
  const req = saveRequest(payload);
  refreshTrayMenu();
  if (!SELFTEST && !isUpdate) {
    overlay?.close();
    new Notification({ title: 'Edit request saved', body: `${req.marks.length} mark(s) · ask Claude to "apply my latest Redline"` }).show();
  }
  console.log(`[redline] ${isUpdate ? 'updated' : 'saved'} ${req.id} → ${requestDir(req.id)}`);
  return { id: req.id, request: req };
});
ipcMain.on('cancel', () => overlay?.close());

// ---------- history ----------

ipcMain.handle('history:list', () => listRequests().map((r) => {
  const thumb = path.join(requestDir(r.id), 'thumb.png');
  const preview = path.join(requestDir(r.id), 'preview.png');
  if (!fs.existsSync(thumb) && fs.existsSync(preview)) {
    fs.writeFileSync(thumb, nativeImage.createFromPath(preview).resize({ width: 360, quality: 'good' }).toPNG());
  }
  return {
    id: r.id, title: r.title, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    app: r.context?.app, url: r.context?.url, progress: progress(r),
    marks: r.marks.map((m) => ({ n: m.n, status: m.status, color: m.color })),
    thumb: fs.existsSync(thumb) ? toDataUrl(thumb) : null,
  };
}));

ipcMain.handle('history:load', (_e, id) => {
  const request = readRequest(id);
  if (!request) throw new Error(`No request ${id}`);
  return { request, screenshot: toDataUrl(path.join(requestDir(id), 'screenshot.png')) };
});

ipcMain.handle('history:delete', (_e, id) => {
  deleteRequest(id);
  refreshTrayMenu();
  return true;
});

ipcMain.handle('history:status', (_e, { id, marks, status, note }) => {
  const r = updateStatus(id, { marks: marks || [], status, note, by: 'user' });
  refreshTrayMenu();
  return r;
});

// ---------- self test: render a demo screenshot with programmatic marks ----------

async function runSelfTest() {
  const svg = fs.readFileSync(path.join(__dirname, 'renderer', 'demo-bg.svg'), 'utf8');
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 } };
  openOverlay(display, {
    mode: 'new',
    screenshot: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    context: { app: 'Demo Browser', windowTitle: 'Acme Dashboard', url: 'http://localhost:3000/dashboard', scaleFactor: 1 },
    selftest: true,
  });
  ipcMain.handleOnce('selftest-done', () => setTimeout(() => app.quit(), 200));
}
