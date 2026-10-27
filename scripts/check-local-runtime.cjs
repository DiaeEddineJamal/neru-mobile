// Exercise preload ordering and stream cancellation without loading a native model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const timers = new Map();
const listeners = new Map();
const loads = [];
let generates = 0;
let repo = 'test';
let lastMessages;
let lastConfig;
let resolveUri;
let delayedUri = false;
const native = {
  load: async uri => { loads.push(uri); },
  unload: async () => {}, cancel: () => {},
  addListener: (event, fn) => { listeners.set(event, fn); return { remove: () => listeners.delete(event) }; },
  generate: async (id, uri, messages, config) => { lastMessages = messages; lastConfig = config; generates++; listeners.get('token')?.({ requestId: id, text: 'Answer <' }); },
};
const mocks = {
  expo: { requireOptionalNativeModule: () => native },
  'expo-file-system': { File: class { exists = true; } },
  'react-native': { Platform: { OS: 'android' } },
  '@/local/models': { installedUri: model => delayedUri ? new Promise(resolve => { resolveUri = resolve; }) : Promise.resolve(model) },
  '@/local/config': { configForLocal: () => ({ systemPrompt: '', thinking: false, maxTokens: 2048, contextTokens: 4096 }) },
  '@/local/catalog': { localModel: () => ({ kind: 'chat', repo, vision: false }) },
  '@/i18n': { t: s => s },
};
const sandbox = { exports: {}, require: name => {
  assert.ok(name in mocks, `Unexpected import ${name}`); return mocks[name];
}, setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), Date, Math };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/local/runtime.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
const runtime = sandbox.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
const fireTimers = async () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await tick(); };

void (async () => {
  runtime.preloadLocal('old'); runtime.preloadLocal('new');
  await fireTimers();
  assert.deepEqual(loads, ['new'], 'rapid model picks only preload the final model');
  delayedUri = true;
  runtime.preloadLocal('stale'); await fireTimers();
  await runtime.unloadLocal(); resolveUri('stale'); await tick();
  assert.deepEqual(loads, ['new'], 'an unload invalidates a pending file lookup');
  const controller = new AbortController();
  const stream = runtime.streamLocal('new', [{ role: 'user', text: 'Hello' }], () => {}, controller.signal, () => {}, () => {});
  await tick(); controller.abort(); resolveUri('new'); await stream;
  assert.equal(generates, 0, 'aborting during file lookup must not start generation');
  delayedUri = false;
  let text = '';
  await runtime.streamLocal('new', [{ role: 'user', text: 'Hello' }], piece => { text += piece; }, new AbortController().signal, () => {}, () => {});
  assert.equal(text, 'Answer <', 'a trailing partial reasoning tag is preserved');
  assert.equal(listeners.size, 0, 'native listeners are removed after generation');
  repo = 'litert-community/Qwen3-0.6B';
  await runtime.streamLocal('new', [{ role: 'user', text: 'One' }, { role: 'assistant', text: 'Answer' }, { role: 'user', text: 'Two' }], () => {}, new AbortController().signal, () => {}, () => {});
  assert.ok(lastMessages.filter(m => m.role === 'user').every(m => m.text.endsWith('/no_think')), 'Qwen keeps non-thinking mode across user turns');
  assert.equal(lastMessages[1].text, 'Answer');
  assert.equal(lastConfig.reuseConversation, false, 'Qwen non-thinking mode rebuilds the conversation while retaining the engine');
  await runtime.streamLocal('new', [{ role: 'user', text: 'Add a Notion journal entry' }], () => {}, new AbortController().signal, () => {}, () => {}, true);
  assert.equal(lastConfig.maxTokens, 1024, 'tool replies reserve context for IDs, schema and tool results');
  const storageKeys = [];
  const toolMocks = {
    react: { useSyncExternalStore: () => {} },
    '@/db': { kvGetSync: key => { storageKeys.push(key); return key === 'tools.unsupported' ? '["gemini\\ngemini-3.8-flash"]' : null; }, kvSet: async () => {} },
    '@/llm/parse': require('../src/llm/parse.ts'),
    '@/llm/vendor': require('../src/llm/vendor.ts'),
    '@/local/catalog': { localModel: () => ({ tools: true }) },
    '@/mcp/store': { allowAlways: () => {}, preapproved: () => false },
  };
  const toolSandbox = { exports: {}, require: name => { assert.ok(name in toolMocks, `Unexpected import ${name}`); return toolMocks[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/llm/tools.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, toolSandbox);
  assert.equal(toolSandbox.exports.toolSupport('gemini', 'gemini-3.8-flash'), 'yes', 'models disabled by old argument errors are retried');
  assert.ok(!storageKeys.includes('tools.unsupported'));
  const names = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const prompt = toolSandbox.exports.localToolPrompt([{ fn: 'test__call', description: 'A tool', schema: { type: 'object', properties: { optional: { type: 'string' }, ...Object.fromEntries(names.map(name => [name, { type: 'string' }])) }, required: names } }]);
  for (const name of names) assert.ok(prompt.includes(`${name}:string`), `required argument ${name} stays visible`);
  const apps = [{ label: 'Gmail', fn: 'gmail__search' }, { label: 'Notion', fn: 'notion__search' }, { label: 'Notion', fn: 'notion__create' }];
  assert.equal(toolSandbox.exports.localToolsForTask(apps, 'Create an architecture paragraph in my Notion journal').length, 2);
  assert.equal(toolSandbox.exports.localToolsForTask(apps, 'Search my connected apps').length, 3);
  console.log('Local runtime checks passed: preload ordering, cancellation, final text, listener cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
