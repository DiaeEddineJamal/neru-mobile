// Diagrams: flowcharts and trees in layers, sequence diagrams in lanes, timelines as a vertical line.
// Shapes and arrows are SVG; labels are RN Text on top (app font, wrapping). Wider than the card scrolls
// sideways. Tapping a node (or actor, or event) highlights what it connects to.
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import Svg, { Line, Path, Polygon, Rect } from 'react-native-svg';

import { haptic } from '@/haptics';
import { font, fs, useColors } from '@/theme';

import { layoutFlow, measure } from './layout';
import type { DiagramSpec, FlowSpec, SequenceSpec, TimelineSpec } from './parse';

export function DiagramView({ spec }: { spec: DiagramSpec }) {
  if (spec.type === 'sequence') return <SequenceView spec={spec} />;
  if (spec.type === 'timeline') return <TimelineView spec={spec} />;
  return <FlowView spec={spec} />;
}

/** Centers content narrower than the card; scrolls it sideways when wider. */
function Scroller({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const [room, setRoom] = useState(0);
  const reduce = useReducedMotion();
  const inner = <Animated.View entering={reduce ? undefined : FadeIn.duration(320)} style={{ width, height }}>{children}</Animated.View>;
  return (
    <View onLayout={e => setRoom(Math.floor(e.nativeEvent.layout.width))} style={{ minHeight: height }}>
      {room === 0 ? null : width > room ? (
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator contentContainerStyle={{ width }}>{inner}</ScrollView>
      ) : (
        <View style={{ alignItems: 'center' }}>{inner}</View>
      )}
    </View>
  );
}

const toggle = (current: string | null, id: string, set: (v: string | null) => void) => {
  haptic.select();
  set(current === id ? null : id);
};

// ---------------------------------------------------------------- flow and tree

function FlowView({ spec }: { spec: FlowSpec }) {
  const c = useColors();
  const layout = layoutFlow(spec, 150);
  const [sel, setSel] = useState<string | null>(null);
  const near = new Set<string>();
  if (sel) for (const l of layout.links) if (l.from === sel || l.to === sel) { near.add(l.from); near.add(l.to); }

  return (
    <Scroller width={layout.width} height={layout.height}>
      <Svg width={layout.width} height={layout.height} style={StyleSheet.absoluteFill}>
        {layout.links.map((l, i) => {
          const on = !!sel && (l.from === sel || l.to === sel);
          const stroke = on ? c.moss : c.muted;
          const opacity = sel && !on ? 0.25 : on ? 1 : 0.7;
          return (
            <Path key={i} d={`${l.d} ${l.arrow}`} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={on ? 2 : 1.4} strokeLinecap="round" strokeLinejoin="round" />
          );
        })}
        {layout.boxes.map(b => {
          const stroke = sel === b.id ? c.moss : near.has(b.id) ? c.sage : c.border;
          const width = sel === b.id ? 2 : near.has(b.id) ? 1.5 : 1;
          const opacity = sel && !near.has(b.id) && sel !== b.id ? 0.5 : 1;
          if (b.kind === 'decision') {
            const pts = `${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}`;
            return <Polygon key={b.id} points={pts} fill={c.surface3} stroke={stroke} strokeWidth={width} opacity={opacity} strokeLinejoin="round" />;
          }
          return (
            <Rect key={b.id} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.kind === 'start' ? b.h / 2 : b.kind === 'data' ? 12 : 9} fill={c.surface3} stroke={stroke} strokeWidth={width} opacity={opacity} strokeDasharray={b.kind === 'data' ? [5, 3] : undefined} />
          );
        })}
      </Svg>
      {layout.links.map((l, i) => {
        if (!l.label) return null;
        const w = Math.min(120, l.label.length * 6.2 + 12);
        return (
          <Text key={`t${i}`} pointerEvents="none" numberOfLines={1} style={[s.edgeLabel, { left: l.mid.x - w / 2, top: l.mid.y - 9, width: w, color: c.secondary, backgroundColor: c.surface2 }]}>{l.label}</Text>
        );
      })}
      {layout.boxes.map(b => {
        const inset = b.kind === 'decision' ? b.w * 0.16 : 10;
        return (
          <Pressable
            key={b.id}
            onPress={() => toggle(sel, b.id, setSel)}
            accessibilityRole="button"
            accessibilityState={{ selected: sel === b.id }}
            accessibilityLabel={b.label}
            style={[s.node, { left: b.x, top: b.y, width: b.w, height: b.h, paddingHorizontal: inset, opacity: sel && !near.has(b.id) && sel !== b.id ? 0.55 : 1 }]}
          >
            <Text style={[s.nodeText, { color: c.text }]} numberOfLines={4}>{b.label}</Text>
          </Pressable>
        );
      })}
    </Scroller>
  );
}

// ---------------------------------------------------------------- sequence

const HEAD = 36;
const ROW = 42;

