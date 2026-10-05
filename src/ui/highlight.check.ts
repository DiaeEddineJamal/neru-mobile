// Self-check for the code colouring: `node src/ui/highlight.check.ts` (Node 22.18+ strips the types).
import assert from 'node:assert';

import { tokenize } from './highlight.ts';

const kinds = (code: string, lang: string) => tokenize(code, lang).map(line => line.filter(t => t.text.trim()).map(t => `${t.kind}:${t.text.trim()}`));

assert.deepEqual(kinds('const x = 42; // hi', 'ts')[0], ['keyword:const', 'plain:x =', 'number:42', 'plain:;', 'comment:// hi']);
assert.deepEqual(kinds('return fetch("a")', 'js')[0], ['control:return', 'func:fetch', 'plain:(', 'string:"a"', 'plain:)']);
assert.deepEqual(kinds('<meta charset="UTF-8">', 'html')[0], ['punct:<', 'tag:meta', 'attr:charset', 'plain:=', 'string:"UTF-8"', 'punct:>']);
assert.deepEqual(kinds('<!-- a\nb -->\n<p>', 'html').map(l => l[0]), ['comment:<!-- a', 'comment:b -->', 'punct:<']);
assert.deepEqual(kinds('/* a\nb */ let', 'ts')[1], ['comment:b */', 'keyword:let']);
assert.deepEqual(kinds('def f(): # note', 'python')[0], ['keyword:def', 'func:f', 'plain:():', 'comment:# note']);
assert.deepEqual(kinds('url = "http://x" // c', 'js')[0].at(-1), 'comment:// c');
assert.equal(tokenize('a\nb', 'txt').length, 2);
console.log('highlight ok');
