// Self-check for the artifact parser, mostly on malformed model output: `node src/artifacts/parse.check.ts`.
import assert from 'node:assert';

import { splitArtifacts, type Artifact, type Segment } from './parse.ts';

let passed = 0;
const arts = (segs: Segment[]): Artifact[] => segs.flatMap(s => (s.type === 'artifact' ? [s.artifact] : []));
const texts = (segs: Segment[]): string[] => segs.flatMap(s => (s.type === 'text' ? [s.text] : []));
function check(name: string, input: string, test: (segs: Segment[]) => void) {
  let segs: Segment[];
  try {
    segs = splitArtifacts(input);
    test(segs);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
  passed++;
}

const PAGE = '<!DOCTYPE html>\n<html>\n<head><title>Tip calculator</title></head>\n<body>\n<h1>Tips</h1>\n<input id="a">\n<script>\nconsole.log(1 < 2)\n</script>\n</body>\n</html>';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${'<circle cx="50" cy="50" r="40" fill="tomato"/>'.repeat(10)}</svg>`;

// 1. A proper tag, with text around it.
check('proper tag', 'Here it is:\n\n<artifact id="tip-calc" type="html" title="Tip calculator">\n' + PAGE + '\n</artifact>\n\nEnjoy!', segs => {
  assert.deepEqual(segs.map(s => s.type), ['text', 'artifact', 'text']);
  const [a] = arts(segs);
  assert.equal(a.id, 'tip-calc');
  assert.equal(a.kind, 'html');
  assert.equal(a.title, 'Tip calculator');
  assert.equal(a.open, false);
  assert.equal(a.content, PAGE);
  assert.deepEqual(texts(segs), ['Here it is:', 'Enjoy!']);
});

// 2. Unclosed while streaming: open, same id as when finished.
check('unclosed streaming', 'Sure.\n<artifact id="notes" type="markdown" title="Notes">\n# Notes\n- one\n- tw', segs => {
  const [a] = arts(segs);
  assert.equal(a.open, true);
  assert.equal(a.id, 'notes');
  assert.equal(a.content, '# Notes\n- one\n- tw');
});

// 3. Stable ids across stream updates, even without an id attribute.
{
  const full = 'Intro\n<artifact title="My Report">\n# Report\nBody text\n</artifact>\nOutro';
  const ids = new Set<string>();
  for (let n = 30; n <= full.length; n += 7) for (const a of arts(splitArtifacts(full.slice(0, n)))) ids.add(a.id);
  for (const a of arts(splitArtifacts(full))) ids.add(a.id);
  assert.deepEqual([...ids], ['my-report']);
  passed++;
}

// 4. Single quotes, attributes in another order, uppercase tag.
check('single quotes uppercase', "<ARTIFACT TITLE='Hello world' TYPE='code' LANGUAGE='python' ID='hello'>\nprint('hi')\n</ARTIFACT>", segs => {
  const [a] = arts(segs);
  assert.equal(a.id, 'hello');
  assert.equal(a.kind, 'code');
  assert.equal(a.language, 'python');
  assert.equal(a.title, 'Hello world');
  assert.equal(a.content, "print('hi')");
});

// 5. Missing closing quote and unquoted values.
check('broken quotes', '<artifact id="budget type=markdown title=Monthly budget plan>\n# Budget\n</artifact>', segs => {
  const [a] = arts(segs);
  assert.equal(a.id, 'budget');
  assert.equal(a.kind, 'markdown');
  assert.equal(a.title, 'Monthly budget plan');
});

// 6. No attributes at all: kind inferred from the content (html, svg, mermaid, fenced code).
check('no attrs html', '<artifact>\n' + PAGE + '\n</artifact>', segs => {
  const [a] = arts(segs);
  assert.equal(a.kind, 'html');
  assert.equal(a.title, 'Tip calculator');
  assert.ok(a.id);
});
check('no attrs svg', '<artifact>' + SVG + '</artifact>', segs => assert.equal(arts(segs)[0].kind, 'svg'));
check('no attrs mermaid', '<artifact>\ngraph TD\n  A --> B\n</artifact>', segs => assert.equal(arts(segs)[0].kind, 'mermaid'));
check('no attrs fenced code', '<artifact>\n```rust\nfn main() {}\n```\n</artifact>', segs => {
  const [a] = arts(segs);
  assert.equal(a.kind, 'code');
  assert.equal(a.language, 'rust');
  assert.equal(a.content, 'fn main() {}');
});

// 7. The whole tag wrapped in a ``` fence.
check('tag in fence', 'Done:\n```html\n<artifact id="p" type="html" title="P">\n' + PAGE + '\n</artifact>\n```\nBye', segs => {
  assert.deepEqual(segs.map(s => s.type), ['text', 'artifact', 'text']);
  assert.deepEqual(texts(segs), ['Done:', 'Bye']);
  assert.equal(arts(segs)[0].content, PAGE);
});

// 8. Stray fences inside the body.
check('fence inside body', '<artifact id="s" type="code" language="ts" title="S">\n```ts\nconst a = 1;\n```\n</artifact>', segs => {
  const [a] = arts(segs);
  assert.equal(a.content, 'const a = 1;');
  assert.equal(a.language, 'ts');
});

// 9. antArtifact style.
check('antArtifact', '<antArtifact identifier="sorter" type="application/vnd.ant.code" language="python" title="Sorter">\ndef sort(x):\n    return sorted(x)\n</antArtifact>', segs => {
  const [a] = arts(segs);
  assert.equal(a.id, 'sorter');
  assert.equal(a.kind, 'code');
  assert.equal(a.language, 'python');
});
check('antArtifact mime types', '<antArtifact identifier="logo" type="image/svg+xml" title="Logo">' + SVG + '</antArtifact><antArtifact identifier="flow" type="application/vnd.ant.mermaid" title="Flow">graph LR\nA-->B</antArtifact>', segs => {
  assert.deepEqual(arts(segs).map(a => a.kind), ['svg', 'mermaid']);
});

// 10. Duplicate and stray closing tags.
check('duplicate closing', 'A\n<artifact id="x" type="markdown" title="X">\nHello\n</artifact></artifact>\n</artifact>\nB', segs => {
  assert.deepEqual(segs.map(s => s.type), ['text', 'artifact', 'text']);
  assert.deepEqual(texts(segs), ['A', 'B']);
});

// 11. A second opening tag before the first was closed: the first ends there.
check('nested open', '<artifact id="one" type="markdown" title="One">\nFirst\n<artifact id="two" type="markdown" title="Two">\nSecond\n</artifact>', segs => {
  const [a, b] = arts(segs);
  assert.equal(a.id, 'one');
  assert.equal(a.content, 'First');
  assert.equal(a.open, false);
  assert.equal(b.id, 'two');
  assert.equal(b.content, 'Second');
});

// 12. HTML-escaped tag and content.
check('escaped', '&lt;artifact id=&quot;e&quot; type=&quot;html&quot; title=&quot;Esc&quot;&gt;\n&lt;!DOCTYPE html&gt;&lt;html&gt;&lt;body&gt;Hi&lt;/body&gt;&lt;/html&gt;\n&lt;/artifact&gt;', segs => {
  const [a] = arts(segs);
  assert.equal(a.id, 'e');
  assert.equal(a.kind, 'html');
  assert.equal(a.content, '<!DOCTYPE html><html><body>Hi</body></html>');
  assert.equal(texts(segs).length, 0);
});

// 13. Small model: a long ```html page with no tag at all is promoted; a short snippet is not.
check('bare fenced page', 'Here is your page:\n\n```html\n' + PAGE + '\n```\n\nOpen it in a browser.', segs => {
  assert.deepEqual(segs.map(s => s.type), ['text', 'artifact', 'text']);
  const [a] = arts(segs);
  assert.equal(a.kind, 'html');
  assert.equal(a.title, 'Tip calculator');
  assert.equal(a.content, PAGE);
});
check('short snippet stays code', 'Use:\n```html\n<b>bold</b>\n```', segs => assert.equal(arts(segs).length, 0));
check('bare fenced page streaming', '```html\n<!DOCTYPE html>\n<html>\n<body>', segs => {
  const [a] = arts(segs);
  assert.equal(a.open, true);
  assert.equal(a.kind, 'html');
});
check('large svg fence', '```svg\n' + SVG + '\n```', segs => assert.equal(arts(segs)[0].kind, 'svg'));
check('bare doctype no fence', 'Page:\n<!DOCTYPE html>\n<html><body>x</body></html>\nThanks', segs => {
  assert.deepEqual(segs.map(s => s.type), ['text', 'artifact', 'text']);
  assert.equal(arts(segs)[0].open, false);
});

// 14. Partial tags at the end of a stream are hidden.
check('partial open tag', 'Let me write it.\n<artif', segs => assert.deepEqual(texts(segs), ['Let me write it.']));
check('tag mid-attributes', 'Ok\n<artifact id="x" type="ht', segs => {
  assert.deepEqual(texts(segs), ['Ok']);
  assert.equal(arts(segs).length, 0);
});
check('partial close tag', '<artifact id="x" type="markdown" title="X">\nBody\n</artif', segs => {
  const [a] = arts(segs);
  assert.equal(a.content, 'Body');
});

// 15. Forgotten `>` before the content.
check('missing >', '<artifact id="pg" type="html" title="Pg"\n' + PAGE + '\n</artifact>', segs => {
  const [a] = arts(segs);
  assert.equal(a.id, 'pg');
  assert.equal(a.content, PAGE);
});

// 16. A tag quoted as inline code is left alone; plain answers are untouched.
check('inline code mention', 'Wrap it in `<artifact>` tags.', segs => assert.deepEqual(segs, [{ type: 'text', text: 'Wrap it in `<artifact>` tags.' }]));
check('plain answer', 'The capital of France is Paris.', segs => assert.deepEqual(segs, [{ type: 'text', text: 'The capital of France is Paris.' }]));

// 17. Two artifacts with the same id in one reply get distinct ids.
check('duplicate ids', '<artifact id="a" type="markdown" title="A">1</artifact>\n<artifact id="a" type="markdown" title="A">2</artifact>', segs => {
  assert.deepEqual(arts(segs).map(a => a.id), ['a', 'a-2']);
});

// 18. Multi-line attributes and smart quotes.
check('multiline attrs', '<artifact id=“plan”\n  type="markdown"\n  title="Trip plan">\n# Trip\n</artifact>', segs => {
  const [a] = arts(segs);
  assert.equal(a.id, 'plan');
  assert.equal(a.title, 'Trip plan');
  assert.equal(a.kind, 'markdown');
});

// 19. Never throws, whatever comes in.
for (const junk of ['', '<', '<artifact', '<artifact>', '</artifact>', '<artifact id="', '```', '```html\n', '&lt;artifact', '<artifact type=>`', '\u0000<artifact\u0000>', null, undefined, 42]) {
  assert.doesNotThrow(() => splitArtifacts(junk as unknown as string));
}
passed++;
for (let n = 0; n <= PAGE.length + 60; n++) splitArtifacts(('x\n<artifact id="z">\n' + PAGE + '\n</artifact>').slice(0, n));
passed++;

console.log(`artifact parser: ${passed} checks passed`);
