// Port of beui.dev/components/motion/pull-to-refresh
// Same pull physics (exponential resistance up to 132px, 76px to arm, held at 68px
// while refreshing, SPRING_PANEL settles), the same fading/scaling indicator with
// beUI's RefreshBuddy character (lift, tilt and stretch with the pull; orbit, blink
// and wobble loops while refreshing) and the swapping status label.
// Native adaptation: the pull is a gesture-handler Pan running alongside the
// native scroll, taken only when the list starts at the top. iOS bounce and
// Android overscroll are off at that edge's expense (bounces={false}) so the two
// never fight; RefreshControl is not used because it cannot show custom visuals.
// Works for FlatList too: renderScrollComponent={(p) => <PullToRefreshScrollView {...p} refreshing={r} onRefresh={f} />}.
// Not ported: mouse/pen dragging, the `disabled` prop and custom labels.
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, type ScrollViewProps, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type EntryExitAnimationFunction,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/haptics';
import { font, useColors } from '@/theme';
import { EASE_IN_OUT, EASE_OUT, SPRING_PANEL, SPRING_SWAP } from '@/ui/motion';

type Status = 'idle' | 'pulling' | 'ready' | 'refreshing';
type PullStatus = Exclude<Status, 'refreshing'>;

const THRESHOLD = 76;
const MAX_PULL = 132;
const HOLD = 68;
const LABELS: Record<Status, string> = { idle: 'Pull to refresh', pulling: 'Pull to refresh', ready: 'Release to refresh', refreshing: 'Refreshing' };

const resisted = (d: number) => {
  'worklet';
  return MAX_PULL * (1 - Math.exp(-Math.max(0, d) / MAX_PULL));
};

type Props = ScrollViewProps & { refreshing: boolean; onRefresh: () => void | Promise<void>; ref?: Ref<ScrollView> };

