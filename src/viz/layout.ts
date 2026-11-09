// Diagram geometry, pure so the check script can run it: a layered layout for flowcharts and trees
// (longest-path ranks, barycenter ordering) and label sizes estimated from character counts.
import type { FlowSpec, NodeKind } from './parse';

export type Box = { id: string; label: string; kind: NodeKind; x: number; y: number; w: number; h: number; rank: number };
export type Link = { from: string; to: string; label?: string; d: string; arrow: string; mid: { x: number; y: number } };
export type FlowLayout = { boxes: Box[]; links: Link[]; width: number; height: number };

const CHAR = 7.1; // DM Sans 13px, average advance
const LINE = 18;

/** Width, height and line count for a label wrapped at `max` px. */
export function measure(label: string, max = 168, min = 64): { w: number; h: number; lines: number } {
  const room = Math.max(1, Math.floor((max - 24) / CHAR));
  let lines = 1;
  let used = 0;
  let widest = 0;
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const len = Math.min(word.length, room);
    if (used && used + 1 + len > room) { lines++; widest = Math.max(widest, used); used = len; } else used += (used ? 1 : 0) + len;
  }
  widest = Math.max(widest, used);
  lines = Math.min(lines, 4);
  return { w: Math.round(Math.min(max, Math.max(min, widest * CHAR + 24))), h: lines * LINE + 18, lines };
}

const GAP_RANK = 46;
const GAP_NODE = 18;
const PAD = 6;

