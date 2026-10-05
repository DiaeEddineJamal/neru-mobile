// Port of beui.dev/components/agents/agent-activity (+ activity-row)
// While any item runs: a ThinkingShimmer status line and a fixed 208dp viewport whose list glides up on
// SPRING_LAYOUT as rows arrive. When the run ends it collapses to a "Completed N steps" toggle that reopens
// at the content's height, scrollable past 208. Rows are beUI's trace rows (icon, label, mono detail chip)
// with the step row's status glyphs: pulsing dot while running, check when done, and an x for failed.
// Not portable: the 12px mask-image fades at the viewport edges become gradients painted in the screen's
// background colour, so this belongs on a c.bg surface.
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  type EntryExitAnimationFunction,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { font, fs, useColors } from '@/theme';
import { AgentDisclosure, DisclosureChevron } from '@/ui/agent-disclosure';
import { EASE_OUT, SPRING_LAYOUT } from '@/ui/motion';
import { ThinkingShimmer } from '@/ui/thinking-shimmer';

export type ActivityItem = { id: string; label: string; status: 'running' | 'done' | 'failed'; detail?: string };

const MAX_HEIGHT = 208;
const FADE = 12;

const rowIn: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 0, transform: [{ translateY: 6 }] }, animations: { opacity: withTiming(1, { duration: 180, easing: EASE_OUT }), transform: [{ translateY: withSpring(0, SPRING_LAYOUT) }] } };
};
const rowOut: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 1, transform: [{ translateY: 0 }] }, animations: { opacity: withTiming(0, { duration: 180, easing: EASE_OUT }), transform: [{ translateY: withSpring(-3, SPRING_LAYOUT) }] } };
};
const rowLayout = LinearTransition.springify().stiffness(360).damping(32).mass(0.6);

/** Step row's "active" glyph: a 12dp halo pulsing 0.35↔0.8 over 1.5s around a 6dp dot. */
function ActiveDot({ color }: { color: string }) {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.set(withRepeat(withSequence(withTiming(0.8, { duration: 750 }), withTiming(0.35, { duration: 750 })), -1));
  }, [pulse]);
  const halo = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', inset: 0, borderRadius: 6, backgroundColor: `${color}1a` }, halo]} />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, opacity: 0.6 }} />
    </View>
  );
}

function Row({ item }: { item: ActivityItem }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={`${item.label}${item.detail ? `, ${item.detail}` : ''}, ${item.status}`} style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
        {item.status === 'running' ? <ActiveDot color={c.text} /> : <Icon name={item.status === 'done' ? 'check' : 'close'} size={16} color={item.status === 'done' ? c.muted : c.danger} />}
      </View>
      <Text style={{ fontFamily: font.medium, fontSize: fs.sm, lineHeight: 20, color: c.text }}>{item.label}</Text>
      {item.detail ? (
        <View style={{ flex: 1, minWidth: 0, borderRadius: 8, backgroundColor: c.surface3, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: fs.xs, color: c.muted }}>{item.detail}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function AgentActivity({ items }: { items: ActivityItem[] }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const viewport = useRef<ScrollView>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const working = items.some(item => item.status === 'running');
  const [open, setOpen] = useState(false);
  const [wasWorking, setWasWorking] = useState(working);
  if (wasWorking !== working) {
    setWasWorking(working);
    if (!working) setOpen(false); // collapseOnComplete
  }
  const expanded = working || open;
  const viewportHeight = working ? MAX_HEIGHT : Math.min(contentHeight, MAX_HEIGHT);
  const capped = contentHeight > MAX_HEIGHT;
  const streamOffset = working ? Math.min(0, viewportHeight - contentHeight) : 0;

  const offset = useSharedValue(streamOffset);
  useEffect(() => {
    offset.set(reduce ? streamOffset : withSpring(streamOffset, SPRING_LAYOUT));
  }, [streamOffset, reduce, offset]);
  const glide = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  const toggle = () => {
    setOpen(!open);
    if (!open) requestAnimationFrame(() => viewport.current?.scrollTo({ y: 0, animated: false }));
  };
  const summary = `Completed ${items.length} ${items.length === 1 ? 'step' : 'steps'}`;
  const fade = (edge: 'top' | 'bottom') => (
    <LinearGradient
      pointerEvents="none"
      colors={edge === 'top' ? [c.bg, `${c.bg}00`] : [`${c.bg}00`, c.bg]}
      style={{ position: 'absolute', left: 0, right: 0, height: FADE, [edge]: 0 }}
    />
  );

  return (
    <View accessibilityState={{ busy: working }} style={{ width: '100%' }}>
      {working ? (
        <View accessibilityRole="summary" style={{ minHeight: 28, justifyContent: 'center' }}>
          <ThinkingShimmer label="Working through it" />
        </View>
      ) : (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={summary}
          accessibilityState={{ expanded }}
          hitSlop={10}
          style={{ height: 28, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Text numberOfLines={1} style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{summary}</Text>
          <DisclosureChevron open={expanded} color={c.muted} />
        </Pressable>
      )}

      <AgentDisclosure open={expanded} height={viewportHeight}>
        <View style={{ height: viewportHeight }}>
          <ScrollView ref={viewport} nestedScrollEnabled scrollEnabled={capped && !working} showsVerticalScrollIndicator={false} style={{ paddingRight: 4 }}>
            <Animated.View onLayout={e => setContentHeight(e.nativeEvent.layout.height)} accessibilityRole="list" style={[{ gap: 2, paddingVertical: 8 }, glide]}>
              <LayoutAnimationConfig skipEntering>
                {items.map(item => (
                  <Animated.View key={item.id} entering={reduce ? undefined : rowIn} exiting={reduce ? undefined : rowOut} layout={reduce ? undefined : rowLayout}>
                    <Row item={item} />
                  </Animated.View>
                ))}
              </LayoutAnimationConfig>
            </Animated.View>
          </ScrollView>
          {capped ? fade('top') : null}
          {capped && !working ? fade('bottom') : null}
        </View>
      </AgentDisclosure>
    </View>
  );
}
