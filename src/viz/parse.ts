// Tolerant reader for the visual fences a model writes: ```chart (JSON, same spec as the desktop app), ```mermaid
// (flowchart, sequenceDiagram, timeline and pie, the subset drawn natively) and ```diagram (JSON).
// Pure: no React, no '@/' imports, so `node src/viz/parse.check.ts` runs it directly. Never throws.

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter';
export type Series = { name: string; values: (number | null)[]; points?: { x: number; y: number }[] };
export type ChartSpec = {
  kind: 'chart';
  type: ChartType;
  title?: string;
  /** Category per value index (x axis, or pie slices). Empty for scatter. */
  labels: string[];
  series: Series[];
  xLabel?: string;
  yLabel?: string;
  /** '%', a currency symbol, or a word such as 'ms'. */
  unit?: string;
  stacked: boolean;
};

export type NodeKind = 'default' | 'start' | 'decision' | 'data';
export type FlowNode = { id: string; label: string; kind: NodeKind };
export type FlowEdge = { from: string; to: string; label?: string };
export type FlowSpec = { kind: 'diagram'; type: 'flow' | 'tree'; title?: string; direction: 'TB' | 'LR'; nodes: FlowNode[]; edges: FlowEdge[] };
export type SequenceSpec = { kind: 'diagram'; type: 'sequence'; title?: string; actors: { id: string; label: string }[]; messages: { from: string; to: string; label?: string; reply: boolean }[] };
export type TimelineSpec = { kind: 'diagram'; type: 'timeline'; title?: string; events: { date: string; label: string; detail?: string }[] };
export type DiagramSpec = FlowSpec | SequenceSpec | TimelineSpec;
export type VisualSpec = ChartSpec | DiagramSpec;
export type VisualParse = { ok: true; spec: VisualSpec } | { ok: false; error: string };

export const LIMITS = { series: 8, points: 500, nodes: 80, messages: 120, bytes: 64 * 1024 };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 120): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
};
const fail = (error: string): VisualParse => ({ ok: false, error });

// ---------------------------------------------------------------- numbers

const CURRENCY = /^[$€£¥₹]|[$€£¥₹]$/;

/** A number from a number or a human string: "1,234", "45%", "$12.5k", "3,5". Null when it is not one. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/[\s  _]/g, '').replace(CURRENCY, '').replace(/%$/, '');
  let mult = 1;
  const suffix = /^[-+]?[\d.,]+([kmb])$/i.exec(s);
  if (suffix) {
    mult = { k: 1e3, m: 1e6, b: 1e9 }[suffix[1].toLowerCase() as 'k' | 'm' | 'b'];
    s = s.slice(0, -1);
  }
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s) * mult;
  return Number.isFinite(n) ? n : null;
}

/** The unit a model wrote into its values ("45%", "$12"), if they agree. */
function unitOf(values: unknown[]): string | undefined {
  const strings = values.filter((v): v is string => typeof v === 'string');
  if (!strings.length) return undefined;
  if (strings.every(v => v.trim().endsWith('%'))) return '%';
  const cur = strings[0].trim().match(CURRENCY)?.[0];
  return cur && strings.every(v => v.trim().includes(cur)) ? cur : undefined;
}

// ---------------------------------------------------------------- forgiving JSON

type Tok = { t: 'p'; v: string } | { t: 's'; v: string } | { t: 'n'; v: number } | { t: 'w'; v: string };
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (ch === '/' && s[i + 1] === '*') { const end = s.indexOf('*/', i + 2); i = end < 0 ? s.length : end + 2; continue; }
    if ('{}[]:,'.includes(ch)) { out.push({ t: 'p', v: ch }); i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let v = '';
      while (j < s.length && s[j] !== ch) {
        if (s[j] === '\\' && j + 1 < s.length) {
          const n = s[j + 1];
          if (n === 'u' && /^[0-9a-f]{4}$/i.test(s.slice(j + 2, j + 6))) { v += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16)); j += 6; continue; }
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
          continue;
        }
        v += s[j++];
      }
      out.push({ t: 's', v });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < s.length && !/[\s{}[\]:,"'`]/.test(s[j]) && !(s[j] === '/' && (s[j + 1] === '/' || s[j + 1] === '*'))) j++;
    if (j === i) j++;
    const word = s.slice(i, j);
    i = j;
    out.push(NUMBER.test(word) ? { t: 'n', v: Number(word) } : { t: 'w', v: word });
  }
  return out;
}

/** Rewrites almost-JSON as JSON: comments, single quotes, unquoted keys and words, trailing or missing commas,
 * Python literals, and brackets left open by a reply that was cut off. */
