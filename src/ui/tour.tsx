// Port of the desktop walkthrough (app/src/components/neru/Tour.tsx): dims the screen, cuts a hole around one
// control, explains it in a card beside it, then glides to the next. Steps whose control is not on screen are
// skipped, and a step with `enter` (opening the drawer) is trusted to bring its control.
// Phone additions, each for a reason: a breathing ring draws the eye to the one control that matters (isolation
// effect), the card points at it (proximity), and Skip, Back, the close button and Android back are always there
// (user control and freedom).
// Everything that moves is a plain native view animated on the UI thread: the hole is one view whose very thick
// border is the dimming, so its inside is the rounded cut-out. (An SVG mask redrew the whole screen every frame.)
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, BackHandler, Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { haptic } from '@/haptics';
import { font, fs, TAP, useColors } from '@/theme';
import { SPRING_LAYOUT } from '@/ui/motion';

/** One stop on a walkthrough. `target` is a `TourTarget` name; without one the card sits centred. */
export type TourStep = { target?: string; title: string; body: string; enter?: () => void };
type Box = { x: number; y: number; width: number; height: number };

const PAD = 6;
const GAP = 16;
const MARGIN = 16;
const CARET = 12;
const RADIUS = 14;
/** The dimming around the hole: far wider than any phone screen. */
const SCRIM = 2400;
const targets = new Map<string, View>();

