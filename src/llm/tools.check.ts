// Self-check for tool calls in streams and the on-device tool protocol: `node src/llm/tools.check.ts`.
import assert from 'node:assert';

import { beforeCall, CallCollector, cleanSchema, parseEvent, parseLocalCalls } from './parse.ts';

const quiet = { onDelta: () => {} };

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
assert.equal(beforeCall('{"name": "x"'), '');
// Liquid's LFM2 format, with Python-style arguments.
const lfm = parseLocalCalls('Checking.<|tool_call_start|>[exa__web_search(query="mcp spec", numResults=3, live=True)]<|tool_call_end|>');
assert.deepEqual([lfm.visible, lfm.calls[0]?.name, JSON.parse(lfm.calls[0]?.args ?? '{}')], ['Checking.', 'exa__web_search', { query: 'mcp spec', numResults: 3, live: true }]);
assert.equal(beforeCall('Checking.<|tool_call_start|>[exa'), 'Checking.');
const two = parseLocalCalls('<|tool_call_start|>[{"name": "a__one", "arguments": {}}, {"name": "a__two", "arguments": {"x": "y, z"}}]<|tool_call_end|>');
assert.deepEqual(two.calls.map(c => [c.name, c.args]), [['a__one', '{}'], ['a__two', '{"x":"y, z"}']]);
console.log('tool streams ok');
