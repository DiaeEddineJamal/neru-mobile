// A small status light; it breathes while something is in progress (steady under reduced motion).
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { EASE_IN_OUT } from '@/ui/motion';

export function StatusDot({ color, pulse = false, size = 8 }: { color: string; pulse?: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    const half = { duration: 700, easing: EASE_IN_OUT };
    t.set(pulse && !reduce ? withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1) : 0);
  }, [pulse, reduce, t]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.35 * t.get(), transform: [{ scale: 1 + 0.9 * t.get() }] }));
  const dot = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[s.abs, dot, halo]} />
      <View style={[s.abs, dot]} />
    </View>
  );
}

const s = StyleSheet.create({ abs: { position: 'absolute' } });
