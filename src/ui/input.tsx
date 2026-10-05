// Port of beui.dev/components/motion/input
// Pill field whose border and 2px ring fade over 200ms on focus and error, an
// error shake (x 0,-6,6,-4,4,-2,0 over 0.45s) each time an error appears, and an
// error line that fades in from 4px above. Not ported: the message's blur, the
// success check and left/right icon slots (not needed here). The field is 48 tall
// instead of 44 to meet the touch-target size.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import Animated, {
  type EntryExitAnimationFunction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { font, fs, TAP, useColors } from '@/theme';

const FADE = { duration: 200 };
const SHAKE = [-6, 6, -4, 4, -2, 0];

const errorIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -4 }] },
    animations: { opacity: withTiming(1, FADE), transform: [{ translateY: withTiming(0, FADE) }] },
  };
};
const errorOut: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0, FADE), transform: [{ translateY: withTiming(-4, FADE) }] },
  };
};

type Props = Omit<TextInputProps, 'style' | 'value' | 'onChangeText' | 'placeholder' | 'secureTextEntry' | 'autoFocus'> & {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  error?: string;
  autoFocus?: boolean;
};

export function TextField({ label, error, editable = true, onFocus, onBlur, autoFocus, ...rest }: Props) {
  const c = useColors();
  const input = useRef<TextInput>(null);
  // Fields in bottom sheets focus once the sheet has slid in: a keyboard opened while the sheet's window is still
  // appearing isn't seen by the keyboard handling, and the field ends up under it.
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => input.current?.focus(), 450);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  const reduce = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const shake = useSharedValue(0);
  const hasError = !!error;

  useEffect(() => {
    if (!hasError || reduce) return;
    shake.set(withSequence(...SHAKE.map((x) => withTiming(x, { duration: 75 }))));
  }, [hasError, reduce, shake]);

  const border = hasError ? c.danger : focused ? `${c.text}66` : c.border;
  const ring = hasError ? `${c.danger}40` : `${c.muted}66`;
  const ringOn = hasError || focused;

  const fieldStyle = useAnimatedStyle(() => ({
    borderColor: reduce ? border : withTiming(border, FADE),
    transform: [{ translateX: shake.get() }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    borderColor: ring,
    opacity: reduce ? (ringOn ? 1 : 0) : withTiming(ringOn ? 1 : 0, FADE),
  }));

  return (
    <View style={s.root}>
      <Text style={[s.label, { color: c.text }]}>{label}</Text>
      <Animated.View style={[s.field, !editable && s.disabled, fieldStyle]}>
        <Animated.View style={[s.ring, ringStyle]} />
        <TextInput
          {...rest}
          ref={input}
          editable={editable}
          accessibilityLabel={label}
          accessibilityHint={error}
          placeholderTextColor={`${c.muted}99`}
          cursorColor={c.text}
          selectionColor={c.sage}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[s.input, { color: c.text }]}
        />
      </Animated.View>
      {error ? (
        <Animated.Text
          key={error}
          entering={errorIn}
          exiting={errorOut}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[s.error, { color: c.danger }]}
        >
          {error}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 6 },
  label: { paddingHorizontal: 4, fontFamily: font.medium, fontSize: fs.sm },
  field: { height: TAP, borderRadius: 9999, borderWidth: 1, justifyContent: 'center' },
  // ring-2 sits just outside the 1px border.
  ring: { position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderRadius: 9999, borderWidth: 2 },
  disabled: { opacity: 0.6 },
  input: { height: '100%', paddingHorizontal: 14, fontFamily: font.sans, fontSize: fs.base },
  error: { paddingHorizontal: 4, fontFamily: font.sans, fontSize: fs.xs },
});
