// Interactive charts drawn with react-native-svg: bars grow and lines draw in (~420 ms, skipped under reduced
// motion); tap or drag shows a crosshair with a tooltip, legend chips toggle series, pie slices highlight on tap.
// Axis text is laid over the SVG as RN Text so it uses the app font.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { font, fs, useColors, useScheme } from '@/theme';
import { EASE_OUT } from '@/ui/motion';

import { colorAt, seriesColors } from './palette';
import { formatTick, formatValue, niceTicks, type ChartSpec } from './parse';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Height of the plot, axis labels included. The streaming placeholder uses it too. */
export const PLOT_H = 200;
const TOP = 8;
const BOTTOM = 22;

/** 0 → 1 once on mount, or 1 straight away under reduced motion. */
function useEntry(): SharedValue<number> {
  const reduce = useReducedMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) p.set(withTiming(1, { duration: 420, easing: EASE_OUT }));
  }, [reduce, p]);
  return p;
}

export function ChartView({ spec }: { spec: ChartSpec }) {
  const c = useColors();
  const colors = seriesColors(c, useScheme());
  const [width, setWidth] = useState(0);
  const [hidden, setHidden] = useState<number[]>([]);
  const round = spec.type === 'pie' || spec.type === 'donut';

  const toggle = (i: number) => {
    const off = hidden.includes(i);
    // The last visible series stays on.
    if (!off && hidden.length >= spec.series.length - 1) { haptic.warning(); return; }
    haptic.select();
    setHidden(off ? hidden.filter(x => x !== i) : [...hidden, i]);
  };

  return (
    <View onLayout={e => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      {!round && spec.yLabel ? <Text style={[s.axisTitle, { color: c.muted }]} numberOfLines={1}>{spec.unit && !spec.yLabel.includes(spec.unit) ? `${spec.yLabel} (${spec.unit})` : spec.yLabel}</Text> : null}
      {width > 0 ? (round ? <Pie spec={spec} width={width} colors={colors} /> : <Cartesian spec={spec} width={width} colors={colors} hidden={hidden} />) : <View style={{ height: PLOT_H }} />}
      {!round && spec.xLabel ? <Text style={[s.axisTitle, { color: c.muted, textAlign: 'center' }]} numberOfLines={1}>{spec.xLabel}</Text> : null}
      {!round && spec.series.length > 1 ? (
        <View style={s.legend}>
          {spec.series.map((series, i) => {
            const off = hidden.includes(i);
            const color = colorAt(colors, i);
            return (
              <Pressable key={i} onPress={() => toggle(i)} accessibilityRole="checkbox" accessibilityState={{ checked: !off }} accessibilityLabel={series.name || t('Series {n}', { n: i + 1 })} hitSlop={4} style={[s.chip, { backgroundColor: c.surface3, opacity: off ? 0.55 : 1 }]}>
                <View style={[s.dot, { borderColor: color, backgroundColor: off ? 'transparent' : color }]} />
                <Text style={[s.chipText, { color: off ? c.muted : c.text }]} numberOfLines={1}>{series.name || t('Series {n}', { n: i + 1 })}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- bar, line, area, scatter

type Pt = { x: number; y: number } | null;

function pathOf(points: Pt[]): { d: string; length: number } {
  let d = '';
  let length = 0;
  let last: Pt = null;
  for (const p of points) {
    if (!p) { last = null; continue; }
    d += `${last ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    if (last) length += Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
  }
  return { d: d.trim(), length: Math.max(1, Math.ceil(length)) };
}

function Cartesian({ spec, width, colors, hidden }: { spec: ChartSpec; width: number; colors: string[]; hidden: number[] }) {
  const c = useColors();
  const p = useEntry();
  const [active, setActive] = useState<number | null>(null);
  const scatter = spec.type === 'scatter';
  const bars = spec.type === 'bar';
  const n = spec.labels.length;
  const visible = spec.series.map((series, i) => ({ series, i })).filter(v => !hidden.includes(v.i));

  // Stacks: running totals per index, positives up and negatives down.
  const stackOf = new Map<number, { lo: number; hi: number }[]>();
  if (spec.stacked) {
    const pos = new Array(n).fill(0);
    const neg = new Array(n).fill(0);
    for (const { series, i } of visible) {
      stackOf.set(i, series.values.map((v, k) => {
        const value = v ?? 0;
        if (value >= 0 || spec.type === 'area') { const lo = pos[k]; pos[k] += value; return { lo, hi: pos[k] }; }
        const hi = neg[k]; neg[k] += value; return { lo: neg[k], hi };
      }));
    }
  }

  let lo = Infinity, hi = -Infinity;
  for (const { series, i } of visible) {
    if (spec.stacked) for (const r of stackOf.get(i)!) { lo = Math.min(lo, r.lo); hi = Math.max(hi, r.hi); }
    else for (const v of series.values) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (bars || spec.type === 'area') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  else if (lo > 0 && lo < hi * 0.25) lo = 0;
  const ticks = niceTicks(lo, hi, 4);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const tickText = ticks.map(v => formatTick(v, spec.unit));
  const padL = Math.min(64, Math.max(24, Math.max(...tickText.map(x => x.length)) * 6.4 + 8));
  const plotW = Math.max(40, width - padL - 6);
  const plotH = PLOT_H - TOP - BOTTOM;
  const Y = (v: number) => TOP + (1 - (v - y0) / (y1 - y0 || 1)) * plotH;
  const base = Y(Math.min(Math.max(0, y0), y1));

  // x: bands for bars, evenly spaced points for lines, a value axis for scatter.
  const band = plotW / Math.max(n, 1);
  const inset = 8;
  const step = n > 1 ? (plotW - inset * 2) / (n - 1) : 0;
  let xTicks: number[] = [];
  let X: (i: number) => number;
  if (scatter) {
    const xs = visible.flatMap(v => (v.series.points ?? []).map(q => q.x));
    xTicks = niceTicks(xs.length ? Math.min(...xs) : 0, xs.length ? Math.max(...xs) : 1, 4);
    const x0 = xTicks[0], x1 = xTicks[xTicks.length - 1];
    X = v => padL + inset + ((v - x0) / (x1 - x0 || 1)) * (plotW - inset * 2);
  } else if (bars) X = i => padL + band * (i + 0.5);
  else X = i => padL + (n > 1 ? inset + i * step : plotW / 2);

  const flat = scatter ? visible.flatMap(v => (v.series.points ?? []).map((q, k) => ({ s: v.i, k, x: X(q.x), y: Y(q.y), q }))) : [];

  const pick = (x: number, y: number, tap: boolean) => {
    let idx: number | null;
    if (scatter) {
      let best = -1, dist = 44;
      flat.forEach((f, i) => { const d = Math.hypot(f.x - x, f.y - y); if (d < dist) { dist = d; best = i; } });
      idx = best < 0 ? null : best;
    } else {
      const raw = bars ? Math.floor((x - padL) / band) : n > 1 ? Math.round((x - padL - inset) / step) : 0;
      idx = Math.min(n - 1, Math.max(0, raw));
    }
    if (tap && idx === active) idx = null;
    if (idx === active) return;
    if (idx !== null) haptic.select();
    setActive(idx);
  };
  const pan = Gesture.Pan().runOnJS(true).activeOffsetX([-6, 6]).failOffsetY([-12, 12])
    .onStart(e => pick(e.x, e.y, false))
    .onUpdate(e => pick(e.x, e.y, false));
  const tap = Gesture.Tap().runOnJS(true).onEnd((e, success) => { if (success) pick(e.x, e.y, true); });
  const gesture = Gesture.Race(pan, tap);

  const valueAt = (i: number, k: number) => (spec.stacked ? stackOf.get(i)?.[k]?.hi ?? null : spec.series[i].values[k]);
  const groups = spec.stacked ? 1 : Math.max(visible.length, 1);
  const inner = band * (n > 12 ? 0.82 : 0.68);
  const barW = Math.max(2, inner / groups - (groups > 1 ? 2 : 0));

  // Tooltip content.
  let tip: { x: number; title: string; rows: { name: string; value: string; color: string }[] } | null = null;
  const act = active !== null && (scatter ? active < flat.length : active < n) ? active : null;
  if (act !== null && scatter) {
    const f = flat[act];
    tip = { x: f.x, title: `${spec.xLabel ?? 'x'}: ${formatValue(f.q.x)}`, rows: [{ name: spec.series[f.s].name || spec.yLabel || t('Value'), value: formatValue(f.q.y, spec.unit), color: colorAt(colors, f.s) }] };
  } else if (act !== null) {
    tip = {
      x: X(act),
      title: spec.labels[act],
      rows: visible.filter(v => v.series.values[act] !== null).map(v => ({ name: v.series.name || spec.yLabel || t('Value'), value: formatValue(v.series.values[act]!, spec.unit), color: colorAt(colors, v.i) })),
    };
  }

  // x labels, thinned so they never collide.
  const longest = Math.max(1, ...spec.labels.map(l => l.length));
  const labelW = Math.min(84, Math.max(28, longest * 6.2 + 8));
  const stride = scatter ? 1 : Math.max(1, Math.ceil(labelW / Math.max(1, bars ? band : step || plotW)));
  const xLabels = scatter
    ? xTicks.map(v => ({ x: X(v), text: formatTick(v) }))
    : spec.labels.map((l, i) => ({ x: X(i), text: l })).filter((_, i) => i % stride === 0);
  const slot = scatter ? 56 : Math.min(labelW, (bars ? band : step || plotW) * stride);

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ height: PLOT_H }} accessible accessibilityRole="image" accessibilityLabel={describe(spec)} accessibilityHint={t('Drag across the chart to read values')}>
        <Svg width={width} height={PLOT_H}>
          {ticks.map(v => <Line key={v} x1={padL} x2={padL + plotW} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? c.muted : c.border} strokeOpacity={v === 0 ? 0.6 : 1} strokeWidth={1} />)}
          {bars && act !== null ? <Rect x={padL + band * act} y={TOP} width={band} height={plotH} fill={c.text} fillOpacity={0.06} rx={4} /> : null}

          {bars && visible.map(({ series, i }, g) => series.values.map((v, k) => {
            if (v === null) return null;
            const r = spec.stacked ? stackOf.get(i)![k] : { lo: Math.min(0, v), hi: Math.max(0, v) };
            const top = Y(r.hi), bottom = Y(r.lo);
            const x = padL + band * k + (band - inner) / 2 + (spec.stacked ? 0 : g * (inner / groups)) + (groups > 1 ? 1 : 0);
            return <Bar key={`${i}-${k}`} x={x} w={spec.stacked ? inner : barW} top={top} h={Math.max(v === 0 ? 0 : 1, bottom - top)} base={base} color={colorAt(colors, i)} dim={act !== null && act !== k} p={p} />;
          }))}

          {spec.type === 'area' && visible.map(({ series, i }) => {
            const upper = series.values.map((v, k) => (spec.stacked ? { x: X(k), y: Y(stackOf.get(i)![k].hi) } : v === null ? null : { x: X(k), y: Y(v) }));
            const lower = series.values.map((_, k) => ({ x: X(k), y: spec.stacked ? Y(stackOf.get(i)![k].lo) : base }));
            const segments: string[] = [];
            let run: number[] = [];
            const flush = () => {
              if (run.length > 1) segments.push(`M${run.map(k => `${upper[k]!.x.toFixed(1)},${upper[k]!.y.toFixed(1)}`).join(' L')} L${[...run].reverse().map(k => `${lower[k].x.toFixed(1)},${lower[k].y.toFixed(1)}`).join(' L')} Z`);
              run = [];
            };
            upper.forEach((q, k) => { if (q) run.push(k); else flush(); });
            flush();
            return <Fill key={`a${i}`} d={segments.join(' ')} color={colorAt(colors, i)} p={p} />;
          })}

          {(spec.type === 'line' || spec.type === 'area') && visible.map(({ series, i }) => {
            const { d, length } = pathOf(series.values.map((v, k) => { const y = valueAt(i, k); return v === null || y === null ? null : { x: X(k), y: Y(y) }; }));
            return d ? <Stroke key={`l${i}`} d={d} length={length} color={colorAt(colors, i)} p={p} /> : null;
          })}
          {spec.type === 'line' && n <= 24 && visible.map(({ series, i }) => series.values.map((v, k) => (v === null ? null : <Dot key={`d${i}-${k}`} cx={X(k)} cy={Y(v)} r={2.6} color={colorAt(colors, i)} p={p} />)))}

          {scatter && flat.map((f, idx) => <Dot key={`s${f.s}-${f.k}`} cx={f.x} cy={f.y} r={act === idx ? 6 : 4} color={colorAt(colors, f.s)} p={p} opacity={act !== null && act !== idx ? 0.45 : 0.9} />)}

          {tip && !bars ? <Line x1={tip.x} x2={tip.x} y1={TOP} y2={TOP + plotH} stroke={c.muted} strokeWidth={1} strokeDasharray={[3, 3]} /> : null}
          {tip && scatter && act !== null ? <Line x1={padL} x2={padL + plotW} y1={flat[act].y} y2={flat[act].y} stroke={c.muted} strokeWidth={1} strokeDasharray={[3, 3]} /> : null}
          {act !== null && !scatter && !bars && visible.map(({ i }) => {
            const y = valueAt(i, act);
            return y === null ? null : <Circle key={`h${i}`} cx={X(act)} cy={Y(y)} r={4.5} fill={colorAt(colors, i)} stroke={c.surface2} strokeWidth={2} />;
          })}
        </Svg>

        {ticks.map((v, i) => (
          <Text key={v} style={[s.tick, { color: c.muted, top: Y(v) - 7, width: padL - 6, textAlign: 'right' }]} numberOfLines={1}>{tickText[i]}</Text>
        ))}
        {xLabels.map((l, i) => (
          <Text key={i} style={[s.tick, { color: c.muted, top: TOP + plotH + 5, width: slot, left: Math.min(width - slot, Math.max(0, l.x - slot / 2)), textAlign: 'center' }]} numberOfLines={1}>{l.text}</Text>
        ))}

        {tip ? (
          <Animated.View entering={FadeIn.duration(120)} pointerEvents="none" style={[s.tip, { backgroundColor: c.surface3, borderColor: c.border }, tip.x > width / 2 ? { right: Math.max(4, width - tip.x + 10) } : { left: Math.min(width - 60, tip.x + 10) }]}>
            <Text style={[s.tipTitle, { color: c.text }]} numberOfLines={1}>{tip.title}</Text>
            {tip.rows.map((r, i) => (
              <View key={i} style={s.tipRow}>
                <View style={[s.dot, { backgroundColor: r.color, borderColor: r.color }]} />
                <Text style={[s.tipName, { color: c.secondary }]} numberOfLines={1}>{r.name}</Text>
                <Text style={[s.tipValue, { color: c.text }]}>{r.value}</Text>
              </View>
            ))}
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function Bar({ x, w, top, h, base, color, dim, p }: { x: number; w: number; top: number; h: number; base: number; color: string; dim: boolean; p: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ y: base + (top - base) * p.get(), height: Math.max(0, h * p.get()) }));
  return <AnimatedRect x={x} width={w} rx={Math.min(3, w / 3)} fill={color} fillOpacity={dim ? 0.4 : 1} animatedProps={props} />;
}

function Stroke({ d, length, color, p }: { d: string; length: number; color: string; p: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - p.get()) }));
  return <AnimatedPath d={d} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={[length, length]} animatedProps={props} />;
}

function Fill({ d, color, p }: { d: string; color: string; p: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ fillOpacity: 0.18 * p.get() }));
  return <AnimatedPath d={d} fill={color} stroke="none" animatedProps={props} />;
}

function Dot({ cx, cy, r, color, p, opacity = 1 }: { cx: number; cy: number; r: number; color: string; p: SharedValue<number>; opacity?: number }) {
  const props = useAnimatedProps(() => ({ r: r * p.get() }));
  return <AnimatedCircle cx={cx} cy={cy} fill={color} fillOpacity={opacity} animatedProps={props} />;
}

// ---------------------------------------------------------------- pie and donut

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // A whole ring: two half arcs (one arc cannot start and end at the same point).
    const outer = `M${pt(r1, a0)} A${r1},${r1} 0 1 1 ${pt(r1, a0 + Math.PI)} A${r1},${r1} 0 1 1 ${pt(r1, a0)} Z`;
    return r0 > 0 ? `${outer} M${pt(r0, a0)} A${r0},${r0} 0 1 0 ${pt(r0, a0 + Math.PI)} A${r0},${r0} 0 1 0 ${pt(r0, a0)} Z` : outer;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (r0 <= 0) return `M${cx.toFixed(2)},${cy.toFixed(2)} L${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} Z`;
  return `M${pt(r1, a0)} A${r1},${r1} 0 ${large} 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)} Z`;
}

function Pie({ spec, width, colors }: { spec: ChartSpec; width: number; colors: string[] }) {
  const c = useColors();
  const p = useEntry();
  const [sel, setSel] = useState<number | null>(null);
  // More than eight slices: the rest merge into "Other".
  let labels = spec.labels;
  let values = spec.series[0].values.map(v => v ?? 0);
  if (values.length > 8) {
    labels = [...labels.slice(0, 7), t('Other')];
    values = [...values.slice(0, 7), values.slice(7).reduce((a, b) => a + b, 0)];
  }
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const size = Math.min(width, 220);
  const cx = size / 2, cy = size / 2;
  const r1 = size / 2 - 8;
  const r0 = spec.type === 'donut' ? r1 * 0.62 : 0;
  const starts = values.map((_, i) => -Math.PI / 2 + (values.slice(0, i).reduce((a, b) => a + b, 0) / total) * Math.PI * 2);
  const slices = values.map((v, i) => {
    const a0 = starts[i];
    const a1 = a0 + (v / total) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const out = sel === i ? 6 : 0;
    return { i, d: arc(cx + Math.cos(mid) * out, cy + Math.sin(mid) * out, r0, r1, a0, a1) };
  });
  const choose = (i: number) => { haptic.select(); setSel(sel === i ? null : i); };
  const pct = (v: number) => `${formatValue(Math.round((v / total) * 1000) / 10)}%`;
  const grow = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ scale: 0.88 + 0.12 * p.get() }, { rotate: `${(1 - p.get()) * -40}deg` }] }));

  return (
    <View>
      <View style={{ alignItems: 'center' }}>
        <Animated.View style={[{ width: size, height: size }, grow]} accessible accessibilityRole="image" accessibilityLabel={describe(spec)}>
          <Svg width={size} height={size}>
            {slices.map(sl => (
              <Path key={sl.i} d={sl.d} fill={colorAt(colors, sl.i)} fillOpacity={sel !== null && sel !== sl.i ? 0.35 : 1} stroke={c.surface2} strokeWidth={values.length > 1 ? 2 : 0} onPress={() => choose(sl.i)} />
            ))}
          </Svg>
        </Animated.View>
        {r0 > 0 ? (
          <View pointerEvents="none" style={[s.center, { width: r0 * 1.7, left: (width - r0 * 1.7) / 2, top: cy - 26 }]}>
            <Text style={[s.centerValue, { color: c.text }]} numberOfLines={1} adjustsFontSizeToFit>{sel === null ? formatValue(total, spec.unit) : formatValue(values[sel], spec.unit)}</Text>
            <Text style={[s.centerLabel, { color: c.muted }]} numberOfLines={1}>{sel === null ? t('Total') : `${labels[sel]} · ${pct(values[sel])}`}</Text>
          </View>
        ) : null}
      </View>
      <View style={s.legend}>
        {labels.map((l, i) => (
          <Pressable key={i} onPress={() => choose(i)} accessibilityRole="button" accessibilityState={{ selected: sel === i }} hitSlop={4} style={[s.chip, { backgroundColor: sel === i ? c.mossDeep : c.surface3, opacity: sel !== null && sel !== i ? 0.6 : 1 }]}>
            <View style={[s.dot, { backgroundColor: colorAt(colors, i), borderColor: colorAt(colors, i) }]} />
            <Text style={[s.chipText, { color: c.text }]} numberOfLines={1}>{l}</Text>
            <Text style={[s.chipValue, { color: c.secondary }]}>{sel === i ? formatValue(values[i], spec.unit) : pct(values[i])}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function describe(spec: ChartSpec): string {
  const kind = { bar: t('Bar chart'), line: t('Line chart'), area: t('Area chart'), pie: t('Pie chart'), donut: t('Donut chart'), scatter: t('Scatter chart') }[spec.type];
  const head = spec.title ? `${kind}: ${spec.title}` : kind;
  if (spec.type === 'scatter') return head;
  const first = spec.series[0];
  const sample = spec.labels.slice(0, 6).map((l, i) => (first.values[i] === null ? null : `${l} ${formatValue(first.values[i]!, spec.unit)}`)).filter(Boolean).join(', ');
  return `${head}. ${sample}${spec.labels.length > 6 ? '…' : ''}`;
}

const s = StyleSheet.create({
  axisTitle: { fontFamily: font.medium, fontSize: 11.5, marginBottom: 4 },
  tick: { position: 'absolute', left: 0, fontFamily: font.medium, fontSize: 10.5, lineHeight: 14 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: 15, maxWidth: '100%' },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  chipText: { fontFamily: font.medium, fontSize: fs.xs, flexShrink: 1 },
  chipValue: { fontFamily: font.medium, fontSize: fs.xs },
  tip: { position: 'absolute', top: 2, maxWidth: 200, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, gap: 3 },
  tipTitle: { fontFamily: font.semibold, fontSize: fs.xs },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipName: { fontFamily: font.medium, fontSize: fs.xs, flexShrink: 1 },
  tipValue: { fontFamily: font.semibold, fontSize: fs.xs, marginLeft: 'auto', paddingLeft: 6 },
  center: { position: 'absolute', alignItems: 'center' },
  centerValue: { fontFamily: font.semibold, fontSize: 20 },
  centerLabel: { fontFamily: font.medium, fontSize: fs.xs },
});
