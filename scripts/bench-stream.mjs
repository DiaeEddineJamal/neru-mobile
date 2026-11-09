// Streaming render benchmark: replays a ~3,000-token Markdown reply token by token through the old and the new
// streaming paths and reports per-update cost, parse/tokenize/block-render counts, store notifications and how
// evenly text reaches the screen. Run from D:\Neru\mobile:  node scripts/bench-stream.mjs
// (Node 23.6+ loads the .ts modules directly.) Exits non-zero if the incremental parser ever disagrees with a
// whole-text parse.
import { createIncrementalParser, parse as wholeParse, sameBlock } from '../src/components/markdown/parse.ts';
import { lineCache, tokenize, tokenizeCached } from '../src/ui/highlight.ts';
import { createReveal } from '../src/ui/stream/reveal.ts';

// ---------- the reply ----------
const ts = `import { useEffect, useState } from 'react';

type User = { id: string; name: string; email?: string };

/** Loads users page by page and keeps the newest first. */
export async function loadUsers(page = 1, size = 20): Promise<User[]> {
  const res = await fetch(\`/api/users?page=\${page}&size=\${size}\`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const body = (await res.json()) as { users: User[] };
  // Newest first
  return body.users.sort((a, b) => b.id.localeCompare(a.id));
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadUsers()
      .then(u => alive && setUsers(u))
      .catch(e => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);
  return { users, error };
}`;
const py = `import csv
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Row:
    name: str
    score: float

def read_rows(path: Path) -> list[Row]:
    """Reads the CSV and skips broken lines."""
    rows = []
    with path.open() as f:
        for line in csv.DictReader(f):
            try:
                rows.append(Row(line["name"], float(line["score"])))
            except (KeyError, ValueError):
                continue  # a broken line
    return rows

def top(rows: list[Row], n: int = 5) -> list[Row]:
    return sorted(rows, key=lambda r: r.score, reverse=True)[:n]

if __name__ == "__main__":
    for r in top(read_rows(Path("scores.csv"))):
        print(f"{r.name}: {r.score:.1f}")`;
const para = i =>
  `Paragraph ${i}: when you stream a reply on a phone, every update has to be **parsed**, laid out and drawn, and the work grows with the length of the text unless the settled part is kept. ` +
  `This sentence adds some \`inline code\`, a [link](https://example.com/docs/${i}) and a little *emphasis* so the inline pass has real work to do on each block.`;
const parts = [
  '# Loading and ranking data',
  para(1),
  para(2),
  '## Steps',
  '1. Fetch the users page by page.\n2. Sort them newest first.\n3. Keep errors visible.\n   - show a retry button\n   - log the status code\n4. Render the list.',
  para(3),
  '```ts\n' + ts + '\n```',
  para(4),
  '> Tip: keep the request size small on slow networks; twenty rows is a good default for a phone screen.',
  '## Comparison',
  '| Approach | Latency | Memory | Notes |\n|---|:---:|---:|---|\n' +
    ['Whole reparse|high|low|simple', 'Incremental|low|low|keeps settled blocks', 'Virtualized|low|medium|for very long replies', 'Native text|lowest|low|no Markdown', 'Web view|medium|high|full HTML', 'Plain text|lowest|lowest|no formatting'].map(r => `| ${r.split('|').join(' | ')} |`).join('\n'),
  para(5),
  '## Python version',
  para(6),
  '```python\n' + py + '\n```',
  para(7),
  '- First point about caching parsed blocks between updates.\n- Second point about memoized rows.\n  - nested detail one\n  - nested detail two\n- Third point about pacing text per frame.',
  '---',
  para(8),
  para(9),
  para(10),
  para(11),
  para(12),
  '## Summary',
  para(13),
  para(14),
  para(15),
  para(16),
  para(17),
  para(18),
];
let reply = parts.join('\n\n');
while (reply.length < 12000) reply += '\n\n' + para(19 + reply.length % 7);
// ~4 characters per token, as BPE vocabularies average on English and code.
const tokens = reply.match(/\s*[^\s]{1,4}|\s+/g);

// ---------- deterministic randomness ----------
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ---------- arrival timelines ----------
/** Token times (ms) for a model producing `tps` tokens/s with ±40% jitter. */
function tokenTimes(tps) {
  const out = [];
  let t = 0;
  for (let i = 0; i < tokens.length; i++) out.push((t += (1000 / tps) * (0.6 + 0.8 * rand())));
  return out;
}
/** When the JS side receives each token. `mode`: 'onToken40' = old native batching (send when a token arrives
 * and >40 ms passed since the last send), 'clock32' = new native ticker every 32 ms, 'net50' = cloud SSE chunks. */