export function PullToRefreshScrollView({ refreshing, onRefresh, ref, style, onScroll, children, ...rest }: Props) {
  const c = useColors();
  const reduce = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => scroll.current as ScrollView);

  const [pullStatus, setPullStatus] = useState<PullStatus>('idle');
  const [internal, setInternal] = useState(false);
  const isRefreshing = refreshing || internal;
  const status: Status = isRefreshing ? 'refreshing' : pullStatus;
  const latestRefreshing = useRef(refreshing);
  useEffect(() => {
    latestRefreshing.current = refreshing;
  }, [refreshing]);

  const y = useSharedValue(0);
  const top = useSharedValue(true);
  const busy = useSharedValue(false);
  const active = useSharedValue(false);
  const reported = useSharedValue<PullStatus>('idle');

  // Hold the content open while any refresh runs; release it when it ends.
  useEffect(() => {
    busy.set(isRefreshing);
    y.set(reduce ? (isRefreshing ? HOLD : 0) : withSpring(isRefreshing ? HOLD : 0, SPRING_PANEL));
  }, [isRefreshing, reduce, busy, y]);

  const runRefresh = async () => {
    haptic.light();
    setInternal(true);
    try {
      await onRefresh();
    } finally {
      setInternal(false);
      // A synchronous refresh can finish inside one batch, so release here too.
      if (!latestRefreshing.current) y.set(reduce ? 0 : withSpring(0, SPRING_PANEL));
    }
  };

  const native = Gesture.Native();
  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-20, 20])
    .simultaneousWithExternalGesture(native)
    .onStart(() => active.set(top.get() && !busy.get()))
    .onChange((e) => {
      if (!active.get()) return;
      const next = resisted(e.translationY);
      y.set(next);
      const st: PullStatus = next >= THRESHOLD ? 'ready' : 'pulling';
      if (st !== reported.get()) {
        reported.set(st);
        scheduleOnRN(setPullStatus, st);
      }
    })
    .onFinalize(() => {
      if (!active.get()) return;
      active.set(false);
      const go = y.get() >= THRESHOLD && !busy.get();
      reported.set('idle');
      scheduleOnRN(setPullStatus, 'idle');
      if (go) {
        busy.set(true);
        y.set(reduce ? HOLD : withSpring(HOLD, SPRING_PANEL));
        scheduleOnRN(runRefresh);
      } else {
        y.set(reduce ? 0 : withSpring(0, SPRING_PANEL));
      }
    });

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.y;
    top.set(offset <= 0);
    // While pulled open the list stays pinned to the top, so reversing the pull doesn't also scroll it.
    if (offset > 0 && y.get() > 0 && active.get()) scroll.current?.scrollTo({ y: 0, animated: false });
    onScroll?.(e);
  };

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateY: reduce ? 0 : y.get() }] }));
  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, 10, THRESHOLD], [0, 0.45, 1], Extrapolation.CLAMP),
    transform: [{ scale: reduce ? 1 : interpolate(y.get(), [0, THRESHOLD], [0.86, 1], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={[s.root, { backgroundColor: c.bg }, style]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[s.fill, contentStyle]}>
          <GestureDetector gesture={native}>
            <ScrollView
              {...rest}
              ref={scroll}
              bounces={false}
              overScrollMode="never"
              scrollEventThrottle={16}
              onScroll={handleScroll}
              accessibilityState={{ busy: isRefreshing }}
            >
              {children}
            </ScrollView>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
      <Animated.View style={[s.indicator, indicatorStyle]}>
        <LinearGradient colors={[c.bg, `${c.bg}F2`, `${c.bg}00`]} style={StyleSheet.absoluteFill} />
        <RefreshBuddy y={y} status={status} reduce={reduce} />
        <View style={s.labelSlot}>
          <Animated.Text
            key={status === 'idle' ? 'pulling' : status}
            entering={labelIn}
            exiting={labelOut}
            accessibilityLiveRegion="polite"
            style={[s.label, { color: c.muted }]}
          >
            {LABELS[status]}
          </Animated.Text>
        </View>
      </Animated.View>
    </View>
  );
}

const LABEL_SWAP = { duration: 160, easing: EASE_OUT };
const labelIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 3 }] },
    animations: { opacity: withTiming(1, LABEL_SWAP), transform: [{ translateY: withTiming(0, LABEL_SWAP) }] },
  };
};
const labelOut: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: { opacity: withTiming(0, LABEL_SWAP), transform: [{ translateY: withTiming(-3, LABEL_SWAP) }] },
  };
};

const LOOP_HALF = { duration: 450, easing: EASE_IN_OUT };
const LOOP_QUARTER = { duration: 225, easing: EASE_IN_OUT };
const LOOP = { duration: 900, easing: EASE_IN_OUT };
const PULSE_HALF = { duration: 600, easing: EASE_IN_OUT };
const FADE = { duration: 150 };
const instant = (v: number) => withTiming(v, { duration: 0 });

