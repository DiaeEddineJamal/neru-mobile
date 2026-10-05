// Port of beui.dev/components/motion/text-reveal (word split, plays once on mount).
// Not ported: the 12px blur-in (RN has no per-view filter blur) and whileInView.
import { useEffect } from 'react';
import { type StyleProp, StyleSheet, type TextStyle, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { EASE_OUT } from '@/ui/motion';

const SPRING = { stiffness: 140, damping: 26, mass: 1.2 };
const STAGGER = 90; // ms

function Word({ word, delay, rise, style }: { word: string; delay: number; rise: number; style: StyleProp<TextStyle> }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(reduce ? 0 : rise);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      opacity.set(withDelay(delay * 0.3, withTiming(1, { duration: 250, easing: EASE_OUT })));
      return;
    }
    y.set(withDelay(delay, withSpring(0, SPRING)));
    opacity.set(withDelay(delay, withTiming(1, { duration: 700, easing: EASE_OUT })));
  }, [reduce, delay, y, opacity]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));
  return <Animated.Text style={[style, anim]}>{word}</Animated.Text>;
}

export function TextReveal({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const flat = StyleSheet.flatten(style) ?? {};
  // yOffset "40%" of the word box.
  const rise = 0.4 * (flat.lineHeight ?? (flat.fontSize ?? 16) * 1.2);
  // Each word keeps its trailing whitespace so wrapping happens between words, like beUI's inline-blocks.
  const words = text.match(/\S+\s*|\s+/g) ?? [];
  const justify = flat.textAlign === 'center' ? 'center' : flat.textAlign === 'right' ? 'flex-end' : 'flex-start';
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: justify }}>
      {words.map((w, i) => (
        <Word key={i} word={w} delay={i * STAGGER} rise={rise} style={style} />
      ))}
    </View>
  );
}
