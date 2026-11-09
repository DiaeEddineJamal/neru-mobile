// Artifacts in replies: `<artifact id="slug" type="html|svg|markdown|code|mermaid" title="…" language="ts">…</artifact>`.
// The desktop app has no chat-artifact tag (its documents come from a tool), so this is the one format.
// Models get it wrong in every way possible, small on-device models most of all, so splitArtifacts is forgiving:
// any tag casing, `<antArtifact identifier=…>`, broken or missing quotes, attributes in any order or missing (the
// kind is then guessed from the content), tags wrapped in ``` fences, fences inside the body, escaped `&lt;…&gt;`
// tags, extra closing tags, unclosed tags while streaming, and full HTML pages or large SVGs written as a plain
// ```html fence with no tag at all. Pure TypeScript with no app imports so `node src/artifacts/parse.check.ts` runs it.
export type ArtifactKind = 'html' | 'svg' | 'markdown' | 'code' | 'mermaid';
export type Artifact = { id: string; title: string; kind: ArtifactKind; language?: string; content: string; /** Still streaming: not closed yet. */ open: boolean };
export type Segment = { type: 'text'; text: string } | { type: 'artifact'; artifact: Artifact };

export const ARTIFACT_KINDS: ArtifactKind[] = ['html', 'svg', 'markdown', 'code', 'mermaid'];

/** Splits a reply into Markdown text and artifacts. Must never throw, whatever the model wrote. */
export function splitArtifacts(text: string): Segment[] {
  try {
    if (typeof text !== 'string') return text == null ? [] : [{ type: 'text', text: String(text) }];
    if (!text || !mayHaveArtifacts(text)) return text.trim() ? [{ type: 'text', text }] : [];
    return parse(text);
  } catch {
    return [{ type: 'text', text: String(text) }];
  }
}

/** False when the text cannot hold an artifact: a cheap test before parsing every message of every chat. */
export function mayHaveArtifacts(text: string): boolean {
  return /artifact|<!doctype|<html|<svg|<\s*\/?\s*an?[a-z]{0,10}$/i.test(text);
}

const OPEN = /(?:<|&lt;)\s*(?:ant)?artifact\b/gi;
const CLOSE = /(?:<|&lt;)\s*\/\s*(?:ant)?artifact\s*(?:>|&gt;)/gi;
const MERMAID = /^\s*(?:%%.*\n\s*)*(?:graph\s+(?:TD|TB|BT|RL|LR)\b|flowchart\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|gantt\b|pie\b|journey\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|xychart(?:-beta)?\b|sankey(?:-beta)?\b|requirementDiagram\b|C4Context\b|block-beta\b)/;
const HTML_DOC = /^\s*(?:<!--[\s\S]*?-->\s*)?(?:<!doctype\s+html|<html[\s>])/i;
const SVG_DOC = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg[\s>]/i;
const FENCE_LINE = /(^|\n)[ \t]*```/g;

/** Ids handed out in this reply, in order, so the same artifact keeps its id on every streamed update. */
type Ctx = { used: Set<string>; count: number };

function parse(input: string): Segment[] {
  const out: Segment[] = [];
  const ctx: Ctx = { used: new Set(), count: 0 };
  let text = '';
  let i = 0;
  while (i < input.length) {
    const open = nextOpen(input, i);
    if (!open) {
      text += input.slice(i);
      break;
    }
    text += input.slice(i, open.start);
    const tag = readTag(input, open.end, open.escaped);
    // The text ends inside the tag itself (still streaming): show nothing for it yet.
    if (!tag.complete) break;
    const attrs = parseAttrs(open.escaped ? unescapeHtml(tag.raw) : tag.raw);
    // This artifact ends at its closing tag, at the next opening tag (close forgotten), or at the end of the text.
    CLOSE.lastIndex = tag.end;
    const close = CLOSE.exec(input);
    const next = nextOpen(input, tag.end);
    let bodyEnd = input.length;
    let after = input.length;
    let closed = false;
    if (close && (!next || close.index < next.start)) {
      bodyEnd = close.index;
      after = close.index + close[0].length;
      closed = true;
    } else if (next) {
      bodyEnd = after = next.start;
      closed = true;
    }
    let body = input.slice(tag.end, bodyEnd);
    if (!closed) {
      // "…</artif" at the very end: the closing tag is arriving.
      const partial = partialTagAt(body, true);
      if (partial >= 0) {
        closed = /\/\s*(?:ant)?artifact\s*$/i.test(body);
        body = body.slice(0, partial);
      }
    }
    // A fence opened right before the tag ("```html\n<artifact …>") belongs to the tag: drop it and its closer.
    const fenceBefore = /(?:^|\n)[ \t]*```[\w+#.-]*[ \t]*\n?[ \t]*$/.exec(text);
    if (fenceBefore && countFences(text) % 2 === 1) {
      text = text.slice(0, fenceBefore.index);
      const fenceAfter = /^[ \t]*\n?[ \t]*```[ \t]*(?=\n|$)/.exec(input.slice(after));
      if (fenceAfter) after += fenceAfter[0].length;
    }
    // Swallow duplicate closing tags right after this one.
    for (;;) {
      CLOSE.lastIndex = after;
      const extra = CLOSE.exec(input);
      if (!extra || input.slice(after, extra.index).trim()) break;
      after = extra.index + extra[0].length;
    }
    pushText(out, text, ctx);
    text = '';
    out.push({ type: 'artifact', artifact: build(attrs, body, !closed, ctx) });
    i = after;
  }
  // "<artif" at the very end: an opening tag is arriving.
  const partial = partialTagAt(text, false);
  if (partial >= 0) text = text.slice(0, partial);
  pushText(out, text, ctx);
  return out;
}

