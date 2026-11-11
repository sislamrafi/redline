// Smoke test: talk to the MCP server over stdio like Claude would.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['mcp/server.js'], env: { ...process.env } }));
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('prompts:', (await client.listPrompts()).prompts.map((p) => p.name).join(', '));
console.log((await client.callTool({ name: 'list_edit_requests', arguments: {} })).content[0].text);
const got = await client.callTool({ name: 'get_edit_request', arguments: {} });
for (const c of got.content) console.log(c.type === 'image' ? `[image ${Math.round(c.data.length * 0.75 / 1024)} KB]` : c.text);
const id = got.content[0].text.match(/request (\S+)/)[1];
console.log((await client.callTool({ name: 'update_edit_request_status', arguments: { id, status: 'done', note: '#1 CTA restyled' } })).content[0].text);
console.log((await client.callTool({ name: 'list_edit_requests', arguments: { status: 'all' } })).content[0].text);
await client.close();
