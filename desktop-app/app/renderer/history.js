// Redline — History window.
// Left: requests by tab, each with a one-click quick action (and a menu to pick a different one).
// Right: the selected request — preview, every mark with its status and the agent's note,
// and a timeline of what happened when (you saved it, the agent picked it up, fixed each mark, you confirmed).

const api = window.annotator || makeDemoApi();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const IS_MAC = (api.platform || navigator.platform || '').toLowerCase().includes('mac') || api.platform === 'darwin';
if (IS_MAC) document.body.classList.add('mac');

const ACTIVE = ['open', 'in_progress', 'partial'];
const FINISHED = ['review', 'done', 'wontfix'];
const LABEL = { open: 'open', in_progress: 'in progress', partial: 'partial', review: 'review', done: 'done', wontfix: "won't fix" };
const LONG = { open: 'Open', in_progress: 'In progress', partial: 'Partially done', review: 'Waiting for you', done: 'Done', wontfix: "Won't fix" };
const TABS = {
  active: (r) => ACTIVE.includes(r.status),
  review: (r) => r.status === 'review',
  done: (r) => ['done', 'wontfix'].includes(r.status),
  all: () => true,
};

// Quick actions. The first one per tab is the default; picking another from the ▾ menu makes it the
// new default for that tab (remembered), so the button always does what you usually want.
const ACTIONS = {
  delete: { label: 'Delete', menu: 'Delete request', danger: true },
  done: { label: '✓ Done', menu: 'Mark everything done' },
  confirm: { label: '✓ Done', menu: 'Confirm — move to Done' },
  review: { label: 'To review', menu: 'Move to Confirm (review)' },
  wontfix: { label: "Won't fix", menu: "Won't fix" },
  reopen: { label: '↺ Reopen', menu: 'Reopen for the agent' },
};
const TAB_ACTIONS = {
  active: ['delete', 'done', 'review', 'wontfix'],
  review: ['confirm', 'reopen', 'delete'],
  done: ['reopen', 'delete'],
  all: ['delete', 'done', 'reopen'],
};
const quickFor = (tab) => {
  try { const k = localStorage.getItem(`redline.quick.${tab}`); if (TAB_ACTIONS[tab].includes(k)) return k; } catch {}
  return TAB_ACTIONS[tab][0];
};
const setQuick = (tab, k) => { try { localStorage.setItem(`redline.quick.${tab}`, k); } catch {} };

const state = { list: [], tab: 'active', sel: null, query: '', detail: null, pendingDelete: new Map() };

