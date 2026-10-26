// Live check of the phone's MCP client against public servers: `node src/mcp/client.check.ts` (needs the internet).
import assert from 'node:assert';

import { McpHttpError, McpSession } from './client.ts';

const open = new McpSession('https://mcp.deepwiki.com/mcp', async () => null);
const tools = await open.tools();
assert.ok(tools.some(t => t.name === 'read_wiki_structure'), 'DeepWiki lists its tools');
const text = await open.call('read_wiki_structure', { repoName: 'modelcontextprotocol/typescript-sdk' });
assert.ok(text.length > 50, 'a tool call returns text');

const exa = new McpSession('https://mcp.exa.ai/mcp', async () => null);
assert.ok((await exa.tools()).length > 0, 'Exa lists tools');

// A server that needs sign-in answers 401 with the hint sign-in follows.
const locked = new McpSession('https://mcp.atlassian.com/v1/mcp', async () => null);
await assert.rejects(locked.tools(), (err: unknown) => err instanceof McpHttpError && err.status === 401 && !!err.wwwAuthenticate);
console.log('mcp client ok', tools.length, 'DeepWiki tools;', text.slice(0, 60).replace(/\s+/g, ' '));
