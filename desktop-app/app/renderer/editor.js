// Markup editor + history browser. All mark geometry is stored in *screenshot pixel*
// coordinates, so the exported image, crops and JSON coordinates all agree exactly.

const PALETTE = [
  ['red', '#FF3B30'], ['blue', '#0A84FF'], ['green', '#30D158'], ['orange', '#FF9F0A'],
  ['purple', '#BF5AF2'], ['pink', '#FF2D92'], ['teal', '#40C8E0'], ['yellow', '#FFD60A'],
];
const STATUS = {
  open: { label: 'Open', color: '#8e8e93', icon: '' },
  in_progress: { label: 'In progress', color: '#0a84ff', icon: '…' },
  partial: { label: 'Partially done', color: '#ff9f0a', icon: '½' },
  review: { label: 'Waiting for confirmation', color: '#ffd60a', icon: '?' },
  done: { label: 'Done', color: '#30d158', icon: '✓' },
  wontfix: { label: "Won't fix", color: '#8e8e93', icon: '✕' },
};
const FINISHED = ['review', 'done', 'wontfix'];
const ACTIVE = ['open', 'in_progress', 'partial'];

const $ = (s) => document.querySelector(s);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const popover = $('#popover');
const textarea = popover.querySelector('textarea');
const api = window.annotator || makeDemoApi();

const state = {
  img: null, W: 0, H: 0, k: 1,           // k = stroke scale (≈ display scale factor)
  mode: 'new', reqId: null, request: null, context: {},
  tool: 'rect', marks: [], draft: null, editing: null, drag: null,
  dirty: false, undo: [], filter: 'active', list: [],
};
let uidSeq = 1;
const uid = () => `m${Date.now().toString(36)}${uidSeq++}`;

// ---------- boot ----------

api.onInit(boot);
api.onHistoryOpen?.(({ id }) => { openDrawer(); if (id) openRequest(id); });
api.onHistoryChanged?.(async () => {
  await refreshList();
  if (state.reqId && !state.dirty && !state.editing && !state.drag) openRequest(state.reqId, { keepUi: true });
});

async function boot(init) {
  state.context = init.context || {};
  restoreToolbarPos();
  if (init.mode === 'history') {
    document.body.classList.add('mode-history');
    state.mode = 'history';
    openDrawer();
    if (init.loadId) await openRequest(init.loadId);
    else showEmpty();
  } else {
    await setImage(init.screenshot);
    if (init.selftest) runSelfTest();
  }
  updateChrome();
  refreshList();
}

function setImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      state.img = img;
      state.W = img.naturalWidth; state.H = img.naturalHeight;
      state.k = Math.max(1, state.W / window.innerWidth);
      canvas.width = state.W; canvas.height = state.H;
      $('#empty').hidden = true;
      render();
      resolve();
    };
    img.onerror = reject;
    img.src = src;
  });
}

function showEmpty() {
  state.img = null; state.marks = []; state.reqId = null; state.request = null;
  canvas.width = 1; canvas.height = 1;
  $('#empty').hidden = false;
  updateChrome();
}

// ---------- geometry ----------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function bboxOf(m) {
  const k = state.k;
  if (m.type === 'pin') { const p = m.points[0], r = 14 * k; return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r }; }
  const xs = m.points.map((p) => p.x), ys = m.points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function centerOf(m) {
  if (m.type === 'pin') return { ...m.points[0] };
  if (m.type === 'arrow') return { ...m.points[1] }; // the target is the arrow head
  const b = bboxOf(m); return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
function badgePos(m) {
  const k = state.k, r = 13 * k;
  if (m.type === 'arrow') return { x: m.points[0].x, y: m.points[0].y };  // badge on the tail
  if (m.type === 'pin') return { x: m.points[0].x, y: m.points[0].y - 36 * k };
  const b = bboxOf(m);
  return { x: clamp(b.x, r, state.W - r), y: clamp(b.y, r, state.H - r) };
}
// Draggable handles of the selected mark (resize a box, move an arrow's ends).
function handlesOf(m) {
  if (m.type === 'rect') {
    const [a, b] = m.points;
    return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
  }
  if (m.type === 'arrow') return m.points.map((p) => ({ ...p }));
  return [];
}
function setHandle(m, i, p) {
  if (m.type === 'arrow') { m.points[i] = p; return; }
  const [a, b] = m.points;
  if (i === 0) { a.x = p.x; a.y = p.y; }
  if (i === 1) { b.x = p.x; a.y = p.y; }
  if (i === 2) { b.x = p.x; b.y = p.y; }
  if (i === 3) { a.x = p.x; b.y = p.y; }
}
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function toImage(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (state.W / r.width), y: (e.clientY - r.top) * (state.H / r.height) };
}
function toScreen(p) {
  const r = canvas.getBoundingClientRect();
  return { x: r.left + p.x * (r.width / state.W), y: r.top + p.y * (r.height / state.H) };
}
const screenPx = () => state.W / canvas.getBoundingClientRect().width; // image px per CSS px

