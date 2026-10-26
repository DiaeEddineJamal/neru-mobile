const assert = require('node:assert/strict');
const additions = require('../src/local/extra-models.json');

for (const model of additions) {
  assert.match(model.revision, /^[a-f0-9]{40}$/);
  assert.match(model.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(model.bytes) && model.bytes > 0);
  assert.ok(model.memory >= 4);
  assert.ok(model.file.endsWith('.litertlm'), 'Pocket Lab runs LiteRT-LM models only');
}
assert.equal(new Set(additions.map(m => m.id)).size, additions.length);
for (const id of ['lfm2.5-vl-3b', 'lfm2.5-vl-1.6b', 'lfm2.5-2.6b', 'lfm2.5-1.2b-thinking', 'lfm2-700m']) assert.ok(additions.some(m => m.id === id), id);
for (const model of additions.filter(m => m.vision)) {
  assert.match(model.file, /_fixB\.litertlm$/, 'use the full-image vision repair');
  assert.equal(model.maxImages, 1);
}
console.log(`Local model checks passed: ${additions.length} pinned artifacts and vision repair.`);
