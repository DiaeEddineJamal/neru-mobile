// Port of beui.dev/components/agents/agent-disclosure (shared by tool-result, tool-approval, file-diff,
// todo-list, agent-activity), plus the rotating ChevronDown every one of them uses as its toggle affordance.
// Not portable: clip-path. As in beUI the box snaps to its full height on open (and to 0 on close) and the
// content is revealed top-down inside it; here an animated-height clip stands in for inset(0 0 100% 0).
import { type ReactNode, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { EASE_OUT, SPRING_SWAP } from '@/ui/motion';

/** `height` fixes the open height (beUI's openHeight); otherwise the content's own height is used. */
export function AgentDisclosure({ open, height, children }: { open: boolean; height?: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [measured, setMeasured] = useState(0);
  const full = height ?? measured;
  const shown = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    shown.set(withTiming(open ? 1 : 0, { duration: reduce ? 0 : open ? 220 : 140, easing: EASE_OUT }));
  }, [open, reduce, shown]);
  const reveal = useAnimatedStyle(() =>
    reduce
      ? { opacity: shown.get(), height: full }
      : { opacity: shown.get(), height: shown.get() * full, transform: [{ translateY: (1 - shown.get()) * -4 }] },
  );
  return (
    <View
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      pointerEvents={open ? 'auto' : 'none'}
      style={{ height: open ? full : 0, overflow: 'hidden' }}
    >
      <Animated.View style={[{ overflow: 'hidden' }, reveal]}>
        <View onLayout={e => setMeasured(e.nativeEvent.layout.height)} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

/** ChevronDown that turns 180° on open with SPRING_SWAP (instant under reduced motion). */
export function DisclosureChevron({ open, color, size = 14 }: { open: boolean; color: string; size?: number }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(open ? 180 : 0);
  useEffect(() => {
    turn.set(reduce ? (open ? 180 : 0) : withSpring(open ? 180 : 0, SPRING_SWAP));
  }, [open, reduce, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));
  return (
    <Animated.View importantForAccessibility="no" style={spin}>
      <Icon name="chevronDown" size={size} color={color} />
    </Animated.View>
  );
}
