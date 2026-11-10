// Charts and diagrams as standalone SVG, for documents, slides and PDFs: the same specs and layout as the in-chat
// visuals (Chart.tsx, Diagram.tsx), drawn static on white with print colours. Pure: no React, no '@/' imports.
import { layoutFlow } from './layout';
import { formatTick, formatValue, niceTicks, type ChartSpec, type FlowSpec, type SequenceSpec, type TimelineSpec, type VisualSpec } from './parse';

export type SvgImage = { svg: string; width: number; height: number };

const FONT = "Calibri, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#1f2a24';
const TEXT = '#3a433e';
const MUTED = '#7d8781';
const GRID = '#e3e8e4';
const NODE_FILL = '#eef3ef';
const NODE_LINE = '#9db8a7';
const ACCENT = '#3e7a5a';
/** Series colours: the accent, then hues that stay apart from it and from each other on white and in print. */
const COLORS = [ACCENT, '#c8873a', '#3e6eab', '#ad4f6c', '#6a5ab0', '#2a8478', '#87741a', '#5b6b80'];
const color = (i: number) => COLORS[i % COLORS.length];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Rough advance of a character at `size` px in the document font. */
const textW = (s: string, size: number) => s.length * size * 0.53;
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

function text(x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; italic?: boolean; rotate?: number } = {}) {
  const t = o.rotate ? ` transform="rotate(${o.rotate} ${n1(x)} ${n1(y)})"` : '';
  return `<text x="${n1(x)}" y="${n1(y)}" font-size="${o.size ?? 12}" fill="${o.fill ?? TEXT}" text-anchor="${o.anchor ?? 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.italic ? ' font-style="italic"' : ''}${t}>${esc(s)}</text>`;
}

/** Words wrapped into lines of at most `room` characters, at most `max` lines (the last one cut with …). */
function wrap(label: string, room: number, max = 4): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const w = word.length > room ? `${word.slice(0, room - 1)}…` : word;
    if (line && line.length + 1 + w.length > room) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = `${lines[max - 1].slice(0, Math.max(1, room - 1))}…`;
  }
  return lines;
}

function frame(width: number, height: number, body: string, title?: string): SvgImage {
  const head = title ? 30 : 0;
  const w = Math.ceil(width);
  const h = Math.ceil(height + head);
  const titled = title ? text(w / 2, 20, title, { size: 15, fill: INK, anchor: 'middle', weight: 700 }) : '';
  return {
    width: w,
    height: h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(FONT)}"><rect width="${w}" height="${h}" fill="#ffffff"/>${titled}<g transform="translate(0 ${head})">${body}</g></svg>`,
  };
}

// ---------------------------------------------------------------- charts

function legend(items: { name: string; color: string }[], width: number, y: number): { svg: string; height: number } {
  let x = 0;
  let row = 0;
  const placed: { name: string; color: string; x: number; row: number }[] = [];
  for (const it of items) {
    const w = 18 + textW(it.name, 12) + 18;
    if (x && x + w > width - 24) { x = 0; row++; }
    placed.push({ ...it, x, row });
    x += w;
  }
  const rows = row + 1;
  const svg = Array.from({ length: rows }, (_, r) => {
    const inRow = placed.filter(p => p.row === r);
    const span = inRow.reduce((a, p) => a + 18 + textW(p.name, 12) + 18, 0) - 18;
    const left = (width - span) / 2;
    return inRow.map(p => `<rect x="${n1(left + p.x)}" y="${n1(y + r * 20 - 9)}" width="10" height="10" rx="2" fill="${p.color}"/>${text(left + p.x + 16, y + r * 20, p.name, { size: 12 })}`).join('');
  }).join('');
  return { svg, height: rows * 20 };
}

