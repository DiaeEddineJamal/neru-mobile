// Lucide's LoaderCircle with Tailwind's animate-spin (1s linear, infinite): the busy glyph beUI's agent
// components share (tool-result, tool-approval, file-diff, animated-badge). Reduced motion holds it still.
import { useEffect } from 'react';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

export function LoaderCircle({ size = 16, color }: { size?: number; color: string }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    turn.set(withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1));
    return () => cancelAnimation(turn);
  }, [reduce, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  return (
    <Animated.View style={[{ width: size, height: size }, spin]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </Svg>
    </Animated.View>
  );
}
