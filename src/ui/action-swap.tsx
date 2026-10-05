// Port of beui.dev/components/motion/action-swap (ActionSwapRollText, the "roll" animation the agent
// components use for titles, counts and status labels). The 3px blur on the moving layers is not portable.
import type { ReactNode } from 'react';
import { type StyleProp, Text, type TextStyle, View } from 'react-native';
import Animated, { type EntryAnimationsValues, type EntryExitAnimationFunction, type ExitAnimationsValues, LayoutAnimationConfig, useReducedMotion, withSpring, withTiming } from 'react-native-reanimated';

import { EASE_OUT, SPRING_SWAP } from '@/ui/motion';

// initial { opacity: 0, y: 90% } → SPRING_SWAP; exit { opacity: 0, y: -90% } over 0.14s EASE_OUT.
const rollIn: EntryExitAnimationFunction = (v: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: v.targetHeight * 0.9 }] },
    animations: { opacity: withSpring(1, SPRING_SWAP), transform: [{ translateY: withSpring(0, SPRING_SWAP) }] },
  };
};
const rollOut: EntryExitAnimationFunction = (v: ExitAnimationsValues) => {
  'worklet';
  const out = { duration: 140, easing: EASE_OUT };
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0, out), transform: [{ translateY: withTiming(-v.currentHeight * 0.9, out) }] },
  };
};

/**
 * Rolls the old label up and out and the new one up and in whenever `value` changes. An invisible copy of
 * the current label sizes the slot (beUI's sizer span); the first label appears without a roll.
 */
export function RollText({ value, style, children }: { value: string; style?: StyleProp<TextStyle>; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <View style={{ overflow: 'hidden', flexShrink: 1 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ opacity: 0 }}>
        <Text numberOfLines={1} style={style}>{children}</Text>
      </View>
      <LayoutAnimationConfig skipEntering>
        <Animated.View key={value} entering={reduce ? undefined : rollIn} exiting={reduce ? undefined : rollOut} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <Text numberOfLines={1} style={style}>{children}</Text>
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}