function deliveries(times, mode) {
  const ev = []; // { t, upTo } : text up to token index upTo (exclusive) is in JS at time t
  if (mode === 'onToken40') {
    let sent = -1e9;
    for (let i = 0; i < times.length; i++) if (times[i] - sent > 40) (sent = times[i]), ev.push({ t: times[i], upTo: i + 1 });
    ev.push({ t: times.at(-1), upTo: times.length });
  } else {
    const step = mode === 'clock32' ? 32 : 50;
    let i = 0;
    for (let t = step; i < times.length; t += step) {
      while (i < times.length && times[i] <= t) i++;
      if (!ev.length || ev.at(-1).upTo !== i) ev.push({ t, upTo: i });
    }
  }
  const offsets = [0];
  for (const tk of tokens) offsets.push(offsets.at(-1) + tk.length);
  return ev.map(e => ({ t: e.t, len: offsets[e.upTo] }));
}

// ---------- render cost models ----------
// "Rendering" a block here = the JS work a render does that is ours: the inline split for text blocks and the
// highlighter for code. React reconciliation and native layout come on top and scale with the blocks counted.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
function renderInlineCost(b) {
  if (b.t === 'table') for (const r of [b.head, ...b.rows]) for (const c of r) c.split(INLINE);
  else if (b.text !== undefined && b.t !== 'code') b.text.split(INLINE);
}

/** Old path: every update re-parses the whole text and re-renders every block; the open fence re-tokenizes fully
 * (closed fences were saved by CodeBlock's useMemo on an equal string). */
function oldUpdate(text, state) {
  const blocks = oldParse(text);
  let lines = 0;
  blocks.forEach((b, i) => {
    renderInlineCost(b);
    if (b.t === 'code') {
      const prev = state.code.get(i);
      if (prev !== b.text) (lines += tokenize(b.text, b.lang).length), state.code.set(i, b.text);
    }
  });
  return { blocksRendered: blocks.length, parses: 1, lines, blocks };
}

/** New path: incremental parser; only blocks whose content changed render; code tokenizes changed lines only. */
function newUpdate(text, state) {
  const blocks = state.parser.update(text);
  let rendered = 0;
  let lines = 0;
  blocks.forEach((b, i) => {
    const prev = state.prev[i];
    if (prev && state.c === state.prevC && sameBlock(prev, b)) return;
    rendered++;
    renderInlineCost(b);
    if (b.t === 'code') {
      const cache = state.code.get(i) ?? lineCache();
      state.code.set(i, cache);
      const before = cache.tokenized;
      tokenizeCached(cache, b.text, b.lang);
      lines += cache.tokenized - before;
    }
  });
  state.prev = blocks;
  state.prevC = state.c;
  return { blocksRendered: rendered, lines, blocks };
}

// ---------- simulations ----------
const FRAME = 1000 / 60;

function simulateOld(ev, flushMs) {
  // store.ts before: first delta arms a setTimeout(flushMs); the flush writes chats via set().
  const updates = [];
  let armed = null;
  let latest = 0;
  for (let k = 0; k < ev.length; k++) {
    latest = ev[k].len;
    if (armed === null) armed = ev[k].t + flushMs;
    while (armed !== null && (k + 1 >= ev.length || ev[k + 1].t >= armed)) {
      updates.push({ t: armed, len: latest });
      armed = null;
    }
  }
  if (!updates.length || updates.at(-1).len !== reply.length) updates.push({ t: ev.at(-1).t, len: reply.length });
  return updates;
}

function simulateNew(ev, minFrameMs) {
  // live.ts: pushes feed the reveal; a frame loop (vsync 60 Hz, at most every minFrameMs) shows the paced prefix.
  const reveal = createReveal();
  const updates = [];
  let k = 0;
  let shown = 0;
  let last = 0;
  const end = ev.at(-1).t;
  for (let t = 0; ; t += FRAME) {
    while (k < ev.length && ev[k].t <= t) reveal.push(ev[k].len, ev[k].t), k++;
    if (k >= ev.length && !reveal.done) reveal.finish();
    if (t - last < minFrameMs - 2) continue;
    const dt = t - last;
    last = t;
    const n = reveal.tick(Math.min(dt, 100));
    if (n !== shown) updates.push({ t, len: (shown = n) });
    if (t > end && shown >= reply.length) break;
  }
  return updates;
}