function cartesian(spec: ChartSpec, width: number): SvgImage {
  const H = 300;
  const top = 12;
  const bottomLabels = 34;
  const scatter = spec.type === 'scatter';
  const bars = spec.type === 'bar';
  const n = spec.labels.length;
  const series = spec.series.map((s, i) => ({ s, i }));

  const stackOf = new Map<number, { lo: number; hi: number }[]>();
  if (spec.stacked) {
    const pos = new Array(n).fill(0);
    const neg = new Array(n).fill(0);
    for (const { s, i } of series) {
      stackOf.set(i, s.values.map((v, k) => {
        const value = v ?? 0;
        if (value >= 0 || spec.type === 'area') { const lo = pos[k]; pos[k] += value; return { lo, hi: pos[k] }; }
        const hi = neg[k]; neg[k] += value; return { lo: neg[k], hi };
      }));
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const { s, i } of series) {
    if (scatter) for (const p of s.points ?? []) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
    else if (spec.stacked) for (const r of stackOf.get(i)!) { lo = Math.min(lo, r.lo); hi = Math.max(hi, r.hi); }
    else for (const v of s.values) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (bars || spec.type === 'area') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  else if (lo > 0 && lo < hi * 0.25) lo = 0;
  const ticks = niceTicks(lo, hi, 5);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const tickText = ticks.map(v => formatTick(v, spec.unit));
  const yTitle = spec.yLabel ? (spec.unit && !spec.yLabel.includes(spec.unit) ? `${spec.yLabel} (${spec.unit})` : spec.yLabel) : '';
  const padL = (yTitle ? 22 : 0) + Math.max(28, Math.max(...tickText.map(t => textW(t, 11))) + 12);
  const plotW = width - padL - 16;
  // Long category names are tilted, and need the room below the plot for it.
  const slotW = scatter ? plotW : bars ? plotW / Math.max(n, 1) : n > 1 ? (plotW - 20) / (n - 1) : plotW;
  const longest = Math.max(1, ...spec.labels.map(l => textW(l.length > 18 ? l.slice(0, 18) : l, 11)));
  const tilt = !scatter && longest > slotW - 4 && n > 3;
  const plotH = H - top - (tilt ? Math.min(90, longest * 0.6 + 22) : bottomLabels) - (spec.xLabel ? 18 : 0);
  const Y = (v: number) => top + (1 - (v - y0) / (y1 - y0 || 1)) * plotH;
  const base = Y(Math.min(Math.max(0, y0), y1));

  const band = plotW / Math.max(n, 1);
  const inset = 10;
  const step = n > 1 ? (plotW - inset * 2) / (n - 1) : 0;
  let xTicks: number[] = [];
  let X: (i: number) => number;
  if (scatter) {
    const xs = series.flatMap(v => (v.s.points ?? []).map(q => q.x));
    xTicks = niceTicks(xs.length ? Math.min(...xs) : 0, xs.length ? Math.max(...xs) : 1, 5);
    const x0 = xTicks[0], x1 = xTicks[xTicks.length - 1];
    X = v => padL + inset + ((v - x0) / (x1 - x0 || 1)) * (plotW - inset * 2);
  } else if (bars) X = i => padL + band * (i + 0.5);
  else X = i => padL + (n > 1 ? inset + i * step : plotW / 2);

  let body = '';
  for (const v of ticks) body += `<line x1="${n1(padL)}" x2="${n1(padL + plotW)}" y1="${n1(Y(v))}" y2="${n1(Y(v))}" stroke="${v === 0 ? '#b9c2bc' : GRID}" stroke-width="1"/>`;
  ticks.forEach((v, i) => (body += text(padL - 8, Y(v) + 4, tickText[i], { size: 11, fill: MUTED, anchor: 'end' })));
  if (yTitle) body += text(12, top + plotH / 2, yTitle, { size: 12, fill: MUTED, anchor: 'middle', rotate: -90 });

  if (bars) {
    const groups = spec.stacked ? 1 : Math.max(series.length, 1);
    const inner = band * (n > 12 ? 0.82 : 0.7);
    const barW = Math.max(2, inner / groups - (groups > 1 ? 2 : 0));
    series.forEach(({ s, i }, g) => s.values.forEach((v, k) => {
      if (v === null) return;
      const r = spec.stacked ? stackOf.get(i)![k] : { lo: Math.min(0, v), hi: Math.max(0, v) };
      const y = Y(r.hi), h = Math.max(v === 0 ? 0 : 1, Y(r.lo) - y);
      const x = padL + band * k + (band - inner) / 2 + (spec.stacked ? 0 : g * (inner / groups)) + (groups > 1 ? 1 : 0);
      body += `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(spec.stacked ? inner : barW)}" height="${n1(h)}" rx="${n1(Math.min(3, barW / 3))}" fill="${color(i)}"/>`;
      // Values on single-series bars when they fit.
      if (!spec.stacked && groups === 1 && n <= 12) body += text(x + barW / 2, (v >= 0 ? y : y + h) + (v >= 0 ? -5 : 13), formatValue(v, spec.unit), { size: 10.5, fill: MUTED, anchor: 'middle' });
    }));
  }
  const at = (i: number, k: number) => (spec.stacked ? stackOf.get(i)?.[k]?.hi ?? null : spec.series[i].values[k]);
  if (spec.type === 'area') {
    for (const { s, i } of series) {
      const up = s.values.map((v, k) => (v === null ? null : { x: X(k), y: Y(at(i, k) ?? 0) }));
      const down = s.values.map((_, k) => ({ x: X(k), y: spec.stacked ? Y(stackOf.get(i)![k].lo) : base }));
      const run = up.map((p, k) => (p ? k : -1)).filter(k => k >= 0);
      if (run.length > 1) body += `<path d="M${run.map(k => `${n1(up[k]!.x)},${n1(up[k]!.y)}`).join(' L')} L${[...run].reverse().map(k => `${n1(down[k].x)},${n1(down[k].y)}`).join(' L')} Z" fill="${color(i)}" fill-opacity="0.18"/>`;
    }
  }
  if (spec.type === 'line' || spec.type === 'area') {
    for (const { s, i } of series) {
      let d = '';
      let pen = false;
      s.values.forEach((v, k) => {
        const y = at(i, k);
        if (v === null || y === null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${n1(X(k))},${n1(Y(y))} `;
        pen = true;
      });
      if (d) body += `<path d="${d.trim()}" fill="none" stroke="${color(i)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (spec.type === 'line' && n <= 24) s.values.forEach((v, k) => { if (v !== null) body += `<circle cx="${n1(X(k))}" cy="${n1(Y(v))}" r="3.2" fill="${color(i)}"/>`; });
    }
  }
  if (scatter) for (const { s, i } of series) for (const p of s.points ?? []) body += `<circle cx="${n1(X(p.x))}" cy="${n1(Y(p.y))}" r="4.5" fill="${color(i)}" fill-opacity="0.85"/>`;

  // x labels: thinned so they never collide, tilted when long.
  const labelY = top + plotH + 18;
  if (scatter) xTicks.forEach(v => (body += text(X(v), labelY, formatTick(v), { size: 11, fill: MUTED, anchor: 'middle' })));
  else {
    const slot = bars ? band : step || plotW;
    const stride = Math.max(1, Math.ceil((tilt ? 16 : longest + 8) / Math.max(1, slot)));
    spec.labels.forEach((l, i) => {
      if (i % stride) return;
      const label = l.length > 18 ? `${l.slice(0, 17)}…` : l;
      body += tilt ? text(X(i) + 3, labelY - 4, label, { size: 11, fill: MUTED, anchor: 'end', rotate: -35 }) : text(X(i), labelY, label, { size: 11, fill: MUTED, anchor: 'middle' });
    });
  }
  let height = H;
  if (spec.xLabel) body += text(padL + plotW / 2, H - 6, spec.xLabel, { size: 12, fill: MUTED, anchor: 'middle' });
  if (spec.series.length > 1) {
    const l = legend(spec.series.map((s, i) => ({ name: s.name || `Series ${i + 1}`, color: color(i) })), width, H + 10);
    body += l.svg;
    height += l.height + 8;
  }
  return frame(width, height, body, spec.title);
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => `${n1(cx + r * Math.cos(a))},${n1(cy + r * Math.sin(a))}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const outer = `M${pt(r1, a0)} A${r1},${r1} 0 1 1 ${pt(r1, a0 + Math.PI)} A${r1},${r1} 0 1 1 ${pt(r1, a0)} Z`;
    return r0 > 0 ? `${outer} M${pt(r0, a0)} A${r0},${r0} 0 1 0 ${pt(r0, a0 + Math.PI)} A${r0},${r0} 0 1 0 ${pt(r0, a0)} Z` : outer;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (r0 <= 0) return `M${n1(cx)},${n1(cy)} L${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} Z`;
  return `M${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z`;
}

function pie(spec: ChartSpec, width: number): SvgImage {
  let labels = spec.labels;
  let values = (spec.series[0]?.values ?? []).map(v => Math.max(0, v ?? 0));
  if (values.length > 8) {
    labels = [...labels.slice(0, 7), 'Other'];
    values = [...values.slice(0, 7), values.slice(7).reduce((a, b) => a + b, 0)];
  }
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const size = 240;
  const cx = size / 2 + 8, cy = size / 2 + 4;
  const r1 = size / 2 - 6;
  const r0 = spec.type === 'donut' ? r1 * 0.6 : 0;
  let a = -Math.PI / 2;
  let body = '';
  values.forEach((v, i) => {
    const a1 = a + (v / total) * Math.PI * 2;
    if (v > 0) body += `<path d="${arc(cx, cy, r0, r1, a, a1)}" fill="${color(i)}" stroke="#ffffff" stroke-width="${values.length > 1 ? 2 : 0}"/>`;
    a = a1;
  });
  if (r0 > 0) {
    body += text(cx, cy + 2, formatValue(total, spec.unit), { size: 20, fill: INK, anchor: 'middle', weight: 700 });
    body += text(cx, cy + 20, 'Total', { size: 11, fill: MUTED, anchor: 'middle' });
  }
  // Legend on the right: colour, label, share.
  const lx = size + 40;
  const rowH = 24;
  const top = cy - (labels.length * rowH) / 2 + 6;
  const names = labels.map(l => (l.length > 28 ? `${l.slice(0, 27)}…` : l));
  const pctX = Math.min(width - 12, lx + 20 + Math.max(...names.map(l => textW(l, 12.5))) + 56);
  names.forEach((l, i) => {
    const y = top + i * rowH;
    const pct = `${formatValue(Math.round((values[i] / total) * 1000) / 10)}%`;
    body += `<rect x="${lx}" y="${n1(y - 10)}" width="12" height="12" rx="3" fill="${color(i)}"/>`;
    body += text(lx + 20, y, l, { size: 12.5, fill: TEXT });
    body += text(pctX, y, pct, { size: 12.5, fill: MUTED, anchor: 'end' });
  });
  return frame(width, size + 10, body, spec.title);
}

// ---------------------------------------------------------------- diagrams

function flow(spec: FlowSpec): SvgImage {
  const layout = layoutFlow(spec, 168);
  let body = '';
  for (const l of layout.links) body += `<path d="${l.d} ${l.arrow}" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (const b of layout.boxes) {
    if (b.kind === 'decision') body += `<polygon points="${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}" fill="#fbf3e6" stroke="#d9b98a" stroke-width="1.2" stroke-linejoin="round"/>`;
    else body += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.kind === 'start' ? b.h / 2 : b.kind === 'data' ? 12 : 9}" fill="${b.kind === 'start' ? '#e6eee8' : NODE_FILL}" stroke="${b.kind === 'start' ? ACCENT : NODE_LINE}" stroke-width="1.2"${b.kind === 'data' ? ' stroke-dasharray="5 3"' : ''}/>`;
    const inner = b.kind === 'decision' ? b.w * 0.68 : b.w;
    const lines = wrap(b.label, Math.max(4, Math.floor((inner - 20) / 7.1)));
    const y = b.y + b.h / 2 - ((lines.length - 1) * 17) / 2 + 4.5;
    lines.forEach((line, i) => (body += text(b.x + b.w / 2, y + i * 17, line, { size: 13, fill: INK, anchor: 'middle' })));
  }
  for (const l of layout.links) {
    if (!l.label) continue;
    const w = Math.min(130, textW(l.label, 11.5) + 12);
    body += `<rect x="${n1(l.mid.x - w / 2)}" y="${n1(l.mid.y - 9)}" width="${n1(w)}" height="18" rx="4" fill="#ffffff"/>`;
    body += text(l.mid.x, l.mid.y + 4, l.label.length > 22 ? `${l.label.slice(0, 21)}…` : l.label, { size: 11.5, fill: TEXT, anchor: 'middle' });
  }
  return frame(layout.width, layout.height, body, spec.title);
}

function sequence(spec: SequenceSpec): SvgImage {
  const HEAD = 36, ROW = 42;
  const cols = spec.actors.map(a => Math.max(110, Math.min(180, textW(a.label, 13) + 34)));
  const centers: number[] = [];
  let acc = 6;
  for (const w of cols) { centers.push(acc + w / 2); acc += w; }
  const width = acc + 6 + (spec.messages.some(m => m.from === m.to) ? 60 : 0);
  const top = HEAD + 14;
  const height = top + spec.messages.length * ROW + 10;
  const at = new Map(spec.actors.map((a, i) => [a.id, centers[i]]));
  let body = '';
  centers.forEach(x => (body += `<line x1="${x}" x2="${x}" y1="${HEAD}" y2="${height - 4}" stroke="#cdd5cf" stroke-dasharray="4 4"/>`));
  spec.actors.forEach((a, i) => {
    const w = cols[i] - 14;
    body += `<rect x="${n1(centers[i] - w / 2)}" y="2" width="${n1(w)}" height="${HEAD - 4}" rx="8" fill="${NODE_FILL}" stroke="${NODE_LINE}"/>`;
    body += text(centers[i], HEAD / 2 + 5, a.label.length > 22 ? `${a.label.slice(0, 21)}…` : a.label, { size: 13, fill: INK, anchor: 'middle', weight: 600 });
  });
  spec.messages.forEach((m, i) => {
    const y = top + i * ROW + 24;
    const x1 = at.get(m.from)!, x2 = at.get(m.to)!;
    const dash = m.reply ? ' stroke-dasharray="5 4"' : '';
    if (x1 === x2) {
      body += `<path d="M${x1},${y - 8} h26 v14 h-24 M${x1 + 8},${y + 1} L${x1 + 2},${y + 6} L${x1 + 8},${y + 11}" fill="none" stroke="${TEXT}" stroke-width="1.5"${dash}/>`;
      if (m.label) body += text(x1 + 32, y - 6, m.label, { size: 12, fill: TEXT });
      return;
    }
    const dir = x2 > x1 ? 1 : -1;
    const end = x2 - dir * 2;
    body += `<path d="M${x1},${y} L${end},${y} M${end - dir * 7},${y - 5} L${end},${y} L${end - dir * 7},${y + 5}" fill="none" stroke="${TEXT}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
    if (m.label) {
      const room = Math.floor((Math.abs(x2 - x1) - 8) / 6.4);
      body += text((x1 + x2) / 2, y - 7, m.label.length > room ? `${m.label.slice(0, Math.max(1, room - 1))}…` : m.label, { size: 12, fill: TEXT, anchor: 'middle' });
    }
  });
  return frame(width, height, body, spec.title);
}

function timeline(spec: TimelineSpec, width: number): SvgImage {
  let y = 10;
  let body = '';
  const x = 24;
  const rows = spec.events.map(e => {
    const detail = e.detail ? wrap(e.detail, Math.floor((width - x - 40) / 6.6), 3) : [];
    const h = 24 + 20 + detail.length * 17 + 14;
    return { e, detail, h };
  });
  const total = rows.reduce((a, r) => a + r.h, 0);
  body += `<line x1="${x}" x2="${x}" y1="${y + 12}" y2="${y + total - rows[rows.length - 1].h + 12}" stroke="#cdd5cf" stroke-width="2"/>`;
  for (const { e, detail, h } of rows) {
    body += `<circle cx="${x}" cy="${y + 12}" r="7" fill="#ffffff" stroke="${ACCENT}" stroke-width="2.5"/>`;
    if (e.date) body += text(x + 22, y + 16, e.date, { size: 12.5, fill: ACCENT, weight: 700 });
    body += text(x + 22, y + (e.date ? 36 : 16), e.label, { size: 14, fill: INK, weight: 600 });
    detail.forEach((line, i) => (body += text(x + 22, y + (e.date ? 54 : 34) + i * 17, line, { size: 12.5, fill: MUTED })));
    y += e.date ? h : h - 20;
  }
  return frame(width, y, body, spec.title);
}

/** A chart or diagram as SVG on white, `width` px wide where the layout allows (diagrams size themselves). */
export function visualSvg(spec: VisualSpec, width = 640): SvgImage {
  if (spec.kind === 'chart') return spec.type === 'pie' || spec.type === 'donut' ? pie(spec, width) : cartesian(spec, width);
  if (spec.type === 'sequence') return sequence(spec);
  if (spec.type === 'timeline') return timeline(spec, width);
  return flow(spec);
}
