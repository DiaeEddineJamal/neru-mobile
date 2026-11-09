// Markdown block parser for chat replies, built to be fed a growing reply many times a second.
// Pure TypeScript with no imports, so scripts/bench-stream.mjs can load it straight into Node.
//
// ponytail: covers what chat replies use (fences, headings, nested lists, quotes, rules, GitHub tables,
// inline code/bold/italic/links). Swap in a full parser when replies need more.
export type Align = 'left' | 'center' | 'right';
export type Block =
  | { t: 'code'; lang: string; text: string; open: boolean }
  | { t: 'h'; level: number; text: string }
  | { t: 'li'; marker: string; text: string; level: number }
  | { t: 'quote'; text: string }
  | { t: 'hr' }
  | { t: 'table'; head: string[]; align: Align[]; rows: string[][] }
  | { t: 'p'; text: string };

const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** "| a | b |" -> ["a", "b"]; a backslash-escaped pipe stays in its cell. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/\\\|/g, '\u0000')
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim().replace(/\u0000/g, '|'));
}

/** A point between blocks where parsing can resume: just after a finished blank line, outside any fence or table. */
type Checkpoint = { offset: number; blocks: number; indents: number[] };

/**
 * Parses `src` into blocks. `indents` is the open-list state to start from (empty for a whole reply).
 * Also returns the checkpoints it passed, so a caller can skip the settled part next time.
 */
export function parseBlocks(src: string, indents: number[] = []): { blocks: Block[]; checkpoints: Checkpoint[] } {
  const blocks: Block[] = [];
  const checkpoints: Checkpoint[] = [];
  const lines = src.split('\n');
  // Character offset where each line starts.
  const starts: number[] = new Array(lines.length);
  for (let i = 0, at = 0; i < lines.length; i++) {
    starts[i] = at;
    at += lines[i].length + 1;
  }
  let para: string[] = [];
  // Indents of the open list items; an item's level is how many open items sit left of it.
  indents = [...indents];
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      flush();
      indents = [];
      const body: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) body.push(lines[i]);
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n'), open: i >= lines.length }); // an unclosed fence (mid-stream) still renders
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && DELIM.test(lines[i + 1]) && cells(lines[i + 1]).length === cells(line).length) {
      flush();
      indents = [];
      const head = cells(line);
      const align = cells(lines[++i]).map((d): Align => (d.endsWith(':') ? (d.startsWith(':') ? 'center' : 'right') : 'left'));
      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1].includes('|')) rows.push(cells(lines[++i]));
      blocks.push({ t: 'table', head, align, rows });
      continue;
    }
    const hr = HR.test(line);
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const li = hr ? null : line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
    const q = line.match(/^>\s?(.*)/);
    if (!hr && !h && !li && !q && line.trim()) {
      para.push(line.trim());
      continue;
    }
    flush();
    if (li) {
      const indent = li[1].replace(/\t/g, '    ').length;
      while (indents.length && indents[indents.length - 1] >= indent) indents.pop();
      blocks.push({ t: 'li', marker: /\d/.test(li[2]) ? li[2] : indents.length ? '◦' : '•', text: li[3], level: indents.length });
      indents.push(indent);
      continue;
    }
    if (line.trim()) indents = [];
    if (hr) blocks.push({ t: 'hr' });
    else if (h) blocks.push({ t: 'h', level: h[1].length, text: h[2] });
    else if (q) blocks.push({ t: 'quote', text: q[1] });
    // A finished blank line (more text follows it) closes everything above it for good: nothing written later can
    // change those blocks. The list indents are the only state that carries over.
    else if (i < lines.length - 1) checkpoints.push({ offset: starts[i + 1], blocks: blocks.length, indents: [...indents] });
  }
  flush();
  return { blocks, checkpoints };
}

/** Whole-text parse, as the renderer used to do on every update. */
export const parse = (src: string): Block[] => parseBlocks(src).blocks;

/**
 * Parses a reply that grows at its end. Blocks before the last finished blank line are parsed once and handed back
 * as the same objects every time (so memoized rows skip them); only the open tail is parsed again.
 * Text that changed before the settled part (a tool call stripped out) starts over.
 */
export function createIncrementalParser() {
  let settled = ''; // the source the settled blocks came from
  let settledBlocks: Block[] = [];
  let indents: number[] = [];
  let tailCache: { src: string; blocks: Block[] } | null = null;
  const stats = { tailParses: 0, settledChars: 0, resets: 0 };
  function update(text: string): Block[] {
    if (!text.startsWith(settled)) {
      settled = '';
      settledBlocks = [];
      indents = [];
      stats.resets++;
    }
    const src = text.slice(settled.length);
    if (tailCache && tailCache.src === src) return tailCache.blocks.length ? settledBlocks.concat(tailCache.blocks) : settledBlocks;
    stats.tailParses++;
    const parsed = parseBlocks(src, indents);
    let blocks = parsed.blocks;
    const cp = parsed.checkpoints[parsed.checkpoints.length - 1];
    if (cp) {
      settledBlocks = settledBlocks.concat(blocks.slice(0, cp.blocks));
      settled += src.slice(0, cp.offset);
      indents = cp.indents;
      // At a checkpoint the parser holds no paragraph and only these indents, so the blocks after it are exactly
      // what parsing the rest from there would give.
      const rest = src.slice(cp.offset);
      blocks = blocks.slice(cp.blocks);
      stats.settledChars = settled.length;
      tailCache = { src: rest, blocks };
    } else tailCache = { src, blocks };
    return blocks.length ? settledBlocks.concat(blocks) : settledBlocks;
  }
  return { update, stats, settledCount: () => settledBlocks.length };
}

/** Two blocks that render the same. Cheap: compares fields, not a serialized copy. */
export function sameBlock(a: Block, b: Block): boolean {
  if (a === b) return true;
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'code': {
      const o = b as typeof a;
      return a.open === o.open && a.lang === o.lang && a.text === o.text;
    }
    case 'h':
      return a.level === (b as typeof a).level && a.text === (b as typeof a).text;
    case 'li': {
      const o = b as typeof a;
      return a.level === o.level && a.marker === o.marker && a.text === o.text;
    }
    case 'hr':
      return true;
    case 'table': {
      const o = b as typeof a;
      const row = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
      return row(a.head, o.head) && row(a.align, o.align) && a.rows.length === o.rows.length && a.rows.every((r, i) => row(r, o.rows[i]));
    }
    default:
      return a.text === (b as typeof a).text;
  }
}
