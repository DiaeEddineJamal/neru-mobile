// Port of beui.dev/components/motion/loader: the default "spinner" variant, plus "ascii-line" (used by reasoning-text).
// Other variants are not ported.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { font, useColors } from '@/theme';
import { EASE_IN_OUT } from '@/ui/motion';

// Reduced motion keeps a calm opacity pulse ([1, 0.4, 1] over 1.4s) and drops every transform.
const pulse = () => withRepeat(withSequence(withTiming(0.4, { duration: 700, easing: EASE_IN_OUT }), withTiming(1, { duration: 700, easing: EASE_IN_OUT })), -1);

export function Loader({ size = 32, color }: { size?: number; color?: string }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduce) opacity.set(pulse());
    else turn.set(withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1));
  }, [reduce, turn, opacity]);
  const spin = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ rotate: `${turn.get()}deg` }] }));

  const stroke = Math.max(2, size * 0.09);
  const r = (size - stroke) / 2;
  const mid = size / 2;
  const tint = color ?? c.text;
  return (
    <Animated.View accessibilityRole="progressbar" accessibilityLabel="Loading" style={[{ width: size, height: size }, spin]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={mid} cy={mid} r={r} fill="none" stroke={tint} strokeOpacity={0.2} strokeWidth={stroke} />
        <Path d={`M ${mid} ${mid - r} A ${r} ${r} 0 0 1 ${mid + r} ${mid}`} fill="none" stroke={tint} strokeWidth={stroke} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

const LINE_FRAMES = ['|', '/', '-', '\\'];

/** beUI's "ascii-line" variant: a terminal spinner glyph cycling once per `speed` seconds. */
export function AsciiLineLoader({ size = 14, speed = 0.8, color }: { size?: number; speed?: number; color?: string }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    // Reduced motion slows the cycle rather than stopping it: it's a glyph swap, not on-screen movement.
    const step = ((reduce ? speed * 2.5 : speed) / LINE_FRAMES.length) * 1000;
    const id = setInterval(() => setFrame(f => (f + 1) % LINE_FRAMES.length), step);
    return () => clearInterval(id);
  }, [reduce, speed]);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Reasoning" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: font.mono, fontSize: size, lineHeight: size * 1.15, color: color ?? c.muted }}>{LINE_FRAMES[frame]}</Text>
    </View>
  );
}
