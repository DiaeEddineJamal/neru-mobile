// Port of beui.dev/components/motion/number-ticker
// Each digit is a 0–9 column, 1.1em per cell, rolled to its value over 0.9s EASE_OUT; on mount the digits
// roll up from 0 staggered 0.04s left to right, later changes roll every digit at once. Glyphs are keyed by
// place value so a changing digit rolls instead of remounting. Not ported: startOnView (mobile counts are on
// screen when mounted, so the entrance plays on mount), pad/suffix/locale/format, the optional blur.
import { useEffect, useState } from 'react';
import { type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { EASE_OUT } from '@/ui/motion';

const DURATION = 900;
const STAGGER = 40;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ digit, delay, cell, style }: { digit: number; delay: number; cell: number; style: StyleProp<TextStyle> }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    y.set(reduce ? -digit * cell : withDelay(delay, withTiming(-digit * cell, { duration: DURATION, easing: EASE_OUT })));
  }, [digit, delay, cell, reduce, y]);
  const roll = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const glyph = [style, { height: cell, lineHeight: cell, textAlign: 'center' as const }];
  return (
    <View style={{ height: cell, overflow: 'hidden' }}>
      <Text style={[glyph, { opacity: 0 }]}>0</Text>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, roll]}>
        {DIGITS.map(n => <Text key={n} style={glyph}>{n}</Text>)}
      </Animated.View>
    </View>
  );
}

export function NumberTicker({ value, style, prefix }: { value: number; style?: StyleProp<TextStyle>; prefix?: string }) {
  const text = String(Math.round(value));
  const cell = (StyleSheet.flatten(style)?.fontSize ?? 14) * 1.1;
  const glyphs = text.split('').map((char, i) => ({ char, id: `g-${text.length - 1 - i}` }));
  const textStyle = [style, { fontVariant: ['tabular-nums' as const] }];

  // The stagger is an entrance flourish only; once it has played, updates roll without delay.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), DURATION + glyphs.length * STAGGER);
    return () => clearTimeout(t);
    // Timed from mount only, like beUI's one-shot reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`${prefix ?? ''}${text}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
      {prefix ? <Text style={[textStyle, { lineHeight: cell }]}>{prefix}</Text> : null}
      {glyphs.map(({ char, id }, i) =>
        /\d/.test(char)
          ? <Digit key={id} digit={Number(char)} delay={entered ? 0 : i * STAGGER} cell={cell} style={textStyle} />
          : <Text key={id} style={[textStyle, { lineHeight: cell }]}>{char}</Text>,
      )}
    </View>
  );
}
