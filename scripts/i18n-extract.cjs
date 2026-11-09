// Lists every English string the app passes to t() (imported from '@/i18n', under any alias) and reports which ones
// each translation is missing, plus translations whose English key no longer appears in the code.
//   node scripts/i18n-extract.cjs            summary; exits 1 when a translation is missing
//   node scripts/i18n-extract.cjs --keys     every key, one per line (--where adds the file that uses it)
//   node scripts/i18n-extract.cjs --missing  the missing keys per language, as JSON
// Literal arguments are found automatically (both branches of a ternary count). Strings that reach t() through a
// constant (option lists, catalogs, error messages) are listed in INDIRECT below; add an entry when you add one.
/* global __dirname */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const LANGS = ['fr', 'es'];

/** Constants whose strings are passed to t() later. `block`: a const/type name; `props`: only these keys' values;
 * `tuple`: only these positions of each inner array; `re`: a global regex whose first group is a key. */
const INDIRECT = [
  { file: 'components/TeamMemberSheet.tsx', block: 'EFFORT_LABEL' },
  { file: 'local/catalog.ts', block: 'extras', tuple: [8] },
  { file: 'local/extra-models.json', json: m => (Array.isArray(m) ? m : Object.values(m)).map(x => x && x.description) },
  { file: 'shared/lib/pocket/catalog.ts', block: 'localModels', props: ['description'] },
  { file: 'store.ts', block: 'NO_MODEL' },
  { file: 'mcp/catalog.ts', block: 'Category' },
  { file: 'mcp/catalog.ts', block: 'catalog', props: ['description', 'tokenHint'] },
  { file: 'mcp/client.ts', re: /(?:Error|McpHttpError)\((?:[^'`;]*\? )?'([^']+)'/g },
  { file: 'app/team-new.tsx', block: 'ACCESS', props: ['label', 'description'] },
  { file: 'app/task-new.tsx', block: 'MODES', props: ['label', 'description'] },
  { file: 'app/tasks.tsx', block: 'badge', tuple: [1] },
  { file: 'app/onboarding.tsx', block: 'providers', props: ['description', 'badge'] },
  { file: 'greetings.ts', re: /'([^'\n]*)'/g, within: 'const pools' },
  { file: 'app/onboarding.tsx', block: 'paths', props: ['title', 'description', 'badge'] },
  { file: 'app/onboarding.tsx', block: 'tour', tuple: [1, 2] },
  { file: 'app/onboarding.tsx', re: /\[('Open the key page[^\]]*)\]/g, all: true },
  { file: 'app/notifications.tsx', block: 'kinds', props: ['title', 'subtitle'] },
  { file: 'app/profile.tsx', block: 'genders', props: ['label'] },
  { file: 'app/settings.tsx', block: 'privacyRules', props: ['label', 'description'] },
  { file: 'app/settings.tsx', block: 'voiceLanguages', props: ['label'] },
  { file: 'i18n/index.ts', block: 'languages', props: ['description'] },
  { file: 'usage.ts', block: 'REFERENCE', props: ['name'] },
  { file: 'shared/providerCatalog.ts', block: 'privacyLabels', props: ['label', 'detail'] },
  { file: 'shared/providerCatalog.ts', block: 'providerPresets', props: ['description', 'freeLimit'] },
  { file: 'theme.ts', block: 'palettes', props: ['name', 'note'] },
  { file: 'ui/tool-result.tsx', block: 'statusLabel' },
  { file: 'ui/todo-list.tsx', block: 'label' },
  { file: 'ui/pull-to-refresh.tsx', block: 'LABELS' },
  { file: 'ui/capability-tag.tsx', block: 'kinds', props: ['label'] },
  { file: 'ui/reasoning-text.tsx', block: 'PHRASES' },
  { file: 'llm/fallback.ts', re: /return '([^']+)'/g, within: 'export function reason' },
];

// ---- a tiny tokenizer: strings, identifiers, punctuation; comments skipped ----
function unescape(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', 0: '\0' }[e] ?? e;
  });
}

/** Tokens of `src` from `start`; stops after the bracket that closes the first one opened (when `balanced`). */
function tokenize(src, start = 0, balanced = false) {
  const out = [];
  let depth = 0;
  for (let i = start; i < src.length; ) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; if (i < 2) break; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      const body = src.slice(i + 1, j);
      out.push({ type: ch === '`' && body.includes('${') ? 'tpl' : 'str', value: unescape(body), at: i });
      i = j + 1;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
    if (id) { out.push({ type: 'id', value: id[0], at: i }); i += id[0].length; continue; }
    const op = /^(===|!==|==|!=|=>|\?\?|\?\.|&&|\|\||[\s\S])/.exec(src.slice(i, i + 3))[0];
    out.push({ type: 'punc', value: op, at: i });
    i += op.length;
    if (balanced) {
      if ('([{'.includes(op)) depth++;
      else if (')]}'.includes(op) && --depth === 0) break;
    }
  }
  return out;
}

const read = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');
const COMPARE = new Set(['===', '!==', '==', '!=']);

// ---- literal t('…') calls ----
function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(name) && !/\.check\.ts$/.test(name)) files.push(p);
  }
  return files;
}

