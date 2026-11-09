// Shared on-disk store for edit requests. Used by the Electron app (writer/editor)
// and the MCP server (reader / status updater).
//
// Layout:
//   ~/.redline/requests/<id>/
//     request.json       structured data (marks, coords, context, status)
//     screenshot.png     untouched original capture
//     annotated.png      screenshot + numbered marks + comment callouts (full res)
//     preview.png        annotated, downscaled (<=1600px wide) for VL models
//     crops/mark-N.png   zoomed crop around each mark (with only that mark outlined)
//     prompt.md          human/LLM readable summary
//
// Status lifecycle (per mark, and rolled up per request):
//   open → in_progress → review (agent finished, waiting for the user to confirm) → done
//                      ↘ partial (agent did some of it)        ↘ user can reopen → open
//   wontfix = agent/user decided not to do it

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LEGACY_HOME = path.join(os.homedir(), '.annotation-mcp');
export const HOME = process.env.REDLINE_HOME || process.env.ANNOTATION_MCP_HOME || path.join(os.homedir(), '.redline');
export const REQUESTS_DIR = path.join(HOME, 'requests');

// One-time move from the pre-Redline folder so existing requests are kept.
if (!process.env.REDLINE_HOME && !process.env.ANNOTATION_MCP_HOME && !fs.existsSync(HOME) && fs.existsSync(LEGACY_HOME)) {
  try { fs.renameSync(LEGACY_HOME, HOME); } catch { /* another process won the race */ }
}

export const STATUSES = ['open', 'in_progress', 'partial', 'review', 'done', 'wontfix'];
export const STATUS_LABEL = {
  open: 'Open', in_progress: 'In progress', partial: 'Partially done',
  review: 'Waiting for confirmation', done: 'Done', wontfix: "Won't fix",
};
// "Active" = still needs agent work.
export const ACTIVE = ['open', 'in_progress', 'partial'];

export function ensureDirs() {
  fs.mkdirSync(REQUESTS_DIR, { recursive: true });
}

export function newId(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function requestDir(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid request id: ${id}`);
  return path.join(REQUESTS_DIR, id);
}

export function readRequest(id) {
  const file = path.join(requestDir(id), 'request.json');
  if (!fs.existsSync(file)) return null;
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const m of r.marks) m.status ||= 'open';
  return r;
}

export function writeRequest(req) {
  const dir = requestDir(req.id);
  fs.mkdirSync(dir, { recursive: true });
  req.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(req, null, 2));
  fs.writeFileSync(path.join(dir, 'prompt.md'), renderPrompt(req));
}

export function listRequests({ status } = {}) {
  ensureDirs();
  const out = [];
  for (const id of fs.readdirSync(REQUESTS_DIR)) {
    try {
      const r = readRequest(id);
      if (!r) continue;
      if (!status || status === 'all' || r.status === status || (status === 'active' && ACTIVE.includes(r.status))) out.push(r);
    } catch { /* skip broken entries */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Roll per-mark statuses up into one request status.
export function deriveStatus(marks) {
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

export function progress(r) {
  const finished = r.marks.filter((m) => ['done', 'wontfix', 'review'].includes(m.status)).length;
  return `${finished}/${r.marks.length}`;
}

/**
 * Update a request and/or individual marks.
 *   status   explicit request status (optional; derived from marks when omitted and marks are given)
 *   marks    [{ n, status, note }]
 *   by       'agent' | 'user'
 */
export function updateStatus(id, { status, note, marks = [], by = 'agent' } = {}) {
  const r = readRequest(id);
  if (!r) throw new Error(`No edit request with id ${id}`);
  const at = new Date().toISOString();
  for (const u of marks) {
    const m = r.marks.find((x) => x.n === u.n);
    if (!m) throw new Error(`Request ${id} has no mark #${u.n} (marks: ${r.marks.map((x) => x.n).join(', ')})`);
    if (u.status) {
      if (!STATUSES.includes(u.status)) throw new Error(`Bad status ${u.status}`);
      m.status = u.status;
    }
    if (u.note) m.agentNote = u.note;
    (m.log ||= []).push({ at, by, status: u.status, note: u.note });
  }
  if (status && !STATUSES.includes(status)) throw new Error(`Bad status ${status}`);
  if (status && !marks.length && ['done', 'review', 'wontfix', 'open', 'in_progress'].includes(status)) {
    // A request-level status with no per-mark detail applies to every unfinished mark.
    for (const m of r.marks) if (!['done', 'wontfix'].includes(m.status) || status === 'open') m.status = status;
  }
  r.status = status || deriveStatus(r.marks);
  if (note) r.resolutionNote = note;
  (r.history ||= []).push({ at, by, status: r.status, note: note || undefined, marks: marks.length ? marks : undefined });
  writeRequest(r);
  return r;
}