const countFences = (s: string) => (s.match(FENCE_LINE) ?? []).length;

/** Index where a cut-off `<artifact` (or `</artifact` when closing) starts at the end of `s`, or -1. */
function partialTagAt(s: string, closing: boolean): number {
  const m = closing ? /(?:<|&lt;)\s*\/\s*([a-z]*)\s*$/i.exec(s) : /(?:<|&lt;)\s*([a-z]{2,11})$/i.exec(s);
  if (!m) return -1;
  const word = m[1].toLowerCase();
  return 'artifact'.startsWith(word) || 'antartifact'.startsWith(word) ? m.index : -1;
}

/** The next opening tag that is not quoted as inline code (`<artifact>`). */
function nextOpen(s: string, from: number): { start: number; end: number; escaped: boolean } | null {
  OPEN.lastIndex = from;
  for (let m = OPEN.exec(s); m; m = OPEN.exec(s)) {
    if (s[m.index - 1] === '`' && /^[^\n]*`/.test(s.slice(m.index))) continue;
    return { start: m.index, end: m.index + m[0].length, escaped: m[0].startsWith('&') };
  }
  return null;
}

/** Reads the attribute part of a tag up to `>` (outside quotes). `complete` is false when the text ends mid-tag. */
function readTag(s: string, from: number, escaped: boolean): { raw: string; end: number; complete: boolean } {
  let quote = '';
  let quoteAt = -1;
  const unclosed = new Set<number>();
  for (let j = from; j < s.length; j++) {
    const ch = s[j];
    if (quote) {
      if (ch === quote || (quote === '“' && ch === '”')) quote = '';
      else if (ch === '\n') {
        // The quote never closed on its line: read the line again as if it were not there.
        unclosed.add(quoteAt);
        quote = '';
        j = quoteAt;
      }
      continue;
    }
    if (!unclosed.has(j) && (ch === '"' || ch === '“' || (ch === "'" && !/\w/.test(s[j - 1] ?? '')))) {
      quote = ch;
      quoteAt = j;
      continue;
    }
    if (ch === '>') return { raw: s.slice(from, j), end: j + 1, complete: true };
    if (escaped && s.startsWith('&gt;', j)) return { raw: s.slice(from, j), end: j + 4, complete: true };
    // `>` forgotten: the content's own markup starts.
    if (ch === '<') return { raw: s.slice(from, j), end: j, complete: true };
    // `>` forgotten at the end of the line, unless the next line carries more attributes.
    if (ch === '\n') {
      const rest = s.slice(j + 1);
      if (rest.trim() && !/^\s*[\w:-]+\s*=/.test(rest)) return { raw: s.slice(from, j), end: j + 1, complete: true };
    }
  }
  return { raw: s.slice(from), end: s.length, complete: false };
}

const QUOTES = /["'“”‘’`]/;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const s = raw.replace(/\/\s*$/, '');
  let j = 0;
  const ws = () => { while (j < s.length && /[\s,]/.test(s[j])) j++; };
  while (j < s.length) {
    ws();
    const name = /^[\w:.-]+/.exec(s.slice(j));
    if (!name) { j++; continue; }
    j += name[0].length;
    const key = name[0].toLowerCase();
    ws();
    if (s[j] !== '=' && s[j] !== ':') { attrs[key] ??= ''; continue; }
    j++;
    ws();
    let value: string;
    const q = s[j];
    if (q && QUOTES.test(q)) {
      j++;
      const closer = q === '“' ? /[”"\n]/ : q === '‘' ? /[’'\n]/ : q === '"' ? /["”\n]/ : q === "'" ? /['’\n]/ : new RegExp(`[${q}\\n]`);
      const rest = s.slice(j);
      const end = rest.search(closer);
      // A missing closing quote: the value runs to the next attribute.
      const cut = end < 0 || rest[end] === '\n' ? rest.search(/\s+[\w:-]+\s*=/) : -1;
      if (end >= 0 && rest[end] !== '\n') {
        value = rest.slice(0, end);
        j += end + 1;
      } else {
        value = cut < 0 ? rest : rest.slice(0, cut);
        j += value.length;
      }
    } else {
      value = (/^[^\s"'“”]+/.exec(s.slice(j)) ?? [''])[0];
      j += value.length;
      // An unquoted title keeps its following words: title=Quarterly report type=markdown.
      if (key === 'title' || key === 'name') {
        const more = /^(?:\s+(?![\w:-]+\s*=)[^\s"'=]+)+/.exec(s.slice(j));
        if (more) { value += more[0]; j += more[0].length; }
      }
    }
    attrs[key] = value.trim().replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '');
  }
  return attrs;
}

/** The kind named by a type attribute ("html", "text/html", "application/vnd.ant.code", "python"…). */
function kindOfType(type: string): { kind: ArtifactKind; language?: string } | null {
  const v = type.toLowerCase().trim();
  if (!v) return null;
  if (v.includes('mermaid')) return { kind: 'mermaid' };
  if (v.includes('svg')) return { kind: 'svg' };
  if (v.includes('react')) return { kind: 'code', language: 'jsx' };
  if (/vnd\.ant\.code|\bcode\b|script|program|source|snippet/.test(v)) return { kind: 'code' };
  if (/\b(?:html?|web|webpage|page|website|app|mini-?app|widget)\b/.test(v)) return { kind: 'html' };
  if (/markdown|\bmd\b|\btext\b|document|\bdoc\b|report|essay|notes?\b|article|letter/.test(v)) return { kind: 'markdown' };
  const lang = kindOfLanguage(v);
  return lang ? { kind: lang, language: lang === 'code' ? v : undefined } : null;
}

function kindOfLanguage(lang: string): ArtifactKind | null {
  const l = lang.toLowerCase();
  if (!l) return null;
  if (l === 'html' || l === 'htm') return 'html';
  if (l === 'svg') return 'svg';
  if (l === 'mermaid' || l === 'mmd') return 'mermaid';
  if (l === 'markdown' || l === 'md') return 'markdown';
  if (/^[a-z][\w+#.-]{0,19}$/.test(l)) return 'code';
  return null;
}

function guessKind(body: string): ArtifactKind {
  if (HTML_DOC.test(body)) return 'html';
  if (SVG_DOC.test(body)) return 'svg';
  if (MERMAID.test(body)) return 'mermaid';
  if (looksLikeCode(body)) return 'code';
  return 'markdown';
}

function looksLikeCode(body: string): boolean {
  const lines = body.split('\n').filter(l => l.trim());
  if (lines.length < 2 || /^\s*#{1,6}\s/m.test(body)) return false;
  const codey = lines.filter(l => /[;{}]\s*$|^\s*(?:import|export|def|class|function|const|let|var|return|#include|package|public|fn|func|using)\b|=>/.test(l)).length;
  return codey / lines.length > 0.4;
}

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function cleanBody(raw: string, open: boolean): { body: string; fenceLang?: string } {
  let body = raw.replace(/\r\n/g, '\n').replace(/^[ \t]*\n/, '');
  // Escaped markup with no real tag in it.
  if (!/<[a-z!/?]/i.test(body) && /&lt;/.test(body)) body = unescapeHtml(body);
  let fenceLang: string | undefined;
  const fence = /^\s*(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*(?:\n|$)/.exec(body);
  if (fence) {
    fenceLang = fence[2].toLowerCase() || undefined;
    body = body.slice(fence[0].length);
    body = body.replace(fence[1][0] === '`' ? /\n?[ \t]*`{3,}\s*$/ : /\n?[ \t]*~{3,}\s*$/, '');
    if (open) body = body.replace(/\n[ \t]*`{1,2}$/, '');
  } else {
    body = body.replace(/\n[ \t]*```\s*$/, '');
  }
  return { body: body.replace(/\s+$/, ''), fenceLang };
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** A title read from the content when the model gave none. */
export function titleFrom(kind: ArtifactKind, body: string): string {
  if (kind === 'html' || kind === 'svg') {
    const m = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(body) ?? (kind === 'html' ? /<h1[^>]*>([^<]{1,120})<\/h1>/i.exec(body) : null);
    if (m) return unescapeHtml(m[1]).trim();
  }
  if (kind === 'markdown') {
    const m = /^\s*#{1,3}\s+(.{1,120})$/m.exec(body);
    if (m) return m[1].replace(/[*_`]/g, '').trim();
  }
  return '';
}

function build(attrs: Record<string, string>, raw: string, open: boolean, ctx: Ctx): Artifact {
  const { body, fenceLang } = cleanBody(raw, open);
  const langAttr = (attrs.language || attrs.lang || '').toLowerCase();
  const typed = kindOfType(attrs.type ?? attrs.kind ?? '');
  let kind: ArtifactKind;
  let language = langAttr || typed?.language || fenceLang;
  if (typed) kind = typed.kind;
  else if (langAttr) kind = kindOfLanguage(langAttr) === 'code' ? 'code' : (kindOfLanguage(langAttr) ?? guessKind(body));
  else if (fenceLang && kindOfLanguage(fenceLang)) kind = kindOfLanguage(fenceLang)!;
  else kind = guessKind(body);
  if (kind !== 'code') language = undefined;
  const given = (attrs.title || attrs.name || '').trim();
  const id = attrs.id || attrs.identifier || attrs.key || '';
  return finish({ id, title: given || titleFrom(kind, body), kind, language: language || undefined, content: body, open }, ctx, slugify(id) || slugify(given));
}

function finish(a: Artifact, ctx: Ctx, base: string): Artifact {
  ctx.count++;
  let id = base || `${a.kind === 'html' ? 'page' : 'artifact'}-${ctx.count}`;
  if (ctx.used.has(id)) {
    let n = 2;
    while (ctx.used.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  ctx.used.add(id);
  return { ...a, id };
}

// ---- Plain text: complete HTML pages and large SVGs written without a tag become artifacts ----

const MIN_PAGE_LINES = 8;
const MIN_SVG_CHARS = 400;

function pushText(out: Segment[], text: string, ctx: Ctx) {
  if (!text) return;
  for (const seg of promote(text.replace(CLOSE, ''), ctx)) {
    if (seg.type === 'artifact') out.push(seg);
    else {
      const t = seg.text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
      if (t.trim()) out.push({ type: 'text', text: t });
    }
  }
}

function promote(text: string, ctx: Ctx): Segment[] {
  const out: Segment[] = [];
  const fence = /(^|\n)[ \t]*(`{3,})[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;
  let last = 0;
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    const lang = m[3].toLowerCase();
    const body = m[4];
    const open = m.index + m[0].length >= text.length && !/\n[ \t]*`{3,}[ \t]*$/.test(m[0]);
    let kind: ArtifactKind | null = null;
    if (['html', 'htm', '', 'xml'].includes(lang) && HTML_DOC.test(body) && (open || body.split('\n').length >= MIN_PAGE_LINES)) kind = 'html';
    else if (['svg', 'xml', '', 'html'].includes(lang) && SVG_DOC.test(body) && (open || body.length >= MIN_SVG_CHARS)) kind = 'svg';
    if (!kind) continue;
    const start = m.index + m[1].length;
    out.push({ type: 'text', text: text.slice(last, start) });
    const content = open ? body.replace(/\n?[ \t]*`{1,2}$/, '') : body.replace(/\s+$/, '');
    out.push({ type: 'artifact', artifact: finish({ id: '', title: titleFrom(kind, content), kind, content, open }, ctx, '') });
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  // A bare page with no fence at all.
  const bare = /(^|\n)[ \t]*(<!doctype\s+html[\s\S]*?(?:<\/html>|$))/i.exec(rest);
  if (bare && countFences(rest.slice(0, bare.index)) % 2 === 0) {
    const start = bare.index + bare[1].length;
    const content = bare[2];
    const closed = /<\/html>$/i.test(content);
    out.push({ type: 'text', text: rest.slice(0, start) });
    out.push({ type: 'artifact', artifact: finish({ id: '', title: titleFrom('html', content), kind: 'html', content: content.replace(/\s+$/, ''), open: !closed }, ctx, '') });
    out.push({ type: 'text', text: rest.slice(start + content.length) });
    return out;
  }
  out.push({ type: 'text', text: rest });
  return out;
}