// ---------- hit testing ----------

function hitHandle(m, p) {
  const r = 10 * screenPx();
  return handlesOf(m).findIndex((h) => Math.hypot(h.x - p.x, h.y - p.y) <= r);
}
function hitBadge(p) {
  const r = 16 * state.k;
  for (let i = state.marks.length - 1; i >= 0; i--) {
    const b = badgePos(state.marks[i]);
    if (Math.hypot(b.x - p.x, b.y - p.y) <= r) return state.marks[i];
  }
  return null;
}
function hitBody(p) {
  const tol = 8 * screenPx();
  for (let i = state.marks.length - 1; i >= 0; i--) {
    const m = state.marks[i];
    if (m.type === 'pin' && Math.hypot(m.points[0].x - p.x, m.points[0].y - p.y) <= 16 * state.k) return m;
    if (m.type === 'arrow' && distToSeg(p, m.points[0], m.points[1]) <= tol) return m;
    if (m.type === 'pen' && m.points.some((q, j) => j && distToSeg(p, m.points[j - 1], q) <= tol)) return m;
    if (m.type === 'rect') {
      // Only the border grabs, so you can still draw a smaller box inside a big one.
      const b = bboxOf(m);
      const inOuter = p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
      const inInner = p.x > b.x + tol && p.x < b.x + b.w - tol && p.y > b.y + tol && p.y < b.y + b.h - tol;
      if (inOuter && !inInner) return m;
    }
  }
  return null;
}

// ---------- drawing (shared by live view, export and crops) ----------

function drawScene(c, { marks = state.marks, labels = true, draft = state.draft, selected = null } = {}) {
  c.drawImage(state.img, 0, 0, state.W, state.H);
  for (const m of marks) drawMark(c, m);
  if (draft) drawMark(c, draft);
  for (const m of marks) drawBadge(c, m);
  if (labels) for (const m of marks) drawLabel(c, m);
  if (selected) drawHandles(c, selected);
}

const isFinished = (m) => FINISHED.includes(m.status);

function drawMark(c, m) {
  const k = state.k;
  c.save();
  if (isFinished(m)) c.globalAlpha = 0.45;
  c.strokeStyle = m.color; c.fillStyle = m.color;
  c.lineWidth = 3 * k; c.lineCap = 'round'; c.lineJoin = 'round';
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 4 * k;
  if (isFinished(m)) c.setLineDash([8 * k, 6 * k]);
  if (m.type === 'rect') {
    const b = bboxOf(m);
    const a = c.globalAlpha; c.globalAlpha = a * 0.10; c.fillRect(b.x, b.y, b.w, b.h); c.globalAlpha = a;
    c.strokeRect(b.x, b.y, b.w, b.h);
  } else if (m.type === 'arrow') {
    const [a, b] = m.points;
    const ang = Math.atan2(b.y - a.y, b.x - a.x), hl = 16 * k;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x - Math.cos(ang) * hl * 0.6, b.y - Math.sin(ang) * hl * 0.6); c.stroke();
    c.setLineDash([]);
    c.beginPath(); c.moveTo(b.x, b.y);
    c.lineTo(b.x - hl * Math.cos(ang - 0.45), b.y - hl * Math.sin(ang - 0.45));
    c.lineTo(b.x - hl * Math.cos(ang + 0.45), b.y - hl * Math.sin(ang + 0.45));
    c.closePath(); c.fill();
  } else if (m.type === 'pen') {
    c.beginPath(); m.points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.stroke();
  } else if (m.type === 'pin') {
    c.setLineDash([]);
    const p = m.points[0];
    c.beginPath(); c.arc(p.x, p.y, 7 * k, 0, Math.PI * 2); c.fill();
    c.lineWidth = 2 * k; c.strokeStyle = '#fff'; c.stroke();
    c.beginPath(); c.arc(p.x, p.y, 14 * k, 0, Math.PI * 2); c.strokeStyle = m.color; c.lineWidth = 2 * k; c.stroke();
  }
  c.restore();
}

