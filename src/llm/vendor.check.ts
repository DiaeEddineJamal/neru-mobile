// Self-check for model makers and tool support: `node src/llm/vendor.check.ts`.
import assert from 'node:assert';

import { cloudToolSupport, rejectsTools, vendorOf } from './vendor.ts';

// Pocket Lab repos and cloud ids map to their maker; DeepSeek's Qwen distill stays DeepSeek's.
for (const [id, logo] of [
  ['litert-community/gemma-4-E2B-it-litert-lm', 'gemma'], ['litert-community/functiongemma-270m-ft-mobile-actions', 'gemma'], ['magic_touch', 'google'],
  ['litert-community/DeepSeek-R1-Distill-Qwen-1.5B', 'deepseek'], ['litert-community/Qwen3-0.6B', 'qwen'], ['litert-community/Phi-4-mini-instruct', 'microsoft'],
  ['litert-community/Ministral-3-3B-Instruct-2512', 'mistral'], ['litert-community/SmolLM3-3B', 'huggingface'], ['litert-community/LFM2.5-1.2B-Instruct', 'liquid'],
  ['qwen/qwen3-coder-480b-a35b-instruct', 'qwen'], ['openai/gpt-oss-120b', 'openai'], ['moonshotai/kimi-k2-instruct', 'kimi'], ['z-ai/glm-4.6', 'zai'],
  ['meta/llama-3.3-70b-instruct', 'meta'], ['claude-sonnet-4-5', 'claude'], ['gemini-3.8-flash', 'gemini'], ['codestral-latest', 'mistral'], ['grok-4', 'grok'],
] as const) assert.equal(vendorOf(id)?.logo, logo, id);
assert.equal(vendorOf('auto', 'nvidia')?.logo, 'nvidia', 'an unknown model falls back to its provider');
assert.equal(vendorOf('auto'), null);

assert.equal(cloudToolSupport('openrouter', 'anything:free'), 'yes');
assert.equal(cloudToolSupport('nvidia', 'qwen/qwen3-coder-480b-a35b-instruct'), 'yes');
assert.equal(cloudToolSupport('gemini', 'gemini-3.8-flash'), 'yes');
assert.equal(cloudToolSupport('groq', 'llama-3.3-70b-versatile'), 'yes');
assert.equal(cloudToolSupport('nvidia', 'deepseek-ai/deepseek-r1-distill-qwen-32b'), 'no');
assert.equal(cloudToolSupport('gemini', 'gemma-3-27b-it'), 'no');
assert.equal(cloudToolSupport('custom', 'my-finetune'), 'unknown');

assert.ok(rejectsTools('HTTP 404: No endpoints found that support tool use. Try disabling "jira__search".'));
assert.ok(rejectsTools('HTTP 400: This model does not support tools'));
assert.ok(rejectsTools('HTTP 400: Function calling is not enabled for models/gemma-3-27b-it'));
assert.ok(rejectsTools('HTTP 400: "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set'));
assert.ok(!rejectsTools('HTTP 429: Rate limit reached for tools'), 'a rate limit is not a tools problem');
assert.ok(!rejectsTools('HTTP 400: context length exceeded'));
console.log('vendors ok');