const keys = new Map(); // key -> first place it was seen
const add = (key, where) => { if (key && key.trim() && !keys.has(key)) keys.set(key, where); };

for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (rel.startsWith('i18n/')) continue;
  const src = fs.readFileSync(file, 'utf8');
  const names = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/i18n'/g))
    for (const spec of m[1].split(',')) {
      const parts = spec.trim().split(/\s+as\s+/);
      if (parts[0] === 't') names.push(parts[1] ?? 't');
    }
  if (!names.length) continue;
  const call = new RegExp(`(?<![\\w$.])(?:${names.join('|')})\\(`, 'g');
  for (const m of src.matchAll(call)) {
    const tokens = tokenize(src, m.index + m[0].length - 1, true);
    // The first argument: tokens up to the first comma at depth 1.
    let depth = 0;
    const first = [];
    for (const tok of tokens) {
      if (tok.type === 'punc' && '([{'.includes(tok.value)) depth++;
      else if (tok.type === 'punc' && ')]}'.includes(tok.value)) depth--;
      else if (tok.type === 'punc' && tok.value === ',' && depth === 1) break;
      first.push(tok);
    }
    first.forEach((tok, i) => {
      if (tok.type !== 'str') return;
      const before = first[i - 1], after = first[i + 1];
      if ((before && COMPARE.has(before.value)) || (after && COMPARE.has(after.value))) return; // `x === 'local' ? …`
      if (before && before.value === '[') return; // obj['key']
      add(tok.value, `${rel}:${src.slice(0, tok.at).split('\n').length}`);
    });
  }
}

// ---- indirect constants ----
function blockTokens(src, name) {
  const m = new RegExp(`(?:const|let|type)\\s+${name}\\b[^=]*=`).exec(src);
  if (!m) throw new Error(`i18n-extract: ${name} not found`);
  let i = m.index + m[0].length;
  while (/\s/.test(src[i])) i++;
  if ('[{('.includes(src[i])) return tokenize(src, i, true);
  const end = src.indexOf(';', i) >= 0 ? Math.min(src.indexOf(';', i), src.indexOf('\n', i) < 0 ? Infinity : src.indexOf('\n', i)) : src.length;
  return tokenize(src.slice(0, end), i);
}