/** Marks a control the walkthrough can point at. Without a name it renders its children alone. */
export function TourTarget({ name, children, style }: { name?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (!name) return <>{children}</>;
  return (
    <View
      collapsable={false}
      style={style}
      ref={view => {
        if (!view) return;
        targets.set(name, view);
        return () => { if (targets.get(name) === view) targets.delete(name); };
      }}
    >
      {children}
    </View>
  );
}

const measure = (view: View | null | undefined) =>
  new Promise<Box | null>(resolve => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => resolve(width || height ? { x, y, width, height } : null));
  });

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: (finished: boolean) => void }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const root = useRef<View>(null);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(220);
  const step = steps[index];
  const last = index === steps.length - 1;

  // Below the control when it fits, otherwise above it; centred when there is no control.
  const fitsBelow = !!spot && spot.y + spot.height + GAP + cardH + insets.bottom + MARGIN <= H;
  const top = !spot ? (H - cardH) / 2 : fitsBelow ? spot.y + spot.height + GAP : Math.max(insets.top + MARGIN, spot.y - GAP - cardH);
  const cardW = W - MARGIN * 2;
  const caretX = spot ? Math.min(Math.max(spot.x + spot.width / 2 - MARGIN - CARET / 2, 24), cardW - 24 - CARET) : 0;

  // The hole starts as a point in the middle of the screen, so the first spotlight opens out from there.
  const hole = { x: useSharedValue(W / 2), y: useSharedValue(H / 2), w: useSharedValue(0), h: useSharedValue(0) };
  const cardTop = useSharedValue(H / 2);
  const pulse = useSharedValue(0);
  const holeStyle = useAnimatedStyle(() => ({ width: hole.w.get() + SCRIM * 2, height: hole.h.get() + SCRIM * 2, transform: [{ translateX: hole.x.get() - SCRIM }, { translateY: hole.y.get() - SCRIM }] }));
  const ringStyle = useAnimatedStyle(() => ({
    width: hole.w.get(), height: hole.h.get(),
    opacity: hole.w.get() > 1 ? 0.9 * (1 - pulse.get()) : 0,
    transform: [{ translateX: hole.x.get() }, { translateY: hole.y.get() }, { scale: 1 + 0.12 * pulse.get() }],
  }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: cardTop.get() }] }));

  // Steps whose control is missing (a screen that is not open) are passed over.
  const go = useCallback((from: number, direction: 1 | -1) => {
    let next = from;
    while (next >= 0 && next < steps.length) {
      steps[next].enter?.();
      if (!steps[next].target || steps[next].enter || targets.has(steps[next].target!)) break;
      next += direction;
    }
    if (next >= steps.length) { haptic.success(); return onClose(true); }
    if (next < 0) return;
    haptic.select();
    setIndex(next);
  }, [steps, onClose]);

  // Measured against the overlay itself, and again as the drawer finishes sliding.
  useEffect(() => {
    if (!step) return;
    let live = true;
    const update = async () => {
      const [origin, box] = await Promise.all([measure(root.current), measure(step.target ? targets.get(step.target) : null)]);
      if (!live) return;
      setSpot(box && origin ? { x: box.x - origin.x - PAD, y: box.y - origin.y - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 } : null);
    };
    void update();
    const timers = [220, 480].map(ms => setTimeout(update, ms));
    AccessibilityInfo.announceForAccessibility(`${step.title}. ${step.body}`);
    return () => { live = false; timers.forEach(clearTimeout); };
  }, [step]);

  useEffect(() => {
    const glide = (v: number) => (reduce ? withTiming(v, { duration: 0 }) : withSpring(v, SPRING_LAYOUT));
    const next = spot ?? { x: W / 2, y: H / 2, width: 0, height: 0 };
    hole.x.set(glide(next.x)); hole.y.set(glide(next.y)); hole.w.set(glide(next.width)); hole.h.set(glide(next.height));
    cardTop.set(glide(top));
  }, [spot, top, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (reduce) return;
    pulse.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(false), true));
    return () => sub.remove();
  }, [onClose]);

  if (!step) return null;
  const centred = !step.target;
  return (
    <Animated.View ref={root} entering={reduce ? undefined : FadeIn.duration(220)} exiting={reduce ? undefined : FadeOut.duration(180)} style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      {/* Swallows taps on the dimmed app, the spotlit control included; only the card acts. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => {}} accessible={false} />
      <Animated.View pointerEvents="none" style={[s.hole, holeStyle]} />
      <Animated.View pointerEvents="none" style={[s.ring, { borderColor: c.sage }, ringStyle]} />

      <Animated.View onLayout={e => setCardH(e.nativeEvent.layout.height)} style={[s.card, { top: 0, left: MARGIN, width: cardW, backgroundColor: c.surface2, borderColor: c.border }, cardStyle]}>
        {spot ? <View style={[s.caret, { left: caretX, backgroundColor: c.surface2, borderColor: c.border }, fitsBelow ? { top: -CARET / 2, borderRightWidth: 0, borderBottomWidth: 0 } : { bottom: -CARET / 2, borderLeftWidth: 0, borderTopWidth: 0 }]} /> : null}
        <Animated.View key={index} entering={reduce ? undefined : FadeInDown.duration(220)} style={[{ gap: 6 }, centred ? s.centred : { paddingRight: 28 }]}>
          {centred ? <Image source={require('@/assets/images/neru-mascot.png')} style={s.mascot} contentFit="contain" accessibilityIgnoresInvertColors /> : null}
          <Text style={[s.eyebrow, { color: c.sage }]}>{centred && index === 0 ? 'Walkthrough' : `Step ${index + 1} of ${steps.length}`}</Text>
          <Text accessibilityRole="header" style={[s.title, { color: c.text }, centred && { textAlign: 'center', fontSize: 30, lineHeight: 34 }]}>{step.title}</Text>
          <Text style={[s.body, { color: c.secondary }, centred && { textAlign: 'center' }]}>{step.body}</Text>
        </Animated.View>
        <View style={[s.dots, centred && { alignSelf: 'center' }]} accessibilityLabel={`Step ${index + 1} of ${steps.length}`}>
          {steps.map((_, i) => <View key={i} style={[s.dot, { backgroundColor: i <= index ? c.moss : c.surface3, width: i === index ? 18 : 6 }]} />)}
        </View>
        <View style={s.actions}>
          {!last ? <Pressable onPress={() => onClose(false)} accessibilityRole="button" hitSlop={8} style={s.skip}><Text style={[s.skipText, { color: c.muted }]}>Skip tour</Text></Pressable> : null}
          <View style={{ flex: 1 }} />
          {index > 0 ? <Pressable onPress={() => go(index - 1, -1)} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [s.back, { backgroundColor: c.surface3, opacity: pressed ? 0.7 : 1 }]}><Icon name="chevronLeft" size={18} color={c.text} /></Pressable> : null}
          <Pressable onPress={() => go(index + 1, 1)} accessibilityRole="button" style={({ pressed }) => [s.next, { backgroundColor: c.mossAction, transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
            <Text style={[s.nextText, { color: c.onAction }]}>{last ? 'Start chatting' : index === 0 && centred ? 'Show me around' : 'Next'}</Text>
            {!last ? <Icon name="chevronRight" size={16} color={c.onAction} /> : null}
          </Pressable>
        </View>
        {!last ? <Pressable onPress={() => onClose(false)} accessibilityRole="button" accessibilityLabel="Close the walkthrough" style={s.close}><Icon name="close" size={16} color={c.muted} /></Pressable> : null}
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  hole: { position: 'absolute', left: 0, top: 0, borderWidth: SCRIM, borderRadius: SCRIM + RADIUS, borderColor: 'rgba(8,10,8,0.66)' },
  ring: { position: 'absolute', left: 0, top: 0, borderWidth: 2, borderRadius: RADIUS + 2 },
  card: { position: 'absolute', padding: 20, gap: 16, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, elevation: 16, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  caret: { position: 'absolute', width: CARET, height: CARET, borderWidth: StyleSheet.hairlineWidth, transform: [{ rotate: '45deg' }] },
  centred: { alignItems: 'center', paddingTop: 4 },
  mascot: { width: 64, height: 64, marginBottom: 4 },
  eyebrow: { fontFamily: font.medium, fontSize: fs.xs, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { fontFamily: font.serif, fontSize: 26, lineHeight: 30 },
  body: { fontFamily: font.sans, fontSize: fs.sm, lineHeight: 21 },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skip: { minHeight: TAP, justifyContent: 'center' },
  skipText: { fontFamily: font.medium, fontSize: fs.sm },
  back: { width: TAP, height: TAP, borderRadius: TAP / 2, alignItems: 'center', justifyContent: 'center' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 4, height: TAP, paddingHorizontal: 20, borderRadius: TAP / 2 },
  nextText: { fontFamily: font.semibold, fontSize: fs.sm },
  close: { position: 'absolute', top: 6, right: 6, width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
});
