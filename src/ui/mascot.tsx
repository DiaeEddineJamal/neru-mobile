// Neru's mascot in the accent theme's color, like the launcher icon (scripts/theme-icons.py makes the variants).
// <Mascot> brings it to life like the desktop's (app/src/components/neru/Mascot.tsx): a blink now and then, a
// glance, a wink with a sparkle, a hop, a sway, and a jump with a spin or a wiggle when tapped. The eyes are part
// of the picture, so blinks and winks lower a lid in the body's color over them.
import { Image, type ImageProps } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { useStore } from '@/store';

const MASCOTS: Record<string, number> = {
  moss: require('@/assets/images/neru-mascot.png'),
  glacier: require('@/assets/images/themes/glacier/mascot.png'),
  heather: require('@/assets/images/themes/heather/mascot.png'),
  terracotta: require('@/assets/images/themes/terracotta/mascot.png'),
  saffron: require('@/assets/images/themes/saffron/mascot.png'),
  tidepool: require('@/assets/images/themes/tidepool/mascot.png'),
  twilight: require('@/assets/images/themes/twilight/mascot.png'),
};

// The body's average color in each theme's picture, sampled from the PNGs: the eyelids are painted in it.
const BODY: Record<string, string> = {
  moss: '#799178',
  glacier: '#88acb5',
  heather: '#c3a0b8',
  terracotta: '#d39f8a',
  saffron: '#dabc7c',
  tidepool: '#7ab4a6',
  twilight: '#a4b1ce',
};

export function MascotImage(props: Omit<ImageProps, 'source'>) {
  const palette = useStore(s => s.settings.palette);
  return <Image {...props} source={MASCOTS[palette ?? 'moss'] ?? MASCOTS.moss} />;
}

// Where the eyes sit in the picture, in thousandths of its side (measured on the PNGs).
const EYES = [
  { x: 545, y: 386, w: 67, h: 185 },
  { x: 695, y: 379, w: 67, h: 174 },
];
const LID_PAD = 10;
// A closed eye keeps a sliver showing, like the desktop's scaleY(.06).
const LID_CLOSED = 0.93;

// The desktop's keyframe curves.
const EASE = Easing.inOut(Easing.ease);
const HOP_EASE = Easing.bezier(0.22, 0.8, 0.35, 1);
const SETTLE = { stiffness: 380, damping: 14, mass: 0.6 };

type Idle = 'blink' | 'look-left' | 'look-right' | 'twinkle' | 'hop' | 'sway' | 'bob';
const IDLE: Idle[] = ['blink', 'blink', 'look-left', 'look-right', 'twinkle', 'hop', 'sway', 'bob'];
type Tap = 'jump-spin' | 'wiggle' | 'hop' | 'twinkle';
const TAPS: Tap[] = ['jump-spin', 'wiggle', 'jump-spin', 'hop', 'twinkle'];

const pick = <T,>(items: T[], not?: T) => {
  const choices = items.filter(x => x !== not);
  return choices[Math.floor(Math.random() * choices.length)] ?? items[0];
};

type Motion = {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  sx: SharedValue<number>;
  sy: SharedValue<number>;
  rot: SharedValue<number>;
  spin: SharedValue<number>;
  lidL: SharedValue<number>;
  lidR: SharedValue<number>;
  spark: SharedValue<number>;
};

const ms = (total: number, share: number) => Math.round(total * share);

function blink(lid: SharedValue<number>, delay = 0) {
  lid.set(withDelay(delay, withSequence(withTiming(LID_CLOSED, { duration: 70 }), withTiming(LID_CLOSED, { duration: 60 }), withTiming(0, { duration: 90 }))));
}

// Desktop "twinkle", 1.15s: the right eye winks (closed 43–58%) while a sparkle turns in beside it (44–58%).
function twinkle(m: Motion) {
  const T = 1150;
  m.lidR.set(withSequence(withDelay(ms(T, 0.3), withTiming(LID_CLOSED, { duration: ms(T, 0.13), easing: EASE })), withTiming(LID_CLOSED, { duration: ms(T, 0.15) }), withTiming(0, { duration: ms(T, 0.12), easing: EASE })));
  m.spark.set(withSequence(withDelay(ms(T, 0.27), withTiming(1, { duration: ms(T, 0.17), easing: EASE })), withTiming(1, { duration: ms(T, 0.14) }), withTiming(0, { duration: ms(T, 0.14), easing: EASE })));
}

