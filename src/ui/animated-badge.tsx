// Port of beui.dev/components/motion/animated-badge (size md)
// Neru statuses map onto beUI's: running → loading (spinning LoaderCircle + pulse), waiting → warning,
// done → success, failed → danger. Icon and label roll in on beUI's own springs (y 210/24/0.85,
// scale 250/24/0.75) and out in 0.22s/0.2s EASE_OUT; the pill's resize glides on 420/30/0.7 and its colours
// cross-fade over 0.3s. Not portable: the 6px blur on the rolling layers.
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  type EntryAnimationsValues,
  type EntryExitAnimationFunction,
  type ExitAnimationsValues,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { font, fs, useColors } from '@/theme';
import { LoaderCircle } from '@/ui/loader-circle';
import { EASE_IN_OUT, EASE_OUT } from '@/ui/motion';

export type BadgeStatus = 'running' | 'waiting' | 'done' | 'failed';

const Y_SPRING = { stiffness: 210, damping: 24, mass: 0.85 };
const SCALE_SPRING = { stiffness: 250, damping: 24, mass: 0.75 };
const ICON = 14;

const iconIn: EntryExitAnimationFunction = () => {
  'worklet';
  const t = { duration: 280, easing: EASE_OUT };
  return {
    initialValues: { opacity: 0.72, transform: [{ translateY: ICON * 0.8 }, { scale: 0.92 }, { rotate: '-8deg' }] },
    animations: { opacity: withTiming(1, t), transform: [{ translateY: withSpring(0, Y_SPRING) }, { scale: withSpring(1, SCALE_SPRING) }, { rotate: withTiming('0deg', t) }] },
  };
};
const iconOut: EntryExitAnimationFunction = () => {
  'worklet';
  const t = { duration: 220, easing: EASE_OUT };
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }, { rotate: '0deg' }] },
    animations: { opacity: withTiming(0.5, t), transform: [{ translateY: withTiming(-ICON * 0.8, t) }, { scale: withTiming(0.96, t) }, { rotate: withTiming('8deg', t) }] },
  };
};
const labelIn: EntryExitAnimationFunction = (v: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0.76, transform: [{ translateY: v.targetHeight * 0.85 }] },
    animations: { opacity: withTiming(1, { duration: 300, easing: EASE_OUT }), transform: [{ translateY: withSpring(0, Y_SPRING) }] },
  };
};
const labelOut: EntryExitAnimationFunction = (v: ExitAnimationsValues) => {
  'worklet';
  const t = { duration: 200, easing: EASE_OUT };
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0.5, t), transform: [{ translateY: withTiming(-v.currentHeight * 0.85, t) }] },
  };
};
const resize = LinearTransition.springify().stiffness(420).damping(30).mass(0.7);

export function AnimatedBadge({ status, label }: { status: BadgeStatus; label: string }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const tone = { running: c.text, waiting: c.codeChip, done: c.sage, failed: c.danger }[status];
  const fill = status === 'running' ? c.surface3 : `${tone}1a`;
  const pulsing = status === 'running' && !reduce;

  const pulse = useSharedValue(0);
  useEffect(() => {
    const half = { duration: 800, easing: EASE_IN_OUT };
    pulse.set(pulsing ? withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1) : 0);
  }, [pulsing, pulse]);
  const glow = useAnimatedStyle(() => ({ opacity: 0.08 + 0.08 * pulse.get(), transform: [{ scale: 0.94 + 0.14 * pulse.get() }] }));
  const colors = useAnimatedStyle(() => ({
    borderColor: withTiming(`${tone}4d`, { duration: 300 }),
    backgroundColor: withTiming(fill, { duration: 300 }),
  }));

  const icon =
    status === 'running' ? <LoaderCircle size={ICON} color={tone} />
      : <Icon name={status === 'waiting' ? 'warning' : status === 'done' ? 'check' : 'close'} size={ICON} color={tone} />;
  const textStyle = { fontFamily: font.medium, fontSize: fs.xs, fontVariant: ['tabular-nums' as const], color: tone };

  return (
    <Animated.View
      layout={reduce ? undefined : resize}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={[{ height: 32, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, overflow: 'hidden', alignSelf: 'flex-start' }, colors]}
    >
      {pulsing ? <Animated.View style={[{ position: 'absolute', inset: 0, borderRadius: 999, backgroundColor: tone }, glow]} /> : null}
      <LayoutAnimationConfig skipEntering>
        <View style={{ width: ICON, height: ICON, overflow: 'hidden' }}>
          <Animated.View key={status} entering={reduce ? undefined : iconIn} exiting={reduce ? undefined : iconOut} style={{ position: 'absolute', inset: 0 }}>
            {icon}
          </Animated.View>
        </View>
        <View style={{ overflow: 'hidden' }}>
          <Text style={[textStyle, { opacity: 0 }]}>{label}</Text>
          <Animated.View key={label} entering={reduce ? undefined : labelIn} exiting={reduce ? undefined : labelOut} style={{ position: 'absolute', top: 0, left: 0 }}>
            <Text numberOfLines={1} style={textStyle}>{label}</Text>
          </Animated.View>
        </View>
      </LayoutAnimationConfig>
    </Animated.View>
  );
}
