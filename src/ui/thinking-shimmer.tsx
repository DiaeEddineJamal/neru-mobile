// Port of beui.dev/components/agents/loading-states (thinking-shimmer) and motion/text-shimmer.
// RN has no background-clip:text, so the 110deg gradient sweep is sampled per character: each glyph takes the
// gradient's colour at its centre (vertical slant is lost; glyph centres are spaced evenly, not measured).
import { useEffect } from 'react';
import { type StyleProp, type TextStyle, View } from 'react-native';
import Animated, { type EntryExitAnimationFunction, Easing, interpolateColor, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { font, fs, useColors } from '@/theme';
import { ThinkingOrb, type OrbState } from '@/ui/thinking-orb';

/** Sweep clock, 0→1 linear per `duration` seconds. Reduced motion holds the gradient still, as beUI's CSS does. */
export function useShimmerClock(duration: number) {
  const reduce = useReducedMotion();
  const t = useSharedValue(reduce ? 0.5 : 0);
  useEffect(() => {
    if (!reduce) t.set(withRepeat(withTiming(1, { duration: duration * 1000, easing: Easing.linear }), -1));
  }, [reduce, duration, t]);
  return t;
}

// linear-gradient(muted 30%, foreground 50%, muted 70%) at background-size 200%, animated from
// background-position 200% to -200% with the default repeat: a highlight crossing left→right twice per cycle.
// `u` is the glyph centre as a fraction of the text width.
function highlight(t: number, u: number) {
  'worklet';
  const g = (((u + 2 - 4 * t) % 2) + 2) % 2; // position inside the 2W-wide gradient tile
  return Math.max(0, 1 - Math.abs(g - 1) / 0.4);
}

export function ShimmerChar({ char, clock, u, style, entering, exiting }: {
  char: string;
  clock: SharedValue<number>;
  u: number;
  style?: StyleProp<TextStyle>;
  entering?: EntryExitAnimationFunction;
  exiting?: EntryExitAnimationFunction;
}) {
  const c = useColors();
  const tint = useAnimatedStyle(() => ({ color: interpolateColor(highlight(clock.get(), u), [0, 1], [c.muted, c.text]) }));
  return <Animated.Text entering={entering} exiting={exiting} style={[style, tint]}>{char}</Animated.Text>;
}

/** The desktop's agent status line: a thinking orb for what the model is doing, and its shimmering label. */
export function ThinkingShimmer({ label = 'Thinking', state = 'working' }: { label?: string; state?: OrbState }) {
  const clock = useShimmerClock(1.8);
  const chars = Array.from(`${label}…`);
  return (
    <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
      <ThinkingOrb state={state} />
      <View style={{ flexDirection: 'row' }}>
        {chars.map((ch, i) => (
          <ShimmerChar key={i} char={ch} clock={clock} u={(i + 0.5) / chars.length} style={{ fontFamily: font.medium, fontSize: fs.base, lineHeight: 24 }} />
        ))}
      </View>
    </View>
  );
}
