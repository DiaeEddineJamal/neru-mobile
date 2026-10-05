// Port of beui.dev/components/blocks/otp-input
// 48x56 slots 8px apart, 200ms border colour changes (filled, active), the 1s
// blinking caret (centred when empty, trailing a digit), digits rolling in from
// 14px below and out 14px above in 0.22s EASE_OUT, and onComplete on the
// empty-to-full transition. One invisible TextInput on top owns focus, the number
// pad, paste and SMS autofill, as in beUI.
// Not ported: in-place holes (RN has no reliable per-key events, so editing is
// append/backspace from the end and a tap always lands on the next empty slot),
// the digits' blur, and the status/mask/label/hint extras (not needed here).
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  type EntryExitAnimationFunction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { font, useColors } from '@/theme';
import { EASE_OUT } from '@/ui/motion';

const ROLL = { duration: 220, easing: EASE_OUT };
const digitIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 14 }] },
    animations: { opacity: withTiming(1, ROLL), transform: [{ translateY: withTiming(0, ROLL) }] },
  };
};
const digitOut: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0, ROLL), transform: [{ translateY: withTiming(-14, ROLL) }] },
  };
};

type Props = { length?: number; value: string; onChange: (value: string) => void; onComplete?: (value: string) => void };

export function OtpInput({ length = 6, value, onChange, onComplete }: Props) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  return (
    <View style={s.root}>
      <View style={s.slots}>
        {Array.from({ length }, (_, i) => (
          <Slot key={i} char={value[i] ?? ''} active={focused && i === active} />
        ))}
      </View>
      <TextInput
        value={value}
        onChangeText={(text) => {
          const next = text.replace(/\D/g, '').slice(0, length);
          if (next === value) return;
          onChange(next);
          if (value.length < length && next.length === length) onComplete?.(next);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        caretHidden
        accessibilityLabel="One-time passcode"
        accessibilityValue={{ text: value.split('').join(' ') }}
        selectionColor="transparent"
        style={[StyleSheet.absoluteFill, s.hidden, { color: c.bg }]}
      />
    </View>
  );
}

function Slot({ char, active }: { char: string; active: boolean }) {
  const c = useColors();
  const border = active ? c.text : char ? c.muted : c.border;
  const borderStyle = useAnimatedStyle(() => ({ borderColor: withTiming(border, { duration: 200 }) }));

  return (
    <Animated.View style={[s.slot, borderStyle]}>
      {active ? <Caret filled={!!char} /> : null}
      {char ? (
        <Animated.Text key={char} entering={digitIn} exiting={digitOut} style={[s.digit, { color: c.text }]}>
          {char}
        </Animated.Text>
      ) : null}
    </Animated.View>
  );
}

function Caret({ filled }: { filled: boolean }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const on = useSharedValue(1);
  useEffect(() => {
    // opacity [1, 1, 0, 0] over 1s, linear: lit for half a second, dark for half.
    if (!reduce) on.set(withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 0 }), withTiming(0, { duration: 500 }), withTiming(1, { duration: 0 })), -1));
  }, [reduce, on]);
  const style = useAnimatedStyle(() => ({ opacity: on.get() }));
  return <Animated.View style={[s.caret, filled ? s.caretTrailing : s.caretCentre, { backgroundColor: c.text }, style]} />;
}

const s = StyleSheet.create({
  root: { alignSelf: 'flex-start' },
  slots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slot: { width: 48, height: 56, borderRadius: 12, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  digit: { position: 'absolute', fontFamily: font.semibold, fontSize: 20, fontVariant: ['tabular-nums'] },
  caret: { position: 'absolute', width: 1, height: 24, top: 15 },
  caretCentre: { left: 22.5 },
  caretTrailing: { right: 12 },
  hidden: { opacity: 0.01 },
});