// ───────────────── helpers ─────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
function ago(iso) {
  const s = (Date.now() - ms(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
function dur(a, b) {
  let s = Math.max(0, Math.round((ms(b) - ms(a)) / 1000));
  if (!isFinite(s)) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); s %= 60;
  if (m < 60) return s && m < 10 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = (iso) => {
  const d = new Date(iso), t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const host = (url) => { try { const u = new URL(url); return u.host + (u.pathname !== '/' ? u.pathname : ''); } catch { return url; } };

// A one-line "what's happening" for a request.
function stateLine(r) {
  if (r.status === 'done') return { cls: 'done', text: `Done · ${ago(r.updatedAt || r.createdAt)}` };
  if (r.status === 'wontfix') return { cls: 'done', text: `Won't fix · ${ago(r.updatedAt || r.createdAt)}` };
  if (r.status === 'review') return { cls: 'review', text: `Agent finished · waiting for you ${dur(r.agentAt || r.updatedAt, new Date().toISOString())}` };
  if (r.seenAt) {
    const recent = Date.now() - ms(r.agentAt || r.seenAt) < 15 * 60_000;
    return { cls: recent ? 'working' : 'waiting', text: recent ? `Agent working · picked up ${ago(r.seenAt)}` : `Agent last active ${ago(r.agentAt || r.seenAt)}` };
  }
  return { cls: 'waiting', text: `Not picked up yet · saved ${ago(r.createdAt)}` };
}

// ───────────────── list ─────────────────
async function refresh({ keepSel = true } = {}) {
  try { state.list = await api.list(); } catch (e) { console.error(e); state.list = []; }
  state.list = state.list.filter((r) => !state.pendingDelete.has(r.id));
  renderTabs();
  renderList();
  if (keepSel && state.sel && !state.list.some((r) => r.id === state.sel)) state.sel = null;
  if (!state.sel) { const first = visible()[0]; if (first) select(first.id, { scroll: false }); else renderDetail(null); }
  else loadDetail(state.sel, { quiet: true });
}

function visible() {
  const q = state.query.trim().toLowerCase();
  return state.list.filter(TABS[state.tab]).filter((r) => !q ||
    [r.title, r.note, r.app, r.url, ...(r.marks || []).map((m) => m.comment)].some((s) => (s || '').toLowerCase().includes(q)));
}

function renderTabs() {
  $$('.tabs button').forEach((b) => {
    const n = state.list.filter(TABS[b.dataset.tab]).length;
    b.classList.toggle('on', b.dataset.tab === state.tab);
    const i = $('i', b); i.textContent = n; i.classList.toggle('has', n > 0);
  });
}

function renderList() {
  const items = visible();
  const list = $('#list');
  if (!items.length) {
    const msg = state.query ? `Nothing matches “${esc(state.query)}”.`
      : state.tab === 'review' ? 'Nothing waiting for you.<br>When an agent finishes a mark it shows up here.'
      : state.tab === 'active' ? 'All clear.<br>Press <b>⌥⇧M</b> to mark up your screen.'
      : 'Nothing here yet.';
    list.innerHTML = `<div class="list-empty">${msg}</div>`;
    return;
  }
  const quick = quickFor(state.tab), A = ACTIONS[quick];
  list.innerHTML = items.map((r) => {
    const st = stateLine(r);
    return `
    <div class="req ${r.id === state.sel ? 'sel' : ''}" data-id="${r.id}" role="button" tabindex="-1">
      ${r.thumb ? `<img class="thumb" src="${r.thumb}" alt="">` : '<div class="thumb"></div>'}
      <div class="body">
        <div class="top"><span class="title">${esc(r.title || r.id)}</span><span class="pill st-${r.status}">${LABEL[r.status] || r.status}</span></div>
        <div class="sub">${esc(r.app || '')}${r.url ? ` · ${esc(host(r.url))}` : ''}${!r.app && !r.url ? ago(r.createdAt) : ''}</div>
        <div class="state ${st.cls}">${esc(st.text)}</div>
        <div class="bottom">
          <div class="dots">${(r.marks || []).map((m) => `<span class="dot s-${m.status} ${FINISHED.includes(m.status) ? 'fin' : ''}" style="background:${m.color}" title="#${m.n} ${LONG[m.status]}${m.comment ? ` — ${esc(m.comment)}` : ''}">${m.n}</span>`).join('')}</div>
          <span class="split k-${quick}"><button class="go" data-act="${quick}" title="${esc(A.menu)}">${A.label}</button><button class="more" data-more title="Choose action">▾</button></span>
        </div>
      </div>
    </div>`;
  }).join('');
}

$('#list').addEventListener('click', (e) => {
  const card = e.target.closest('.req'); if (!card) return;
  const id = card.dataset.id;
  const go = e.target.closest('.go');
  if (go) { e.stopPropagation(); return runAction(go.dataset.act, id); }
  if (e.target.closest('[data-more]')) { e.stopPropagation(); return openMenu(e.target.closest('[data-more]'), id); }
  select(id);
});
$('#list').addEventListener('dblclick', (e) => { const c = e.target.closest('.req'); if (c && !e.target.closest('.split')) api.edit(c.dataset.id); });

function select(id, { scroll = true } = {}) {
  state.sel = id;
  $$('.req').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  if (scroll) $(`.req[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  loadDetail(id);
}

$$('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
function setTab(tab) {
  state.tab = tab; renderTabs(); renderList();
  if (!visible().some((r) => r.id === state.sel)) { const f = visible()[0]; if (f) select(f.id, { scroll: false }); else { state.sel = null; renderDetail(null); } }
}
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });

// ───────────────── actions ─────────────────
function openMenu(anchor, id) {
  const menu = $('#menu'), cur = quickFor(state.tab), r = state.list.find((x) => x.id === id);
  menu.innerHTML = `<div class="label">One-click action in “${$('.tabs .on').firstChild.textContent.trim()}”</div>` +
    TAB_ACTIONS[state.tab].map((k) => `<button data-k="${k}" class="${ACTIONS[k].danger ? 'danger' : ''}"><span class="check">${k === cur ? '✓' : ''}</span>${ACTIONS[k].menu}</button>`).join('') +
    `<div class="sep"></div><button data-open><span class="check"></span>Open in editor</button>` +
    (r ? `<button data-reveal><span class="check"></span>Show files</button>` : '');
  menu.hidden = false;
  const b = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.min(b.right - mw, innerWidth - mw - 8)}px`;
  menu.style.top = `${b.bottom + mh + 6 > innerHeight ? b.top - mh - 6 : b.bottom + 6}px`;
  menu.onclick = (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    closeMenu();
    if (btn.dataset.open !== undefined) return api.edit(id);
    if (btn.dataset.reveal !== undefined) return api.reveal?.(id);
    setQuick(state.tab, btn.dataset.k);
    renderList();
    runAction(btn.dataset.k, id);
  };
  setTimeout(() => menu.querySelector('button')?.focus());
}
function closeMenu() { $('#menu').hidden = true; }
addEventListener('mousedown', (e) => { if (!$('#menu').hidden && !e.target.closest('#menu')) closeMenu(); });

async function runAction(k, id) {
  const r = state.list.find((x) => x.id === id) || state.detail?.request;
  if (!r) return;
  const marks = r.marks || [];
  try {
    if (k === 'delete') return softDelete(id);
    if (k === 'done') await api.setStatus({ id, status: 'done', note: 'Marked done in History' });
    if (k === 'wontfix') await api.setStatus({ id, status: 'wontfix' });
    if (k === 'review') await api.setStatus({ id, status: 'review' });
    if (k === 'reopen') await api.setStatus({ id, status: 'open', note: 'Reopened in History' });
    if (k === 'confirm') {
      const rev = marks.filter((m) => m.status === 'review');
      if (rev.length) await api.setStatus({ id, marks: rev.map((m) => ({ n: m.n, status: 'done' })) });
      else await api.setStatus({ id, status: 'done' });
    }
    const label = { done: 'Marked done', wontfix: "Marked won't fix", review: 'Moved to Confirm', reopen: 'Reopened for the agent', confirm: 'Confirmed — moved to Done' }[k];
    toast(`${label}: ${r.title || id}`);
    await refresh();
  } catch (e) { console.error(e); toast(`Failed: ${e.message}`); }
}

// Delete with a few seconds to undo instead of a confirmation dialog.
function softDelete(id) {
  const r = state.list.find((x) => x.id === id);
  const card = $(`.req[data-id="${id}"]`);
  card?.classList.add('leaving');
  const idx = visible().findIndex((x) => x.id === id);
  const timer = setTimeout(async () => {
    state.pendingDelete.delete(id);
    try { await api.remove(id); } catch (e) { console.error(e); }
  }, 5000);
  state.pendingDelete.set(id, timer);
  setTimeout(() => {
    state.list = state.list.filter((x) => x.id !== id);
    renderTabs(); renderList();
    if (state.sel === id) { const v = visible(); const next = v[Math.min(idx, v.length - 1)]; if (next) select(next.id); else { state.sel = null; renderDetail(null); } }
  }, 180);
  toast(`Deleted “${(r?.title || id).slice(0, 40)}”`, () => {
    clearTimeout(state.pendingDelete.get(id));
    state.pendingDelete.delete(id);
    refresh().then(() => select(id));
  });
}

async function setMark(id, n, status, note) {
  try {
    await api.setStatus({ id, marks: [{ n, status, ...(note ? { note } : {}) }] });
    toast(status === 'done' ? `#${n} confirmed` : status === 'open' ? `#${n} reopened for the agent` : `#${n} → ${LONG[status]}`);
    await refresh();
  } catch (e) { console.error(e); toast(`Failed: ${e.message}`); }
}

// ───────────────── detail ─────────────────
let detailSeq = 0;
async function loadDetail(id, { quiet = false } = {}) {
  const seq = ++detailSeq;
  try {
    const d = await api.detail(id);
    if (seq !== detailSeq) return;
    state.detail = d;
    renderDetail(d, { keepScroll: quiet });
  } catch (e) { if (!quiet) { console.error(e); renderDetail(null); } }
}

function renderDetail(d, { keepScroll = false } = {}) {
  const el = $('#detail');
  if (!d) {
    el.innerHTML = `<div class="empty-detail"><img src="../assets/logo-dark.svg" alt="" width="72" height="72"><p>No request selected.</p>
      <p class="dim">Press <kbd>⌥⇧M</kbd> anywhere to mark up your screen, then type <kbd>/redline</kbd> in Claude Code (or ask your agent to “apply my latest Redline”).</p></div>`;
    return;
  }
  const r = d.request, top = el.scrollTop;
  const ctx = r.context || {};
  const review = r.marks.filter((m) => m.status === 'review').length;
  const unfinished = r.marks.filter((m) => ACTIVE.includes(m.status)).length;
  el.innerHTML = `
    <div class="d-head">
      <div class="d-title"><h1>${esc(r.title || r.id)}</h1><span class="pill st-${r.status}">${LONG[r.status] || r.status}</span></div>
      <div class="d-meta">
        <span title="${esc(r.createdAt)}">${day(r.createdAt)} ${clock(r.createdAt)}</span>
        ${ctx.app ? `<span>${esc(ctx.app)}${ctx.windowTitle ? ` — ${esc(ctx.windowTitle)}` : ''}</span>` : ''}
        ${ctx.url ? `<a href="${esc(ctx.url)}" data-ext>${esc(host(ctx.url))}</a>` : ''}
        <span>${r.marks.length} mark${r.marks.length === 1 ? '' : 's'}</span>
      </div>
      <div class="d-actions">
        ${review ? `<button class="btn ok" data-do="confirm">✓ Confirm ${review === r.marks.length ? 'all' : review} — Done</button>` : ''}
        ${FINISHED.includes(r.status) ? `<button class="btn" data-do="reopen">↺ Reopen</button>` : ''}
        ${unfinished ? `<button class="btn" data-do="done">✓ Mark all done</button>` : ''}
        <button class="btn" data-do="edit"><svg viewBox="0 0 20 20"><path d="M4 16l1-4 8-8 3 3-8 8z"/></svg>Open in editor <kbd>↵</kbd></button>
        <button class="btn" data-do="reveal">Show files</button>
        <button class="btn danger" data-do="delete">Delete</button>
      </div>
    </div>
    <div class="d-body">
      ${flowStrip(r, d.seenAt)}
      ${d.preview ? `<div class="preview" data-do="edit" title="Open in editor"><img src="${d.preview}" alt="Annotated screenshot"><span class="hint">Open in editor ↵</span></div>` : ''}
      ${r.note ? `<div class="sec"><h2>Overall request</h2><div class="mark" style="grid-template-columns:1fr"><div class="comment">${esc(r.note)}</div></div></div>` : ''}
      <div class="sec">
        <h2><span class="grow">Marks</span>${unfinished ? `<span>${unfinished} still with the agent</span>` : ''}</h2>
        <div class="marks">${r.marks.map((m) => markRow(r, m)).join('')}</div>
      </div>
      ${unfinished ? `<div class="prompt-box"><code>/redline</code><span>Type this in Claude Code, or ask any agent to “apply my latest Redline”.</span><button class="btn" data-copy="/redline">Copy</button></div>` : ''}
      <div class="sec"><h2>Activity</h2><ul class="timeline">${timeline(r, d.seenAt)}</ul></div>
    </div>`;
  if (keepScroll) el.scrollTop = top;
}

function markRow(r, m) {
  const fin = FINISHED.includes(m.status);
  const opts = Object.keys(LONG).map((s) => `<option value="${s}" ${s === m.status ? 'selected' : ''}>${LABEL[s]}</option>`).join('');
  const last = (m.log || []).filter((l) => l.status).slice(-1)[0];
  return `
    <div class="mark ${fin ? 'fin' : ''}">
      <span class="badge" style="background:${m.color}">${m.n}</span>
      <div class="text">
        <div class="comment ${m.comment ? '' : 'none'}">${m.comment ? esc(m.comment) : 'No comment — see the overall request'}</div>
        <div class="kind">${esc(m.colorName || '')} ${esc(m.type || '')}${last ? ` · ${LONG[last.status] || last.status} ${ago(last.at)} by ${last.by === 'user' ? 'you' : 'agent'}` : ''}</div>
        ${m.agentNote ? `<div class="note"><b>Agent:</b> ${esc(m.agentNote)}</div>` : ''}
        ${m.userFeedback ? `<div class="feedback">You: ${esc(m.userFeedback)}</div>` : ''}
      </div>
      <div class="ctrl">
        <select class="status st-${m.status}" data-mark="${m.n}" title="Change status">${opts}</select>
        ${m.status === 'review' ? `<div class="quick"><button class="yes" data-mk="${m.n}" data-st="done" title="Looks good">✓ Looks good</button><button data-mk="${m.n}" data-st="open" title="Not done — send back to the agent">↺</button></div>` : ''}
        ${m.status === 'done' ? `<div class="quick"><button data-mk="${m.n}" data-st="open" title="Reopen">↺ Reopen</button></div>` : ''}
      </div>
    </div>`;
}

// created → seen by agent → working → waiting for you → done, each with its time.
function flowStrip(r, seenAt) {
  const hist = r.history || [];
  const agent = hist.filter((h) => h.by === 'agent');
  const firstWork = agent.find((h) => h.event !== 'fetched')?.at;
  const reviewAt = [...hist].reverse().find((h) => h.by === 'agent' && ['review', 'partial'].includes(h.status))?.at
    || (['review', 'done'].includes(r.status) ? agent.slice(-1)[0]?.at : null);
  const doneAt = r.status === 'done' ? [...hist].reverse().find((h) => h.status === 'done')?.at || r.updatedAt : null;
  const now = new Date().toISOString();
  const cell = (on, title, when, from, last) => `<div class="${on ? 'on' : ''} ${last ? 'last' : ''}"><b>${title}</b><span>${when ? clock(when) : '—'}</span><small>${when && from ? `+${dur(from, when)}` : !when && on ? '' : '&nbsp;'}</small></div>`;
  return `<div class="flow">
    ${cell(true, 'Marked', r.createdAt)}
    ${cell(!!seenAt, 'Agent saw it', seenAt, r.createdAt)}
    ${cell(!!firstWork, 'Working', firstWork, seenAt || r.createdAt)}
    ${cell(!!reviewAt, 'Fixed', reviewAt, firstWork || seenAt || r.createdAt)}
    ${cell(!!doneAt, 'Done', doneAt, reviewAt || r.createdAt, true)}
  </div>${r.status === 'review' && reviewAt ? `<div class="dim" style="margin-top:-12px;font-size:12px">Waiting for you for ${dur(reviewAt, now)}.</div>` : ''}`;
}

function timeline(r, seenAt) {
  const items = [];
  let agentName = 'Agent'; // the client name from the latest fetch, e.g. "claude-code"
  const who = (h) => (h.by === 'user' ? 'You' : (h.agent || agentName));
  let fetchedOnce = false;
  for (const h of r.history || []) {
    if (h.event === 'fetched' && h.agent) agentName = h.agent;
    if (h.note === 'created') { items.push({ at: h.at, cls: 'user', what: 'You marked up the screen', sub: `${r.marks.length} mark${r.marks.length === 1 ? '' : 's'} saved` }); continue; }
    if (h.note === 'edited in app') { items.push({ at: h.at, cls: 'user', what: 'You edited the request' }); continue; }
    if (h.event === 'fetched') {
      items.push({ at: h.at, cls: 'agent', what: fetchedOnce ? `${who(h)} looked at it again` : `${who(h)} picked it up`, sub: fetchedOnce ? '' : `read the screenshot and ${r.marks.length} mark${r.marks.length === 1 ? '' : 's'}` });
      fetchedOnce = true; continue;
    }
    if (h.marks?.length) {
      const groups = new Map();
      for (const m of h.marks) { const key = `${m.status}|${m.note || ''}`; (groups.get(key) || groups.set(key, []).get(key)).push(m); }
      for (const ms_ of groups.values()) {
        const m = ms_[0], nums = ms_.map((x) => `#${x.n}`).join(', ');
        let what;
        if (h.by === 'user') what = m.status === 'done' ? `You confirmed ${nums}` : m.status === 'open' ? `You reopened ${nums}` : `You set ${nums} to ${LONG[m.status]}`;
        else what = m.status === 'in_progress' ? `${who(h)} started on ${nums}` : m.status === 'review' ? `${who(h)} fixed ${nums}` : `${who(h)} set ${nums} to ${LONG[m.status]}`;
        items.push({ at: h.at, cls: m.status === 'done' ? 'ok' : m.status === 'review' ? 'review' : h.by, what, sub: m.note || '' });
      }
      if (h.note && h.by === 'agent') items.push({ at: h.at, cls: 'agent', what: `${who(h)} left a summary`, sub: h.note });
      continue;
    }
    if (h.status) {
      const what = h.by === 'user'
        ? (h.status === 'done' ? 'You marked it done' : h.status === 'open' ? 'You reopened it' : `You set it to ${LONG[h.status]}`)
        : `${who(h)} set it to ${LONG[h.status]}`;
      items.push({ at: h.at, cls: h.status === 'done' ? 'ok' : h.by, what, sub: h.note && !['Marked done in History', 'Reopened in History'].includes(h.note) ? h.note : '' });
    }
  }
  if (!seenAt && ACTIVE.includes(r.status)) items.push({ at: null, cls: '', what: 'Waiting for an agent', sub: 'Type /redline in Claude Code to start.' });
  return items.map((it) => `<li class="${it.cls}"><div class="what">${esc(it.what)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div>
    <div class="when">${it.at ? `<b>${clock(it.at)}</b>${it.at !== r.createdAt ? `+${dur(r.createdAt, it.at)}` : day(it.at)}` : ''}</div></li>`).join('');
}

$('#detail').addEventListener('click', async (e) => {
  const d = state.detail; if (!d) return;
  const id = d.request.id;
  const ext = e.target.closest('[data-ext]'); if (ext) { e.preventDefault(); window.open(ext.href, '_blank'); return; }
  const copy = e.target.closest('[data-copy]');
  if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied /redline'); } catch {} return; }
  const mk = e.target.closest('[data-mk]');
  if (mk) return setMark(id, +mk.dataset.mk, mk.dataset.st);
  const act = e.target.closest('[data-do]')?.dataset.do;
  if (!act) return;
  if (act === 'edit') return api.edit(id);
  if (act === 'reveal') return api.reveal?.(id);
  runAction(act, id);
});
$('#detail').addEventListener('change', (e) => {
  const s = e.target.closest('select.status'); if (!s || !state.detail) return;
  setMark(state.detail.request.id, +s.dataset.mark, s.value);
});

// ───────────────── toast ─────────────────
function toast(msg, onUndo) {
  const t = $('#toast'), u = $('.undo', t);
  $('.msg', t).textContent = msg;
  u.hidden = !onUndo;
  u.onclick = () => { t.hidden = true; onUndo?.(); };
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), onUndo ? 5000 : 2200);
}

// ───────────────── keyboard ─────────────────
addEventListener('keydown', (e) => {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if (e.key === 'Escape') { if (!$('#menu').hidden) return closeMenu(); if (document.activeElement === $('#search')) { $('#search').blur(); if (state.query) { $('#search').value = state.query = ''; renderList(); } } return; }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) || !$('#menu').hidden) return;
  if (mod && e.key.toLowerCase() === 'z' && !$('#toast').hidden && !$('.undo').hidden) { e.preventDefault(); return $('.undo').click(); }
  if (mod || e.altKey) return;
  const v = visible(), i = v.findIndex((r) => r.id === state.sel);
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); if (v[i + 1]) select(v[i + 1].id); else if (i < 0 && v[0]) select(v[0].id); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); if (v[i - 1]) select(v[i - 1].id); }
  else if (['1', '2', '3', '4'].includes(e.key)) setTab(['active', 'review', 'done', 'all'][+e.key - 1]);
  else if (!state.sel) return;
  else if (e.key === 'Enter') api.edit(state.sel);
  else if (e.key === 'Backspace' || e.key === 'Delete') softDelete(state.sel);
  else if (e.key === 'd') runAction(state.tab === 'review' ? 'confirm' : 'done', state.sel);
  else if (e.key === 'r') runAction('reopen', state.sel);
});