function drawBadge(c, m) {
  const k = state.k, p = badgePos(m), r = 13 * k;
  c.save();
  if (isFinished(m)) c.globalAlpha = 0.6;
  c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 4 * k;
  c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fillStyle = m.color; c.fill();
  c.shadowBlur = 0; c.lineWidth = 2 * k; c.strokeStyle = '#fff'; c.stroke();
  c.fillStyle = '#fff'; c.font = `700 ${14 * k}px -apple-system, Helvetica, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(m.n), p.x, p.y + 0.5 * k);
  // Status chip on the badge's lower-right: ✓ done, ? waiting for confirmation, ½ partial…
  const st = STATUS[m.status];
  if (st && st.icon) {
    c.globalAlpha = 1;
    const cx = p.x + r * 0.85, cy = p.y + r * 0.85, cr = 8 * k;
    c.beginPath(); c.arc(cx, cy, cr, 0, Math.PI * 2); c.fillStyle = st.color; c.fill();
    c.lineWidth = 1.5 * k; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = m.status === 'review' ? '#111' : '#fff'; c.font = `800 ${10 * k}px -apple-system, Helvetica, sans-serif`;
    c.fillText(st.icon, cx, cy + 0.5 * k);
  }
  c.restore();
}

// Comment callout next to the badge, so the instruction is *in* the image.
function drawLabel(c, m) {
  const text = (m.comment || '').trim();
  if (!text) return;
  const k = state.k, p = badgePos(m), r = 13 * k, pad = 6 * k, fs = 13 * k, lh = 17 * k;
  c.save();
  if (isFinished(m)) c.globalAlpha = 0.55;
  c.font = `600 ${fs}px -apple-system, Helvetica, sans-serif`;
  const lines = wrap(c, text, 280 * k).slice(0, 4);
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + pad * 2;
  const h = lines.length * lh + pad * 2 - (lh - fs);
  // Keep the callout outside the marked region so it never hides what's being pointed at.
  let x = p.x + r + 4 * k, y;
  if (m.type === 'rect' || m.type === 'pen') {
    const b = bboxOf(m), gap = 6 * k;
    y = b.y - h - gap >= 2 * k ? b.y - h - gap : b.y + b.h + gap;
  } else {
    y = p.y - h / 2;
  }
  if (x + w > state.W) x = p.x - r - 4 * k - w;
  x = clamp(x, 2 * k, state.W - w - 2 * k);
  y = clamp(y, 2 * k, state.H - h - 2 * k);
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 6 * k;
  c.fillStyle = m.color; c.beginPath(); c.roundRect(x, y, w, h, 6 * k); c.fill();
  c.shadowBlur = 0;
  c.fillStyle = isLight(m.color) ? '#111' : '#fff'; c.textBaseline = 'top';
  lines.forEach((l, i) => c.fillText(l, x + pad, y + pad + i * lh));
  c.restore();
}

function drawHandles(c, m) {
  const s = screenPx();
  c.save();
  c.setLineDash([4 * s, 3 * s]); c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 1 * s;
  const b = bboxOf(m), pad = 6 * s;
  c.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
  c.setLineDash([]);
  for (const h of handlesOf(m)) {
    c.fillStyle = '#fff'; c.strokeStyle = m.color; c.lineWidth = 2 * s;
    c.beginPath(); c.rect(h.x - 5 * s, h.y - 5 * s, 10 * s, 10 * s); c.fill(); c.stroke();
  }
  c.restore();
}

function wrap(c, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (c.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const isLight = (hex) => ['#FFD60A', '#40C8E0', '#30D158', '#FF9F0A'].includes(hex);

let raf = 0;
function render() {
  if (!state.img) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => drawScene(ctx, { selected: state.editing || state.drag?.mark }));
}

// ---------- chrome (toolbar state) ----------

function deriveStatus(marks) {
  const s = marks.map((m) => m.status || 'open');
  if (!s.length) return 'open';
  const all = (...xs) => s.every((x) => xs.includes(x));
  const any = (...xs) => s.some((x) => xs.includes(x));
  if (all('done', 'wontfix')) return 'done';
  if (all('review', 'done', 'wontfix')) return 'review';
  if (any('review', 'done', 'partial', 'wontfix')) return 'partial';
  if (any('in_progress')) return 'in_progress';
  return 'open';
}

function updateChrome() {
  const existing = !!state.reqId;
  const saveBtn = $('#save');
  saveBtn.firstChild.textContent = existing ? 'Update ' : 'Save ';
  saveBtn.querySelector('.count').textContent = state.marks.length;
  saveBtn.disabled = existing ? !state.dirty : !state.img;
  $('#cancel').textContent = state.mode === 'history' || existing ? 'Close' : 'Cancel';
  $('#delete-req').hidden = !existing;
  const pill = $('#req-status');
  pill.hidden = !existing;
  if (existing) {
    const st = deriveStatus(state.marks);
    pill.className = `pill st-${st}`;
    const fin = state.marks.filter(isFinished).length;
    pill.textContent = `${STATUS[st].label} · ${fin}/${state.marks.length}`;
  }
  $('#confirm-all').hidden = !state.marks.some((m) => m.status === 'review');
}

function setDirty() { state.dirty = true; updateChrome(); }

// ---------- toolbar: drag + remembered position ----------

const POS_KEY = 'redline.toolbarPos';
function placeToolbar(x, y) {
  const tb = $('#toolbar'), r = tb.getBoundingClientRect();
  x = clamp(x, 4, window.innerWidth - r.width - 4);
  y = clamp(y, 4, window.innerHeight - r.height - 4);
  tb.classList.add('placed');
  tb.style.left = `${x}px`; tb.style.top = `${y}px`;
  return { x, y };
}
function restoreToolbarPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    // Stored as fractions of the screen, so it lands in the same place on any display size.
    if (p) placeToolbar(p.fx * window.innerWidth, p.fy * window.innerHeight);
  } catch { /* storage unavailable: keep default */ }
}
$('#grip').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const tb = $('#toolbar'), r = tb.getBoundingClientRect();
  const off = { x: e.clientX - r.left, y: e.clientY - r.top };
  document.body.classList.add('dragging-toolbar');
  const move = (ev) => placeToolbar(ev.clientX - off.x, ev.clientY - off.y);
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('dragging-toolbar');
    const p = placeToolbar(ev.clientX - off.x, ev.clientY - off.y);
    try { localStorage.setItem(POS_KEY, JSON.stringify({ fx: p.x / window.innerWidth, fy: p.y / window.innerHeight })); } catch {}
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});
$('#grip').addEventListener('dblclick', () => {
  const tb = $('#toolbar');
  tb.classList.remove('placed'); tb.style.left = ''; tb.style.top = '';
  try { localStorage.removeItem(POS_KEY); } catch {}
});

// ---------- interaction: draw / select / move ----------

function nextColor() { return PALETTE[state.marks.length % PALETTE.length]; }
function snapshot() {
  state.undo.push(JSON.stringify(state.marks));
  if (state.undo.length > 50) state.undo.shift();
}

function setTool(t) {
  state.tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state.img) return;
  e.preventDefault(); // don't let the canvas click move focus away from the comment box
  const p = toImage(e);
  const sel = state.editing;
  const hIdx = sel ? hitHandle(sel, p) : -1;
  commitPopover();
  if (hIdx >= 0) {
    state.drag = { kind: 'handle', mark: sel, idx: hIdx, start: p, moved: false };
  } else {
    const m = hitBadge(p) || hitBody(p);
    if (m) state.drag = { kind: 'move', mark: m, start: p, orig: m.points.map((q) => ({ ...q })), moved: false };
  }
  if (state.drag) { canvas.setPointerCapture(e.pointerId); render(); return; }

  const [colorName, color] = nextColor();
  state.draft = { uid: uid(), n: state.marks.length + 1, type: state.tool, color, colorName, points: [p, { ...p }], comment: '', status: 'open' };
  if (state.tool === 'pin' || state.tool === 'pen') state.draft.points = [p];
  canvas.setPointerCapture(e.pointerId);
  render();
});

canvas.addEventListener('pointermove', (e) => {
  const p = toImage(e);
  const d = state.drag;
  if (d) {
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 3 * screenPx()) return;
    if (!d.moved) { d.moved = true; snapshot(); }
    if (d.kind === 'handle') setHandle(d.mark, d.idx, p);
    else d.mark.points = d.orig.map((q) => ({ x: q.x + p.x - d.start.x, y: q.y + p.y - d.start.y }));
    render();
    return;
  }
  const dr = state.draft;
  if (!dr) {
    const sel = state.editing;
    canvas.style.cursor = (sel && hitHandle(sel, p) >= 0) ? 'nwse-resize' : (hitBadge(p) || hitBody(p)) ? 'move' : 'crosshair';
    return;
  }
  if (dr.type === 'pen') dr.points.push(p);
  else if (dr.type === 'pin') dr.points[0] = p;
  else dr.points[1] = p;
  render();
});

window.addEventListener('pointerup', finishPointer);
window.addEventListener('pointercancel', finishPointer);
function finishPointer() {
  const drag = state.drag;
  if (drag) {
    state.drag = null;
    if (drag.moved) { touched(drag.mark); }
    openPopover(drag.mark);
    return;
  }
  const d = state.draft;
  if (!d) return;
  state.draft = null;
  const b = bboxOf(d);
  if (d.type !== 'pin' && Math.max(b.w, b.h) < 6 * state.k) { d.type = 'pin'; d.points = [d.points[0]]; } // a click = "here"
  if (d.type === 'rect') { // normalise so points[0] is top-left
    const [a, c] = d.points;
    d.points = [{ x: Math.min(a.x, c.x), y: Math.min(a.y, c.y) }, { x: Math.max(a.x, c.x), y: Math.max(a.y, c.y) }];
  }
  snapshot();
  state.marks.push(d);
  setDirty();
  render();
  openPopover(d);
}

// A mark the user changed after an agent worked on it becomes a fresh instruction.
function touched(m) {
  if (m.status !== 'open') { m.status = 'open'; m.reopened = true; }
  if (m.type === 'rect') {
    const [a, c] = m.points;
    m.points = [{ x: Math.min(a.x, c.x), y: Math.min(a.y, c.y) }, { x: Math.max(a.x, c.x), y: Math.max(a.y, c.y) }];
  }
  setDirty();
}

// ---------- popover ----------

function openPopover(m) {
  state.editing = m;
  const b = bboxOf(m);
  const anchor = toScreen({ x: b.x + b.w, y: b.y });
  const pw = 320, ph = 200;
  let x = anchor.x + 14, y = anchor.y;
  if (x + pw > window.innerWidth - 8) x = toScreen({ x: b.x, y: 0 }).x - pw - 14;
  x = clamp(x, 8, window.innerWidth - pw - 8);
  y = clamp(y, 64, window.innerHeight - ph - 8);
  popover.style.left = `${x}px`; popover.style.top = `${y}px`;
  const badge = popover.querySelector('.badge');
  badge.textContent = m.n; badge.style.background = m.color;
  popover.querySelector('.pop-title').textContent = `${m.colorName} ${m.type}`;
  $('#mark-status').value = m.status || 'open';
  const note = $('#agent-note');
  note.hidden = !m.agentNote;
  if (m.agentNote) note.innerHTML = `<b>Agent:</b> ${escapeHtml(m.agentNote)}`;
  $('#review-actions').hidden = m.status !== 'review';
  textarea.value = m.comment || '';
  textarea.dataset.orig = m.comment || '';
  popover.hidden = false;
  textarea.focus();
  render();
}

function commitPopover() {
  const m = state.editing;
  if (!m) return;
  const val = textarea.value.trim();
  if (val !== (textarea.dataset.orig || '').trim()) { m.comment = val; touched(m); }
  state.editing = null;
  popover.hidden = true;
  textarea.blur();
  render();
}

async function setMarkStatus(m, status) {
  snapshot();
  m.status = status;
  if (status !== 'open') m.reopened = false;
  $('#review-actions').hidden = status !== 'review';
  $('#mark-status').value = status;
  render();
  if (state.reqId) await persist({ quiet: true }); // statuses save immediately for saved requests
  else setDirty();
}

function deleteMark(m) {
  snapshot();
  state.marks = state.marks.filter((x) => x !== m);
  state.marks.forEach((x, i) => { x.n = i + 1; [x.colorName, x.color] = PALETTE[i % PALETTE.length]; });
  state.editing = null; popover.hidden = true;
  setDirty();
  render();
}

textarea.addEventListener('input', () => { if (state.editing) { state.editing.comment = textarea.value; render(); } });
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); commitPopover(); }
});
popover.querySelector('.del').addEventListener('click', () => state.editing && deleteMark(state.editing));
$('#mark-status').addEventListener('change', (e) => state.editing && setMarkStatus(state.editing, e.target.value));
$('#review-actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act, m = state.editing;
  if (!act || !m) return;
  if (act === 'confirm') { setMarkStatus(m, 'done'); toast(`#${m.n} confirmed`); }
  if (act === 'reopen') { setMarkStatus(m, 'open'); m.reopened = true; textarea.focus(); toast(`#${m.n} reopened — add what's still wrong`, '#ff9f0a'); }
});

