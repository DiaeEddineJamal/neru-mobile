// Self-check for the Remote framing: `node src/remote/crypto.check.ts` (Node 22.18+ strips the types).
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';

import { connectionUrls, open, parsePairing, seal, toBase64Url } from './crypto.ts';

const key = new Uint8Array(randomBytes(32));
const frame = seal(key, new Uint8Array(randomBytes(24)), '{"id":1,"cmd":"hello"}');
assert.equal(open(key, frame), '{"id":1,"cmd":"hello"}');
assert.throws(() => open(new Uint8Array(randomBytes(32)), frame), 'a frame sealed with another key must not open');

const p = parsePairing(`neru://pair?v=1&h=192.168.1.5,10.0.0.2&p=47613&k=${toBase64Url(key)}&n=My%20PC`);
assert.deepEqual([p.hosts, p.port, p.name], [['192.168.1.5', '10.0.0.2'], 47613, 'My PC']);
assert.deepEqual(p.key, key);
assert.throws(() => parsePairing('https://example.com'));
const internet = parsePairing(`neru://pair?v=1&h=192.168.1.5&p=47613&k=${toBase64Url(key)}&u=${encodeURIComponent('wss://desktop.example.com/remote')}`);
assert.deepEqual(connectionUrls(internet), ['wss://desktop.example.com/remote', 'ws://192.168.1.5:47613']);
assert.throws(() => parsePairing(`neru://pair?v=1&h=192.168.1.5&p=47613&k=${toBase64Url(key)}&u=${encodeURIComponent('ws://desktop.example.com')}`));
assert.throws(() => parsePairing(`neru://pair?v=1&h=192.168.1.5&p=99999&k=${toBase64Url(key)}`));
console.log('remote crypto ok');