$('#capture').addEventListener('click', () => api.capture?.());
$('#capture kbd').textContent = IS_MAC ? '⌥⇧M' : 'Alt+Shift+M';

// ───────────────── boot ─────────────────
api.onHistoryChanged?.(() => refresh());
api.onSelect?.(({ id }) => { const r = state.list.find((x) => x.id === id); if (r && !TABS[state.tab](r)) setTab('all'); select(id); });
setInterval(() => { renderList(); if (state.detail) renderDetail(state.detail, { keepScroll: true }); }, 30_000); // keep "5m ago" fresh

(async () => {
  const want = new URLSearchParams(location.search).get('id');
  await refresh({ keepSel: false });
  if (!state.list.some(TABS.active) && state.list.some(TABS.review)) setTab('review');
  if (want && state.list.some((r) => r.id === want)) {
    const r = state.list.find((x) => x.id === want);
    if (!TABS[state.tab](r)) setTab(Object.keys(TABS).find((t) => TABS[t](r)));
    select(want);
  }
})();

// ───────────────── browser demo (open history.html directly) ─────────────────
function makeDemoApi() {
  const t = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const img = (c) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#f4f3ee"/><rect x="20" y="16" width="60" height="10" rx="3" fill="#1f211d"/><rect x="20" y="50" width="200" height="14" rx="3" fill="#1f211d"/><rect x="20" y="74" width="260" height="8" rx="3" fill="#dddcd4"/><rect x="20" y="110" width="70" height="22" rx="3" fill="#1f211d"/><rect x="14" y="104" width="82" height="34" rx="4" fill="none" stroke="${c}" stroke-width="3"/><circle cx="230" cy="57" r="7" fill="${c}"/></svg>`)}`;
  const reqs = [
    { id: 'r1', title: 'Checkout polish', status: 'review', createdAt: t(42), updatedAt: t(31), agentSeenAt: t(39),
      context: { app: 'Safari', url: 'http://localhost:3000/checkout', windowTitle: 'Acme — Checkout' },
      marks: [
        { n: 1, type: 'rect', color: '#FF3B30', colorName: 'red', comment: 'make the button full width', status: 'review', agentNote: 'Pay button now spans the card (src/Checkout.tsx)', log: [{ at: t(31), by: 'agent', status: 'review' }] },
        { n: 2, type: 'pin', color: '#0A84FF', colorName: 'blue', comment: 'total should be bold', status: 'review', agentNote: 'Total row uses font-semibold', log: [{ at: t(31), by: 'agent', status: 'review' }] },
      ],
      history: [{ at: t(42), by: 'user', status: 'open', note: 'created' }, { at: t(39), by: 'agent', event: 'fetched', agent: 'claude-code' },
        { at: t(39), by: 'agent', status: 'in_progress', marks: [{ n: 1, status: 'in_progress' }, { n: 2, status: 'in_progress' }] },
        { at: t(33), by: 'agent', status: 'partial', marks: [{ n: 1, status: 'review', note: 'Pay button now spans the card (src/Checkout.tsx)' }] },
        { at: t(31), by: 'agent', status: 'review', marks: [{ n: 2, status: 'review', note: 'Total row uses font-semibold' }] }] },
    { id: 'r2', title: 'Header logo is blurry on retina', status: 'in_progress', createdAt: t(6), updatedAt: t(2), agentSeenAt: t(3),
      context: { app: 'Google Chrome', url: 'http://localhost:5173/' },
      marks: [{ n: 1, type: 'rect', color: '#FF3B30', colorName: 'red', comment: 'use the svg logo here', status: 'in_progress' }, { n: 2, type: 'arrow', color: '#0A84FF', colorName: 'blue', comment: 'more space under the nav', status: 'open' }],
      history: [{ at: t(6), by: 'user', status: 'open', note: 'created' }, { at: t(3), by: 'agent', event: 'fetched', agent: 'claude-code' }, { at: t(2), by: 'agent', status: 'in_progress', marks: [{ n: 1, status: 'in_progress' }] }] },
    { id: 'r3', title: 'Pricing cards spacing', status: 'open', createdAt: t(1), updatedAt: t(1), context: { app: 'Safari', url: 'http://localhost:3000/pricing' },
      marks: [{ n: 1, type: 'pin', color: '#FF3B30', colorName: 'red', comment: 'cards need equal height', status: 'open' }], history: [{ at: t(1), by: 'user', status: 'open', note: 'created' }] },
    { id: 'r4', title: 'Make this smaller', status: 'done', createdAt: t(1500), updatedAt: t(1400), agentSeenAt: t(1490), context: { app: 'Safari', url: 'http://localhost:3001/' },
      marks: [{ n: 1, type: 'rect', color: '#FF3B30', colorName: 'red', comment: 'make this smaller', status: 'done', agentNote: 'Hero title 64px → 48px' }],
      history: [{ at: t(1500), by: 'user', status: 'open', note: 'created' }, { at: t(1490), by: 'agent', event: 'fetched' }, { at: t(1480), by: 'agent', status: 'review', marks: [{ n: 1, status: 'review', note: 'Hero title 64px → 48px' }] }, { at: t(1400), by: 'user', status: 'done', marks: [{ n: 1, status: 'done' }] }] },
  ];
  const derive = (marks) => {
    const s = marks.map((m) => m.status);
    if (s.every((x) => ['done', 'wontfix'].includes(x))) return 'done';
    if (s.every((x) => FINISHED.includes(x))) return 'review';
    if (s.some((x) => FINISHED.includes(x) || x === 'partial')) return 'partial';
    if (s.includes('in_progress')) return 'in_progress';
    return 'open';
  };
  const demoAgents = {};
  window.demoConnect = (name = 'claude-code') => { const now = new Date().toISOString(); demoAgents[name] = { name, firstSeen: now, lastSeen: now, lastConnect: now }; };
  const firstAgent = (r) => r.agentSeenAt || r.history.find((h) => h.by === 'agent')?.at || null;
  const lastAgent = (r) => [...r.history].reverse().find((h) => h.by === 'agent')?.at || null;
  return {
    platform: 'darwin',
    list: async () => reqs.map((r) => ({ id: r.id, title: r.title, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, app: r.context.app, url: r.context.url,
      seenAt: firstAgent(r), agentAt: lastAgent(r), marks: r.marks.map(({ n, status, color, comment }) => ({ n, status, color, comment })), thumb: img(r.marks[0].color) })),
    detail: async (id) => { const r = reqs.find((x) => x.id === id); return { request: structuredClone(r), preview: img(r.marks[0].color), seenAt: firstAgent(r) }; },
    setStatus: async ({ id, status, marks = [], note }) => {
      const r = reqs.find((x) => x.id === id), at = new Date().toISOString();
      for (const u of marks) { const m = r.marks.find((x) => x.n === u.n); m.status = u.status; (m.log ||= []).push({ at, by: 'user', status: u.status }); }
      if (status && !marks.length) for (const m of r.marks) if (!['done', 'wontfix'].includes(m.status) || status === 'open') m.status = status;
      r.status = status || derive(r.marks); r.updatedAt = at;
      r.history.push({ at, by: 'user', status: r.status, note, marks: marks.length ? marks : undefined });
    },
    remove: async (id) => { reqs.splice(reqs.findIndex((x) => x.id === id), 1); },
    edit: async (id) => toast(`Demo: would open ${id} in the editor`),
    capture: async () => toast('Demo: would start a capture'),
    reveal: async () => toast('Demo: would show the files'),
    setupInfo: async () => ({ serverPath: '/Users/you/redline/desktop-app/mcp/server.js', serverExists: true, platform: 'darwin', home: '/Users/you', appData: '/Users/you/Library/Application Support',
      agents: demoAgents, settings: { setupDone: false }, hotkey: '⌥⇧M' }),
    setupDone: async () => ({}),
    agents: async () => demoAgents,
    installClaudeCommand: async () => '/Users/you/.claude/commands/redline.md',
    openExternal: async (u) => toast(`Demo: open ${u.slice(0, 40)}…`),
  };
}