$('#confirm-all').addEventListener('click', async () => {
  snapshot();
  const n = state.marks.filter((m) => m.status === 'review').length;
  state.marks.forEach((m) => { if (m.status === 'review') m.status = 'done'; });
  render();
  if (state.reqId) await persist({ quiet: true }); else setDirty();
  toast(`${n} item${n === 1 ? '' : 's'} confirmed`);
});

$('#undo').addEventListener('click', undo);
$('#cancel').addEventListener('click', cancel);
$('#save').addEventListener('click', () => persist());
$('#history-btn').addEventListener('click', toggleDrawer);
$('#drawer-close').addEventListener('click', toggleDrawer);
$('#delete-req').addEventListener('click', deleteCurrent);

function undo() {
  const prev = state.undo.pop();
  if (!prev) return;
  state.marks = JSON.parse(prev);
  state.editing = null; popover.hidden = true;
  setDirty(); render();
}

async function cancel() {
  if (state.dirty && state.marks.length && !(await confirmBox(state.reqId ? 'Discard your unsaved changes?' : 'Discard this markup?', 'Discard'))) return;
  api.cancel();
}

// ⌘ on macOS, Ctrl on Windows/Linux.
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
const isMod = (e) => (IS_MAC ? e.metaKey : e.ctrlKey);

