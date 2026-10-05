// Port of beui.dev/components/blocks/swipeable-list (one row, right-side actions)
// Swiping left reveals 56px icon actions on the muted rail under the card. Release
// uses beUI's rules (opens past max(34px, 46% of the rail) or on a 720px/s fling
// after 14px, closes under 72% or on a 320px/s fling back) and settles on its row
// spring (560/48/0.82) carrying the clamped release velocity (±1500).
// Additions: a full swipe (past half the row) runs the last action, with a haptic
// as it arms; to make that reachable the card follows the finger past the rail
// instead of beUI's 4% rubber band (kept at the closed edge). Not ported:
// left-side actions, closing the other rows when one opens (no shared list
// state), action tones (callers pass the icon colour).
import * as Haptics from 'expo-haptics';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon, type IconName } from '@/components/Icon';
import { useColors } from '@/theme';

const ROW_SETTLE = { stiffness: 560, damping: 48, mass: 0.82 };
const ACTION_WIDTH = 56;
const REVEAL_THRESHOLD = 34;
const OPEN_DISTANCE_RATIO = 0.46;
const CLOSE_DISTANCE_RATIO = 0.72;
const OPEN_VELOCITY = 720;
const CLOSE_VELOCITY = 320;
const FLING_DISTANCE = 14;
const RELEASE_VELOCITY_LIMIT = 1500;
const FULL_SWIPE_RATIO = 0.5;

type Action = { key: string; label: string; icon: IconName; color: string; onPress: () => void };

export function SwipeableRow({ children, actions }: { children: ReactNode; actions: Action[] }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [rowWidth, setRowWidth] = useState(0);
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const armed = useSharedValue(false);
  const railWidth = actions.length * ACTION_WIDTH;
  const fullAt = Math.max(railWidth + ACTION_WIDTH, rowWidth * FULL_SWIPE_RATIO);

  const settle = (to: number, velocity = 0) => {
    'worklet';
    const v = Math.max(-RELEASE_VELOCITY_LIMIT, Math.min(RELEASE_VELOCITY_LIMIT, velocity));
    x.set(reduce ? to : withSpring(to, { ...ROW_SETTLE, velocity: v }));
  };
  const snap = (side: boolean, velocity = 0) => {
    'worklet';
    scheduleOnRN(setOpen, side);
    settle(side ? -railWidth : 0, velocity);
  };
  const run = (action: Action) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    action.onPress();
    setOpen(false);
    settle(0);
  };
  const runLast = () => {
    const last = actions[actions.length - 1];
    if (last) run(last);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onStart(() => {
      start.set(x.get());
      armed.set(false);
    })
    .onChange((e) => {
      const next = start.get() + e.translationX;
      x.set(next > 0 ? next * 0.04 : next);
      const nowArmed = -next > fullAt;
      if (nowArmed !== armed.get()) {
        armed.set(nowArmed);
        scheduleOnRN(Haptics.selectionAsync);
      }
    })
    .onEnd((e) => {
      const latest = x.get();
      const velocity = e.velocityX;
      if (armed.get()) {
        scheduleOnRN(runLast);
        return;
      }
      if (open) {
        snap(!(Math.abs(latest) < railWidth * CLOSE_DISTANCE_RATIO || velocity > CLOSE_VELOCITY), velocity);
        return;
      }
      const threshold = Math.max(REVEAL_THRESHOLD, railWidth * OPEN_DISTANCE_RATIO);
      snap(railWidth > 0 && (latest < -threshold || (velocity < -OPEN_VELOCITY && latest < -FLING_DISTANCE)), velocity);
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  // The rail grows with the card past its width, the last action taking the extra room.
  const railStyle = useAnimatedStyle(() => ({ width: Math.max(railWidth, -x.get()) }));

  return (
    <View
      onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
      accessibilityActions={actions.map((a) => ({ name: a.key, label: a.label }))}
      onAccessibilityAction={(e) => {
        const action = actions.find((a) => a.key === e.nativeEvent.actionName);
        if (action) run(action);
      }}
      style={[s.row, { backgroundColor: c.surface3 }]}
    >
      <Animated.View
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        style={[s.rail, railStyle]}
      >
        {actions.map((a, i) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={() => run(a)}
            style={[s.action, i === actions.length - 1 ? s.grow : { width: ACTION_WIDTH }]}
          >
            {({ pressed }) => (
              <View style={[s.actionIcon, pressed && { backgroundColor: c.bg, transform: [{ scale: 0.95 }] }]}>
                <Icon name={a.icon} size={18} color={a.color} />
              </View>
            )}
          </Pressable>
        ))}
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[s.card, { backgroundColor: c.surface }, cardStyle]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  // Flat like Claude's chat list: the row is the content, the card only covers the rail until swiped.
  row: { borderRadius: 10, overflow: 'hidden' },
  rail: { position: 'absolute', top: 0, bottom: 0, right: 0, flexDirection: 'row', borderTopRightRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden' },
  action: { height: '100%', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: ACTION_WIDTH },
  actionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 10, justifyContent: 'center' },
});
