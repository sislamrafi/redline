// Redline — first-run setup ("connect your agent") + the quick-command bar in the History window.
// Loaded after history.js and shares its globals (api, $, $$, esc, toast, ago).

const setup = { info: null, agentId: null, step: 1, waitSince: 0, agents: {} };

// ───────────────── agents ─────────────────
// Each agent: how to add the Redline MCP server from the command line (shown first), a prompt to paste
// into the agent itself, the config file for reference, and how to make it reconnect.
function agentDefs(info) {
  const S = info.serverPath;
  const home = info.home.split('\\').join('/');
  const appData = (info.appData || '').split('\\').join('/');
  const win = info.platform === 'win32';
  const mcpJson = (key = 'mcpServers') => JSON.stringify({ [key]: { redline: { command: 'node', args: [S] } } }, null, 2);
  // A one-liner that adds Redline to a JSON config file and keeps every other server in it.
  const merge = (file) => `node -e "const fs=require('fs'),p=require('path'),f='${file}';` +
    `const j=fs.existsSync(f)&&fs.readFileSync(f,'utf8').trim()?JSON.parse(fs.readFileSync(f,'utf8')):{};` +
    `(j.mcpServers??={}).redline={command:'node',args:['${S}']};fs.mkdirSync(p.dirname(f),{recursive:true});` +
    `fs.writeFileSync(f,JSON.stringify(j,null,2));console.log('Redline added to '+f)"`;
  const askFile = (name, file) => `Add an MCP server called "redline" to my ${name} MCP config at ${file}:\n` +
    `command "node", args ["${S}"].\nKeep every other server that is already in the file. ` +
    `Then tell me how to reload ${name} so the redline tools (list_edit_requests, get_edit_request, update_edit_request_status) show up.`;
  const fileAgent = (o) => ({
    ...o,
    cli: [{ label: `Add Redline to ${o.name}`, cmd: merge(o.file) }],
    prompt: askFile(o.name, o.file),
    config: { file: o.file, body: mcpJson() },
  });
  const claudeDesktopFile = win ? `${appData}/Claude/claude_desktop_config.json`
    : info.platform === 'darwin' ? `${home}/Library/Application Support/Claude/claude_desktop_config.json` : `${home}/.config/Claude/claude_desktop_config.json`;
  return [
    {
      id: 'claude', name: 'Claude Code', sub: 'Terminal, IDE & desktop Code tab', match: /claude-code|claude code/i, slash: true,
      cli: [
        { label: 'Add Redline to Claude Code (every project)', cmd: `claude mcp add --scope user redline -- node "${S}"` },
        { label: 'Check it — this also connects once, so setup can see it', cmd: 'claude mcp list' },
      ],
      prompt: `Add the Redline MCP server for me by running this in the terminal, then run \`claude mcp list\` and confirm "redline" is connected:\n\nclaude mcp add --scope user redline -- node "${S}"`,
      config: { file: `${home}/.claude.json  (or a project's .mcp.json)`, body: mcpJson() },
      reload: 'Run this in your terminal. It makes Claude Code connect to Redline once, so this screen can see it.', reloadCmd: 'claude mcp list', reloadAlt: 'Or start a new Claude Code session.',
    },
    fileAgent({ id: 'cursor', name: 'Cursor', sub: 'Agent & Composer', match: /cursor/i, file: `${home}/.cursor/mcp.json`,
      reload: 'In Cursor, open Settings → MCP and switch redline on (toggle it off and on once if it was already there).',
      deeplink: `cursor://anysphere.cursor-deeplink/mcp/install?name=redline&config=${btoa(JSON.stringify({ command: 'node', args: [S] }))}` }),
    { id: 'codex', name: 'Codex CLI', sub: 'OpenAI', match: /codex/i,
      cli: [{ label: 'Add Redline to Codex', cmd: `codex mcp add redline -- node "${S}"` }],
      prompt: `Add an MCP server called "redline" to my Codex config (~/.codex/config.toml):\n\n[mcp_servers.redline]\ncommand = "node"\nargs = ["${S}"]\n\nThen tell me to start a new session so the redline tools load.`,
      config: { file: `${home}/.codex/config.toml`, body: `[mcp_servers.redline]\ncommand = "node"\nargs = ["${S}"]` },
      reload: 'Start a new Codex session in your terminal.', reloadCmd: 'codex', reloadAlt: 'Or run codex mcp list to check it is added.' },
    fileAgent({ id: 'windsurf', name: 'Windsurf', sub: 'Cascade', match: /windsurf|codeium|cascade/i, file: `${home}/.codeium/windsurf/mcp_config.json`,
      reload: 'In Cascade, open the MCP servers panel and click Refresh.' }),
    fileAgent({ id: 'antigravity', name: 'Antigravity', sub: 'Google', match: /antigravity|gemini/i, file: `${home}/.gemini/antigravity/mcp_config.json`,
      reload: 'Agent panel → ⋮ → MCP Servers → Manage → Refresh.' }),
    fileAgent({ id: 'claude-desktop', name: 'Claude Desktop', sub: 'Chat app', match: /claude-ai|claude desktop|claude-desktop/i, file: claudeDesktopFile,
      reload: 'Fully quit Claude Desktop (⌘Q) and open it again.' }),
    { id: 'vscode', name: 'VS Code', sub: 'Copilot agent mode', match: /visual studio code|vscode|copilot/i,
      cli: [{ label: 'Add Redline to VS Code', cmd: `code --add-mcp "{\\"name\\":\\"redline\\",\\"command\\":\\"node\\",\\"args\\":[\\"${S}\\"]}"` }],
      prompt: `Add an MCP server called "redline" to my VS Code user MCP settings: command "node", args ["${S}"]. Then tell me how to start it.`,
      config: { file: 'Command Palette → “MCP: Open User Configuration”', body: JSON.stringify({ servers: { redline: { command: 'node', args: [S] } } }, null, 2) },
      reload: 'Command Palette → “MCP: List Servers” → redline → Start.' },
    { id: 'chatgpt', name: 'ChatGPT', sub: 'Read-only, via a tunnel', match: /openai|chatgpt|supergateway/i,
      cli: [
        { label: '1 · Serve Redline over HTTP', cmd: `npx -y supergateway --stdio "node ${S}" --outputTransport streamableHttp --port 8787` },
        { label: '2 · In a second terminal: get a public HTTPS URL', cmd: 'cloudflared tunnel --url http://localhost:8787' },
      ],
      prompt: null,
      note: 'Then in ChatGPT: Settings → Apps & Connectors → Advanced → Developer mode → create a connector with the tunnel URL + /mcp, no auth. ChatGPT can read your markups but can’t edit your code, and anyone with the URL can see your screenshots: stop the tunnel when you’re done.',
      reload: 'Turn the Redline connector on in a new chat.' },
    { id: 'other', name: 'Other', sub: 'Cline, Zed, Continue…', match: /.^/,
      cli: [],
      prompt: `Add an MCP server called "redline" to your MCP configuration: command "node", args ["${S}"] (stdio). Keep the other servers.`,
      config: { file: 'Your agent’s MCP settings', body: mcpJson() },
      reload: 'Restart or refresh the agent’s MCP servers.' },
  ];
}
const defs = () => agentDefs(setup.info);
const def = (id) => defs().find((a) => a.id === id) || defs()[0];