window.addEventListener('keydown', (e) => {
  if (!$('#modal').hidden) return;
  const typing = e.target === textarea || e.target.id === 'note';
  if (e.key === 'Escape') {
    if (state.editing) { commitPopover(); return; }
    if (e.target.id === 'note') { e.target.blur(); return; }
    return cancel();
  }
  if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); commitPopover(); return persist(); }
  if (isMod(e) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); return undo(); }
  if (isMod(e) && e.key === 'Backspace' && state.editing) { e.preventDefault(); return deleteMark(state.editing); }
  if (typing || e.metaKey || e.ctrlKey) return;
  const map = { r: 'rect', a: 'arrow', p: 'pen', i: 'pin' };
  const key = e.key.toLowerCase();
  if (map[key]) setTool(map[key]);
  if (key === 'n') { e.preventDefault(); $('#note').focus(); }
  if (key === 'h') { e.preventDefault(); toggleDrawer(); }
});
$('#note').addEventListener('input', setDirty);

// ---------- export ----------

function exportCanvas(drawFn, w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(h);
  drawFn(c.getContext('2d'));
  return c.toDataURL('image/png');
}

function buildPayload() {
  const { W, H, k } = state;
  const round = (o) => Object.fromEntries(Object.entries(o).map(([a, v]) => [a, Math.round(v)]));
  const norm = (o) => ({ x: +(o.x / W).toFixed(4), y: +(o.y / H).toFixed(4), w: +(o.w / W).toFixed(4), h: +(o.h / H).toFixed(4) });
  const marks = state.marks.map((m) => {
    if (m.type === 'pen' && m.points.length > 300) m.points = m.points.filter((_, i) => i % 2 === 0);
    const bbox = bboxOf(m);
    // Crop: the mark plus generous surrounding context so the model can see what it's in.
    const pad = Math.max(120 * k, Math.max(bbox.w, bbox.h) * 0.6);
    const cx = clamp(bbox.x - pad, 0, W), cy = clamp(bbox.y - pad, 0, H);
    const crop = { x: cx, y: cy, w: clamp(bbox.x + bbox.w + pad, 0, W) - cx, h: clamp(bbox.y + bbox.h + pad, 0, H) - cy };
    const cropDataUrl = exportCanvas((c) => {
      c.translate(-crop.x, -crop.y);
      drawScene(c, { marks: [m], labels: false, draft: null });
    }, crop.w, crop.h);
    const { uid: id = uid(), n, type, color, colorName, status = 'open', agentNote, log, reopened } = m;
    return {
      uid: id, n, type, color, colorName, status,
      comment: (m.comment || '').trim(),
      ...(agentNote && !reopened ? { agentNote } : {}),
      ...(log ? { log } : {}),
      bbox: round(bbox), bboxNorm: norm(bbox),
      center: round(centerOf(m)),
      points: m.points.map((q) => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 })),
      crop: round(crop), cropDataUrl,
    };
  });
  return {
    id: state.reqId || undefined,
    note: $('#note').value.trim(),
    context: state.context,
    image: { width: W, height: H },
    screenshot: state.reqId ? undefined : exportCanvas((c) => c.drawImage(state.img, 0, 0, W, H), W, H),
    annotated: exportCanvas((c) => drawScene(c, { draft: null }), W, H),
    marks,
  };
}