export function layoutFlow(spec: FlowSpec, maxLabel = 168): FlowLayout {
  const ids = spec.nodes.map(n => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = spec.edges.filter(e => index.has(e.from) && index.has(e.to) && e.from !== e.to);
  const out = ids.map(() => [] as number[]);
  for (const e of edges) out[index.get(e.from)!].push(index.get(e.to)!);

  // Back edges (found by DFS from the roots) are left out of ranking so cycles still lay out.
  const state = ids.map(() => 0);
  const back = new Set<string>();
  const indeg = ids.map(() => 0);
  for (const e of edges) indeg[index.get(e.to)!]++;
  const dfs = (start: number) => {
    const stack: [number, number][] = [[start, 0]];
    state[start] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, i] = top;
      if (i >= out[v].length) { state[v] = 2; stack.pop(); continue; }
      top[1]++;
      const w = out[v][i];
      if (state[w] === 1) back.add(`${v}>${w}`);
      else if (state[w] === 0) { state[w] = 1; stack.push([w, 0]); }
    }
  };
  ids.forEach((_, i) => { if (indeg[i] === 0 && state[i] === 0) dfs(i); });
  ids.forEach((_, i) => { if (state[i] === 0) dfs(i); });

  const forward = ids.map(() => [] as number[]);
  const preds = ids.map(() => [] as number[]);
  for (let v = 0; v < ids.length; v++) for (const w of out[v]) if (!back.has(`${v}>${w}`)) { forward[v].push(w); preds[w].push(v); }
  // Longest path from a root, by Kahn's order.
  const rank = ids.map(() => 0);
  const left = preds.map(p => p.length);
  const queue = ids.map((_, i) => i).filter(i => left[i] === 0);
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    for (const w of forward[v]) {
      rank[w] = Math.max(rank[w], rank[v] + 1);
      if (--left[w] === 0) queue.push(w);
    }
  }

  const layers: number[][] = [];
  ids.forEach((_, i) => { (layers[rank[i]] ??= []).push(i); });
  for (let r = 0; r < layers.length; r++) layers[r] ??= [];
  const pos = ids.map(() => 0);
  const setPos = () => layers.forEach(layer => layer.forEach((v, i) => { pos[v] = i; }));
  setPos();
  const bary = (v: number, from: number[]) => (from.length ? from.reduce((a, u) => a + pos[u], 0) / from.length : pos[v]);
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).reverse().slice(1);
    for (const r of order) {
      const scores = new Map(layers[r].map(v => [v, bary(v, down ? preds[v] : forward[v])]));
      layers[r].sort((a, b) => scores.get(a)! - scores.get(b)!);
      setPos();
    }
  }

  const lr = spec.direction === 'LR';
  const sizes = spec.nodes.map(n => {
    const m = measure(n.label, maxLabel);
    // A diamond needs room around its text.
    return n.kind === 'decision' ? { w: Math.round(m.w * 1.3), h: Math.round(m.h * 1.35) } : { w: m.w, h: m.h };
  });
  // Main axis: one band per rank; cross axis: nodes side by side, each band centered.
  const along = (i: number) => (lr ? sizes[i].w : sizes[i].h);
  const across = (i: number) => (lr ? sizes[i].h : sizes[i].w);
  const band = layers.map(layer => Math.max(0, ...layer.map(along)));
  const spans = layers.map(layer => layer.reduce((a, v) => a + across(v), 0) + GAP_NODE * Math.max(0, layer.length - 1));
  const widest = Math.max(0, ...spans);
  const boxes: Box[] = new Array(ids.length);
  let main = PAD;
  layers.forEach((layer, r) => {
    let cross = PAD + (widest - spans[r]) / 2;
    for (const v of layer) {
      const n = spec.nodes[v];
      const offset = (band[r] - along(v)) / 2;
      const x = lr ? main + offset : cross;
      const y = lr ? cross : main + offset;
      boxes[v] = { id: n.id, label: n.label, kind: n.kind, x: Math.round(x), y: Math.round(y), w: sizes[v].w, h: sizes[v].h, rank: r };
      cross += across(v) + GAP_NODE;
    }
    main += band[r] + GAP_RANK;
  });
  const width = Math.ceil(lr ? main - GAP_RANK + PAD : widest + PAD * 2);
  const height = Math.ceil(lr ? widest + PAD * 2 : main - GAP_RANK + PAD);

  const links: Link[] = edges.map(e => {
    const a = boxes[index.get(e.from)!];
    const b = boxes[index.get(e.to)!];
    const backwards = b.rank <= a.rank;
    let p0: [number, number], p3: [number, number], c1: [number, number], c2: [number, number];
    if (!backwards) {
      p0 = lr ? [a.x + a.w, a.y + a.h / 2] : [a.x + a.w / 2, a.y + a.h];
      p3 = lr ? [b.x, b.y + b.h / 2] : [b.x + b.w / 2, b.y];
      const k = (lr ? p3[0] - p0[0] : p3[1] - p0[1]) / 2;
      c1 = lr ? [p0[0] + k, p0[1]] : [p0[0], p0[1] + k];
      c2 = lr ? [p3[0] - k, p3[1]] : [p3[0], p3[1] - k];
    } else {
      // Loops back around the outside edge.
      p0 = lr ? [a.x + a.w / 2, a.y + a.h] : [a.x + a.w, a.y + a.h / 2];
      p3 = lr ? [b.x + b.w / 2, b.y + b.h] : [b.x + b.w, b.y + b.h / 2];
      const bulge = 36;
      c1 = lr ? [p0[0], p0[1] + bulge] : [p0[0] + bulge, p0[1]];
      c2 = lr ? [p3[0], p3[1] + bulge] : [p3[0] + bulge, p3[1]];
    }
    const at = (t: number, i: 0 | 1) => (1 - t) ** 3 * p0[i] + 3 * (1 - t) ** 2 * t * c1[i] + 3 * (1 - t) * t ** 2 * c2[i] + t ** 3 * p3[i];
    const angle = Math.atan2(p3[1] - c2[1], p3[0] - c2[0]);
    const tip = (da: number) => `${(p3[0] - 7 * Math.cos(angle + da)).toFixed(1)},${(p3[1] - 7 * Math.sin(angle + da)).toFixed(1)}`;
    const f = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    return {
      from: e.from,
      to: e.to,
      label: e.label,
      d: `M${f(p0)} C${f(c1)} ${f(c2)} ${f(p3)}`,
      arrow: `M${tip(0.45)} L${f(p3)} L${tip(-0.45)}`,
      mid: { x: at(0.5, 0), y: at(0.5, 1) },
    };
  });
  // Room for loops drawn past the right or bottom edge.
  const extra = links.some(l => l.d && boxes[index.get(l.to)!].rank <= boxes[index.get(l.from)!].rank) ? 30 : 0;
  return { boxes, links, width: width + (lr ? 0 : extra), height: height + (lr ? extra : 0) };
}
