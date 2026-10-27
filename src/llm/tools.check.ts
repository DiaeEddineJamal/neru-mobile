// Self-check for tool calls in streams and the on-device tool protocol: `node src/llm/tools.check.ts`.
import assert from 'node:assert';

import { beforeCall, CallCollector, cleanSchema, coerceArgs, geminiSchema, localArgumentShape, parseArgs, parseEvent, parseLocalCalls } from './parse.ts';

const quiet = { onDelta: () => {} };
assert.deepEqual(parseArgs(''), {});
assert.deepEqual(parseArgs('{"query":"hello"}'), { query: 'hello' });
for (const invalid of ['{broken', '[]', 'null', '42', '"text"']) assert.throws(() => parseArgs(invalid), /Tool arguments must/);

// Chat Completions: tool calls arrive in pieces by index.
const openai = new CallCollector();
for (const chunk of [
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'jira__search', arguments: '{"q":' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"bug"}' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'gmail__list_labels', arguments: '{}' } }] } }] },
]) parseEvent('openai-chat', JSON.stringify(chunk), quiet, openai);
assert.deepEqual(openai.done(), [{ id: 'call_a', name: 'jira__search', args: '{"q":"bug"}' }, { id: 'call_b', name: 'gmail__list_labels', args: '{}' }]);

// Anthropic: a tool_use block, then its input as JSON deltas.
const claude = new CallCollector();
for (const e of [
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'notion__search' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query"' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"roadmap"}' } },
]) parseEvent('anthropic', JSON.stringify(e), quiet, claude);
assert.deepEqual(claude.done(), [{ id: 'toolu_1', name: 'notion__search', args: '{"query":"roadmap"}' }]);

// Responses: the finished function_call item.
const responses = new CallCollector();
parseEvent('openai-responses', JSON.stringify({ type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'github__get_me', arguments: '{}' } }), quiet, responses);
assert.deepEqual(responses.done(), [{ id: 'call_9', name: 'github__get_me', args: '{}' }]);

// Schemas lose keys providers reject, and always describe an object.
assert.deepEqual(cleanSchema({ $schema: 'x', type: 'object', properties: { a: { type: 'string', $comment: 'c' } } }), { properties: { a: { type: 'string' } }, type: 'object' });
assert.deepEqual(cleanSchema({}), { type: 'object', properties: {} });
// On-device protocol: calls are read out of the text and hidden from it.
const local = parseLocalCalls('Let me look.\n<tool_call>{"name": "jira__search", "arguments": {"q": "login"}}</tool_call>');
assert.equal(local.visible, 'Let me look.');
assert.equal(local.calls.length, 1);
assert.equal(local.calls[0].name, 'jira__search');
assert.equal(local.calls[0].args, '{"q":"login"}');
assert.equal(beforeCall('Sure <tool_call>{"na'), 'Sure ');
assert.equal(parseLocalCalls('No tools here.').calls.length, 0);
// Small models: the JSON alone, fenced or not, counts as a call; JSON that is not a call stays text.
const bare = parseLocalCalls('```json\n{"name": "deepwiki__ask_question", "arguments": {"repoName": "a/b", "question": "What?"}}\n```');
assert.deepEqual([bare.visible, bare.calls[0]?.name, bare.calls[0]?.args], ['', 'deepwiki__ask_question', '{"repoName":"a/b","question":"What?"}']);
assert.equal(parseLocalCalls('{"answer": 42}').calls.length, 0);
// Cloud models on the text protocol: other argument keys, arguments as a JSON string, fenced bodies, no closing tag.
for (const reply of [
  '<tool_call>{"name": "notion__search", "parameters": {"query": "roadmap"}}</tool_call>',
  '<tool_call>{"name": "notion__search", "arguments": "{\\"query\\": \\"roadmap\\"}"}</tool_call>',
  '<tool_call>\n```json\n{"name": "notion__search", "arguments": {"query": "roadmap"}}\n```\n</tool_call>',
  'Searching.\n<tool_call>{"name": "notion__search", "arguments": {"query": "roadmap"}}',
]) {
  const parsed = parseLocalCalls(reply);
  assert.equal(parsed.calls.length, 1, reply);
  assert.deepEqual(JSON.parse(parsed.calls[0].args), { query: 'roadmap' });
  assert.ok(!parsed.visible.includes('tool_call'));
}
assert.equal(beforeCall('{"name": "x"'), '');
// Liquid's LFM2 format, with Python-style arguments.
const lfm = parseLocalCalls('Checking.<|tool_call_start|>[exa__web_search(query="mcp spec", numResults=3, live=True)]<|tool_call_end|>');
assert.deepEqual([lfm.visible, lfm.calls[0]?.name, JSON.parse(lfm.calls[0]?.args ?? '{}')], ['Checking.', 'exa__web_search', { query: 'mcp spec', numResults: 3, live: true }]);
assert.equal(beforeCall('Checking.<|tool_call_start|>[exa'), 'Checking.');
const two = parseLocalCalls('<|tool_call_start|>[{"name": "a__one", "arguments": {}}, {"name": "a__two", "arguments": {"x": "y, z"}}]<|tool_call_end|>');
assert.deepEqual(two.calls.map(c => [c.name, c.args]), [['a__one', '{}'], ['a__two', '{"x":"y, z"}']]);
// Gemma 4's trained format must preserve nested Notion inputs and punctuation inside a paragraph.
const paragraph = 'Architectural types: residential, civic and sacred; forms include {courtyards}, "vaults", and towers.';
const gemma = parseLocalCalls(`I will add it. <|tool_call>call:notion__create_pages{parent:{page_id:<|"|>journal-id<|"|>},pages:[{properties:{title:<|"|>Architectural types<|"|>},content:<|"|>${paragraph}<|"|>}]}<tool_call|><|tool_response>`);
assert.equal(gemma.visible, 'I will add it.');
assert.deepEqual(JSON.parse(gemma.calls[0].args), { parent: { page_id: 'journal-id' }, pages: [{ properties: { title: 'Architectural types' }, content: paragraph }] });
assert.equal(beforeCall('Adding it. <|tool_call>call:notion'), 'Adding it. ');
assert.equal(parseLocalCalls('<|tool_call>call:x{content:<|"|>unfinished}<tool_call|>').calls.length, 0);

