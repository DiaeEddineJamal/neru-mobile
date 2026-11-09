// A ```chart, ```diagram or ```mermaid fence drawn as an interactive card. While the fence is still streaming a
// shimmer placeholder of about the final size stands in; a block that cannot be drawn falls back to its code.
import * as Clipboard from 'expo-clipboard';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { font, fs, useColors } from '@/theme';
import { CodeBlock } from '@/ui/code-block';
import { Bone, Skeleton } from '@/ui/skeleton';

import { ChartView, PLOT_H } from './Chart';
import { DiagramView } from './Diagram';
import { chartCsv, parseVisual, type VisualSpec } from './parse';

/** Fence languages Visual renders. ```mermaid is what the desktop app uses for diagrams. */
export const VISUAL_LANGS = ['chart', 'diagram', 'mermaid'];

/** Renders a ```chart / ```diagram fence as an interactive visual. `streaming` while the fence is still open. */
export function Visual({ lang, source, streaming }: { lang: string; source: string; streaming: boolean }) {
  if (streaming) return <Placeholder lang={lang} source={source} />;
  const parsed = parseVisual(lang, source);
  const fallback = (detail?: string) => <Fallback lang={lang} source={source} detail={detail} />;
  if (!parsed.ok) return fallback(parsed.error);
  return (
    <Boundary source={source} fallback={fallback}>
      <Card spec={parsed.spec} source={source} />
    </Boundary>
  );
}

const isChart = (lang: string, source: string) => lang.toLowerCase() === 'chart' || /^\s*pie\b/i.test(source);

function Fallback({ lang, source, detail }: { lang: string; source: string; detail?: string }) {
  const c = useColors();
  return (
    <View style={s.fallback}>
      <View style={s.note}>
        <Icon name="alertCircle" size={14} color={c.muted} />
        <Text style={[s.noteText, { color: c.secondary }]}>{isChart(lang, source) ? t("Couldn't draw this chart") : t("Couldn't draw this diagram")}</Text>
      </View>
      {detail ? <Text style={[s.detail, { color: c.muted }]} numberOfLines={2}>{detail}</Text> : null}
      <CodeBlock lang={lang} code={source} />
    </View>
  );
}

/** A render error inside a visual shows its code instead of breaking the message. */
class Boundary extends Component<{ source: string; fallback: (detail?: string) => ReactNode; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidUpdate(prev: { source: string }) {
    if (prev.source !== this.props.source && this.state.error !== null) this.setState({ error: null });
  }
  render() {
    return this.state.error !== null ? this.props.fallback(this.state.error) : this.props.children;
  }
}

function Card({ spec, source }: { spec: VisualSpec; source: string }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    haptic.light();
    await Clipboard.setStringAsync(spec.kind === 'chart' ? chartCsv(spec) : source);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Animated.View entering={reduce ? undefined : FadeIn.duration(240)} style={[s.card, { backgroundColor: c.surface2 }]}>
      <View style={s.head}>
        <Text style={[s.title, { color: c.text }]} numberOfLines={2} accessibilityRole="header">{spec.title ?? ''}</Text>
        <Pressable onPress={copy} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Copy data')} style={({ pressed }) => [s.copy, { backgroundColor: pressed ? c.surface3 : 'transparent' }]}>
          <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? c.sage : c.secondary} />
          <Text style={[s.copyText, { color: c.secondary }]}>{copied ? t('Copied') : t('Copy data')}</Text>
        </Pressable>
      </View>
      {spec.kind === 'chart' ? <ChartView spec={spec} /> : <DiagramView spec={spec} />}
    </Animated.View>
  );
}

const BARS = [0.45, 0.7, 0.55, 0.9, 0.62, 0.8];

/** Shimmer in the shape of what is coming: bars, a disc for pies, stacked boxes for diagrams. */
function Placeholder({ lang, source }: { lang: string; source: string }) {
  const c = useColors();
  const pie = /["']?type["']?\s*:\s*["']?(pie|donut|doughnut)/i.test(source) || /^\s*pie\b/i.test(source);
  const chart = isChart(lang, source) || /["']?type["']?\s*:\s*["']?(bar|line|area|scatter)/i.test(source);
  return (
    <View style={[s.card, { backgroundColor: c.surface2 }]}>
      <Skeleton label={chart ? t('Drawing chart') : t('Drawing diagram')} style={{ gap: 14 }}>
        <View style={s.head}>
          <Bone width="45%" height={16} />
          <Bone width={78} height={14} />
        </View>
        {pie ? (
          <View style={[s.pieBox, { height: 220 }]}><Bone width={204} height={204} radius={102} /></View>
        ) : chart ? (
          <View style={[s.barBox, { height: PLOT_H }]}>
            {BARS.map((h, i) => <View key={i} style={{ flex: 1 }}><Bone height={(PLOT_H - 30) * h} radius={4} /></View>)}
          </View>
        ) : (
          <View style={s.diagramBox}>
            {[150, 130, 150].map((w, i) => <Bone key={i} width={w} height={38} radius={10} />)}
          </View>
        )}
      </Skeleton>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 18, padding: 14, marginVertical: 6, gap: 10, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 28 },
  title: { flex: 1, fontFamily: font.semibold, fontSize: fs.base, lineHeight: 22 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 28, borderRadius: 14 },
  copyText: { fontFamily: font.medium, fontSize: fs.xs },
  fallback: { marginVertical: 6, gap: 6 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  noteText: { fontFamily: font.medium, fontSize: fs.xs },
  detail: { fontFamily: font.sans, fontSize: fs.xs, lineHeight: 16 },
  pieBox: { alignItems: 'center', justifyContent: 'center' },
  barBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingLeft: 30, paddingBottom: 22 },
  diagramBox: { alignItems: 'center', gap: 28, paddingVertical: 6 },
});