let saving = false;
async function persist({ quiet = false } = {}) {
  if (saving || !state.img) return;
  commitPopover();
  if (!state.marks.length && !$('#note').value.trim()) return toast('Mark something first', '#ff9f0a');
  saving = true;
  try {
    const res = await api.save(buildPayload());
    if (state.reqId) {
      state.request = res.request;
      state.marks.forEach((m, i) => { m.uid = res.request.marks[i].uid; if (!res.request.marks[i].agentNote) delete m.agentNote; m.reopened = false; });
      state.dirty = false;
      updateChrome();
      if (!quiet) toast('Updated');
      refreshList();
    }
  } catch (err) {
    console.error(err); toast(`Save failed: ${err.message}`, '#ff453a');
  } finally { saving = false; }
}

// ---------- history drawer ----------

function openDrawer() { $('#drawer').hidden = false; document.body.classList.add('drawer-open'); refreshList(); }
function closeDrawer() { $('#drawer').hidden = true; document.body.classList.remove('drawer-open'); }
function toggleDrawer() { $('#drawer').hidden ? openDrawer() : closeDrawer(); }

async function refreshList() {
  try { state.list = await api.list(); } catch (err) { console.error(err); state.list = []; }
  renderList();
  const todo = state.list.filter((r) => ACTIVE.includes(r.status)).length;
  const c = $('#todo-count'); c.hidden = !todo; c.textContent = todo;
}