// Gemini (HTTP 400 "Request contains an invalid argument" otherwise): every schema must fit its OpenAPI subset.
const GEMINI_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
function assertGemini(s: Record<string, unknown>, at = 'root') {
  for (const k of Object.keys(s)) assert.ok(['type', 'format', 'description', 'nullable', 'enum', 'items', 'properties', 'required', 'minItems', 'maxItems', 'minimum', 'maximum'].includes(k), `${at}: ${k}`);
  if (s.anyOf) return (s.anyOf as Record<string, unknown>[]).forEach((b, i) => assertGemini(b, `${at}.anyOf${i}`));
  assert.ok(GEMINI_TYPES.includes(s.type as string), `${at}: type ${JSON.stringify(s.type)}`);
  if (s.enum) assert.ok(s.type === 'string' && (s.enum as unknown[]).every(v => typeof v === 'string'), `${at}: enum`);
  if (s.format) assert.ok((s.type === 'string' && ['enum', 'date-time'].includes(s.format as string)) || s.type !== 'string', `${at}: format ${s.format}`);
  if (s.type === 'array') assertGemini(s.items as Record<string, unknown>, `${at}[]`);
  if (s.type === 'object') {
    const props = s.properties as Record<string, Record<string, unknown>>;
    assert.ok(props && Object.keys(props).length, `${at}: empty object`);
    for (const r of (s.required as string[]) ?? []) assert.ok(r in props, `${at}: required ${r}`);
    for (const [k, p] of Object.entries(props)) assertGemini(p, `${at}.${k}`);
  }
}
// Shaped like Notion's hosted tools: $ref, const, oneOf, uri/uuid formats, type lists, maps and number enums.
const notion = {
  $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false,
  $defs: { parent: { oneOf: [{ type: 'object', properties: { page_id: { type: 'string', format: 'uuid' }, type: { const: 'page_id' } }, required: ['page_id'] }, { type: 'object', properties: { database_id: { type: 'string', format: 'uuid' } }, required: ['database_id'] }] } },
  properties: {
    parent: { $ref: '#/$defs/parent' },
    pages: { type: 'array', minItems: 1, items: { type: 'object', properties: { properties: { type: 'object', additionalProperties: { type: ['string', 'number', 'null'] } }, content: { type: 'string', default: '' }, icon: { type: ['string', 'null'], format: 'uri' } }, required: ['properties'] } },
    page_size: { type: 'integer', enum: [10, 25, 50], exclusiveMinimum: 0 },
    filter: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
  },
  required: ['parent', 'pages', 'missing'],
};
const g = geminiSchema(notion)!;
assertGemini(g);
const typedParents = geminiSchema({ type: 'object', properties: { parent: { oneOf: [
  { type: 'object', properties: { page_id: { type: 'string' }, type: { const: 'page_id' } } },
  { type: 'object', properties: { data_source_id: { type: 'string' }, type: { const: 'data_source_id' } } },
] } } })!;
assert.ok(JSON.stringify(typedParents).includes('"enum":["page_id","data_source_id"]'), 'both parent type choices survive schema conversion');
// Hosted Notion permits a special string parent as well as page/data-source objects. Describe the object
// variants rather than collapsing the whole union to that special string.
const journalSchema = { type: 'object', properties: {
  parent: { anyOf: [{ type: 'string', enum: ['memory'] }, { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] }, { type: 'object', properties: { data_source_id: { type: 'string' } }, required: ['data_source_id'] }] },
  pages: { type: 'array', items: { type: 'object', properties: { properties: { type: 'object', additionalProperties: true }, content: { type: 'string' } } } },
}, required: ['pages'] };
const journalGemini = geminiSchema(journalSchema)!;
assertGemini(journalGemini);
assert.equal((journalGemini.properties as Record<string, Record<string, unknown>>).parent.type, 'object');
assert.deepEqual(coerceArgs({ parent: '{"page_id":"journal-id"}', pages: [{ properties: '{"title":"Architectural types"}', content: paragraph }] }, journalSchema), { parent: { page_id: 'journal-id' }, pages: [{ properties: { title: 'Architectural types' }, content: paragraph }] });
assert.deepEqual(coerceArgs({ parent: 'memory' }, journalSchema), { parent: 'memory' });
const journalShape = localArgumentShape(journalSchema);
for (const field of ['page_id', 'data_source_id', 'pages', 'content', 'properties']) assert.ok(journalShape.includes(field), `local Notion schema includes ${field}`);
assert.equal(geminiSchema({ type: 'object', properties: {} }), null, 'no parameters for a tool without arguments');
assert.deepEqual((g.properties as Record<string, Record<string, unknown>>).page_size, { type: 'string', enum: ['10', '25', '50'] });
// What the model writes back for those fields becomes what Notion expects.
assert.deepEqual(coerceArgs({ parent: { page_id: 'p1' }, pages: [{ properties: '{"Name":"Bug"}' }], page_size: '25', filter: '{"a":1}' }, notion), { parent: { page_id: 'p1' }, pages: [{ properties: { Name: 'Bug' } }], page_size: 25, filter: { a: 1 } });
// Nested optional values and typed maps must reach the connector with their original JSON types.
assert.deepEqual(coerceArgs({ limit: '1e2', enabled: 'false', entries: '[{"count":"3"}]', counts: { open: '2' } }, {
  type: 'object', properties: {
    limit: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    enabled: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    entries: { anyOf: [{ type: 'array', items: { type: 'object', properties: { count: { type: 'integer' } } } }, { type: 'null' }] },
    counts: { type: 'object', additionalProperties: { type: 'integer' } },
  },
}), { limit: 100, enabled: false, entries: [{ count: 3 }], counts: { open: 2 } });
assert.deepEqual(coerceArgs({ count: '2.5', either: '42', huge: '1e999' }, { properties: { count: { type: 'integer' }, either: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, huge: { type: 'number' } } }), { count: '2.5', either: '42', huge: '1e999' });
const escapedRef = { type: 'object', $defs: { 'a/b': { type: 'integer' } }, properties: { count: { $ref: '#/$defs/a~1b' } } };
assert.deepEqual(coerceArgs({ count: '3' }, escapedRef), { count: 3 });
assertGemini(geminiSchema(escapedRef)!);
assert.deepEqual(coerceArgs({ kind: 'numeric', value: '3' }, { oneOf: [
  { type: 'object', properties: { kind: { const: 'numeric' }, value: { type: 'integer' } } },
  { type: 'object', properties: { kind: { const: 'text' }, value: { type: 'string' } } },
] }), { kind: 'numeric', value: 3 });
assert.deepEqual(coerceArgs({ shared: 's', kind: 'numeric', value: '3' }, { type: 'object', properties: { shared: { type: 'string' } }, oneOf: [
  { type: 'object', properties: { kind: { const: 'numeric' }, value: { type: 'integer' } } },
  { type: 'object', properties: { kind: { const: 'text' }, value: { type: 'string' } } },
] }), { shared: 's', kind: 'numeric', value: 3 });
// The live schemas of the catalog's open servers, saved by scripts while checking them, when present.
const live = process.argv[2] ? JSON.parse((await import('node:fs')).readFileSync(process.argv[2], 'utf8')) as Record<string, Record<string, unknown>> : {};
for (const [name, schema] of Object.entries(live)) { const s = geminiSchema(schema); if (s) assertGemini(s, name); }
// Gemini 3's thought signature rides along with the call.
const signed = new CallCollector();
parseEvent('openai-chat', JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'notion__search', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig' } } }] } }] }), quiet, signed);
assert.deepEqual(signed.done()[0].extra, { google: { thought_signature: 'sig' } });
console.log(`tool streams ok; gemini schemas ok (${Object.keys(live).length} live)`);