/** How text reached the screen. Arrival time of char i = when JS received it. */
function smoothness(updates, ev) {
  const arrival = new Float64Array(reply.length + 1);
  let j = 0;
  for (let i = 0; i <= reply.length; i++) {
    while (ev[j].len < i) j++;
    arrival[i] = ev[j].t;
  }
  const jumps = updates.map((u, i) => u.len - (i ? updates[i - 1].len : 0));
  const gaps = updates.slice(1).map((u, i) => u.t - updates[i].t);
  let lagSum = 0;
  let lagMax = 0;
  let prev = 0;
  for (const u of updates) {
    for (let i = prev + 1; i <= u.len; i++) {
      const lag = u.t - arrival[i];
      lagSum += lag;
      lagMax = Math.max(lagMax, lag);
    }
    prev = u.len;
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
  const durS = (updates.at(-1).t - updates[0].t) / 1000;
  // Characters that became visible in each 100 ms window: a steady flow has a low spread.
  const windows = new Array(Math.ceil((updates.at(-1).t + 1) / 100)).fill(0);
  updates.forEach((u, i) => (windows[Math.floor(u.t / 100)] += jumps[i]));
  const mid = windows.slice(Math.floor(windows.length * 0.1), Math.floor(windows.length * 0.9));
  // Longest time with no visible change while text was already waiting to be shown.
  let stall = 0;
  for (let i = 1; i < updates.length; i++) if (arrival[updates[i - 1].len + 1] < updates[i].t) stall = Math.max(stall, updates[i].t - Math.max(updates[i - 1].t, arrival[updates[i - 1].len + 1]));
  return {
    flowCv: sd(mid) / mean(mid),
    stallMs: stall,
    updatesPerS: updates.length / durS,
    meanJump: mean(jumps),
    maxJump: Math.max(...jumps),
    gapMeanMs: mean(gaps),
    gapCv: sd(gaps) / mean(gaps), // 0 = perfectly even
    lagMeanMs: lagSum / reply.length,
    lagMaxMs: lagMax,
    durS,
  };
}

function cost(updates, path) {
  const state = path === 'old' ? { code: new Map() } : { parser: createIncrementalParser(), prev: [], code: new Map(), c: 1, prevC: 1 };
  const run = path === 'old' ? oldUpdate : newUpdate;
  const times = [];
  let blocks = 0;
  let lines = 0;
  let mismatches = 0;
  for (const u of updates) {
    const text = reply.slice(0, u.len);
    const t0 = performance.now();
    const r = run(text, state);
    times.push(performance.now() - t0);
    blocks += r.blocksRendered;
    lines += r.lines;
    if (path === 'new') {
      const ref = oldParse(text);
      if (ref.length !== r.blocks.length || ref.some((b, i) => !sameBlock(b, r.blocks[i]))) mismatches++;
    }
  }
  const tail = times.slice(Math.floor(times.length * 0.9));
  const tailMs = tail.reduce((a, b) => a + b, 0) / tail.length;
  times.sort((a, b) => a - b);
  const total = times.reduce((a, b) => a + b, 0);
  return { tailMs, updates: updates.length, meanMs: total / times.length, p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times.at(-1), totalMs: total, blocksPerUpdate: blocks / updates.length, blocks, lines, mismatches };
}

// ---------- the pre-change parser, verbatim from Markdown.tsx ----------
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
function cells(line) {
  return line.trim().replace(/\\\|/g, '\u0000').replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim().replace(/\u0000/g, '|'));
}
function oldParse(src) {
  const blocks = [];
  const lines = src.split('\n');
  let para = [];
  let indents = [];
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
      const body = [];
      while (++i < lines.length && !lines[i].startsWith('```')) body.push(lines[i]);
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n'), open: i >= lines.length });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && DELIM.test(lines[i + 1]) && cells(lines[i + 1]).length === cells(line).length) {
      flush();
      indents = [];
      const head = cells(line);
      const align = cells(lines[++i]).map(d => (d.endsWith(':') ? (d.startsWith(':') ? 'center' : 'right') : 'left'));
      const rows = [];
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
  }
  flush();
  return blocks;
}

// ---------- run ----------
// Sanity: the new whole-text parse equals the old one on every prefix length, char by char.
let parseDiffs = 0;
for (let n = 0; n <= reply.length; n += 7) {
  const a = oldParse(reply.slice(0, n));
  const b = wholeParse(reply.slice(0, n));
  if (a.length !== b.length || a.some((x, i) => !sameBlock(x, b[i]))) parseDiffs++;
}
// And the incremental parser fed one character at a time.
let incDiffs = 0;
{
  const p = createIncrementalParser();
  for (let n = 0; n <= reply.length; n++) {
    const a = oldParse(reply.slice(0, n));
    const b = p.update(reply.slice(0, n));
    if (a.length !== b.length || a.some((x, i) => !sameBlock(x, b[i]))) incDiffs++;
  }
}

// Warm the JIT so both paths are measured hot.
for (let i = 0; i < 3; i++) cost(simulateOld(deliveries(tokenTimes(15), 'onToken40'), 150), 'old'), cost(simulateNew(deliveries(tokenTimes(15), 'clock32'), 33), 'new');