function repair(s: string): string {
  const toks = tokenize(s);
  const stack: string[] = [];
  let out = '';
  let prev: 'start' | 'open' | 'colon' | 'comma' | 'value' = 'start';
  let key = false;
  const closeKey = () => { if (key) { out += ':null'; key = false; } };
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.t === 'p') {
      if (tok.v === '{' || tok.v === '[') {
        closeKey();
        if (prev === 'value') out += ',';
        out += tok.v;
        stack.push(tok.v === '{' ? '}' : ']');
        prev = 'open';
      } else if (tok.v === '}' || tok.v === ']') {
        if (!stack.includes(tok.v)) continue;
        closeKey();
        if (prev === 'comma') out = out.slice(0, -1);
        if (prev === 'colon') out += 'null';
        while (stack.length) {
          const top = stack.pop()!;
          out += top;
          if (top === tok.v) break;
        }
        prev = 'value';
      } else if (tok.v === ':') {
        if (key) { out += ':'; key = false; prev = 'colon'; }
      } else if (prev === 'value') {
        closeKey();
        out += ',';
        prev = 'comma';
      }
      continue;
    }
    const inObject = stack[stack.length - 1] === '}';
    const isKey = inObject && prev !== 'colon';
    let piece: string;
    if (tok.t === 'w') {
      let word = tok.v;
      // Unquoted text with spaces ("title: Sales by month"), up to the next key.
      while (!isKey && k + 1 < toks.length && (toks[k + 1].t === 'w' || toks[k + 1].t === 'n') && !(toks[k + 2]?.t === 'p' && toks[k + 2].v === ':')) {
        word += ' ' + String(toks[++k].v);
      }
      if (!isKey && /^(true|false|null)$/.test(word)) piece = word;
      else if (!isKey && /^(True|False)$/.test(word)) piece = word.toLowerCase();
      else if (!isKey && /^(None|NaN|undefined|-?Infinity)$/.test(word)) piece = 'null';
      else piece = JSON.stringify(word);
    } else if (tok.t === 'n') {
      piece = isKey ? JSON.stringify(String(tok.v)) : String(tok.v);
    } else {
      piece = JSON.stringify(tok.v);
    }
    closeKey();
    if (prev === 'value') out += ',';
    out += piece;
    prev = 'value';
    key = isKey;
  }
  closeKey();
  if (prev === 'comma') out = out.slice(0, -1);
  if (prev === 'colon') out += 'null';
  while (stack.length) out += stack.pop();
  return out;
}