// ───────────────── wizard ─────────────────
async function openSetup() {
  setup.info = await api.setupInfo();
  setup.agents = setup.info.agents || {};
  setup.agentId = setup.info.settings?.agent || null;
  setup.step = 1;
  $('#setup').hidden = false;
  renderSetup();
}
function closeSetup(done = true) {
  $('#setup').hidden = true;
  api.setupDone?.(setup.agentId ? { agent: setup.agentId } : {});
  if (setup.agentId) setCmdAgent(setup.agentId);
}

function stepper() {
  const names = ['Pick your agent', 'Connect', 'Waiting', 'Done'];
  return `<ol class="steps">${names.map((n, i) => `<li class="${i + 1 === setup.step ? 'on' : i + 1 < setup.step ? 'past' : ''}"><i>${i + 1 < setup.step ? '✓' : i + 1}</i>${n}</li>`).join('')}</ol>`;
}
const codeBlock = (cmd, label) => `
  <div class="code">${label ? `<div class="code-label">${esc(label)}</div>` : ''}
    <div class="code-row"><pre>${esc(cmd)}</pre><button class="copy" data-copy="${esc(cmd)}">Copy</button></div>
  </div>`;

function renderSetup() {
  const box = $('#setup .setup-box');
  const a = setup.agentId ? def(setup.agentId) : null;
  let body = '';
  if (setup.step === 1) {
    body = `
      <h2>Connect Redline to your AI agent</h2>
      <p class="lead">Redline gives your agent the screenshots and notes you mark up, through an MCP server. Pick the agent you use; you can add more later.</p>
      <div class="agent-grid">${defs().map((d) => `
        <button class="agent ${d.id === setup.agentId ? 'on' : ''}" data-agent="${d.id}">
          <b>${esc(d.name)}</b><span>${esc(d.sub)}</span>
          ${Object.values(setup.agents).some((x) => d.match.test(x.name)) ? '<em>connected before</em>' : ''}
        </button>`).join('')}
      </div>
      <div class="server-path">MCP server: <code>node ${esc(setup.info.serverPath)}</code>${setup.info.serverExists ? '' : ' <span class="warn">not found — run from the repo checkout</span>'}</div>`;
  } else if (setup.step === 2) {
    body = `
      <h2>Connect ${esc(a.name)}</h2>
      ${a.cli.length ? `<section><h3><span class="tag">Recommended</span> Command line</h3><p class="hint">Paste into your terminal.</p>${a.cli.map((c) => codeBlock(c.cmd, c.label)).join('')}</section>` : ''}
      ${a.deeplink ? `<section><h3>One click</h3><button class="btn" data-deeplink="${esc(a.deeplink)}">Add to ${esc(a.name)}</button></section>` : ''}
      ${a.prompt ? `<section><h3>Or ask ${esc(a.name)} to do it</h3><p class="hint">Paste this into ${esc(a.name)}’s chat.</p>${codeBlock(a.prompt)}</section>` : ''}
      ${a.note ? `<p class="note">${esc(a.note)}</p>` : ''}
      ${a.slash ? `<section class="row-sec"><div><h3>Add the <code>/redline</code> command</h3><p class="hint">Then <code>/redline</code> applies your latest markup, <code>/redline list</code> shows them all.</p></div><button class="btn" data-install-cmd>Install /redline</button></section>` : ''}
      ${a.config ? `<details><summary>Config file (for reference)</summary><div class="hint">${esc(a.config.file)}</div>${codeBlock(a.config.body)}</details>` : ''}`;
  } else if (setup.step === 3) {
    const seen = Object.values(setup.agents).sort((x, y) => y.lastSeen.localeCompare(x.lastSeen));
    body = `
      <div class="wait">
        <div class="radar"><span></span><span></span><span></span><img src="../assets/logo-dark.svg" alt=""></div>
        <h2>Waiting for ${esc(a.name)} to connect…</h2>
        <div class="do-now">
          <div class="do-head"><span class="do-badge">Do this now</span><span>${esc(a.reload || 'Reload your agent so it starts the Redline server.')}</span></div>
          ${a.reloadCmd ? codeBlock(a.reloadCmd) : ''}
          ${a.reloadAlt ? `<div class="do-alt">${esc(a.reloadAlt)}</div>` : ''}
        </div>
        <p class="hint live"><span class="live-dot"></span>Listening — this screen switches to ✓ by itself the moment ${esc(a.name)} connects.</p>
        ${seen.length ? `<div class="seen"><div class="hint">Agents that connected before</div>${seen.slice(0, 4).map((x) => `<div class="seen-row"><span class="dot-on"></span><b>${esc(x.name)}</b><span>${ago(x.lastSeen)}</span></div>`).join('')}<button class="link" data-finish>That’s the one — finish</button></div>` : ''}
      </div>`;
  } else {
    const got = setup.connected;
    body = `
      <div class="wait done">
        <div class="tick">✓</div>
        <h2>${esc(got?.name || a?.name || 'Your agent')} is connected</h2>
        <p class="lead">Try it now:</p>
        <ol class="try">
          <li>Press <kbd>${esc(setup.info.hotkey)}</kbd> anywhere, draw a box around something and write what should change.</li>
          <li>${a?.slash ? 'In Claude Code, type' : `In ${esc(a?.name || 'your agent')}, say`} ${codeInline(a?.slash ? '/redline' : 'Apply my latest Redline')}</li>
          <li>Confirm each fix here in History.</li>
        </ol>
      </div>`;
  }
  const foot = setup.step === 1 ? `<button class="link" data-skip>Skip setup</button><span class="grow"></span><button class="btn primary" data-next ${setup.agentId ? '' : 'disabled'}>Continue</button>`
    : setup.step === 2 ? `<button class="btn" data-back>Back</button><button class="link" data-skip>Skip</button><span class="grow"></span><button class="btn primary" data-next>I’ve added it — check the connection</button>`
    : setup.step === 3 ? `<button class="btn" data-back>Back</button><button class="link" data-skip>Skip — I’ll check later</button><span class="grow"></span>`
    : `<span class="grow"></span><button class="btn primary" data-close>Start using Redline</button>`;
  box.innerHTML = `
    <header class="setup-head"><img src="../assets/logo-dark.svg" alt="" width="28" height="28"><b>Redline setup</b>${stepper()}<button class="x" data-skip title="Skip setup (Esc)">✕</button></header>
    <div class="setup-body">${body}</div>
    <footer class="setup-foot">${foot}</footer>`;
}
const codeInline = (t) => `<span class="inline-copy" data-copy="${esc(t)}" title="Click to copy"><code>${esc(t)}</code></span>`;

