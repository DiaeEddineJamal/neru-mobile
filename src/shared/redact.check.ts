// Self-check for the secret scanner: `node src/shared/redact.check.ts` (Node 22.18+ strips the types).
import assert from 'node:assert';

import { findSecrets, redact } from './redact.ts';

const hide = (t: string) => redact(t).text;

assert.equal(hide('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx1234'), 'OPENAI_API_KEY=[secret removed: OpenAI key]');
assert.equal(hide('DB_PASSWORD="hunter2hunter2"'), 'DB_PASSWORD="[secret removed: DB_PASSWORD]"');
assert.equal(hide('postgres://neru:s3cretpass@db.local:5432/app'), 'postgres://neru:[secret removed: password]@db.local:5432/app');
assert.equal(hide('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'token: [secret removed: GitHub token]');
assert.ok(hide('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----').startsWith('[secret removed: private key]'));
assert.equal(hide('AWS AKIAIOSFODNN7EXAMPLE here'), 'AWS [secret removed: AWS key] here');
// Not secrets: placeholders, ordinary code, prose.
for (const fine of ['API_KEY=your-key-here', 'password = process.env.DB_PASSWORD', 'const token = getToken()', 'Set the TOKEN env var first.', 'SECRET=${SECRET}', 'author: someone']) {
  assert.deepEqual(findSecrets(fine), [], fine);
}
// Overlaps count once, and text around them stays.
const both = redact('key sk-ant-abcdefghijklmnopqrstuvwxyz and AIzaSyA1234567890abcdefghijklmnopqrstuv end');
assert.equal(both.secrets.length, 2);
assert.ok(both.text.endsWith(' end'));
console.log('redact ok');
