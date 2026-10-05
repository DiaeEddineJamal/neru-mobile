// Port of beui.dev/components/motion/switch
// Heavy thumb spring (800/80/4) drives the travel, the press squish (scale 0.9 and
// a 4px stretch toward the destination) and the 200ms track colour; a press on a
// disabled switch shakes the thumb after 200ms. Not ported: focus-visible ring
// and the optional inline label (wrap it in a row yourself).
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { useColors } from '@/theme';

const THUMB_SPRING = { stiffness: 800, damping: 80, mass: 4 };
const TRAVEL = 40; // track 48 minus 2 x 4 padding
const SHAKE_STEP = { duration: 150 };

type Props = { value: boolean; onValueChange: (value: boolean) => void; disabled?: boolean; accessibilityLabel: string };

export function Switch({ value, onValueChange, disabled, accessibilityLabel }: Props) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const shake = useSharedValue(0);
  const squish = !disabled && pressed && !reduce;
  const width = squish ? 24 : 20;
  const left = value ? TRAVEL - width : 0;
  const trackColor = value ? c.mossAction : `${c.muted}99`;

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: reduce ? trackColor : withTiming(trackColor, { duration: 200 }),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: reduce ? left : withSpring(left, THUMB_SPRING),
    width: reduce ? width : withSpring(width, THUMB_SPRING),
    transform: [{ translateX: shake.get() }, { scale: reduce ? 1 : withSpring(squish ? 0.9 : 1, THUMB_SPRING) }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={10}
      onPressIn={() => {
        setPressed(true);
        if (disabled && !reduce) {
          shake.set(withDelay(200, withSequence(withTiming(-2, SHAKE_STEP), withTiming(2, SHAKE_STEP), withTiming(-1, SHAKE_STEP), withTiming(0, SHAKE_STEP))));
        }
      }}
      onPressOut={() => setPressed(false)}
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onValueChange(!value);
      }}
      style={disabled ? s.disabled : undefined}
    >
      <Animated.View style={[s.track, trackStyle]}>
        <View style={s.rail}>
          <Animated.View style={[s.thumb, { backgroundColor: c.bg }, thumbStyle]} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  disabled: { opacity: 0.6 },
  track: { width: 48, height: 28, borderRadius: 14, paddingHorizontal: 4, justifyContent: 'center' },
  rail: { height: 20 },
  thumb: {
    position: 'absolute',
    top: 0,
    height: 20,
    borderRadius: 10,
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
  },
});