$('#setup').addEventListener('click', async (e) => {
  const t = e.target;
  const copy = t.closest('[data-copy]');
  if (copy) return copyText(copy.dataset.copy, copy);
  const agent = t.closest('[data-agent]');
  if (agent) { setup.agentId = agent.dataset.agent; setup.step = 2; return renderSetup(); }
  if (t.closest('[data-deeplink]')) return api.openExternal?.(t.closest('[data-deeplink]').dataset.deeplink);
  if (t.closest('[data-install-cmd]')) {
    try { const f = await api.installClaudeCommand(); toast(`Installed /redline → ${f}`); t.closest('[data-install-cmd]').textContent = '✓ Installed'; } catch (err) { toast(`Failed: ${err.message}`); }
    return;
  }
  if (t.closest('[data-back]')) { setup.step = Math.max(1, setup.step - 1); return renderSetup(); }
  if (t.closest('[data-next]')) {
    if (setup.step === 2) setup.waitSince = Date.now() - 5000;
    setup.step += 1; return renderSetup();
  }
  if (t.closest('[data-finish]')) { setup.connected = Object.values(setup.agents).sort((x, y) => y.lastSeen.localeCompare(x.lastSeen))[0]; setup.step = 4; return renderSetup(); }
  if (t.closest('[data-skip]') || t.closest('[data-close]')) return closeSetup();
});
// While setup is open, keys stay in setup (no History shortcuts behind it); Esc skips setup.
addEventListener('keydown', (e) => {
  if ($('#setup').hidden) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); closeSetup(); return; }
  if (!e.metaKey && !e.ctrlKey) e.stopImmediatePropagation();
}, true);