function RefreshBuddy({ y, status, reduce }: { y: SharedValue<number>; status: Status; reduce: boolean }) {
  const c = useColors();
  const bodyY = useSharedValue(0);
  const bodyRot = useSharedValue(0);
  const bodyScale = useSharedValue(1);
  const pulse = useSharedValue(1);
  const orbit = useSharedValue(-35);
  const eyes = useSharedValue(1);
  const ready = status === 'ready';
  const refreshing = status === 'refreshing';

  useEffect(() => {
    if (refreshing && reduce) {
      pulse.set(withSequence(instant(0.55), withRepeat(withSequence(withTiming(1, PULSE_HALF), withTiming(0.55, PULSE_HALF)), -1)));
    } else if (refreshing) {
      bodyY.set(withRepeat(withSequence(withTiming(-2, LOOP_HALF), withTiming(0, LOOP_HALF)), -1));
      bodyRot.set(withSequence(instant(-3), withRepeat(withSequence(withTiming(3, LOOP_HALF), withTiming(-3, LOOP_HALF)), -1)));
      bodyScale.set(withSpring(1, SPRING_SWAP));
      orbit.set(withSequence(instant(0), withRepeat(withTiming(360, LOOP), -1)));
      eyes.set(withRepeat(withSequence(withTiming(1, LOOP_QUARTER), withTiming(0.15, LOOP_QUARTER), withTiming(1, LOOP_QUARTER), withTiming(1, LOOP_QUARTER)), -1));
    } else {
      pulse.set(withTiming(1, FADE));
      bodyY.set(withSpring(0, SPRING_SWAP));
      bodyRot.set(withSpring(0, SPRING_SWAP));
      bodyScale.set(withSpring(ready ? 1.08 : 1, SPRING_SWAP));
      orbit.set(withSpring(ready ? 0 : -35, SPRING_SWAP));
      eyes.set(withSpring(ready ? 1.18 : 1, SPRING_SWAP));
    }
  }, [ready, refreshing, reduce, bodyY, bodyRot, bodyScale, pulse, orbit, eyes]);

  const pullStyle = useAnimatedStyle(() => {
    if (reduce) return {};
    const p = interpolate(y.get(), [0, THRESHOLD], [0, 1], Extrapolation.CLAMP);
    return {
      transform: [
        { translateY: interpolate(p, [0, 1], [-7, 0]) },
        { rotate: `${interpolate(p, [0, 1], [-10, 0])}deg` },
        { scaleY: interpolate(p, [0, 0.55, 1], [0.68, 1.1, 0.92]) },
      ],
    };
  });
  const svgStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: pulse.get() }
      : { transform: [{ translateY: bodyY.get() }, { rotate: `${bodyRot.get()}deg` }, { scale: bodyScale.get() }] },
  );
  const orbitStyle = useAnimatedStyle(() => ({
    opacity: withTiming(ready || refreshing ? 1 : 0, FADE),
    transform: reduce ? [] : [{ rotate: `${orbit.get()}deg` }],
  }));
  const eyesStyle = useAnimatedStyle(() => ({ transform: reduce ? [] : [{ scaleY: eyes.get() }] }));
  const flatStyle = useAnimatedStyle(() => ({ opacity: withTiming(ready || refreshing ? 0 : 1, FADE) }));
  const smileStyle = useAnimatedStyle(() => ({ opacity: withTiming(ready ? 1 : 0, FADE) }));
  const ohStyle = useAnimatedStyle(() => ({ opacity: withTiming(refreshing ? 1 : 0, FADE) }));

  const layer = (style: object, svg: ReactNode) => (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={36} height={36} viewBox="0 0 36 36">
        {svg}
      </Svg>
    </Animated.View>
  );

  return (
    <Animated.View style={[s.buddy, pullStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, svgStyle]}>
        {layer(orbitStyle, (
          <>
            <Path d="M18 2.5a15.5 15.5 0 0 1 12.7 6.6" fill="none" stroke={c.muted} strokeWidth={1.5} strokeLinecap="round" />
            <Circle cx={31.3} cy={10.2} r={2.2} fill={c.text} />
          </>
        ))}
        {layer({}, <Rect x={7} y={7} width={22} height={22} rx={9} fill={c.text} />)}
        {layer([s.eyes, eyesStyle], (
          <>
            <Circle cx={14.2} cy={16} r={1.45} fill={c.bg} />
            <Circle cx={21.8} cy={16} r={1.45} fill={c.bg} />
          </>
        ))}
        {layer(flatStyle, <Path d="M14.5 21h7" fill="none" stroke={c.bg} strokeWidth={1.5} strokeLinecap="round" />)}
        {layer(smileStyle, <Path d="M14 20.5c1 2.4 7 2.4 8 0" fill="none" stroke={c.bg} strokeWidth={1.5} strokeLinecap="round" />)}
        {layer(ohStyle, <Circle cx={18} cy={21} r={1.6} fill={c.bg} />)}
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    pointerEvents: 'none',
  },
  buddy: { width: 36, height: 36, transformOrigin: 'bottom' },
  eyes: { transformOrigin: [18, 16, 0] },
  labelSlot: { height: 16, minWidth: 96 },
  label: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: font.medium, fontSize: 11 },
});