// Desktop "hop", 0.95s: crouch, rise 9%, land with a little squash.
function hop(m: Motion) {
  const T = 950;
  const step = (share: number, ty: number, sx: number, sy: number) => {
    const cfg = { duration: ms(T, share), easing: HOP_EASE };
    return [withTiming(ty, cfg), withTiming(sx, cfg), withTiming(sy, cfg)] as const;
  };
  const steps = [step(0.18, 0.03, 1.03, 0.96), step(0.3, -0.09, 0.98, 1.03), step(0.26, 0, 1.02, 0.98), step(0.26, 0, 1, 1)];
  m.ty.set(withSequence(...steps.map(s => s[0])));
  m.sx.set(withSequence(...steps.map(s => s[1])));
  m.sy.set(withSequence(...steps.map(s => s[2])));
}

function play(m: Motion, kind: Idle | Tap) {
  switch (kind) {
    case 'blink':
      blink(m.lidL);
      blink(m.lidR, 15);
      // Now and then a double blink.
      if (Math.random() < 0.3) {
        blink(m.lidL, 320);
        blink(m.lidR, 335);
      }
      return;
    case 'look-left':
    case 'look-right': {
      // Desktop "look", 1.3s: out by 25%, held to 68%, back. The eyes are painted on, so the whole body leans.
      const dir = kind === 'look-left' ? -1 : 1;
      m.tx.set(withSequence(withTiming(0.03 * dir, { duration: 325, easing: EASE }), withTiming(0.03 * dir, { duration: 559 }), withTiming(0, { duration: 416, easing: EASE })));
      m.rot.set(withSequence(withTiming(3 * dir, { duration: 325, easing: EASE }), withTiming(3 * dir, { duration: 559 }), withTiming(0, { duration: 416, easing: EASE })));
      return;
    }
    case 'twinkle':
      return twinkle(m);
    case 'hop':
      return hop(m);
    case 'sway':
      // Desktop "sway", 1.2s: -5° at 25%, +5° at 65%, upright.
      m.rot.set(withSequence(withTiming(-5, { duration: 300, easing: EASE }), withTiming(5, { duration: 480, easing: EASE }), withTiming(0, { duration: 420, easing: EASE })));
      return;
    case 'bob':
      m.ty.set(withSequence(withTiming(-0.025, { duration: 700, easing: EASE }), withTiming(0, { duration: 700, easing: EASE }), withTiming(-0.015, { duration: 600, easing: EASE }), withTiming(0, { duration: 600, easing: EASE })));
      return;
    case 'wiggle':
      m.rot.set(withSequence(...[-10, 10, -8, 8, -5, 4, 0].map(deg => withTiming(deg, { duration: 85, easing: EASE }))));
      m.sy.set(withSequence(withTiming(0.94, { duration: 120 }), withSpring(1, SETTLE)));
      m.sx.set(withSequence(withTiming(1.06, { duration: 120 }), withSpring(1, SETTLE)));
      blink(m.lidL, 120);
      blink(m.lidR, 135);
      return;
    case 'jump-spin': {
      // Squash, stretch up into a jump with a full turn, squash on landing, spring back.
      m.sy.set(withSequence(withTiming(0.82, { duration: 130, easing: EASE }), withTiming(1.12, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 300 }), withTiming(0.86, { duration: 90 }), withSpring(1, SETTLE)));
      m.sx.set(withSequence(withTiming(1.14, { duration: 130, easing: EASE }), withTiming(0.9, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 300 }), withTiming(1.12, { duration: 90 }), withSpring(1, SETTLE)));
      m.ty.set(withSequence(withTiming(0.04, { duration: 130, easing: EASE }), withTiming(-0.3, { duration: 300, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 250, easing: Easing.in(Easing.quad) }), withTiming(0, { duration: 200 })));
      m.spin.set(withSequence(withTiming(0, { duration: 150 }), withTiming(360, { duration: 520, easing: EASE }), withTiming(0, { duration: 0 })));
      m.spark.set(withSequence(withDelay(560, withTiming(1, { duration: 160 })), withTiming(0, { duration: 260 })));
      return;
    }
  }
}

