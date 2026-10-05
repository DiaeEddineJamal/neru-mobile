// Claude's dictation stripes: a strip of rounded bars gliding left at a steady pace for as long as you talk,
// each new bar as tall as your voice when it entered on the right. Everything runs on the UI thread from one
// frame clock: the recognizer's ~10 volume readings a second only set a target the strip eases toward, so the
// bars never step, stutter or restart, whatever happens on the JS thread (typing, deleting, streaming).
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, type SharedValue } from 'react-native-reanimated';

const BARS = 64; // enough to span the widest composer; the strip clips the oldest
const SPACING = 6; // 3dp bar + 3dp gap
const SPEED = 0.05; // dp per ms: a new bar every 120 ms
const MIN = 3;
const MAX = 24;

function Bar({ samples, offset, index, color }: { samples: SharedValue<number[]>; offset: SharedValue<number>; index: number; color: string }) {
  // Anchored to the right edge: the newest bar slides in from just outside it.
  const style = useAnimatedStyle(() => ({
    height: MIN + (MAX - MIN) * (samples.get()[index] ?? 0),
    transform: [{ translateX: SPACING - offset.get() - (BARS - 1 - index) * SPACING }],
  }));
  return <Animated.View style={[s.bar, { backgroundColor: color }, style]} />;
}

// Reduce motion: a few bars rise and fall in place with the voice instead of scrolling.
function StillBar({ level, scale, color }: { level: SharedValue<number>; scale: number; color: string }) {
  const style = useAnimatedStyle(() => ({ height: MIN + (MAX - MIN) * level.get() * scale }));
  return <Animated.View style={[s.still, { backgroundColor: color }, style]} />;
}

/** `level` 0..1 from the speech recognizer; `active` false lets the strip settle while the last words arrive. */
export function VoiceWaveform({ level, active, color }: { level: number; active: boolean; color: string }) {
  const reduce = useReducedMotion();
  const target = useSharedValue(0);
  const smooth = useSharedValue(0);
  const offset = useSharedValue(0);
  const samples = useSharedValue<number[]>(Array(BARS).fill(0));
  useEffect(() => { target.set(active ? level : 0); }, [level, active, target]);

  useFrameCallback(({ timeSincePreviousFrame }) => {
    'worklet';
    const dt = Math.min(64, timeSincePreviousFrame ?? 16);
    // Ease toward the latest reading (~90 ms) so the steps between readings become a curve.
    smooth.set(smooth.get() + (target.get() - smooth.get()) * (1 - Math.exp(-dt / 90)));
    if (reduce) return;
    let next = offset.get() + dt * SPEED;
    if (next >= SPACING) {
      next -= SPACING;
      // Normal speech sits high in the recognizer's range: the curve keeps only loud syllables near full
      // height, and a little texture keeps a steady voice from reading as a solid block.
      samples.set([...samples.get().slice(1), Math.min(1, smooth.get() ** 1.6 * (0.55 + Math.random() * 0.6))]);
    }
    offset.set(next);
  });

  return (
    <View style={[s.row, reduce && s.centered]} accessibilityLabel={active ? 'Listening' : 'Finishing dictation'} accessibilityLiveRegion="polite">
      {reduce
        ? [0.6, 1, 0.8, 1, 0.6].map((k, i) => <StillBar key={i} level={smooth} scale={k} color={color} />)
        : Array.from({ length: BARS }, (_, i) => <Bar key={i} samples={samples} offset={offset} index={i} color={color} />)}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flex: 1, height: MAX, overflow: 'hidden', justifyContent: 'center' },
  centered: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  bar: { position: 'absolute', right: 0, width: 3, borderRadius: 1.5 },
  still: { width: 3, borderRadius: 1.5 },
});
