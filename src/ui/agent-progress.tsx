// Port of beui.dev/components/agents/loading-states (agent-progress)
// The 3×3 grid whose cells breathe in sequence (opacity 0.28↔1, scale 0.72↔1, 1.55s EASE_IN_OUT, staggered
// 0.14s), the medium label, and beUI's mono elapsed timer. Mobile change: with `value` the timer slot
// shows the percentage instead (no timer); without it the timer runs, as in beUI.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { font, fs, useColors } from '@/theme';
import { EASE_IN_OUT } from '@/ui/motion';

const DELAYS = [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.98, 1.12];

function formatElapsed(total: number) {
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(1);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function Cell({ delay, color }: { delay: number; color: string }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    const half = { duration: 775, easing: EASE_IN_OUT };
    p.set(withDelay(delay * 1000, withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1)));
  }, [delay, p]);
  // Reduced motion: opacity 0.35↔0.8 only.
  const style = useAnimatedStyle(() =>
    reduce ? { opacity: 0.35 + 0.45 * p.get() } : { opacity: 0.28 + 0.72 * p.get(), transform: [{ scale: 0.72 + 0.28 * p.get() }] },
  );
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 1, backgroundColor: color }, style]} />;
}

export function AgentProgress({ label, value }: { label: string; value?: number }) {
  const c = useColors();
  const [elapsed, setElapsed] = useState(0);
  const timed = value === undefined;
  useEffect(() => {
    if (!timed) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => clearInterval(timer);
  }, [timed]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}, in progress`}
      accessibilityValue={timed ? undefined : { min: 0, max: 100, now: Math.round(value) }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'flex-start' }}
    >
      <View style={{ width: 20, height: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        {DELAYS.map(delay => <Cell key={delay} delay={delay} color={c.muted} />)}
      </View>
      <Text style={{ fontFamily: font.medium, fontSize: fs.sm, color: c.muted }}>{label}</Text>
      <Text style={{ fontFamily: font.mono, fontSize: fs.sm, fontVariant: ['tabular-nums'], color: c.muted, opacity: 0.7 }}>
        {timed ? formatElapsed(elapsed) : `${Math.round(value)}%`}
      </Text>
    </View>
  );
}
