// Loading placeholders: soft bones in the shape of what is coming, with one highlight sweeping across them.
// Every bone in a <Skeleton> shares a single clock, so the sweep moves through the whole group in step.
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useColors } from '@/theme';
import { useShimmerClock } from '@/ui/thinking-shimmer';

const BAND = 140;
const Clock = createContext<SharedValue<number> | null>(null);

export function Skeleton({ children, style, label = 'Loading' }: { children: ReactNode; style?: ViewStyle; label?: string }) {
  const clock = useShimmerClock(1.6);
  return (
    <Clock.Provider value={clock}>
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} accessible accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
        {children}
      </Animated.View>
    </Clock.Provider>
  );
}

export function Bone({ width = '100%', height = 14, radius = 7, style }: { width?: DimensionValue; height?: number; radius?: number; style?: ViewStyle }) {
  const c = useColors();
  const clock = useContext(Clock);
  const [w, setW] = useState(0);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: -BAND + (clock?.get() ?? 0) * (w + BAND * 2) }] }));
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={[{ width, height, borderRadius: radius, backgroundColor: c.surface3, overflow: 'hidden' }, style]}>
      {w ? (
        <Animated.View style={[s.band, sweep]}>
          <LinearGradient colors={['transparent', `${c.text}12`, 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A conversation on its way: replies as text lines, your messages as bubbles on the right. */
export function ConversationSkeleton() {
  const reply = (widths: DimensionValue[]) => (
    <View style={{ gap: 9, paddingHorizontal: 20 }}>
      {widths.map((w, i) => <Bone key={i} width={w} />)}
    </View>
  );
  const bubble = (width: DimensionValue) => (
    <View style={{ alignItems: 'flex-end', paddingHorizontal: 16 }}>
      <Bone width={width} height={40} radius={20} style={{ borderBottomRightRadius: 6 }} />
    </View>
  );
  return (
    <Skeleton label="Loading the conversation" style={{ gap: 28, paddingVertical: 20 }}>
      {bubble('52%')}
      {reply(['94%', '88%', '61%'])}
      {bubble('38%')}
      {reply(['90%', '72%'])}
    </Skeleton>
  );
}

/** List rows on their way: a glyph, a title and a subtitle. */
export function RowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <Skeleton label="Loading sessions" style={{ gap: 6, paddingTop: 8 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={s.row}>
          <Bone width={18} height={18} radius={5} />
          <View style={{ flex: 1, gap: 7 }}>
            <Bone width={`${78 - ((i * 17) % 34)}%`} height={13} />
            <Bone width="34%" height={10} radius={5} />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}

const s = StyleSheet.create({
  band: { position: 'absolute', top: 0, bottom: 0, left: 0, width: BAND },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12 },
});