/** Parses JSON as a model writes it. Throws when nothing JSON-like is there. */
export function looseJson(input: string): unknown {
  const s = input.replace(/^﻿/, '').trim().replace(/^```[\w-]*[ \t]*\n?/, '').replace(/\n?```\s*$/, '');
  try { return JSON.parse(s); } catch { /* repaired below */ }
  const smart = s.replace(/[“”„‟«»]/g, '"').replace(/[‘’‚‛]/g, "'");
  const start = smart.search(/[[{]/);
  if (start < 0) throw new Error('No JSON object found.');
  return JSON.parse(repair(smart.slice(start)));
}

// ---------------------------------------------------------------- charts

const CHART_ALIASES: Record<string, ChartType> = {
  bar: 'bar', bars: 'bar', column: 'bar', columns: 'bar', histogram: 'bar', horizontalbar: 'bar', groupedbar: 'bar', stackedbar: 'bar',
  line: 'line', lines: 'line', spline: 'line', trend: 'line', timeseries: 'line',
  area: 'area', areas: 'area', stackedarea: 'area',
  pie: 'pie', donut: 'donut', doughnut: 'donut', ring: 'donut',
  scatter: 'scatter', points: 'scatter', dots: 'scatter', bubble: 'scatter', xy: 'scatter',
};

function chartType(v: unknown): ChartType | undefined {
  if (typeof v !== 'string') return undefined;
  const key = v.toLowerCase().replace(/[^a-z]/g, '').replace(/(chart|graph|plot)$/, '');
  return CHART_ALIASES[key];
}

const LABEL_KEYS = ['label', 'name', 'x', 'category', 'key', 'title', 'month', 'year', 'date', 'period', 'group'];
const VALUE_KEYS = ['value', 'y', 'count', 'amount', 'total', 'v'];

/** Rows such as [{ "month": "Jan", "sales": 10, "cost": 4 }] → labels from the first text field, a series per number field. */
function fromRows(rows: unknown[]): { labels: string[]; series: Series[]; unit?: string } | null {
  if (!rows.length) return null;
  if (rows.every(r => Array.isArray(r))) {
    const pairs = rows as unknown[][];
    if (!pairs.every(p => p.length >= 2)) return null;
    const labels = pairs.map(p => String(p[0] ?? ''));
    const width = Math.max(...pairs.map(p => p.length));
    const series = Array.from({ length: width - 1 }, (_, i) => ({ name: width > 2 ? `Series ${i + 1}` : '', values: pairs.map(p => num(p[i + 1])) }));
    return { labels, series, unit: unitOf(pairs.map(p => p[1])) };
  }
  if (!rows.every(isObj)) return null;
  const objs = rows as Obj[];
  const keys = [...new Set(objs.flatMap(o => Object.keys(o)))];
  const labelKey = LABEL_KEYS.find(k => keys.includes(k) && objs.some(o => num(o[k]) === null)) ?? keys.find(k => objs.every(o => typeof o[k] === 'string' && num(o[k]) === null));
  const numeric = keys.filter(k => k !== labelKey && objs.some(o => num(o[k]) !== null));
  if (!numeric.length) return null;
  const valueKeys = numeric.filter(k => VALUE_KEYS.includes(k)).length === numeric.length ? numeric : numeric.filter(k => k !== 'id');
  return {
    labels: objs.map((o, i) => (labelKey ? text(o[labelKey], 60) : undefined) ?? String(i + 1)),
    series: valueKeys.map(k => ({ name: VALUE_KEYS.includes(k) && valueKeys.length === 1 ? '' : k, values: objs.map(o => num(o[k])) })),
    unit: unitOf(objs.map(o => o[valueKeys[0]])),
  };
}

type RawPoint = { x: unknown; y: number | null };
function point(p: unknown): RawPoint | null {
  if (Array.isArray(p) && p.length >= 2) return { x: p[0], y: num(p[1]) };
  if (isObj(p)) {
    const x = p.x ?? p.label ?? p.name ?? p.category ?? p.date;
    const y = p.y ?? p.value ?? p.count ?? p.amount;
    if (x !== undefined || y !== undefined) return { x, y: num(y) };
  }
  return null;
}

/** Normalizes any chart-shaped value. Returns an error string when nothing drawable is in it. */
export function chartFrom(raw: unknown, hint?: ChartType): ChartSpec | string {
  let o: Obj;
  if (Array.isArray(raw)) {
    if (raw.length && raw.every(v => num(v) !== null)) o = { series: [{ name: '', data: raw }] };
    else if (raw.length && raw.every(v => isObj(v) && ('data' in v || 'values' in v))) o = { series: raw };
    else o = { rows: raw };
  } else if (isObj(raw)) o = raw;
  else return 'The chart must be a JSON object with "labels" and "series".';

  // Chart.js shape: { data: { labels, datasets: [{ label, data }] } }.
  const inner = isObj(o.data) && (Array.isArray(o.data.datasets) || Array.isArray(o.data.labels)) ? o.data : undefined;
  const axis = (v: unknown) => (isObj(v) ? v : undefined);
  const xAxis = axis(o.x) ?? axis(o.xAxis) ?? axis(o.x_axis);
  const yAxis = axis(o.y) ?? axis(o.yAxis) ?? axis(o.y_axis);
  let type = chartType(o.type ?? o.kind ?? o.chart ?? o.chartType ?? o.chart_type) ?? hint;
  let labels: string[] = [];
  const rawLabels = o.labels ?? o.categories ?? inner?.labels ?? xAxis?.categories ?? xAxis?.labels ?? xAxis?.data;
  if (Array.isArray(rawLabels)) labels = rawLabels.slice(0, LIMITS.points).map(l => String(l ?? '').slice(0, 60));
  let unit = text(yAxis?.unit ?? o.unit ?? o.units, 12);

  let series: Series[] = [];
  let rawSeries: unknown = o.series ?? o.datasets ?? inner?.datasets ?? o.data ?? o.values ?? o.rows;
  // { "data": { "A": 1, "B": 2 } } or { "series": { "Sales": [1, 2] } }.
  if (isObj(rawSeries)) {
    const entries = Object.entries(rawSeries);
    if (entries.every(([, v]) => num(v) !== null)) {
      if (!labels.length) labels = entries.map(([k]) => k);
      unit ??= unitOf(entries.map(([, v]) => v));
      rawSeries = [{ name: '', data: entries.map(([, v]) => v) }];
    } else rawSeries = entries.map(([name, data]) => ({ name, data }));
  }
  if (Array.isArray(rawSeries) && rawSeries.length && rawSeries.every(v => num(v) !== null)) rawSeries = [{ name: '', data: rawSeries }];
  if (!Array.isArray(rawSeries) || !rawSeries.length) return 'The chart needs data: a "series" list of numbers.';

  const isSeries = (v: unknown) => isObj(v) && ['data', 'values', 'points', 'y'].some(k => Array.isArray(v[k]) || isObj(v[k]));
  if (!rawSeries.every(isSeries)) {
    const rows = fromRows(rawSeries);
    if (!rows) return 'Each series needs a "name" and a "data" list of numbers.';
    if (!labels.length) labels = rows.labels;
    series = rows.series;
    unit ??= rows.unit;
  } else {
    // Category labels met in {x, y} points, merged with the declared ones in order.
    const order = new Map(labels.map((l, i) => [l, i]));
    const scatterish = type === 'scatter';
    for (const [index, entry] of rawSeries.slice(0, LIMITS.series).entries()) {
      const s = entry as Obj;
      const name = text(s.name ?? s.label ?? s.title ?? s.key, 60) ?? (rawSeries.length > 1 ? `Series ${index + 1}` : '');
      let data: unknown = s.data ?? s.values ?? s.points ?? s.y;
      if (isObj(data)) data = Object.entries(data).map(([x, y]) => ({ x, y }));
      const list = (data as unknown[]).slice(0, LIMITS.points);
      unit ??= unitOf(list);
      const pts = list.map(point);
      if (list.length && pts.every(p => p !== null) && list.every(v => typeof v === 'object' && v !== null)) {
        const pairs = pts as RawPoint[];
        if (scatterish || (!labels.length && pairs.every(p => num(p.x) !== null) && type !== 'bar' && type !== 'pie' && type !== 'donut' && type !== 'line' && type !== 'area')) {
          const points = pairs.map((p, i) => ({ x: num(p.x) ?? i, y: p.y })).filter((p): p is { x: number; y: number } => p.y !== null);
          series.push({ name, values: points.map(p => p.y), points });
          type ??= 'scatter';
        } else {
          const values: (number | null)[] = [];
          for (const p of pairs) {
            const label = String(p.x ?? '').slice(0, 60);
            if (!order.has(label)) { order.set(label, order.size); labels.push(label); }
            values[order.get(label)!] = p.y;
          }
          series.push({ name, values: Array.from(values, v => v ?? null) });
        }
      } else {
        series.push({ name, values: list.map(num) });
      }
    }
  }
  if (!series.length) return 'The chart needs at least one series.';
  series = series.slice(0, LIMITS.series);

  const longest = Math.max(...series.map(s => s.values.length));
  if (!series.some(s => s.values.some(v => v !== null))) return 'The chart has no numbers to draw.';
  if (!type) type = series.every(s => s.points) ? 'scatter' : longest > 16 ? 'line' : 'bar';
  if (type === 'scatter' && !series.every(s => s.points)) {
    series = series.map(s => s.points ? s : { ...s, points: s.values.flatMap((y, x) => (y === null ? [] : [{ x: num(labels[x]) ?? x, y }])) });
  }

  if (type === 'pie' || type === 'donut') {
    // Several one-value series are slices too.
    if (series.length > 1 && series.every(s => s.values.filter(v => v !== null).length === 1)) {
      labels = series.map(s => s.name);
      series = [{ name: '', values: series.map(s => s.values.find(v => v !== null) ?? null) }];
    }
    const first = series[0];
    const n = Math.max(first.values.length, 1);
    const all = Array.from({ length: n }, (_, i) => labels[i] ?? String(i + 1));
    const keep = all.map((_, i) => i).filter(i => (first.values[i] ?? 0) > 0);
    if (!keep.length) return 'Pie slices need positive values.';
    labels = keep.map(i => all[i]);
    series = [{ name: first.name, values: keep.map(i => first.values[i]) }];
  } else if (type !== 'scatter') {
    labels = Array.from({ length: longest }, (_, i) => labels[i] ?? String(i + 1));
    series = series.map(s => ({ ...s, values: Array.from({ length: longest }, (_, i) => s.values[i] ?? null) }));
  } else {
    labels = [];
  }

  const axisTitle = (a: Obj | undefined, flat: unknown) => text(a?.label ?? a?.title ?? a?.name ?? (typeof flat === 'string' ? flat : undefined), 60);
  return {
    kind: 'chart',
    type,
    title: text(o.title ?? o.name ?? o.caption),
    labels,
    series,
    xLabel: axisTitle(xAxis, o.x ?? o.xLabel ?? o.xAxis ?? o.x_label),
    yLabel: axisTitle(yAxis, o.y ?? o.yLabel ?? o.yAxis ?? o.y_label),
    unit,
    stacked: (o.stacked === true || o.stack === true || yAxis?.stacked === true || /stacked/i.test(String(o.type ?? ''))) && (type === 'bar' || type === 'area'),
  };
}

/** "Label: value" lines (also "Label, value", "Label | value", bullets) and bare number lists. */
export function chartFromLines(source: string): ChartSpec | string {
  const lines = source.split(/\r?\n/).map(l => l.trim().replace(/^([-*•]|\d+[.)])\s+/, '')).filter(Boolean);
  const labels: string[] = [];
  const values: (number | null)[] = [];
  const meta: Record<string, string> = {};
  let stray = 0;
  for (const line of lines) {
    const parts = line.split(/[,;\s]+/).filter(Boolean);
    if (parts.length > 1 && parts.every(p => num(p) !== null)) {
      for (const p of parts) { values.push(num(p)); labels.push(String(values.length)); }
      continue;
    }
    const m = /^(.+?)\s*(?::|=|\||\t|,|—|–| - )\s*(.+)$/.exec(line);
    if (!m) { stray++; continue; }
    const key = m[1].replace(/^["'*]+|["'*]+$/g, '').trim();
    const value = num(m[2].replace(/^["']|["']$/g, ''));
    if (value !== null && key) { labels.push(key.slice(0, 60)); values.push(value); }
    else if (/^(type|title|unit|x|y)$/i.test(key)) meta[key.toLowerCase()] = m[2].trim();
    else stray++;
  }
  if (!values.length) return 'Write the chart as JSON, or as "label: value" lines.';
  if (stray > Math.max(1, lines.length / 3)) return 'Some lines are not "label: value" pairs.';
  return chartFrom({ type: meta.type, title: meta.title, unit: meta.unit, x: meta.x, y: meta.y, labels, series: [{ name: '', data: values }] });
}

// ---------------------------------------------------------------- diagrams

const DIAGRAM_ALIASES: Record<string, DiagramSpec['type']> = {
  flow: 'flow', flowchart: 'flow', graph: 'flow', process: 'flow', dag: 'flow', steps: 'flow', workflow: 'flow', pipeline: 'flow', statemachine: 'flow', state: 'flow',
  tree: 'tree', hierarchy: 'tree', org: 'tree', orgchart: 'tree', mindmap: 'tree',
  sequence: 'sequence', sequencediagram: 'sequence', seq: 'sequence', interaction: 'sequence',
  timeline: 'timeline', roadmap: 'timeline', history: 'timeline', milestones: 'timeline',
};

function nodeKind(v: unknown): NodeKind {
  const k = String(v ?? '').toLowerCase();
  if (/start|end|stop|terminal|begin|finish|pill|round/.test(k)) return 'start';
  if (/decision|choice|condition|if|diamond|question|branch/.test(k)) return 'decision';
  if (/data|database|db|store|storage|io|input|output|cylinder|file/.test(k)) return 'data';
  return 'default';
}

const arr = (...vs: unknown[]): unknown[] => (vs.find(Array.isArray) as unknown[] | undefined) ?? [];

function flowFrom(o: Obj, type: 'flow' | 'tree', title?: string): VisualParse {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const byId = new Map<string, FlowNode>();
  const add = (id: string, label = id, kind: NodeKind = 'default') => {
    const hit = byId.get(id);
    if (hit) return hit;
    const node = { id, label: label.slice(0, 80), kind };
    byId.set(id, node);
    nodes.push(node);
    return node;
  };
  // Nested trees: { label, children: [...] }.
  const walk = (n: unknown, parent?: string, depth = 0) => {
    if (depth > 12 || nodes.length >= LIMITS.nodes) return;
    const label = typeof n === 'string' ? n : isObj(n) ? text(n.label ?? n.name ?? n.title ?? n.text ?? n.id, 80) : undefined;
    if (!label) return;
    const id = isObj(n) && text(n.id) ? text(n.id)! : `${parent ?? 'root'}/${label}`;
    add(id, label, isObj(n) ? nodeKind(n.kind ?? n.shape) : 'default');
    if (parent) edges.push({ from: parent, to: id });
    if (isObj(n)) for (const child of arr(n.children, n.items, n.nodes)) walk(child, id, depth + 1);
  };
  const root = o.root ?? o.tree;
  if (root !== undefined) walk(root);
  else if (!Array.isArray(o.nodes) && Array.isArray(o.children)) walk(o);

  const listed = arr(o.nodes, o.steps, o.items, o.states);
  for (const [i, n] of listed.slice(0, LIMITS.nodes).entries()) {
    if (typeof n === 'string' || typeof n === 'number') { add(String(n)); continue; }
    if (!isObj(n)) continue;
    const label = text(n.label ?? n.text ?? n.name ?? n.title ?? n.id, 80) ?? `Step ${i + 1}`;
    const id = text(n.id ?? n.key ?? n.name, 80) ?? label;
    add(id, label, nodeKind(n.kind ?? n.type ?? n.shape));
    for (const next of arr(n.next, n.to, n.children, n.targets)) if (text(next)) edges.push({ from: id, to: text(next)! });
    if (Array.isArray(n.children) && n.children.some(isObj)) for (const child of n.children) walk(child, id, 1);
  }
  for (const e of arr(o.edges, o.links, o.connections, o.arrows, o.transitions)) {
    if (Array.isArray(e) && e.length >= 2) edges.push({ from: String(e[0]), to: String(e[1]), label: text(e[2], 60) });
    else if (typeof e === 'string') {
      const m = /^(.+?)\s*(?:-+>|=+>|→|->)\s*(.+?)(?:\s*:\s*(.+))?$/.exec(e);
      if (m) edges.push({ from: m[1].trim(), to: m[2].trim(), label: m[3]?.trim() });
    } else if (isObj(e)) {
      const from = text(e.from ?? e.source ?? e.start ?? e.src, 80);
      const to = text(e.to ?? e.target ?? e.end ?? e.dst, 80);
      if (from && to) edges.push({ from, to, label: text(e.label ?? e.text ?? e.name, 60) });
    }
  }
  // Edges may name nodes by label; unknown ends become nodes.
  const byLabel = new Map(nodes.map(n => [n.label.toLowerCase(), n.id]));
  const resolve = (ref: string) => byId.has(ref) ? ref : byLabel.get(ref.toLowerCase()) ?? add(ref).id;
  const resolved = edges.slice(0, LIMITS.nodes * 3).map(e => ({ ...e, from: resolve(e.from), to: resolve(e.to) }));
  if (!resolved.length && nodes.length > 1 && type === 'flow') {
    for (let i = 1; i < nodes.length; i++) resolved.push({ from: nodes[i - 1].id, to: nodes[i].id });
  }
  if (!nodes.length) return fail('The diagram needs "nodes" (and "edges" between them).');
  const dir = String(o.direction ?? o.dir ?? o.orientation ?? '').toUpperCase();
  return { ok: true, spec: { kind: 'diagram', type, title, direction: /^(LR|RL|H)/.test(dir) ? 'LR' : 'TB', nodes: nodes.slice(0, LIMITS.nodes), edges: resolved } };
}

function sequenceFrom(o: Obj, title?: string): VisualParse {
  const actors: { id: string; label: string }[] = [];
  const ids = new Map<string, string>();
  const actor = (ref: string, label = ref) => {
    const key = ref.toLowerCase();
    if (!ids.has(key)) { ids.set(key, ref); actors.push({ id: ref, label: label.slice(0, 40) }); }
    return ids.get(key)!;
  };
  for (const a of arr(o.actors, o.participants, o.lanes, o.parties)) {
    if (typeof a === 'string') actor(a);
    else if (isObj(a)) { const id = text(a.id ?? a.name ?? a.label, 40); if (id) { actor(id, text(a.label ?? a.name, 40) ?? id); if (text(a.label)) ids.set(text(a.label)!.toLowerCase(), id); } }
  }
  const messages: SequenceSpec['messages'] = [];
  for (const m of arr(o.messages, o.steps, o.calls, o.edges, o.events).slice(0, LIMITS.messages)) {
    let from: string | undefined, to: string | undefined, label: string | undefined, reply = false;
    if (Array.isArray(m)) [from, to, label] = [text(m[0], 40), text(m[1], 40), text(m[2], 80)];
    else if (typeof m === 'string') {
      const r = /^(.+?)\s*(--?>>?|=>|→)\s*(.+?)\s*:\s*(.*)$/.exec(m);
      if (r) { from = r[1]; to = r[3]; label = r[4]; reply = r[2].startsWith('--'); }
    } else if (isObj(m)) {
      from = text(m.from ?? m.source ?? m.sender, 40);
      to = text(m.to ?? m.target ?? m.receiver, 40);
      label = text(m.label ?? m.text ?? m.message ?? m.name, 80);
      reply = m.reply === true || m.dashed === true || m.response === true || /return|reply|response/i.test(String(m.type ?? ''));
    }
    if (from && to) messages.push({ from: actor(from), to: actor(to), label, reply });
  }
  if (!messages.length) return fail('A sequence diagram needs "messages" with "from" and "to".');
  return { ok: true, spec: { kind: 'diagram', type: 'sequence', title, actors: actors.slice(0, 12), messages } };
}

function timelineFrom(o: Obj | unknown[], title?: string): VisualParse {
  const list = Array.isArray(o) ? o : arr(o.events, o.items, o.milestones, o.nodes, o.entries);
  const events: TimelineSpec['events'] = [];
  for (const e of list.slice(0, LIMITS.nodes)) {
    if (typeof e === 'string') {
      const m = /^(.+?)\s*[:—–-]\s+(.+)$/.exec(e);
      events.push(m ? { date: m[1], label: m[2] } : { date: '', label: e });
    } else if (isObj(e)) {
      const label = text(e.label ?? e.title ?? e.event ?? e.name ?? e.text, 100);
      if (!label) continue;
      events.push({ date: text(e.date ?? e.time ?? e.year ?? e.when ?? e.period ?? e.start, 40) ?? '', label, detail: text(e.detail ?? e.description ?? e.desc ?? e.note, 240) });
    }
  }
  if (!events.length) return fail('A timeline needs "events" with "date" and "label".');
  return { ok: true, spec: { kind: 'diagram', type: 'timeline', title, events } };
}

/** Normalizes a ```diagram JSON value. */
export function diagramFrom(raw: unknown): VisualParse {
  if (Array.isArray(raw)) {
    if (raw.every(isObj) && raw.some(e => 'date' in e || 'year' in e || 'when' in e)) return timelineFrom(raw);
    if (raw.every(v => typeof v === 'string')) return flowFrom({ nodes: raw }, 'flow');
    return fail('The diagram must be a JSON object with "type", "nodes" and "edges".');
  }
  if (!isObj(raw)) return fail('The diagram must be a JSON object with "type", "nodes" and "edges".');
  const title = text(raw.title ?? raw.caption);
  const declared = DIAGRAM_ALIASES[String(raw.type ?? raw.kind ?? '').toLowerCase().replace(/[^a-z]/g, '').replace(/diagram$/, '') || '_'];
  const type = declared
    ?? (raw.actors || raw.participants || raw.messages ? 'sequence' : raw.events || raw.milestones ? 'timeline' : raw.root || raw.children ? 'tree' : 'flow');
  if (type === 'sequence') return sequenceFrom(raw, title);
  if (type === 'timeline') return timelineFrom(raw, title);
  return flowFrom(raw, type, title);
}

// ---------------------------------------------------------------- mermaid subset

const SHAPE = /^(\(\(\(.*?\)\)\)|\(\(.*?\)\)|\(\[.*?\]\)|\[\[.*?\]\]|\[\(.*?\)\]|\[\/.*?[/\\]\]|\[\\.*?[/\\]\]|\{\{.*?\}\}|\[.*?\]|\(.*?\)|\{.*?\}|>.*?\])/;
const LINK_TEXT = /^\s*<?(?:--|==|-\.)\s*([^>|]+?)\s*(?:-->|---|==>|===|\.->|\.-)[>ox]?\s*/;
const LINK = /^\s*(<?(?:-{2,}>|-{3,}|={2,}>|={3,}|-\.+->|-\.+-|~~~|--[ox]|==[ox]))\s*(?:\|([^|]*)\|)?\s*/;

const cleanLabel = (s: string) => s.replace(/^["'`]|["'`]$/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/\*\*|__/g, '').replace(/&quot;/g, '"').replace(/#quot;/g, '"').replace(/\s+/g, ' ').trim();

function mermaidFlow(head: string[], lines: string[], title?: string): VisualParse {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const byId = new Map<string, FlowNode>();
  const node = (id: string, shape?: string) => {
    let kind: NodeKind = 'default';
    let label = id;
    if (shape) {
      if (/^(\(\(|\(\[)/.test(shape)) kind = 'start';
      else if (/^\{[^{]/.test(shape)) kind = 'decision';
      else if (/^\[\(/.test(shape)) kind = 'data';
      label = cleanLabel(shape.replace(/^[[({>/\\]+|[\])}/\\]+$/g, ''));
    }
    const hit = byId.get(id);
    if (hit) { if (shape) { hit.label = label.slice(0, 80); hit.kind = kind; } return id; }
    const n = { id, label: label.slice(0, 80), kind };
    byId.set(id, n);
    nodes.push(n);
    return id;
  };
  const readGroup = (s: string): [string[], string] | null => {
    const ids: string[] = [];
    let rest = s;
    for (;;) {
      const m = /^\s*([A-Za-z0-9_À-￿][\w.\-À-￿]*)/.exec(rest);
      if (!m) return ids.length ? [ids, rest] : null;
      rest = rest.slice(m[0].length);
      const shape = SHAPE.exec(rest);
      if (shape) rest = rest.slice(shape[0].length);
      rest = rest.replace(/^:::\w+/, '');
      ids.push(node(m[1], shape?.[0]));
      const amp = /^\s*&\s*/.exec(rest);
      if (!amp) return [ids, rest];
      rest = rest.slice(amp[0].length);
    }
  };
  let direction: 'TB' | 'LR' = /^(LR|RL)$/i.test(head[0] ?? '') ? 'LR' : 'TB';
  for (const raw of lines) {
    for (const statement of raw.split(';')) {
      const s = statement.trim();
      if (!s || /^(subgraph|end$|classDef|class\s|style\s|linkStyle|click\s|accTitle|accDescr)/.test(s)) continue;
      const dir = /^direction\s+(\w+)/.exec(s);
      if (dir) { if (!nodes.length) direction = /^(LR|RL)$/i.test(dir[1]) ? 'LR' : 'TB'; continue; }
      let first = readGroup(s);
      if (!first) continue;
      let [from, rest] = first;
      for (;;) {
        const plain = LINK.exec(rest);
        const worded = plain ? null : LINK_TEXT.exec(rest);
        const link = plain ?? worded;
        if (!link) break;
        const label = plain ? plain[2] : link[1];
        rest = rest.slice(link[0].length);
        first = readGroup(rest);
        if (!first) break;
        const [to, after] = first;
        for (const a of from) for (const b of to) edges.push({ from: a, to: b, label: label ? cleanLabel(label).slice(0, 60) || undefined : undefined });
        from = to;
        rest = after;
      }
    }
  }
  if (!nodes.length) return fail('The flowchart has no nodes.');
  return { ok: true, spec: { kind: 'diagram', type: 'flow', title, direction, nodes: nodes.slice(0, LIMITS.nodes), edges } };
}

function mermaidSequence(lines: string[], title?: string): VisualParse {
  const o: Obj = { actors: [] as Obj[], messages: [] as Obj[] };
  for (const line of lines) {
    const p = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line);
    if (p) { (o.actors as Obj[]).push({ id: cleanLabel(p[2]), label: cleanLabel(p[3] ?? p[2]) }); continue; }
    const t = /^title:?\s+(.+)$/i.exec(line);
    if (t) { title ??= cleanLabel(t[1]); continue; }
    const m = /^(.+?)\s*(--?(?:>>|>|x|\)))\s*[+-]?\s*(.+?)\s*:\s*(.*)$/.exec(line) ?? /^(.+?)\s*(--?(?:>>|>|x|\)))\s*[+-]?\s*(.+?)\s*$/.exec(line);
    if (m) (o.messages as Obj[]).push({ from: cleanLabel(m[1]), to: cleanLabel(m[3]), label: m[4] ? cleanLabel(m[4]) : undefined, reply: m[2].startsWith('--') });
  }
  return sequenceFrom(o, title);
}

function mermaidTimeline(lines: string[], title?: string): VisualParse {
  const events: Obj[] = [];
  for (const line of lines) {
    const t = /^title\s+(.+)$/i.exec(line);
    if (t) { title ??= cleanLabel(t[1]); continue; }
    if (/^section\s/i.test(line)) continue;
    const parts = line.split(/\s+:\s+|\s*:\s+|^:\s*/).map(cleanLabel);
    if (line.startsWith(':') && events.length) {
      const last = events[events.length - 1];
      const more = parts.filter(Boolean);
      last.detail = [last.detail, ...more].filter(Boolean).join(' · ');
      continue;
    }
    const [date, label, ...rest] = parts;
    if (date && label) events.push({ date, label, detail: rest.filter(Boolean).join(' · ') || undefined });
  }
  return timelineFrom({ events }, title);
}

function mermaidPie(head: string[], lines: string[], title?: string): VisualParse {
  const labels: string[] = [];
  const values: number[] = [];
  const inline = head.join(' ').match(/title\s+(.+)/i);
  if (inline) title ??= cleanLabel(inline[1]);
  for (const line of lines) {
    const t = /^title\s+(.+)$/i.exec(line);
    if (t) { title ??= cleanLabel(t[1]); continue; }
    const m = /^(.+?)\s*:\s*([-+\d.,]+)\s*$/.exec(line);
    const v = m ? num(m[2]) : null;
    if (m && v !== null) { labels.push(cleanLabel(m[1])); values.push(v); }
  }
  const spec = chartFrom({ type: 'pie', title, labels, series: [{ name: '', data: values }] });
  return typeof spec === 'string' ? fail(spec) : { ok: true, spec };
}

const MERMAID_HEAD = /^(graph|flowchart|sequencediagram|timeline|pie|classdiagram|statediagram|erdiagram|gantt|journey|mindmap|gitgraph|quadrantchart|xychart|sankey|block|c4\w*)\b/i;

/** Draws the Mermaid subset that reads well on a phone; anything else is reported, not guessed. */
export function parseMermaid(source: string): VisualParse {
  let lines = source.split(/\r?\n/).map(l => l.replace(/%%.*$/, '').trim()).filter(Boolean);
  let title: string | undefined;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    for (const l of lines.slice(1, end < 0 ? 1 : end)) { const m = /^title:\s*(.+)$/.exec(l); if (m) title = cleanLabel(m[1]); }
    lines = lines.slice(end < 0 ? 1 : end + 1);
  }
  const [kw = '', ...head] = (lines.shift() ?? '').split(/\s+/);
  switch (kw.toLowerCase()) {
    case 'graph':
    case 'flowchart':
      return mermaidFlow(head, lines, title);
    case 'sequencediagram':
      return mermaidSequence(lines, title);
    case 'timeline':
      return mermaidTimeline(lines, title);
    case 'pie':
      return mermaidPie(head, lines, title);
    default:
      return fail(kw ? `"${kw}" diagrams are not drawn here. Flowchart, sequence, timeline and pie are.` : 'The diagram is empty.');
  }
}

// ---------------------------------------------------------------- entry point

const cache = new Map<string, VisualParse>();

/** Parses a finished visual fence. Cached by language and source, so re-renders cost nothing. */
export function parseVisual(lang: string, source: string): VisualParse {
  const key = `${lang}\n${source}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let result: VisualParse;
  try { result = parseUncached(lang.toLowerCase().trim(), source); } catch (e) { result = fail(e instanceof Error ? e.message : String(e)); }
  if (cache.size > 200) cache.clear();
  cache.set(key, result);
  return result;
}

function fromJson(raw: unknown, preferDiagram: boolean): VisualParse {
  const declared = isObj(raw) ? raw.type ?? raw.kind : undefined;
  const asChart = chartType(declared);
  const asDiagram = typeof declared === 'string' && DIAGRAM_ALIASES[declared.toLowerCase().replace(/[^a-z]/g, '').replace(/diagram$/, '')];
  if (asDiagram || (preferDiagram && !asChart)) return diagramFrom(raw);
  const chart = chartFrom(raw);
  return typeof chart === 'string' ? fail(chart) : { ok: true, spec: chart };
}

function parseUncached(lang: string, source: string): VisualParse {
  const body = source.trim();
  if (!body) return fail('The block is empty.');
  if (body.length > LIMITS.bytes) return fail('The block is too large to draw.');
  if (lang === 'mermaid' || MERMAID_HEAD.test(body)) return parseMermaid(body);
  const jsonish = /^(```\w*\s*)?[[{]/.test(body);
  if (jsonish) {
    let raw: unknown;
    try { raw = looseJson(body); } catch (e) { return fail(`Not valid JSON${e instanceof Error ? `: ${e.message}` : ''}`); }
    return fromJson(raw, lang === 'diagram');
  }
  if (lang === 'diagram') return fail('Write the diagram as JSON with "nodes" and "edges", or as a Mermaid flowchart.');
  const chart = chartFromLines(body);
  return typeof chart === 'string' ? fail(chart) : { ok: true, spec: chart };
}

// ---------------------------------------------------------------- axes and numbers

/** Round axis ticks covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { const pad = Math.abs(min) || 1; min -= pad; max += pad; }
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(c => c >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(10)));
  return ticks;
}

const make = (opts: Intl.NumberFormatOptions) => {
  try { return new Intl.NumberFormat(undefined, opts); } catch { return null; }
};
const full = make({ maximumFractionDigits: 2 });
const compact = make({ notation: 'compact', maximumFractionDigits: 1 });

function compactFallback(v: number): string {
  const a = Math.abs(v);
  const [d, s] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  return `${Number((v / d).toFixed(1))}${s}`;
}

const withUnit = (n: string, unit?: string) => !unit ? n : unit === '%' ? `${n}%` : /^[$€£¥₹]$/.test(unit) ? (n.startsWith('-') ? `-${unit}${n.slice(1)}` : `${unit}${n}`) : `${n} ${unit}`;

/** A value as read in a tooltip: grouped digits, two decimals at most, with its unit. */
export function formatValue(v: number, unit?: string): string {
  return withUnit(full ? full.format(v) : String(Number(v.toFixed(2))), unit);
}

/** An axis tick: compact from 10,000 up. */
export function formatTick(v: number, unit?: string): string {
  if (Math.abs(v) >= 10_000) return withUnit(compact ? compact.format(v) : compactFallback(v), unit);
  return formatValue(v, unit);
}

/** The chart's data as CSV, for "Copy data". */
export function chartCsv(spec: ChartSpec): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  if (spec.type === 'scatter') {
    const rows = spec.series.flatMap(s => (s.points ?? []).map(p => [s.name, String(p.x), String(p.y)]));
    return [['series', spec.xLabel ?? 'x', spec.yLabel ?? 'y'], ...rows].map(r => r.map(cell).join(',')).join('\n');
  }
  const head = [spec.xLabel ?? 'label', ...spec.series.map((s, i) => s.name || (spec.series.length > 1 ? `Series ${i + 1}` : spec.yLabel ?? 'value'))];
  const rows = spec.labels.map((l, i) => [l, ...spec.series.map(s => (s.values[i] === null || s.values[i] === undefined ? '' : String(s.values[i])))]);
  return [head, ...rows].map(r => r.map(cell).join(',')).join('\n');
}
