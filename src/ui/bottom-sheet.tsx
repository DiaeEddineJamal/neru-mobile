// Port of beui.dev/components/motion/bottom-sheet, styled like Claude's app sheets: a grabber, a header with the
// close X (or a back arrow for a sub-page, `onBack`) on the left and a centered bold title, a 32px top radius, the
// near-black surface for content cards (c.surface2) to sit on, and a fading backdrop.
// The panel opens on SPRING_PANEL and closes on beUI's 0.5s EASE_DRAWER glide; the drag keeps beUI's elastic
// (0.4 down, 0.02 up) and dismiss rules (fling > 600px/s or drag > 120px). Haptics: a light tap as it opens, a
// selection tick when it is dragged shut. Not ported: snap points (one content-sized height, capped by maxHeight,
// or the whole cap with `fullHeight`), the scrim's backdrop blur, Escape key and body scroll lock (the Modal covers
// both). The whole header is the drag handle, not only the pill, so it is a usable touch target.
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { IconButton } from '@/components/Icon';
import { haptic } from '@/haptics';
import { t } from '@/i18n';
import { font, useColors, useScheme } from '@/theme';
import { EASE_DRAWER, SPRING_PANEL } from '@/ui/motion';

const DRAWER = { duration: 500, easing: EASE_DRAWER };
const DRAWER_REDUCED = { duration: 180, easing: EASE_DRAWER };
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 600;
// Motion's spring back to the drag constraint when dragElastic is set.
const SNAP_BACK = { stiffness: 200, damping: 40, mass: 1 };

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  maxHeight?: number;
  /** Runs once the exit glide has landed and the sheet is gone. */
  onDismiss?: () => void;
  /** A sub-page inside the sheet: the header shows a back arrow that calls this instead of the close X. */
  onBack?: () => void;
  /** Take the whole height cap (85% of the screen, or maxHeight) instead of fitting the content. */
  fullHeight?: boolean;
};

export function BottomSheet({ open, onClose, title, children, maxHeight, onDismiss, onBack, fullHeight }: Props) {
  const c = useColors();
  const light = useScheme() === 'light';
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const reduce = useReducedMotion();
  // Stay mounted through the exit glide; unmount when it lands.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  const finishDismiss = useCallback(() => { setMounted(false); onDismiss?.(); }, [onDismiss]);

  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const sheetH = useSharedValue(screenH);
  // The sheet alone handles the keyboard: the Modal fills the screen, so the keyboard's height is exactly how far
  // the sheet rises, and the sheet gets shorter by as much so a tall one still fits above it. (A keyboard-aware
  // scroll view inside as well added the keyboard's height a second time and scrolled the field out of sight.)
  const keyboard = useReanimatedKeyboardAnimation();
  const cap = maxHeight ?? screenH * 0.85;
  const dockStyle = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, -keyboard.height.get()) }));
  const capStyle = useAnimatedStyle(() => {
    const h = Math.min(cap, screenH - insets.top - 16 + keyboard.height.get());
    return fullHeight ? { height: h, maxHeight: h } : { maxHeight: h };
  });

  // The haptic plays once per opening, not on every re-render while open.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!mounted) return;
    if (open) {
      if (!wasOpen.current) haptic.light();
      wasOpen.current = true;
      drag.set(0);
      progress.set(reduce ? withTiming(1, DRAWER_REDUCED) : withSpring(1, SPRING_PANEL));
    } else {
      wasOpen.current = false;
      progress.set(withTiming(0, reduce ? DRAWER_REDUCED : DRAWER, (done) => {
        if (done) scheduleOnRN(finishDismiss);
      }));
    }
  }, [open, mounted, reduce, progress, drag, finishDismiss]);

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onChange((e) => drag.set(e.translationY * (e.translationY > 0 ? 0.4 : 0.02)))
    .onEnd((e) => {
      if (e.velocityY > DISMISS_VELOCITY || e.translationY > DISMISS_DISTANCE) {
        scheduleOnRN(haptic.select);
        scheduleOnRN(onClose);
      } else drag.set(withSpring(0, SNAP_BACK));
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, progress.get())) }));
  const panelStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: progress.get(), transform: [{ translateY: drag.get() }] }
      : { transform: [{ translateY: (1 - progress.get()) * sheetH.get() + drag.get() }] },
  );

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onBack ?? onClose}>
      <GestureHandlerRootView style={s.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: light ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.55)' }, scrimStyle]}>
          <Pressable style={s.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close bottom sheet')} />
        </Animated.View>
        <Animated.View style={[s.fill, s.dock, dockStyle]}>
          <Animated.View
            accessibilityViewIsModal
            accessibilityLabel={title ?? t('Bottom sheet')}
            onLayout={(e) => sheetH.set(e.nativeEvent.layout.height)}
            style={[s.panel, { backgroundColor: c.surface, borderColor: light ? c.border : 'transparent' }, capStyle, panelStyle]}
          >
            <GestureDetector gesture={pan}>
              <View>
                <View style={s.grabberRow}>
                  <View style={[s.grabber, { backgroundColor: c.muted }]} />
                </View>
                <View style={s.titleRow}>
                  {onBack ? (
                    <IconButton name="back" label={t('Back')} color={c.text} size={24} onPress={onBack} />
                  ) : (
                    <IconButton name="close" label={t('Close bottom sheet')} color={c.text} size={24} onPress={onClose} />
                  )}
                  <Text accessibilityRole="header" numberOfLines={1} style={[s.title, { color: c.text }]}>{title}</Text>
                  <View style={s.side} />
                </View>
              </View>
            </GestureDetector>
            <ScrollView
              style={s.body}
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 + insets.bottom }}
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
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
  },
  grabberRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  grabber: { height: 5, width: 40, borderRadius: 3, opacity: 0.45 },
  // The X sits where Claude's does; an empty slot of the same width on the right keeps the title centred.
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, minHeight: 56 },
  title: { flex: 1, textAlign: 'center', fontFamily: font.bold, fontSize: 20 },
  side: { width: 48 },
  body: { flexShrink: 1 },
});