function SequenceView({ spec }: { spec: SequenceSpec }) {
  const c = useColors();
  const [sel, setSel] = useState<string | null>(null);
  const cols = spec.actors.map(a => Math.max(100, measure(a.label, 140).w + 14));
  const centers: number[] = [];
  let acc = 4;
  for (const w of cols) { centers.push(acc + w / 2); acc += w; }
  const width = acc + 4 + (spec.messages.some(m => m.from === m.to && m.from === spec.actors[spec.actors.length - 1]?.id) ? 40 : 0);
  const top = HEAD + 14;
  const height = top + spec.messages.length * ROW + 6;
  const at = new Map(spec.actors.map((a, i) => [a.id, centers[i]]));

  return (
    <Scroller width={width} height={height}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        {centers.map((x, i) => <Line key={i} x1={x} x2={x} y1={HEAD} y2={height - 2} stroke={sel === spec.actors[i].id ? c.sage : c.border} strokeWidth={1} strokeDasharray={[4, 4]} />)}
        {spec.messages.map((m, i) => {
          const y = top + i * ROW + 24;
          const x1 = at.get(m.from)!, x2 = at.get(m.to)!;
          const on = sel === m.from || sel === m.to;
          const stroke = on ? c.moss : c.muted;
          const opacity = sel && !on ? 0.3 : 1;
          if (x1 === x2) {
            return <Path key={i} d={`M${x1},${y - 8} h26 v14 h-24 M${x1 + 8},${y + 1} L${x1 + 2},${y + 6} L${x1 + 8},${y + 11}`} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={1.5} strokeDasharray={m.reply ? [4, 3] : undefined} />;
          }
          const dir = x2 > x1 ? 1 : -1;
          const end = x2 - dir * 2;
          return (
            <Path key={i} d={`M${x1},${y} L${end},${y} M${end - dir * 7},${y - 5} L${end},${y} L${end - dir * 7},${y + 5}`} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={on ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={m.reply ? [5, 4] : undefined} />
          );
        })}
      </Svg>
      {spec.messages.map((m, i) => {
        if (!m.label) return null;
        const x1 = at.get(m.from)!, x2 = at.get(m.to)!;
        const self = x1 === x2;
        const left = self ? x1 + 30 : Math.min(x1, x2) + 4;
        const w = self ? 140 : Math.abs(x2 - x1) - 8;
        return (
          <Text key={`m${i}`} numberOfLines={1} style={[s.message, { left, width: w, top: top + i * ROW + (self ? 8 : 4), textAlign: self ? 'left' : 'center', color: sel && sel !== m.from && sel !== m.to ? c.muted : c.secondary }]}>{m.label}</Text>
        );
      })}
      {spec.actors.map((a, i) => (
        <Pressable
          key={a.id}
          onPress={() => toggle(sel, a.id, setSel)}
          accessibilityRole="button"
          accessibilityState={{ selected: sel === a.id }}
          style={[s.actor, { left: centers[i] - (cols[i] - 14) / 2, width: cols[i] - 14, backgroundColor: c.surface3, borderColor: sel === a.id ? c.moss : c.border, borderWidth: sel === a.id ? 2 : StyleSheet.hairlineWidth }]}
        >
          <Text style={[s.actorText, { color: c.text }]} numberOfLines={1}>{a.label}</Text>
        </Pressable>
      ))}
    </Scroller>
  );
}

// ---------------------------------------------------------------- timeline

function TimelineView({ spec }: { spec: TimelineSpec }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [sel, setSel] = useState<number | null>(null);
  return (
    <View>
      {spec.events.map((e, i) => {
        const on = sel === i;
        const first = i === 0, last = i === spec.events.length - 1;
        return (
          <Animated.View key={i} entering={reduce ? undefined : FadeInDown.duration(260).delay(Math.min(i, 8) * 45)}>
            <Pressable onPress={() => { haptic.select(); setSel(on ? null : i); }} accessibilityRole="button" accessibilityState={{ expanded: on }} style={s.event}>
              <View style={s.rail}>
                <View style={[s.railLine, { height: 14, backgroundColor: first ? 'transparent' : c.border }]} />
                <View style={[s.railDot, { backgroundColor: on ? c.moss : c.surface2, borderColor: on ? c.moss : c.sage }]} />
                <View style={[s.railLine, { flex: 1, backgroundColor: last ? 'transparent' : c.border }]} />
              </View>
              <View style={[s.eventBody, on && { backgroundColor: c.surface3 }]}>
                {e.date ? <Text style={[s.date, { color: on ? c.moss : c.secondary }]}>{e.date}</Text> : null}
                <Text style={[s.eventLabel, { color: c.text }]}>{e.label}</Text>
                {e.detail ? <Text style={[s.detail, { color: c.muted }]} numberOfLines={on ? undefined : 2}>{e.detail}</Text> : null}
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  node: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  nodeText: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  edgeLabel: { position: 'absolute', fontFamily: font.medium, fontSize: 11, lineHeight: 16, textAlign: 'center', borderRadius: 4, overflow: 'hidden' },
  actor: { position: 'absolute', top: 0, height: HEAD, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  actorText: { fontFamily: font.semibold, fontSize: 12.5 },
  message: { position: 'absolute', fontFamily: font.medium, fontSize: 11.5, lineHeight: 16 },
  event: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  rail: { width: 14, alignItems: 'center' },
  railLine: { width: 2 },
  railDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  eventBody: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10, gap: 2, marginVertical: 1 },
  date: { fontFamily: font.semibold, fontSize: fs.xs },
  eventLabel: { fontFamily: font.medium, fontSize: fs.sm, lineHeight: 20 },
  detail: { fontFamily: font.sans, fontSize: fs.xs, lineHeight: 17 },
});
