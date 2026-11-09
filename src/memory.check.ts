// Self-check for memory's pure parts: `node src/memory.check.ts` (Node 22.18+ strips the types).
import assert from 'node:assert';

import { assembleMemoryPrompt, cleanMemory, excerpt, pastChatSnippets, scoreChats, shouldSynthesize, tokenize, transcript, trimTo, PACE, type ChatDoc } from './memory/core.ts';

const day = 86_400_000;
const doc = (id: string, title: string, texts: string[], at = 0): ChatDoc => ({
  id,
  title,
  updatedAt: at,
  messages: texts.map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', text, createdAt: at + i })),
});
const docs = [
  doc('a', 'Sourdough starter', ['My sourdough starter smells like acetone, what now?', 'Feed it more often.'], 3 * day),
  doc('b', 'Expo router tabs', ['How do I add tabs with Expo Router in my React Native app?', 'Use a Tabs layout.'], 2 * day),
  doc('c', 'Trip to Lisbon', ['Plan three days in Lisbon with good café stops', 'Day 1: Alfama.'], 1 * day),
];
const date = (ms: number) => `day ${Math.round(ms / day)}`;

// tokenize: accents, stop words, short words
assert.deepEqual(tokenize('The Café in Lisbon, a été'), ['cafe', 'lisbon', 'ete']);

// scoring: the matching chat first, unrelated ones left out
const ranked = scoreChats('expo router navigation tabs', docs);
assert.equal(ranked[0].doc.id, 'b');
assert.ok(!ranked.some(r => r.doc.id === 'a'));
assert.deepEqual(scoreChats('', docs), []);
assert.deepEqual(scoreChats('the and', docs), []);

// excerpt keeps the match and marks cuts
const long = `${'x '.repeat(300)}needle here ${'y '.repeat(300)}`;
const ex = excerpt(long, ['needle'], 80);
assert.ok(ex.includes('needle') && ex.startsWith('…') && ex.endsWith('…') && ex.length <= 82);

// snippets: within budget, labelled, secrets cleaned
const snips = pastChatSnippets('lisbon cafe ideas', docs, 400, date, s => s.replace(/Alfama/g, '[x]'));
assert.equal(snips.length, 1);
assert.ok(snips[0].startsWith('- "Trip to Lisbon" (day 1)'));
assert.ok(snips.join('\n').length <= 400);
assert.ok(pastChatSnippets('lisbon expo sourdough', docs, 120, date).join('\n').length <= 120);

// prompt assembly: empty → '', local trims memory
assert.equal(assembleMemoryPrompt({ local: false }), '');
const memory = Array.from({ length: 80 }, (_, i) => `- fact number ${i}`).join('\n');
const local = assembleMemoryPrompt({ memory, local: true });
const cloud = assembleMemoryPrompt({ memory, local: false });
assert.ok(local.length < 800 && cloud.length > local.length);
assert.ok(local.startsWith('What you remember about the user'));
const both = assembleMemoryPrompt({ memory: '- likes tea', projectName: 'Garden', projectMemory: '- raised beds', snippets: ['- "x" (day 1)'], local: false });
assert.ok(both.includes('project "Garden"') && both.includes('raised beds') && both.includes('past conversations'));
assert.ok(!/claude|anthropic/i.test(both));

// trimTo
assert.equal(trimTo('short', 10), 'short');
assert.ok(trimTo('one two three four five six', 12).endsWith('…'));

// transcript: only new messages, within budget, newest chat first
const tr = transcript(docs, 2 * day, 2000, date);
assert.ok(tr.startsWith('## Sourdough starter') && !tr.includes('Lisbon') && tr.includes('Expo'));
assert.ok(transcript(docs, 0, 400, date).length <= 400);
assert.equal(transcript(docs, 10 * day, 2000, date), '');

// cleaning model output
assert.equal(cleanMemory('<think>hmm</think>\n```markdown\n## Work\n- Builds apps\n```'), '## Work\n- Builds apps');
assert.equal(cleanMemory('(empty)'), '');

// pacing
const now = 100 * day;
assert.equal(shouldSynthesize(now, now - 60_000, 50), false, 'never within minGap');
assert.equal(shouldSynthesize(now, now - PACE.minGapMs, PACE.batch), true);
assert.equal(shouldSynthesize(now, now - PACE.minGapMs, 1), false);
assert.equal(shouldSynthesize(now, now - PACE.maxGapMs, 1), true);
assert.equal(shouldSynthesize(now, 0, 0), false);

console.log('memory ok');