// Live: the MCP server writes agents.json when an agent connects.
function onAgents(all) {
  setup.agents = all || {};
  renderCmdbar();
  if ($('#setup').hidden || setup.step !== 3) return;
  const fresh = Object.values(setup.agents).filter((x) => Date.parse(x.lastConnect || x.lastSeen) >= setup.waitSince)
    .sort((x, y) => y.lastSeen.localeCompare(x.lastSeen));
  if (fresh.length) { setup.connected = fresh[0]; setup.step = 4; renderSetup(); }
}
api.onAgents?.(onAgents);
// Fallback poll while waiting (in case file watching is unavailable).
setInterval(async () => { if (!$('#setup').hidden && setup.step === 3 && api.agents) onAgents(await api.agents()); }, 2000);
api.onSetupOpen?.(openSetup);
$('#open-setup').addEventListener('click', openSetup);

async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (el) { el.classList.add('copied'); const old = el.tagName === 'BUTTON' ? el.textContent : null; if (old) el.textContent = 'Copied ✓'; setTimeout(() => { el.classList.remove('copied'); if (old) el.textContent = old; }, 1400); }
}

// ───────────────── quick-command bar ─────────────────
const CMD_KEY = 'redline.cmdbar';
const cmdState = () => { try { return { open: true, agent: 'claude', ...JSON.parse(localStorage.getItem(CMD_KEY) || '{}') }; } catch { return { open: true, agent: 'claude' }; } };
const saveCmd = (p) => { try { localStorage.setItem(CMD_KEY, JSON.stringify({ ...cmdState(), ...p })); } catch {} };
const COMMANDS = {
  slash: [['/redline', 'Apply my latest markup'], ['/redline list', 'Show all requests'], ['/redline check', 'What waits for me'], ['/redline all', 'Apply every open one']],
  say: [['Apply my latest Redline', 'Apply my latest markup'], ['List my Redlines', 'Show all requests'], ['Check which Redlines are waiting for me', 'What waits for me'], ['Apply all my open Redlines', 'Apply every open one']],
};
const CMD_AGENTS = [['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor'], ['windsurf', 'Windsurf'], ['antigravity', 'Antigravity'], ['claude-desktop', 'Claude Desktop'], ['vscode', 'VS Code'], ['chatgpt', 'ChatGPT']];
function setCmdAgent(id) { if (CMD_AGENTS.some(([k]) => k === id)) { saveCmd({ agent: id }); renderCmdbar(); } }

