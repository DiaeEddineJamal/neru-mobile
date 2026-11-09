// Self-check for safety-filter stops: `node src/llm/flagged.check.ts`.
import assert from 'node:assert';

import { flaggedError, flagReason } from './flagged.ts';

const chat = (finish: string) => JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] });
assert.equal(flagReason('openai-chat', chat('content_filter')), 'content_filter');
assert.equal(flagReason('openai-chat', chat('SAFETY')), 'SAFETY', 'Gemini through its OpenAI endpoint');
assert.equal(flagReason('openai-chat', chat('stop')), null);
assert.equal(flagReason('openai-chat', JSON.stringify({ choices: [{ delta: { content: 'Safety first: content_filter is a word' } }] })), null, 'words in text are not a stop');
assert.equal(flagReason('openai-chat', JSON.stringify({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] })), 'PROHIBITED_CONTENT');
assert.equal(flagReason('openai-chat', JSON.stringify({ candidates: [{ finishReason: 'RECITATION' }] })), 'RECITATION');
assert.equal(flagReason('openai-chat', JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })), 'SAFETY');
assert.equal(flagReason('anthropic', JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'refusal' } })), 'refusal');
assert.equal(flagReason('anthropic', JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })), null);
assert.equal(flagReason('openai-responses', JSON.stringify({ type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } })), 'content_filter');
assert.equal(flagReason('openai-chat', '[DONE]'), null);
assert.match(flaggedError('content_filter').message, /flagged/);
console.log('flagged ok');
