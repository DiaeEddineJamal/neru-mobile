// A small line tokenizer that colours code like VS Code's Dark+ and Light+ themes. Not a parser: it knows
// comments, strings, numbers, keywords, tags/attributes, calls and types, which covers how chat replies read.
// Block comments and template strings carry over to the next line.
export type Kind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'control' | 'type' | 'func' | 'tag' | 'attr' | 'punct' | 'variable';
export type Token = { text: string; kind: Kind };
export type Mode = null | 'block' | 'html-comment' | 'template' | 'triple"' | "triple'";

export const vscode: Record<'dark' | 'light', Record<Kind, string>> = {
  dark: { plain: '#d4d4d4', comment: '#6a9955', string: '#ce9178', number: '#b5cea8', keyword: '#569cd6', control: '#c586c0', type: '#4ec9b0', func: '#dcdcaa', tag: '#569cd6', attr: '#9cdcfe', punct: '#808080', variable: '#9cdcfe' },
  light: { plain: '#1f1f1f', comment: '#008000', string: '#a31515', number: '#098658', keyword: '#0000ff', control: '#af00db', type: '#267f99', func: '#795e26', tag: '#800000', attr: '#e50000', punct: '#800000', variable: '#001080' },
};

const CONTROL = new Set('if else elif for while do switch case break continue return yield await try catch except finally raise throw import from export default as with match when loop in of goto defer select go'.split(' '));
const KEYWORD = new Set(('const let var function func fn def class struct enum interface type trait impl extends implements new delete typeof instanceof void this self super null undefined true false True False None nil public private protected static readonly abstract async lambda pass global nonlocal and or not is mut pub use mod crate package val override final sealed data object where unsafe extern ref out int float double bool boolean string char long short byte unsigned signed auto echo fi then esac local '
  + 'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE JOIN LEFT RIGHT INNER ON GROUP BY ORDER LIMIT AND OR NOT NULL AS PRIMARY KEY').split(' '));
const HASH_COMMENT = /^(py|python|rb|ruby|sh|bash|shell|zsh|yaml|yml|toml|r|pl|perl|ps1|powershell|dockerfile|makefile|conf|ini)$/i;
const MARKUP = /^(html|xml|svg|vue|svelte|jsx|tsx|astro)$/i;

/** Tokenizes one line; returns the tokens and the mode the next line starts in. */
export function tokenizeLine(line: string, lang: string, mode: Mode): { tokens: Token[]; mode: Mode } {
  const out: Token[] = [];
  const push = (text: string, kind: Kind) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  const hash = HASH_COMMENT.test(lang);
  const markup = MARKUP.test(lang);
  const css = /^(css|scss|less)$/i.test(lang);
  const sql = /^sql$/i.test(lang);
  let i = 0;
  // Finish whatever the previous line left open.
  const close = (end: string, kind: Kind) => {
    const at = line.indexOf(end, i);
    if (at < 0) { push(line.slice(i), kind); i = line.length; return false; }
    push(line.slice(i, at + end.length), kind); i = at + end.length; return true;
  };
  if (mode === 'block' && close('*/', 'comment')) mode = null;
  else if (mode === 'html-comment' && close('-->', 'comment')) mode = null;
  else if (mode === 'triple"' && close('"""', 'string')) mode = null;
  else if (mode === "triple'" && close("'''", 'string')) mode = null;
  else if (mode === 'template' && close('`', 'string')) mode = null;
  if (mode) return { tokens: out, mode };

  let inTag = false;
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i];
    let m: RegExpMatchArray | null;
    if (markup && rest.startsWith('<!--')) { mode = 'html-comment'; i += 4; push('<!--', 'comment'); if (close('-->', 'comment')) mode = null; continue; }
    if (!hash && rest.startsWith('/*')) { mode = 'block'; i += 2; push('/*', 'comment'); if (close('*/', 'comment')) mode = null; continue; }
    if ((!hash && !css && rest.startsWith('//') && !/:$/.test(line.slice(0, i))) || (hash && ch === '#') || (sql && rest.startsWith('--'))) { push(rest, 'comment'); break; }
    if (rest.startsWith('"""') || rest.startsWith("'''")) { const q = rest.slice(0, 3); mode = q === '"""' ? 'triple"' : "triple'"; i += 3; push(q, 'string'); if (close(q, 'string')) mode = null; continue; }
    if (ch === '`') { mode = 'template'; i += 1; push('`', 'string'); if (close('`', 'string')) mode = null; continue; }
    if ((m = rest.match(/^(["'])(?:\\.|(?!\1).)*\1?/))) { push(m[0], 'string'); i += m[0].length; continue; }
    if (markup && (m = rest.match(/^<\/?([A-Za-z][\w.:-]*)/))) { push(m[0].startsWith('</') ? '</' : '<', 'punct'); push(m[1], /^[A-Z]/.test(m[1]) ? 'type' : 'tag'); i += m[0].length; inTag = true; continue; }
    if (inTag && (m = rest.match(/^\/?>/))) { push(m[0], 'punct'); i += m[0].length; inTag = false; continue; }
    if (inTag && (m = rest.match(/^[A-Za-z_:@][\w:.-]*/))) { push(m[0], 'attr'); i += m[0].length; continue; }
    if ((m = rest.match(/^(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)[a-z%]*/i)) && !/[\w$]/.test(line[i - 1] ?? '')) { push(m[0], 'number'); i += m[0].length; continue; }
    if (css && (m = rest.match(/^[a-z-]+(?=\s*:)/))) { push(m[0], 'attr'); i += m[0].length; continue; }
    if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) {
      const w = m[0];
      const next = line.slice(i + w.length).trimStart()[0];
      const kind: Kind = CONTROL.has(w) ? 'control' : KEYWORD.has(w) ? 'keyword' : next === '(' ? 'func' : /^[A-Z][a-z0-9]/.test(w) ? 'type' : line[i - 1] === '.' ? 'variable' : 'plain';
      push(w, kind); i += w.length; continue;
    }
    if ((m = rest.match(/^@[\w.]+/)) || (m = rest.match(/^\$[\w{}]+/))) { push(m[0], 'func'); i += m[0].length; continue; }
    push(ch, 'plain'); i += 1;
  }
  return { tokens: out, mode };
}

/** All lines of a block, each as tokens. */
export function tokenize(code: string, lang: string): Token[][] {
  let mode: Mode = null;
  return code.split('\n').map(line => { const r = tokenizeLine(line, lang, mode); mode = r.mode; return r.tokens; });
}
