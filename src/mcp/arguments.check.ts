// Notion-style MCP round trips through a local fake server. Never writes to a real Notion account.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { McpSession } from './client.ts';
import { coerceArgs, parseArgs, parseLocalCalls } from '../llm/parse.ts';

const schema = { type: 'object', properties: {
  parent: { anyOf: [{ type: 'string', enum: ['memory'] }, { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] }] },
  pages: { type: 'array', items: { type: 'object', properties: { properties: { type: 'object', additionalProperties: true }, content: { type: 'string' } } } },
}, required: ['pages'] };
const paragraph = 'Architectural types include residential, civic, commercial and sacred buildings.';
let writes = 0;
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const rpc = JSON.parse(body);
  if (!rpc.id) { response.writeHead(202).end(); return; }
  let result: unknown = {};
  if (rpc.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'local-notion-fixture', version: '1' } };
  if (rpc.method === 'tools/list') result = { tools: [{ name: 'create_pages', description: 'Add a journal page', inputSchema: schema }] };
  if (rpc.method === 'tools/call') {
    const args = rpc.params.arguments;
    if (rpc.params.name === 'search') result = { content: [{ type: 'text', text: JSON.stringify({ page_id: 'journal-id' }) }] };
    else if (args.parent?.page_id !== 'journal-id' || args.pages?.[0]?.properties?.title !== 'Architectural types' || args.pages?.[0]?.content !== paragraph)
      result = { isError: true, content: [{ type: 'text', text: 'Wrong argument: parent and page properties must be objects.' }] };
    else { writes++; result = { content: [{ type: 'text', text: 'Created journal page (local fixture only).' }] }; }
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const session = new McpSession(`http://127.0.0.1:${address.port}/mcp`, async () => null);
  assert.equal((await session.tools())[0].name, 'create_pages');
  const search = parseLocalCalls('<|tool_call>call:notion__search{query:<|"|>Journal<|"|>}<tool_call|>').calls[0];
  const parent = JSON.parse(await session.call('search', parseArgs(search.args)));
  const gemma = parseLocalCalls(`<|tool_call>call:notion__create_pages{parent:{page_id:<|"|>${parent.page_id}<|"|>},pages:[{properties:{title:<|"|>Architectural types<|"|>},content:<|"|>${paragraph}<|"|>}]}<tool_call|>`).calls[0];
  assert.match(await session.call('create_pages', coerceArgs(parseArgs(gemma.args), schema)), /Created journal/);
  await assert.rejects(session.call('create_pages', { parent: '{"page_id":"journal-id"}', pages: [] }), /Wrong argument/);
  assert.equal(writes, 1, 'an invalid call must be reported as a failure');
  const gemini = { parent: '{"page_id":"journal-id"}', pages: [{ properties: '{"title":"Architectural types"}', content: paragraph }] };
  assert.match(await session.call('create_pages', coerceArgs(gemini, schema)), /Created journal/);
  assert.equal(writes, 2);
  console.log('Notion-style MCP round trips passed: Gemma calls, nested arguments, failure reporting (local mock only).');
} finally { server.closeIdleConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
