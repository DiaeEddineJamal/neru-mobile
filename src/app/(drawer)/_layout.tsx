import { router, useFocusEffect } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AppTour, type DrawerControl } from '@/components/AppTour';
import { DrawerContent, sidebar, useSidebarOpen } from '@/components/DrawerContent';
import { IconButton } from '@/components/Icon';
import { ModelButton } from '@/components/ModelButton';
import { ModelSheet } from '@/components/ModelSheet';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { WhatsNew } from '@/components/WhatsNew';
import { t } from '@/i18n';
import { setDraftChat } from '@/store';
import { font, useColors } from '@/theme';
import { EASE_DRAWER } from '@/ui/motion';
import { TourTarget } from '@/ui/tour';

/** A full open or close; a gesture's release takes the remaining share of it. */
const OPEN_MS = 300;
/** Android's back gesture owns the outer ~30dp; a wider zone lets a swipe from just inside it open the sidebar. */
const EDGE = 110;
/** How far the chat drifts right under the sidebar, as a share of the screen: the parallax. */
const DRIFT = 0.28;
const FLING = 500;

const clamp = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

const newChat = () => (setDraftChat(null), router.navigate('/'));

export default function DrawerLayout() {
  const c = useColors();
  const { width: W } = useWindowDimensions();
  const reduce = useReducedMotion();
  const open = useSidebarOpen();
  const [drawer] = useState<DrawerControl>(() => ({ open: sidebar.open, close: sidebar.close }));

  // 0 closed, 1 open. `target` is where it is headed, so a release and the state change it causes animate once.
  const progress = useSharedValue(open ? 1 : 0);
  const target = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    const to = open ? 1 : 0;
    if (target.get() === to) return;
    target.set(to);
    progress.set(withTiming(to, { duration: reduce ? 160 : OPEN_MS, easing: EASE_DRAWER }));
  }, [open, reduce, progress, target]);

  // Worklets can only call plain JS functions on the RN thread, not methods that drag their object along
  // (capturing `Keyboard` made the gesture throw "Cannot copy value of type KeyboardImpl").
  const dismissKeyboard = () => Keyboard.dismiss();
  const setOpen = (next: boolean) => sidebar.set(next);
  const settle = (next: boolean) => {
    'worklet';
    const to = next ? 1 : 0;
    target.set(to);
    progress.set(withTiming(to, { duration: Math.max(140, OPEN_MS * Math.abs(to - progress.get())), easing: EASE_DRAWER }));
    scheduleOnRN(setOpen, next);
  };

  // A right swipe from the left edge of the chat opens it; a left swipe anywhere on the sidebar closes it.
  // Chat rows claim right swipes for their actions, so the two never compete.
  const openPan = Gesture.Pan()
    .enabled(!open)
    .hitSlop({ left: 0, width: EDGE })
    .activeOffsetX(10)
    .failOffsetY([-14, 14])
    // The open state only changes on release: flipping it mid-drag would disable this very gesture.
    .onStart(() => scheduleOnRN(dismissKeyboard))
    .onChange(e => progress.set(clamp(e.translationX / W)))
    .onEnd(e => settle(e.velocityX > FLING || (e.velocityX > -FLING && progress.get() > 0.35)))
    .onFinalize((_, success) => {
      if (!success && target.get() === 0 && progress.get() > 0) settle(false);
    });
  const closePan = Gesture.Pan()
    .enabled(open)
    .activeOffsetX(-10)
    .failOffsetY([-14, 14])
    .onChange(e => progress.set(clamp(1 + e.translationX / W)))
    .onEnd(e => settle(!(e.velocityX < -FLING || (e.velocityX < FLING && progress.get() < 0.65))))
    .onFinalize((_, success) => {
      if (!success && target.get() === 1 && progress.get() < 1) settle(true);
    });

  // Android back closes the open sidebar first, but only while it is on screen (not under Settings).
  useFocusEffect(
    useCallback(() => {
      if (!open) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => (sidebar.close(), true));
      return () => sub.remove();
    }, [open]),
  );

  // The sidebar slides in from the left over the chat, which drifts right and dims behind it. With reduced
  // motion nothing travels: the sidebar fades in place.
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: reduce ? 0 : progress.get() * W * DRIFT }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.55 }));
  const sidebarStyle = useAnimatedStyle(() =>
    reduce ? { opacity: progress.get(), transform: [{ translateX: progress.get() > 0 ? 0 : -W }] } : { opacity: 1, transform: [{ translateX: (progress.get() - 1) * W }] },
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <GestureDetector gesture={openPan}>
        <Animated.View style={[{ flex: 1 }, contentStyle]} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}>
          <Drawer
            // Only the navigator is used: its drawer never opens. Neru's own sidebar is drawn below.
            drawerContent={() => null}
            screenOptions={{
              drawerType: 'front',
              drawerStyle: { width: 0 },
              swipeEnabled: false,
              headerShadowVisible: false,
              headerStyle: { backgroundColor: c.bg },
              headerTitleAlign: 'center',
              headerTitleStyle: { fontFamily: font.semibold, color: c.text },
              headerLeft: () => <TourTarget name="menu" style={{ marginLeft: 4 }}><IconButton name="menu" label={t('Open sidebar')} color={c.text} onPress={sidebar.open} /></TourTarget>,
              headerTitle: () => null,
              headerRight: () => null,
              sceneStyle: { backgroundColor: c.bg },
            }}
          >
            {/* A new chat shows which model will answer, centered; an open chat shows its title there instead. */}
            <Drawer.Screen name="index" options={{ headerTitle: () => <TourTarget name="model"><ModelButton /></TourTarget> }} />
            <Drawer.Screen
              name="chat/[id]"
              options={{
                // The model pill sits in the composer of an empty chat; once a chat has started it lives up here.
                headerRight: () => (
                  <View style={s.right}>
                    <TourTarget name="model"><ModelButton compact /></TourTarget>
                    <TourTarget name="compose"><IconButton name="compose" label={t('New chat')} color={c.text} onPress={newChat} /></TourTarget>
                  </View>
                ),
              }}
            />
          </Drawer>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimStyle]} />
        </Animated.View>
      </GestureDetector>
      <GestureDetector gesture={closePan}>
        <Animated.View
          pointerEvents={open ? 'auto' : 'none'}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          accessibilityViewIsModal={open}
          style={[StyleSheet.absoluteFill, s.sidebar, sidebarStyle]}
        >
          <DrawerContent />
        </Animated.View>
      </GestureDetector>
      <ModelSheet />
      <WhatsNew />
      <UpdatePrompt />
      <AppTour drawer={drawer} />
    </View>
  );
}

const s = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 4 },
  sidebar: { elevation: 24, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 4, height: 0 } },
});