const FILTERS = {
  active: (r) => ACTIVE.includes(r.status),
  review: (r) => r.status === 'review',
  done: (r) => ['done', 'wontfix'].includes(r.status),
  all: () => true,
};
document.querySelectorAll('#filters button').forEach((b) => b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  renderList();
}));

function renderList() {
  document.querySelectorAll('#filters button').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === state.filter);
    b.querySelector('i').textContent = state.list.filter(FILTERS[b.dataset.filter]).length;
  });
  const items = state.list.filter(FILTERS[state.filter]);
  const list = $('#list');
  if (!items.length) {
    list.innerHTML = `<div class="list-empty">${state.list.length ? 'Nothing here.' : 'No edit requests yet.'}</div>`;
    return;
  }
  list.innerHTML = items.map((r) => `
    <button class="card ${r.id === state.reqId ? 'current' : ''}" data-id="${r.id}">
      ${r.thumb ? `<img src="${r.thumb}" alt="">` : ''}
      <div class="meta">
        <div class="row"><span class="title">${escapeHtml(r.title || r.id)}</span><span class="pill st-${r.status}">${STATUS[r.status]?.label || r.status}</span></div>
        <div class="row"><span class="sub">${timeAgo(r.updatedAt || r.createdAt)}${r.app ? ` · ${escapeHtml(r.app)}` : ''}</span><span class="sub">${r.progress} finished</span></div>
        <div class="dots">${r.marks.map((m) => `<span class="dot ${FINISHED.includes(m.status) ? 'fin' : ''}" style="background:${m.color}" ${STATUS[m.status]?.icon ? `data-s="${STATUS[m.status].icon}"` : ''} title="#${m.n} ${STATUS[m.status]?.label}">${m.n}</span>`).join('')}</div>
      </div>
    </button>`).join('');
  list.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => openRequest(el.dataset.id)));
}

async function openRequest(id, { keepUi = false } = {}) {
  if (!keepUi && state.dirty && state.marks.length && id !== state.reqId) {
    if (!(await confirmBox(state.reqId ? 'Discard unsaved changes to this request?' : 'Discard the markup you just made?', 'Discard'))) return;
  }
  const { request, screenshot } = await api.load(id);
  await setImage(screenshot);
  state.reqId = id;
  state.request = request;
  state.context = request.context || {};
  state.k = Math.max(1, request.context?.scaleFactor || state.W / window.innerWidth);
  state.marks = request.marks.map((m) => ({ ...m, uid: m.uid || uid(), status: m.status || 'open', points: m.points.map((p) => ({ ...p })) }));
  $('#note').value = request.note || '';
  state.dirty = false; state.undo = []; state.editing = null; popover.hidden = true;
  updateChrome(); render(); renderList();
}

async function deleteCurrent() {
  if (!state.reqId) return;
  if (!(await confirmBox('Delete this edit request and its screenshots? This cannot be undone.', 'Delete'))) return;
  const id = state.reqId;
  await api.remove(id);
  state.dirty = false;
  await refreshList();
  const next = state.list.find((r) => r.id !== id);
  if (next) await openRequest(next.id); else showEmpty();
  toast('Deleted');
}

// ---------- small UI helpers ----------

function confirmBox(message, okLabel = 'OK') {
  const modal = $('#modal');
  modal.querySelector('p').textContent = message;
  modal.querySelector('[data-v="1"]').textContent = okLabel;
  modal.hidden = false;
  return new Promise((resolve) => {
    const onClick = (e) => {
      const v = e.target.dataset.v;
      if (v === undefined && e.target !== modal) return;
      modal.hidden = true;
      modal.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey, true);
      resolve(v === '1');
    };
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); modal.hidden = true; modal.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey, true); resolve(e.key === 'Enter'); }
    };
    modal.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey, true);
  });
}

