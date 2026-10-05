// Port of beui.dev/components/motion/button (base Button, icon size) plus the icon swap beUI's prompt-input uses for send/stop.
// Hover scale and the optional ripple are not ported (no hover on touch). Labelled buttons live in button-base.tsx.
import { haptic } from '@/haptics';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle, View } from 'react-native';
import Animated, { type EntryExitAnimationFunction, LayoutAnimationConfig, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { SPRING_PRESS, SPRING_SWAP } from '@/ui/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** beUI default 0.93; response actions use 0.9. */
  pressScale?: number;
  /** Pads the visual size up to the 48dp touch target. */
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  /** Haptic on press: a light tap by default, a firmer one for commitments like sending. */
  feedback?: 'light' | 'medium' | 'none';
  children: ReactNode;
};

/** beUI Button: whileTap scale on SPRING_PRESS, disabled at 50% opacity. */
export function Button({ label, onPress, disabled, pressScale = 0.93, hitSlop = 8, style, feedback = 'light', children }: ButtonProps) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const pressed = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      onPress={() => {
        if (feedback !== 'none') haptic[feedback]();
        onPress?.();
      }}
      onPressIn={() => !reduce && scale.set(withSpring(pressScale, SPRING_PRESS))}
      onPressOut={() => scale.set(withSpring(1, SPRING_PRESS))}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[{ alignItems: 'center', justifyContent: 'center' }, style, disabled && { opacity: 0.5 }, pressed]}
    >
      {children}
    </AnimatedPressable>
  );
}

// AnimatePresence mode="popLayout": the outgoing slot leaves upward while the new one rises in, both on SPRING_SWAP.
export const swapIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 3 }, { scale: 0.8 }] },
    animations: { opacity: withSpring(1, SPRING_SWAP), transform: [{ translateY: withSpring(0, SPRING_SWAP) }, { scale: withSpring(1, SPRING_SWAP) }] },
  };
};
export const swapOut: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    animations: { opacity: withSpring(0, SPRING_SWAP), transform: [{ translateY: withSpring(-3, SPRING_SWAP) }, { scale: withSpring(0.8, SPRING_SWAP) }] },
  };
};

/** Swaps between keyed icons in a fixed-size slot. Change `swapKey` to trigger the swap. */
export function SwapIcon({ swapKey, size, children }: { swapKey: string; size: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    // skipEntering mirrors AnimatePresence initial={false}: the first icon appears without a swap.
    <View style={{ width: size, height: size }}>
      <LayoutAnimationConfig skipEntering>
        <Animated.View
          key={swapKey}
          entering={reduce ? undefined : swapIn}
          exiting={reduce ? undefined : swapOut}
          style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}
        >
          {children}
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}
