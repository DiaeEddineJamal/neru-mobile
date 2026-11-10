// Self-check for the Office file builders: `node src/artifacts/office.check.ts [outDir]`.
// Builds a sample Word, PowerPoint and Excel file, checks the zip and every XML part, and with an out dir writes the
// files there so they can be opened in Office.
import assert from 'node:assert';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from '../components/markdown/parse.ts';
import { docx, parseCsv, plain, pptx, runs, sheetsFrom, splitSlides, xlsx, type FigureLookup } from './office.ts';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  void name;
}

/** The entries of a stored zip, read back from its central directory. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out[name] = dec.decode(bytes.subarray(start, start + size));
    at += 46 + nameLen;
  }
  return out;
}

/** A rough well-formedness check: every opened tag closes in order. */
function wellFormed(name: string, src: string) {
  const stack: string[] = [];
  const tag = /<(\/?)([\w:.-]+)[^>]*?(\/?)>/g;
  const body = src.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `${name}: </${m[2]}> closes the wrong tag`);
    else stack.push(m[2]);
  }
  assert.equal(stack.length, 0, `${name}: unclosed ${stack.join(', ')}`);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(body), `${name}: bare &`);
}

check('inline runs', () => {
  assert.deepEqual(runs('a **b** _c_ `d` [e](https://x.y)'), [
    { text: 'a ' }, { text: 'b', b: true }, { text: ' ' }, { text: 'c', i: true }, { text: ' ' }, { text: 'd', code: true }, { text: ' ' }, { text: 'e', link: 'https://x.y' },
  ]);
  assert.equal(plain('snake_case_name and 2*3*4'), 'snake_case_name and 2*3*4');
  assert.equal(plain('**Total:** 5'), 'Total: 5');
});

check('csv', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n'), [['a', 'b'], ['x, y', '2']]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

const DOC = `# Quarterly report

A short **summary** with a [link](https://example.com) & an ampersand <tag>.

## Results

1. First
2. Second
   - nested bullet
- Bullet after

| Region | Sales | Share |
|:--|--:|:-:|
| North | 1,200 | 40% |
| South | 1,800 | 60% |

> A quote

\`\`\`
const x = 1;
\`\`\`

---

The end.`;

const DECK = `# Neru launch
Our plan for the next quarter

---

# Why now
- Phones are fast enough
  - even mid-range ones
- People want privacy
- **Free** models got good

---

# Numbers
| Metric | Q1 | Q2 |
|---|---|---|
| Users | 1,000 | 4,500 |
| Revenue | $2k | $9k |

---

## Next steps
1. Ship
2. Listen`;

const SHEET = `## Budget
| Item | Qty | Price | Total |
|---|---|---|---|
| Laptop | 2 | 1,200 | =B2*C2 |
| Phone | 3 | 450.50 | =B3*C3 |
| Sum | | | =SUM(D2:D3) |

## Rates
| Name | Rate |
|---|---|
| A | 12.5% |`;

// Figures: a ```chart block becomes a picture. The check uses a real PNG when one is passed (argv[3]), else a 1×1.
const PNG = process.argv[3] ? new Uint8Array(readFileSync(process.argv[3])) : Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const figure: FigureLookup = lang => (lang === 'chart' ? { png: PNG, width: 640, height: 330, alt: 'Chart: Model accuracy' } : undefined);
const FIG_DOC = `# Report\n\nAccuracy by model:\n\n\`\`\`chart\n{"type":"bar"}\n\`\`\`\n\nThe end.`;
const FIG_DECK = `# Results\nQ3 review\n\n---\n\n# Accuracy\n- Forests lead\n- SVM close behind\n\n\`\`\`chart\n{"type":"bar"}\n\`\`\`\n\n---\n\n# Chart only\n\`\`\`chart\n{"type":"bar"}\n\`\`\``;

const files = {
  'sample.docx': docx(parse(DOC), 'Quarterly report'),
  'sample.pptx': pptx(splitSlides(DECK, parse), 'Neru launch'),
  'figures.docx': docx(parse(FIG_DOC), 'Report', figure),
  'figures.pptx': pptx(splitSlides(FIG_DECK, parse), 'Results', figure),
  'sample.xlsx': xlsx(sheetsFrom(SHEET, parse), 'Budget'),
  'csv.xlsx': xlsx(sheetsFrom('Name,Score\nAda,"9,5"\nBob,7', parse), 'Scores'),
};

check('slides split', () => {
  const slides = splitSlides(DECK, parse);
  assert.equal(slides.length, 4);
  assert.equal(slides[0].title, 'Neru launch');
  assert.equal(slides[3].title, 'Next steps');
});

check('sheets', () => {
  const sheets = sheetsFrom(SHEET, parse);
  assert.deepEqual(sheets.map(s => s.name), ['Budget', 'Rates']);
  assert.equal(sheets[0].rows[1][3], '=B2*C2');
});

for (const [name, bytes] of Object.entries(files)) {
  check(name, () => {
    const parts = unzip(bytes);
    assert.ok(parts['[Content_Types].xml'] && parts['_rels/.rels']);
    for (const [part, src] of Object.entries(parts)) if (/\.(xml|rels)$/.test(part)) wellFormed(`${name}/${part}`, src);
  });
}

check('figures', () => {
  const doc = unzip(files['figures.docx']);
  assert.ok(doc['word/media/figure1.png'] !== undefined, 'docx picture');
  assert.ok(doc['word/document.xml'].includes('r:embed="rIdImg1"') && doc['word/_rels/document.xml.rels'].includes('media/figure1.png'));
  assert.ok(doc['[Content_Types].xml'].includes('Extension="png"'));
  const deck = unzip(files['figures.pptx']);
  assert.ok(deck['ppt/media/figure2.png'] !== undefined && deck['ppt/media/figure3.png'] !== undefined, 'one picture per figure slide');
  assert.ok(deck['ppt/slides/slide2.xml'].includes('<p:pic>') && deck['ppt/slides/slide2.xml'].includes('Forests lead'));
  assert.ok(!deck['ppt/slides/slide1.xml'].includes('<p:pic>'));
});

check('xlsx cells', () => {
  const sheet = unzip(files['sample.xlsx'])['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes('<c r="C2"><v>1200</v></c>'), 'thousands separator dropped');
  assert.ok(sheet.includes('<c r="D2"><f>B2*C2</f></c>'), 'formula');
  assert.ok(unzip(files['sample.xlsx'])['xl/worksheets/sheet2.xml'].includes('<v>0.125</v>'), 'percent');
});

const outDir = process.argv[2];
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(outDir, name), bytes);
}
console.log(`office: ${passed} checks passed${outDir ? `, files in ${outDir}` : ''}`);