function toast(msg, bg = '#30d158') {
  const t = $('#toast'); t.textContent = msg; t.style.background = bg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------- self test (electron . --selftest) ----------

async function runSelfTest() {
  const add = (type, points, comment) => {
    const [colorName, color] = nextColor();
    state.marks.push({ uid: uid(), n: state.marks.length + 1, type, color, colorName, points, comment, status: 'open' });
  };
  add('rect', [{ x: 1172, y: 54 }, { x: 1342, y: 96 }], 'Make this the primary CTA: indigo #6366f1 background, white text');
  add('arrow', [{ x: 560, y: 120 }, { x: 470, y: 178 }], 'Typo: "happend" → "happened"');
  add('pen', [{ x: 1150, y: 230 }, { x: 1400, y: 228 }, { x: 1405, y: 330 }, { x: 1148, y: 335 }, { x: 1150, y: 232 }], 'NPS card is missing the trend line like the other cards');
  add('pin', [{ x: 330, y: 730 }], 'Export button looks disabled — use secondary style');
  $('#note').value = 'Polish pass on the dashboard overview';
  render();
  await api.save(buildPayload());
  await api.selftestDone();
}

// ---------- plain-browser demo (open editor.html directly) ----------
// An in-memory fake of the Electron bridge so the whole UI can be developed in a browser.

function makeDemoApi() {
  const store = new Map();
  let initCb;
  const seed = () => {
    const mk = (id, title, mins, marks) => store.set(id, {
      request: { id, title, note: title, createdAt: new Date(Date.now() - mins * 60000).toISOString(), context: { app: 'Safari', scaleFactor: 1 }, image: { width: 1440, height: 900 }, marks },
    });
    mk('demo-1', 'Polish pass on the dashboard', 5, [
      { n: 1, type: 'rect', color: '#FF3B30', colorName: 'red', comment: 'Make this the primary CTA', status: 'review', agentNote: 'Changed Header.tsx: bg-indigo-500 text-white', points: [{ x: 1172, y: 54 }, { x: 1342, y: 96 }] },
      { n: 2, type: 'arrow', color: '#0A84FF', colorName: 'blue', comment: 'Typo: happend → happened', status: 'done', points: [{ x: 560, y: 120 }, { x: 470, y: 178 }] },
      { n: 3, type: 'pin', color: '#30D158', colorName: 'green', comment: 'Export looks disabled', status: 'partial', agentNote: 'Restyled the button; hover state still missing', points: [{ x: 330, y: 730 }] },
    ]);
    mk('demo-2', 'NPS card trend line', 90, [
      { n: 1, type: 'rect', color: '#FF3B30', colorName: 'red', comment: 'Add trend like other cards', status: 'open', points: [{ x: 1142, y: 216 }, { x: 1412, y: 336 }] },
    ]);
  };
  seed();
  const summary = (r) => ({
    id: r.id, title: r.title, status: deriveStatus(r.marks), createdAt: r.createdAt, updatedAt: r.updatedAt, app: r.context?.app,
    progress: `${r.marks.filter((m) => FINISHED.includes(m.status)).length}/${r.marks.length}`,
    marks: r.marks.map((m) => ({ n: m.n, status: m.status, color: m.color })), thumb: 'demo-bg.svg',
  });
  setTimeout(() => initCb?.({ mode: new URLSearchParams(location.search).get('mode') || 'new', loadId: 'demo-1', screenshot: 'demo-bg.svg', context: { app: 'Demo', scaleFactor: 1 } }));
  return {
    onInit: (cb) => { initCb = cb; },
    list: async () => [...store.values()].map((v) => summary(v.request)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    load: async (id) => ({ request: structuredClone(store.get(id).request), screenshot: 'demo-bg.svg' }),
    save: async (p) => {
      const id = p.id || `demo-${Date.now()}`;
      const prev = store.get(id)?.request;
      p.marks.forEach((m) => delete m.cropDataUrl);
      const request = { ...(prev || {}), id, title: p.note || p.marks[0]?.comment || 'Untitled', note: p.note, createdAt: prev?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), context: p.context, image: p.image, marks: p.marks };
      store.set(id, { request });
      if (!p.id) toast(`Demo: saved ${p.marks.length} marks`);
      return { id, request: structuredClone(request) };
    },
    remove: async (id) => store.delete(id),
    cancel: () => toast('Demo: close'),
  };
}
