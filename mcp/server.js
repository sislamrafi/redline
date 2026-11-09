#!/usr/bin/env node
// MCP server (stdio) that lets Claude / any MCP agent fetch the UI edit requests
// you marked up with the hotkey app, see them as images, and report progress per mark.

import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  listRequests, readRequest, requestDir, updateStatus, deleteRequest, renderPrompt,
  progress, STATUS_LABEL, ACTIVE, REQUESTS_DIR,
} from '../shared/store.js';

const server = new McpServer({ name: 'redline', version: '0.3.0' });

const STATUS = z.enum(['open', 'in_progress', 'partial', 'review', 'done', 'wontfix']);
const STATUS_HELP =
  'open = not started · in_progress = working on it · partial = some of it done · ' +
  'review = finished, waiting for the user to confirm · done = confirmed finished · wontfix = will not be done';

const img = (file) => ({ type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType: 'image/png' });
const text = (t) => ({ type: 'text', text: t });

function resolveId(id) {
  if (id && id !== 'latest') return id;
  const pick = listRequests({ status: 'active' })[0];
  if (!pick) throw new Error('No open edit requests. Press the hotkey (default ⌥⇧M) to mark up your screen first.');
  return pick.id;
}

const summaryLine = (r) =>
  `- ${r.id} [${r.status}] ${progress(r)} marks finished — ${r.title}` +
  (r.context?.app ? `  (${r.context.app}${r.context.url ? ` · ${r.context.url}` : ''})` : '');

server.registerTool('list_edit_requests', {
  title: 'List UI edit requests',
  description: 'List visual edit requests the user marked up on screen (newest first). Each has numbered marks with comments describing UI changes to make. ' +
    '"active" (default) = open, in_progress or partial — the ones that still need work.',
  inputSchema: { status: z.enum(['active', 'open', 'in_progress', 'partial', 'review', 'done', 'wontfix', 'all']).default('active') },
}, async ({ status }) => {
  const rs = listRequests({ status });
  return { content: [text(rs.length ? rs.map(summaryLine).join('\n') : `No ${status === 'all' ? '' : status + ' '}edit requests.`)] };
});

server.registerTool('get_edit_request', {
  title: 'Get a UI edit request',
  description:
    'Fetch a marked-up screenshot edit request: an annotated image (numbered, color-coded marks with the user\'s comments drawn in), ' +
    'a zoomed crop per unfinished mark, and a structured description with each mark\'s status and exact pixel + normalized coordinates. ' +
    'Use the numbers/colors to match each instruction to its location, then find and edit the corresponding code. ' +
    'Omit id (or pass "latest") to get the most recent request that still needs work.',
  inputSchema: {
    id: z.string().optional().describe('Request id, or "latest" (default)'),
    include_crops: z.boolean().default(true).describe('Include a zoomed crop image for each unfinished mark'),
    include_original: z.boolean().default(false).describe('Also include the unmarked original screenshot'),
    mark_in_progress: z.boolean().default(true).describe('Set open marks to in_progress when fetched'),
  },
}, async ({ id, include_crops, include_original, mark_in_progress }) => {
  const rid = resolveId(id);
  let r = readRequest(rid);
  if (!r) throw new Error(`No edit request with id ${rid}`);
  const openMarks = r.marks.filter((m) => m.status === 'open');
  if (mark_in_progress && openMarks.length) {
    r = updateStatus(rid, { marks: openMarks.map((m) => ({ n: m.n, status: 'in_progress' })), by: 'agent' });
  }
  const dir = requestDir(rid);

  const content = [text(renderPrompt(r)), text('Annotated screenshot (numbered marks + comments):'), img(path.join(dir, 'preview.png'))];
  if (include_crops) {
    for (const m of r.marks.filter((x) => ACTIVE.includes(x.status))) {
      const f = path.join(dir, 'crops', `mark-${m.n}.png`);
      if (fs.existsSync(f)) content.push(text(`Zoomed crop of #${m.n} (${m.colorName} ${m.type}): ${m.comment || '(no comment)'}`), img(f));
    }
  }
  if (include_original) content.push(text('Original screenshot, no markup:'), img(path.join(dir, 'screenshot.png')));
  content.push(text(
    `Files on disk: ${dir}\n` +
    'As you work, report progress with update_edit_request_status, per mark: ' +
    'set a mark to "review" when you have implemented it (the user confirms it in the app), "partial" if only part is done ' +
    '(say what is left in the note), or "wontfix" with a reason. Do not set "done" yourself unless the user told you to.',
  ));
  return { content };
});

server.registerTool('update_edit_request_status', {
  title: 'Report progress on an edit request',
  description:
    'Update the status of individual marks (preferred) and/or the whole request, with notes the user will see in the app. ' +
    `Statuses: ${STATUS_HELP}. When marks are given and status is omitted, the request status is derived from the marks.`,
  inputSchema: {
    id: z.string(),
    marks: z.array(z.object({
      n: z.number().int().describe('Mark number as shown on the image'),
      status: STATUS,
      note: z.string().optional().describe('What you changed (file/component) or what is left'),
    })).optional(),
    status: STATUS.optional().describe('Request-level status; applied to all unfinished marks when no marks are given'),
    note: z.string().optional().describe('Overall summary note'),
  },
}, async ({ id, marks, status, note }) => {
  if (!marks?.length && !status) throw new Error('Give marks[] and/or status');
  const r = updateStatus(id, { marks: marks || [], status, note, by: 'agent' });
  const lines = r.marks.map((m) => `#${m.n} ${STATUS_LABEL[m.status]}${m.agentNote ? ` — ${m.agentNote}` : ''}`);
  return { content: [text(`Request ${r.id} is now ${STATUS_LABEL[r.status]} (${progress(r)}).\n${lines.join('\n')}`)] };
});

server.registerTool('delete_edit_request', {
  title: 'Delete an edit request',
  description: 'Permanently delete an edit request and its images. Only do this when the user asks.',
  inputSchema: { id: z.string() },
  annotations: { destructiveHint: true },
}, async ({ id }) => {
  if (!readRequest(id)) throw new Error(`No edit request with id ${id}`);
  deleteRequest(id);
  return { content: [text(`Deleted ${id}.`)] };
});

// Prompt shortcut: in Claude Code this shows up as /mcp__redline__apply_latest
server.registerPrompt('apply_latest', {
  title: 'Apply my latest screen markup',
  description: 'Fetch the latest UI edit request and implement it in this codebase',
}, () => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: 'Call get_edit_request (latest). For each numbered mark that is not finished, locate the UI element in this codebase using the ' +
        'screenshot, URL/window context and nearby visible text, then make the requested change. After each mark, call ' +
        'update_edit_request_status for that mark with status "review" (or "partial"/"wontfix") and a note naming the file you changed.',
    },
  }],
}));

fs.mkdirSync(REQUESTS_DIR, { recursive: true });
await server.connect(new StdioServerTransport());