export function deleteRequest(id) {
  fs.rmSync(requestDir(id), { recursive: true, force: true });
}

const fmtBox = (b) => `x=${Math.round(b.x)}, y=${Math.round(b.y)}, w=${Math.round(b.w)}, h=${Math.round(b.h)}`;
const fmtNorm = (b) => `x=${b.x.toFixed(3)}, y=${b.y.toFixed(3)}, w=${b.w.toFixed(3)}, h=${b.h.toFixed(3)}`;

const TYPE_LABEL = {
  rect: 'box around the region',
  arrow: 'arrow pointing at the target (arrow head = target)',
  pen: 'freehand outline/scribble over the region',
  pin: 'pin dropped on an exact spot',
};

// A description written for vision-language models: it ties each number in the
// image to a color, a shape, a location in words and exact coordinates.
export function renderPrompt(r) {
  const W = r.image.width, H = r.image.height;
  const lines = [];
  lines.push(`# UI edit request ${r.id}`);
  lines.push('');
  lines.push(`Status: **${STATUS_LABEL[r.status] || r.status}** (${progress(r)} marks finished) · Created: ${r.createdAt}${r.updatedAt ? ` · Updated: ${r.updatedAt}` : ''}`);
  const c = r.context || {};
  const ctx = [c.app && `app: ${c.app}`, c.windowTitle && `window: "${c.windowTitle}"`, c.url && `url: ${c.url}`].filter(Boolean);
  if (ctx.length) lines.push(`Captured from ${ctx.join(' · ')}`);
  lines.push(`Screenshot: ${W}×${H}px (display scale ${c.scaleFactor ?? 1}×; divide pixel coords by the scale for CSS/points).`);
  lines.push('');
  if (r.note) {
    lines.push('## Overall request');
    lines.push(r.note);
    lines.push('');
  }
  const todo = r.marks.filter((m) => ACTIVE.includes(m.status));
  lines.push('## Marked edits');
  lines.push('Each mark is drawn on the annotated image as a colored shape with a numbered circular badge in the same color.');
  lines.push('Finished marks (done / waiting for confirmation / won\'t fix) must not be redone. The statuses in this text are authoritative;');
  lines.push('the image is redrawn only when the user saves in the app, so it may show older statuses (finished marks there are faded with a ✓/✕/? chip).');
  lines.push('Coordinates are pixels in the original screenshot (origin top-left); "norm" values are 0–1 fractions of width/height.');
  if (todo.length) lines.push(`Marks still to do: ${todo.map((m) => `#${m.n}`).join(', ')}`);
  lines.push('');
  for (const m of r.marks) {
    lines.push(`### #${m.n} — ${m.colorName} ${m.type} · ${STATUS_LABEL[m.status] || m.status}`);
    lines.push(`- Instruction: ${m.comment?.trim() || '(no comment — infer from overall request)'}`);
    if (m.agentNote) lines.push(`- Agent note: ${m.agentNote}`);
    if (m.userFeedback) lines.push(`- User feedback after review: ${m.userFeedback}`);
    lines.push(`- Shape: ${TYPE_LABEL[m.type] || m.type}`);
    lines.push(`- Location: ${describeLocation(m.center, W, H)}`);
    lines.push(`- Bounding box (px): ${fmtBox(m.bbox)} · norm: ${fmtNorm(m.bboxNorm)}`);
    if (m.type === 'arrow' && m.points?.length === 2) {
      const [a, b] = m.points;
      lines.push(`- Arrow from (${Math.round(a.x)}, ${Math.round(a.y)}) → target (${Math.round(b.x)}, ${Math.round(b.y)})`);
    }
    if (m.type === 'pin') lines.push(`- Pin point (px): (${Math.round(m.center.x)}, ${Math.round(m.center.y)})`);
    if (m.crop) lines.push(`- Zoomed crop: crops/mark-${m.n}.png (region ${fmtBox(m.crop)})`);
    lines.push('');
  }
  if (r.resolutionNote) {
    lines.push('## Latest note');
    lines.push(r.resolutionNote);
  }
  return lines.join('\n');
}

function describeLocation(p, W, H) {
  const fx = p.x / W, fy = p.y / H;
  const v = fy < 0.33 ? 'top' : fy > 0.66 ? 'bottom' : 'middle';
  const h = fx < 0.33 ? 'left' : fx > 0.66 ? 'right' : 'center';
  const where = v === 'middle' && h === 'center' ? 'center' : `${v}-${h}`;
  return `${where} of the screen, centered at (${Math.round(p.x)}, ${Math.round(p.y)})`;
}