const scenarios = [
  { name: 'on-device, 15 tok/s', tps: 15, oldNative: 'onToken40', newNative: 'clock32', oldFlush: 150, newFrame: 33 },
  { name: 'cloud, 60 tok/s', tps: 60, oldNative: 'net50', newNative: 'net50', oldFlush: 33, newFrame: 16 },
];
const fmt = (x, d = 2) => (typeof x === 'number' ? x.toFixed(d) : x);
console.log(`Reply: ${reply.length} chars, ${tokens.length} tokens, ${oldParse(reply).length} blocks`);
console.log(`Parser equivalence: whole-text new vs old differs on ${parseDiffs} prefixes; incremental (char by char) differs on ${incDiffs} of ${reply.length + 1}`);
let bad = parseDiffs + incDiffs;
for (const sc of scenarios) {
  seed = 7;
  const times = tokenTimes(sc.tps);
  const evOld = deliveries(times, sc.oldNative);
  const evNew = deliveries(times, sc.newNative);
  const uOld = simulateOld(evOld, sc.oldFlush);
  const uNew = simulateNew(evNew, sc.newFrame);
  const sOld = smoothness(uOld, evOld);
  const sNew = smoothness(uNew, evNew);
  // Median of 5 runs for timing.
  const med = path => {
    const runs = Array.from({ length: 5 }, () => cost(path === 'old' ? uOld : uNew, path));
    return runs.sort((a, b) => a.totalMs - b.totalMs)[2];
  };
  const cOld = med('old');
  const cNew = med('new');
  bad += cNew.mismatches;
  console.log(`\n== ${sc.name} (${fmt(sOld.durS, 1)} s of streaming) ==`);
  console.log(`native->JS events/s        old ${fmt(evOld.length / sOld.durS, 1)}   new ${fmt(evNew.length / sNew.durS, 1)}`);
  console.log(`global store set()/s       old ${fmt(uOld.length / sOld.durS, 1)} (each wakes every useStore subscriber)   new 0 (only tool steps + end)`);
  console.log(`row updates/s              old ${fmt(sOld.updatesPerS, 1)}   new ${fmt(sNew.updatesPerS, 1)} (live channel, 1 subscriber)`);
  console.log(`chars per update  mean/max old ${fmt(sOld.meanJump, 1)}/${sOld.maxJump}   new ${fmt(sNew.meanJump, 1)}/${sNew.maxJump}`);
  console.log(`chars shown per 100 ms CV  old ${fmt(sOld.flowCv)}   new ${fmt(sNew.flowCv)}  (spread of the flow; 0 = perfectly steady)`);
  console.log(`longest visible stall ms   old ${fmt(sOld.stallMs, 0)}   new ${fmt(sNew.stallMs, 0)}  (text waiting, screen unchanged)`);
  console.log(`text lag after arrival ms  old mean ${fmt(sOld.lagMeanMs, 0)} max ${fmt(sOld.lagMaxMs, 0)}   new mean ${fmt(sNew.lagMeanMs, 0)} max ${fmt(sNew.lagMaxMs, 0)}`);
  console.log(`JS cost per update ms      old mean ${fmt(cOld.meanMs, 3)} p95 ${fmt(cOld.p95Ms, 3)} max ${fmt(cOld.maxMs, 3)}   new mean ${fmt(cNew.meanMs, 3)} p95 ${fmt(cNew.p95Ms, 3)} max ${fmt(cNew.maxMs, 3)}`);
  console.log(`JS cost/update, last 10%   old ${fmt(cOld.tailMs, 3)}   new ${fmt(cNew.tailMs, 3)}  (grows with the reply in the old path)`);
  console.log(`JS cost whole reply ms     old ${fmt(cOld.totalMs, 1)}   new ${fmt(cNew.totalMs, 1)}   (per streamed second: old ${fmt(cOld.totalMs / sOld.durS, 2)}, new ${fmt(cNew.totalMs / sNew.durS, 2)})`);
  console.log(`blocks re-rendered/update  old ${fmt(cOld.blocksPerUpdate, 1)}   new ${fmt(cNew.blocksPerUpdate, 2)}   (total old ${cOld.blocks}, new ${cNew.blocks})`);
  console.log(`block renders per second   old ${fmt(cOld.blocks / sOld.durS, 0)}   new ${fmt(cNew.blocks / sNew.durS, 0)}`);
  console.log(`parses of full text        old ${cOld.updates}   new 0 (tail only)`);
  console.log(`code lines tokenized       old ${cOld.lines}   new ${cNew.lines}`);
  console.log(`incremental vs whole-text mismatches: ${cNew.mismatches}`);
}
if (bad) {
  console.error(`\nFAIL: ${bad} parser mismatches`);
  process.exit(1);
}
