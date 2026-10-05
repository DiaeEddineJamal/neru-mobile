// Port of beui.dev/components/motion/button (registry: button-base), lg size
// Press scale 0.93 on SPRING_PRESS, primary/secondary/ghost variants, disabled at
// 50% opacity. Additions the base button does not have: `destructive` (primary
// shape in the danger colour, standing in for beUI's `outline`), a leading icon,
// and `loading`, which trades the label for the shared LoaderCircle spinner on SPRING_SWAP (the token
// beUI reserves for label/icon slot swaps) while keeping the button's width.
// Not ported: hover lift (no hover on touch), the opt-in ripple.
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';
import { LoaderCircle } from '@/ui/loader-circle';
import { SPRING_PRESS, SPRING_SWAP } from '@/ui/motion';

const PRESS_SCALE = 0.93;

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Props = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ActionButton({ title, onPress, variant = 'primary', icon, loading = false, disabled = false, style }: Props) {
  const c = useColors();
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const swap = useSharedValue(loading ? 1 : 0);
  const inert = disabled || loading;

  useEffect(() => {
    swap.set(reduce ? (loading ? 1 : 0) : withSpring(loading ? 1 : 0, SPRING_SWAP));
  }, [loading, reduce, swap]);

  const look = {
    primary: { bg: c.mossAction, fg: c.onAction, border: 'transparent' },
    secondary: { bg: c.surface2, fg: c.text, border: c.border },
    ghost: { bg: 'transparent', fg: c.muted, border: 'transparent' },
    destructive: { bg: c.danger, fg: c.onAction, border: 'transparent' },
  }[variant];

  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: 1 - swap.get(), transform: [{ translateY: -8 * swap.get() }] }));
  const spinnerStyle = useAnimatedStyle(() => ({ opacity: swap.get(), transform: [{ translateY: 8 * (1 - swap.get()) }] }));

  const press = (to: number) => {
    if (!reduce) scale.set(withSpring(to, SPRING_PRESS));
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPressIn={() => press(PRESS_SCALE)}
      onPressOut={() => press(1)}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={[s.base, { backgroundColor: look.bg, borderColor: look.border }, disabled && s.disabled, pressStyle, style]}
    >
      <Animated.View style={[s.row, labelStyle]}>
        {icon ? <Icon name={icon} size={18} color={look.fg} /> : null}
        <Text numberOfLines={1} style={[s.label, { color: look.fg }]}>
          {title}
        </Text>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, s.center, spinnerStyle]}>
        <View>{loading ? <LoaderCircle size={18} color={look.fg} /> : null}</View>
      </Animated.View>
    </AnimatedPressable>
  );
}

const s = StyleSheet.create({
  base: { height: TAP, paddingHorizontal: 24, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: font.medium, fontSize: fs.base },
});
