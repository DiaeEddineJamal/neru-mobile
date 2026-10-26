const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const root = path.resolve(__dirname, '../src');
const memory = new Map();
const db = { kvGetSync: key => memory.get(key) ?? null, kvSet: async (key, value) => { memory.set(key, value); } };
const react = { useCallback: fn => fn, useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
let nextId = 0;
let launch;
let pending;
let recovered = 0;
const picker = {
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchCameraAsync: () => launch(), launchImageLibraryAsync: () => launch(),
  getPendingResultAsync: async () => { recovered++; return pending; },
};
function moduleFrom(file, deps) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { console, Set, Map, Promise })(name => {
    if (!(name in deps)) throw new Error(`Unexpected import: ${name}`);
    return deps[name];
  }, module, module.exports);
  return module.exports;
}
function boot() {
  const drafts = moduleFrom('drafts.ts', { react, '@/db': db });
  const attach = moduleFrom('attach.ts', {
    'expo-document-picker': {}, 'expo-file-system': {}, 'expo-image-picker': picker,
    '@/db': db, '@/drafts': drafts, '@/store': { uid: () => `image-${++nextId}` },
    '@/ui/confirm': { notice: async () => {} }, '@/i18n': { t: s => s },
  });
  return { drafts, attach };
}
const photo = { canceled: false, assets: [{ uri: 'file:///cache/photo.jpg', mimeType: 'image/jpeg', base64: 'test-image-bytes' }] };
const tick = () => new Promise(resolve => setImmediate(resolve));
const timeout = setTimeout(() => { console.error('Attachment checks timed out'); process.exit(1); }, 10000);
(async () => {
  let { drafts, attach } = boot();
  const chat = drafts.useComposerDraft('chat-a');
  chat.setText('Please describe this photo');
  let finish;
  launch = () => new Promise(resolve => { finish = resolve; });
  const picking = attach.pickPhotos('chat-a');
  await tick();
  assert.equal(memory.get('camera.chat'), 'chat-a');
  assert.equal(attach.cameraChat(), null, 'live picker must not trigger recovery navigation');
  assert.equal(JSON.parse(memory.get('composer.draft.chat-a')).text, 'Please describe this photo');
  finish(photo);
  const photos = await picking;
  assert.equal(photos.length, 1);
  assert.equal(attach.cameraChat(), null);
  chat.setAttachments(current => drafts.mergeAttachments(current, photos));
  await drafts.flushComposerDraft('chat-a');
  assert.equal(drafts.useComposerDraft('chat-a').attachments.length, 1, 'normal result must not duplicate its persisted photo');
  assert.equal(JSON.parse(memory.get('composer.draft.chat-a')).attachments[0].base64, undefined);
  ({ drafts, attach } = boot());
  assert.equal(drafts.useComposerDraft('chat-a').text, 'Please describe this photo');
  assert.equal(drafts.useComposerDraft('chat-a').attachments.length, 1);
  memory.set('camera.chat', 'chat-a'); pending = photo;
  const results = await Promise.all([attach.recoverPhoto(), attach.recoverPhoto()]);
  assert.equal(recovered, 1, 'consume native pending result once');
  assert.equal(results[0][0].id, results[1][0].id);
  assert.equal(drafts.useComposerDraft('chat-a').attachments.length, 2);
  assert.equal(drafts.useComposerDraft('new').attachments.length, 0, 'no leaking to a new chat');
  for (const target of ['task', 'desktop:session-a']) {
    launch = async () => photo;
    await attach.takePhoto(target);
    assert.equal(drafts.useComposerDraft(target).attachments.length, 1);
  }
  launch = async () => ({ canceled: true, assets: null });
  assert.equal((await attach.pickPhotos('chat-a')).length, 0);
  assert.equal(drafts.useComposerDraft('chat-a').attachments.length, 2);
  assert.equal(attach.cameraChat(), null);
  drafts.clearComposerDraft('chat-a');
  await drafts.flushComposerDraft('chat-a');
  ({ drafts } = boot());
  assert.equal(drafts.useComposerDraft('chat-a').text, '');
  assert.equal(drafts.useComposerDraft('chat-a').attachments.length, 0);
  console.log('Attachment checks passed: persistence, gallery/camera targets, live picker, cold recovery, deduplication, cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(timeout));
