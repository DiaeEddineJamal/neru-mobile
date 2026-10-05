// Self-check for the new-chat greetings: `node src/greetings.check.ts` (Node 22.18+ strips the types).
import assert from 'node:assert';

import { greeting } from './greetings.ts';

for (let h = 0; h < 24; h++) {
  const at = new Date(2026, 9, 5, h);
  let prev = '';
  for (let i = 0; i < 20; i++) {
    const g = greeting('Sam Lee', at);
    assert.ok(g.length > 0 && g.length <= 30, `too long at ${h}h: ${g}`);
    assert.notEqual(g, prev, 'never the same line twice in a row');
    assert.ok(!g.includes('Lee'), 'first name only');
    prev = g;
  }
}
assert.ok(!greeting(undefined, new Date(2026, 9, 5, 9)).includes(', ,'));
console.log('greetings ok', greeting('Luzi', new Date(2026, 9, 5, 9)), '|', greeting('Luzi', new Date(2026, 9, 5, 23)));
