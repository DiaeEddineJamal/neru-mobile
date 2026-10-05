// Port of beui.dev/components/motion/bottom-sheet
// Same vaul-style 0.5s EASE_DRAWER glide for panel and scrim, same elastic drag
// (0.4 down, 0.02 up), same dismiss rules (fling > 600px/s or drag > 120px).
// Not ported: snap points (one content-sized height, capped by maxHeight), the
// scrim's backdrop blur (no blur view installed, so the scrim is a bit denser),
// Escape key and body scroll lock (the Modal covers both). The drag handle is the
// whole header, not only the 6px pill, so it is a usable touch target.
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { font, fs, useColors } from '@/theme';
import { EASE_DRAWER } from '@/ui/motion';

const DRAWER = { duration: 500, easing: EASE_DRAWER };
const DRAWER_REDUCED = { duration: 180, easing: EASE_DRAWER };
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 600;
// Motion's spring back to the drag constraint when dragElastic is set.
const SNAP_BACK = { stiffness: 200, damping: 40, mass: 1 };

type Props = { open: boolean; onClose: () => void; title?: string; children?: ReactNode; maxHeight?: number };

export function BottomSheet({ open, onClose, title, children, maxHeight }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const reduce = useReducedMotion();
  // Stay mounted through the exit glide; unmount when it lands.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const sheetH = useSharedValue(screenH);
  // The sheet alone handles the keyboard: the Modal fills the screen, so the keyboard's height is exactly how far
  // the sheet rises, and the sheet gets shorter by as much so a tall one still fits above it. (A keyboard-aware
  // scroll view inside as well added the keyboard's height a second time and scrolled the field out of sight.)
  const keyboard = useReanimatedKeyboardAnimation();
  const cap = maxHeight ?? screenH * 0.85;
  const dockStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -keyboard.height.get()) }));
  const capStyle = useAnimatedStyle(() => ({ maxHeight: Math.min(cap, screenH - insets.top - 16 + keyboard.height.get()) }));

  useEffect(() => {
    if (!mounted) return;
    const timing = reduce ? DRAWER_REDUCED : DRAWER;
    if (open) {
      drag.set(0);
      progress.set(withTiming(1, timing));
    } else {
      progress.set(withTiming(0, timing, (done) => {
        if (done) scheduleOnRN(setMounted, false);
      }));
    }
  }, [open, mounted, reduce, progress, drag]);

  const pan = Gesture.Pan()
    .onChange((e) => drag.set(e.translationY * (e.translationY > 0 ? 0.4 : 0.02)))
    .onEnd((e) => {
      if (e.velocityY > DISMISS_VELOCITY || e.translationY > DISMISS_DISTANCE) scheduleOnRN(onClose);
      else drag.set(withSpring(0, SNAP_BACK));
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const panelStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: progress.get(), transform: [{ translateY: drag.get() }] }
      : { transform: [{ translateY: (1 - progress.get()) * sheetH.get() + drag.get() }] },
  );

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={s.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: `${c.bg}99` }, scrimStyle]}>
          <Pressable style={s.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close bottom sheet" />
        </Animated.View>
        <Animated.View style={[s.fill, s.dock, dockStyle]}>
          <Animated.View
            accessibilityViewIsModal
            accessibilityLabel={title ?? 'Bottom sheet'}
            onLayout={(e) => sheetH.set(e.nativeEvent.layout.height)}
            style={[s.panel, { backgroundColor: c.bg, borderColor: c.border }, capStyle, panelStyle]}
          >
            <GestureDetector gesture={pan}>
              <View style={s.header}>
                <View style={s.grabberHit}>
                  <View style={[s.grabber, { backgroundColor: c.muted }]} />
                </View>
                {title ? (
                  <Text accessibilityRole="header" style={[s.title, { color: c.text }]}>
                    {title}
                  </Text>
                ) : null}
              </View>
            </GestureDetector>
            <ScrollView
              style={s.body}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + insets.bottom }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  dock: { justifyContent: 'flex-end', pointerEvents: 'box-none' },
  panel: {
    width: '100%',
    maxWidth: 672,
    alignSelf: 'center',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  grabberHit: { paddingVertical: 4 },
  grabber: { height: 6, width: 40, borderRadius: 3, opacity: 0.4 },
  title: { marginTop: 8, alignSelf: 'stretch', fontFamily: font.semibold, fontSize: fs.base },
  body: { flexShrink: 1 },
});