type Props = {
  size: number;
  /** Tapping it plays a fun animation. */
  interactive?: boolean;
  /** Does something small every few seconds (blinks, glances, hops). */
  idle?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** The animated mascot. Respects reduced motion: then it only blinks when tapped. */
export function Mascot({ size, interactive = false, idle = true, style }: Props) {
  const palette = useStore(s => s.settings.palette) ?? 'moss';
  const reduce = useReducedMotion();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const rot = useSharedValue(0);
  const spin = useSharedValue(0);
  const lidL = useSharedValue(0);
  const lidR = useSharedValue(0);
  const spark = useSharedValue(0);
  // Shared values never change identity, so this object is stable.
  const m = useMemo<Motion>(() => ({ tx, ty, sx, sy, rot, spin, lidL, lidR, spark }), [tx, ty, sx, sy, rot, spin, lidL, lidR, spark]);
  const last = useRef<string>('');

  useEffect(() => {
    if (!idle || reduce) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        const kind = pick(IDLE, last.current as Idle);
        last.current = kind;
        play(m, kind);
        next();
      }, 4000 + Math.random() * 6000);
    };
    next();
    return () => clearTimeout(timer);
  }, [idle, reduce, m]);

  const onTap = () => {
    haptic.light();
    if (reduce) {
      blink(lidL);
      blink(lidR, 15);
      return;
    }
    // A tap interrupts whatever is playing.
    for (const v of [tx, ty, rot, spin, sx, sy]) {
      cancelAnimation(v);
      v.set(v === sx || v === sy ? 1 : 0);
    }
    const kind = pick(TAPS, last.current as Tap);
    last.current = kind;
    play(m, kind);
  };

  const body = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.get() * size },
      { translateY: ty.get() * size },
      { rotate: `${rot.get()}deg` },
      { scaleX: sx.get() },
      { scaleY: sy.get() },
    ],
  }));
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));
  const sparkStyle = useAnimatedStyle(() => {
    const v = spark.get();
    return { opacity: v, transform: [{ scale: 0.25 + 0.75 * v }, { rotate: `${-25 + 40 * v}deg` }] };
  });

  const unit = size / 1000;
  const lidColor = BODY[palette] ?? BODY.moss;
  const figure = (
    <Animated.View style={[{ width: size, height: size, transformOrigin: '55% 85%' }, body]}>
      <Animated.View style={[StyleSheet.absoluteFill, spinStyle]}>
        <MascotImage style={StyleSheet.absoluteFill} contentFit="contain" accessibilityIgnoresInvertColors />
        {EYES.map((eye, i) => (
          <Lid key={i} lid={i === 0 ? lidL : lidR} color={lidColor} left={(eye.x - LID_PAD) * unit} top={(eye.y - LID_PAD) * unit} width={(eye.w + 2 * LID_PAD) * unit} height={(eye.h + 2 * LID_PAD) * unit} />
        ))}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 785 * unit, top: 320 * unit, width: 44 * unit, height: 44 * unit }, sparkStyle]}>
          <Svg width="100%" height="100%" viewBox="983 402 54 54">
            <Path d="M 1010 402 L 1017 422 L 1037 429 L 1017 436 L 1010 456 L 1003 436 L 983 429 L 1003 422 Z" fill="#f5f4ef" />
          </Svg>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );

  if (!interactive) {
    return <View style={[{ width: size, height: size }, style]} accessible accessibilityRole="image" accessibilityLabel={t('Neru spirit')}>{figure}</View>;
  }
  return (
    <Pressable onPress={onTap} style={[{ width: size, height: size }, style]} accessibilityRole="button" accessibilityLabel={t('Animate Neru mascot')} hitSlop={8}>
      {figure}
    </Pressable>
  );
}

/** A body-colored lid that slides down over a painted eye: an eye-shaped oval, revealed from the top. */
function Lid({ lid, color, left, top, width, height }: { lid: SharedValue<number>; color: string; left: number; top: number; width: number; height: number }) {
  const clip = useAnimatedStyle(() => ({ height: lid.get() * height }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left, top, width, overflow: 'hidden' }, clip]}>
      <View style={{ width, height, borderRadius: width / 2, backgroundColor: color }} />
    </Animated.View>
  );
}
