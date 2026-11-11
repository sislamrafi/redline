// Call one tool on the Redline MCP server over stdio, exactly as an agent would.
// usage: node scripts/mcp-call.js <tool> '<json args>' [outDir to dump images]
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [tool, args = '{}', outDir] = process.argv.slice(2);
const client = new Client({ name: 'cli', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['mcp/server.js'], env: { ...process.env } }));
const res = await client.callTool({ name: tool, arguments: JSON.parse(args) });
let i = 0;
for (const c of res.content) {
  if (c.type === 'text') console.log(c.text);
  else {
    const kb = Math.round(c.data.length * 0.75 / 1024);
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      const f = path.join(outDir, `image-${++i}.png`);
      fs.writeFileSync(f, Buffer.from(c.data, 'base64'));
      console.log(`[image ${kb} KB → ${f}]`);
    } else console.log(`[image ${kb} KB]`);
  }
}
if (res.isError) process.exitCode = 1;
await client.close();
