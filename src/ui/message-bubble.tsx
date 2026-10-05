// Port of beui.dev/components/agents/message-bubble ("soft" variant, align end) inside beUI's Message row (from="user").
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { font, fs, useColors } from '@/theme';

// iMessage/Telegram send: the bubble launches from the composer, scaling out of its tail corner,
// text and all, and settles with one soft overshoot.
const LAUNCH = { stiffness: 340, damping: 24, mass: 0.75 };
const RISE = 44;

type Props = {
  text: string;
  onLongPress?: () => void;
  /** Plays the entrance once on mount. Pass false for history rows so scrolling a list doesn't replay it. */
  animateIn?: boolean;
};

export function MessageBubble({ text, onLongPress, animateIn = true }: Props) {
  const c = useColors();
  const reduce = useReducedMotion();
  const pop = animateIn && !reduce;
  const launch = useSharedValue(pop ? 0 : 1);

  useEffect(() => {
    if (pop) launch.set(withSpring(1, LAUNCH));
  }, [pop, launch]);

  const rowStyle = useAnimatedStyle(() => {
    const t = launch.get();
    return {
      opacity: Math.min(1, t * 4),
      transform: [{ translateY: RISE * (1 - t) }, { scale: 0.78 + 0.22 * t }],
    };
  });

  return (
    <Animated.View style={[s.row, rowStyle]}>
      <Pressable
        onLongPress={
          onLongPress &&
          (() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onLongPress();
          })
        }
        disabled={!onLongPress}
        accessibilityRole="text"
        accessibilityLabel={text}
        accessibilityHint={onLongPress ? 'Long-press for options' : undefined}
        style={({ pressed }) => [s.bubble, { backgroundColor: c.bubble }, pressed && { transform: [{ scale: 0.97 }] }]}
      >
        <Text style={{ fontFamily: font.sans, fontSize: fs.base, lineHeight: 22, color: c.bubbleText }}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // iMessage keeps a gutter on the sender's side so the bubble reads as a shape, not a band off the screen edge.
  row: { width: '100%', alignItems: 'flex-end', paddingLeft: 56, paddingRight: 14, transformOrigin: '100% 100%' },
  // Round everywhere but the tail corner, which tightens toward the sender like iMessage and Telegram.
  bubble: { minWidth: 40, maxWidth: '100%', borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 15, paddingVertical: 9, borderCurve: 'continuous' },
});