function renderCmdbar() {
  const st = cmdState(), bar = $('#cmdbar');
  $('#cmd-toggle').hidden = st.open;
  bar.hidden = !st.open;
  if (!st.open) return;
  const slash = st.agent === 'claude';
  const re = { claude: /claude-code/i, codex: /codex/i, cursor: /cursor/i, windsurf: /windsurf|codeium/i, antigravity: /antigravity|gemini/i, 'claude-desktop': /claude-ai|claude-desktop/i, vscode: /code|copilot/i, chatgpt: /openai|chatgpt|supergateway/i }[st.agent];
  const conn = Object.values(setup.agents || {}).filter((x) => re?.test(x.name)).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
  bar.innerHTML = `
    <div class="cmd-head">
      <span>Commands for</span>
      <select id="cmd-agent" title="Your agent">${CMD_AGENTS.map(([k, n]) => `<option value="${k}" ${k === st.agent ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="conn ${conn ? 'on' : ''}" title="${conn ? `${esc(conn.name)} last talked to Redline ${ago(conn.lastSeen)}` : 'Not connected yet — click Connect'}">${conn ? `● ${ago(conn.lastSeen)}` : '○ not connected'}</span>
      <span class="grow"></span>
      <button class="icon" data-cmd-setup title="Connect an agent">⚙︎</button>
      <button class="icon" data-cmd-close title="Hide commands">✕</button>
    </div>
    <div class="cmd-list">${(slash ? COMMANDS.slash : COMMANDS.say).map(([cmd, what]) => `
      <button class="cmd" data-copy="${esc(cmd)}" title="Copy “${esc(cmd)}”"><code>${esc(cmd)}</code><span>${esc(what)}</span><i>copy</i></button>`).join('')}
    </div>
    ${slash ? '' : `<div class="cmd-hint">Say it in ${esc(CMD_AGENTS.find(([k]) => k === st.agent)[1])}’s chat. Redline tells the agent what these mean.</div>`}`;
}
$('#cmdbar').addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) { copyText(c.dataset.copy, c); toast(`Copied “${c.dataset.copy}”`); return; }
  if (e.target.closest('[data-cmd-close]')) { saveCmd({ open: false }); return renderCmdbar(); }
  if (e.target.closest('[data-cmd-setup]')) return openSetup();
});
$('#cmdbar').addEventListener('change', (e) => { if (e.target.id === 'cmd-agent') setCmdAgent(e.target.value); });
$('#cmd-toggle').addEventListener('click', () => { saveCmd({ open: true }); renderCmdbar(); });

// ───────────────── boot ─────────────────
(async () => {
  try { setup.info = await api.setupInfo?.(); setup.agents = setup.info?.agents || {}; } catch {}
  renderCmdbar();
  const firstRun = new URLSearchParams(location.search).get('setup') === '1' || (setup.info && !setup.info.settings?.setupDone);
  if (firstRun && setup.info) openSetup();
})();