for (const spec of INDIRECT) {
  const where = `${spec.file} (indirect)`;
  const full = path.join(SRC, spec.file);
  if (!fs.existsSync(full)) { console.warn(`i18n-extract: ${spec.file} is gone; drop it from INDIRECT`); continue; }
  if (spec.json) { for (const k of spec.json(JSON.parse(fs.readFileSync(full, 'utf8')))) if (typeof k === 'string') add(k, where); continue; }
  let src = read(spec.file);
  if (spec.within) src = src.slice(src.indexOf(spec.within), src.indexOf('\n}', src.indexOf(spec.within)));
  if (spec.re) {
    for (const m of src.matchAll(spec.re)) {
      if (spec.all) tokenize(m[1]).filter(t => t.type === 'str').forEach(t => add(t.value, where));
      else add(unescape(m[1]), where);
    }
    continue;
  }
  const tokens = blockTokens(src, spec.block);
  if (spec.props) {
    tokens.forEach((tok, i) => {
      const key = tokens[i - 2];
      if (tok.type === 'str' && tokens[i - 1]?.value === ':' && key && (key.type === 'id' || key.type === 'str') && spec.props.includes(key.value)) add(tok.value, where);
    });
  } else if (spec.tuple) {
    const stack = [];
    for (const tok of tokens) {
      if (tok.type === 'punc' && '[{('.includes(tok.value)) stack.push({ open: tok.value, index: 0 });
      else if (tok.type === 'punc' && ']})'.includes(tok.value)) stack.pop();
      else if (tok.type === 'punc' && tok.value === ',' && stack.length) stack[stack.length - 1].index++;
      else if (tok.type === 'str' && stack.length >= 2 && stack[stack.length - 1].open === '[' && spec.tuple.includes(stack[stack.length - 1].index)) add(tok.value, where);
    }
  } else {
    tokens.forEach((tok, i) => {
      // Skip object keys written as strings ('no-training': …).
      if (tok.type === 'str' && tokens[i + 1]?.value !== ':') add(tok.value, where);
    });
  }
}

// ---- translations ----
function loadParts() {
  const dir = path.join(SRC, 'i18n', 'parts');
  const dicts = Object.fromEntries(LANGS.map(l => [l, {}]));
  const origin = {};
  for (const name of fs.readdirSync(dir)) {
    if (name === 'index.ts') continue;
    const code = fs.readFileSync(path.join(dir, name), 'utf8')
      .replace(/^import[^\n]*\n/gm, '')
      .replace(/const (\w+): Part =/, 'const $1 =')
      .replace(/export default (\w+);?/, 'module.exports = $1;');
    const sandbox = { module: {} };
    vm.runInNewContext(code, sandbox, { filename: name });
    const part = sandbox.module.exports;
    for (const l of LANGS) for (const [k, v] of Object.entries(part[l] ?? {})) {
      if (k in dicts[l] && dicts[l][k] !== v) console.warn(`i18n-extract: ${l} "${k}" differs in ${origin[l + k]} and ${name}`);
      dicts[l][k] = v;
      origin[l + k] = name;
    }
  }
  return { dicts, origin };
}

const { dicts, origin } = loadParts();
const all = [...keys.keys()].sort();
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

if (process.argv.includes('--keys')) { for (const k of all) console.log(process.argv.includes('--where') ? `${keys.get(k)}\t${k}` : k); process.exit(0); }

const report = {};
let bad = 0;
for (const l of LANGS) {
  const missing = all.filter(k => !(k in dicts[l]));
  const stale = Object.keys(dicts[l]).filter(k => !keys.has(k));
  const broken = all.filter(k => k in dicts[l] && placeholders(k) !== placeholders(dicts[l][k]));
  report[l] = { missing, stale: stale.map(k => `${k}  [${origin[l + k]}]`), placeholders: broken };
  bad += missing.length + broken.length;
}

if (process.argv.includes('--missing')) {
  console.log(JSON.stringify(Object.fromEntries(LANGS.map(l => [l, report[l].missing])), null, 1));
  process.exit(0);
}

console.log(`${all.length} keys in the code`);
for (const l of LANGS) {
  const r = report[l];
  console.log(`${l}: ${all.length - r.missing.length}/${all.length} translated, ${r.missing.length} missing, ${r.stale.length} stale, ${r.placeholders.length} placeholder mismatches`);
  for (const k of r.missing.slice(0, 20)) console.log(`  missing  ${JSON.stringify(k)}  (${keys.get(k)})`);
  if (r.missing.length > 20) console.log(`  … and ${r.missing.length - 20} more (--missing lists them all)`);
  for (const k of r.stale) console.log(`  stale    ${k}`);
  for (const k of r.placeholders) console.log(`  placeholders differ  ${JSON.stringify(k)}`);
}
process.exit(bad ? 1 : 0);
