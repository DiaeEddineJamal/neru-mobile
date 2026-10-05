// Port of beui.dev/components/agents/todo-list
// Bordered section, header (ListTodo ↔ drawn green check, "To-dos", rolled completed/total count, chevron),
// AgentDisclosure list capped at 248 that follows new items, SVG status rings (dashed pending, spinning
// 68% arc in progress, drawn check when completed) and the strike line that wipes in from the left.
// Collapses when everything is completed and reopens when something is not (collapseOnComplete).
// Not ported: cancelled status, per-item progress and detail (not in Neru's todo shape).
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type EntryExitAnimationFunction,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';
import { RollText } from '@/ui/action-swap';
import { AgentDisclosure, DisclosureChevron } from '@/ui/agent-disclosure';
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from '@/ui/motion';

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' };

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK = 'M7.5 12.25 10.5 15.25 16.75 8.75';
const CHECK_LENGTH = 13.26; // the two segments of CHECK
const RING = 2 * Math.PI * 9;
const label = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' } as const;

// Rows: { opacity: 0, y: 6 } in, { opacity: 0, y: -3 } out; opacity over 0.18s EASE_OUT, y and layout on SPRING_LAYOUT.
const rowIn: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 0, transform: [{ translateY: 6 }] }, animations: { opacity: withTiming(1, { duration: 180, easing: EASE_OUT }), transform: [{ translateY: withSpring(0, SPRING_LAYOUT) }] } };
};
const rowOut: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 1, transform: [{ translateY: 0 }] }, animations: { opacity: withTiming(0, { duration: 180, easing: EASE_OUT }), transform: [{ translateY: withSpring(-3, SPRING_LAYOUT) }] } };
};
const rowLayout = LinearTransition.springify().stiffness(360).damping(32).mass(0.6);

// Header icon swap (popLayout): the check pops in from 0.72, the list icon from 0.8 and out to 0.72.
const popIn = (from: number): EntryExitAnimationFunction => () => {
  'worklet';
  return { initialValues: { opacity: 0, transform: [{ scale: from }] }, animations: { opacity: withSpring(1, SPRING_SWAP), transform: [{ scale: withSpring(1, SPRING_SWAP) }] } };
};
const popOut = (to: number): EntryExitAnimationFunction => () => {
  'worklet';
  return { initialValues: { opacity: 1, transform: [{ scale: 1 }] }, animations: { opacity: withSpring(0, SPRING_SWAP), transform: [{ scale: withSpring(to, SPRING_SWAP) }] } };
};

/** Draws from 0 to 1 over `duration` ms EASE_OUT (pathLength), or sits at the target under reduced motion. */
function useDraw(on: boolean, duration: number, delay = 0) {
  const reduce = useReducedMotion();
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    p.set(reduce ? (on ? 1 : 0) : withDelay(delay, withTiming(on ? 1 : 0, { duration, easing: EASE_OUT })));
  }, [on, reduce, duration, delay, p]);
  return p;
}

/** Green disc whose white check draws in over 0.24s EASE_OUT each time it mounts. */
function CompleteMark({ color }: { color: string }) {
  const reduce = useReducedMotion();
  const draw = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) draw.set(withTiming(1, { duration: 240, easing: EASE_OUT }));
  }, [reduce, draw]);
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - draw.get()) }));
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} fill={color} />
      <AnimatedPath animatedProps={checkProps} d={CHECK} fill="none" stroke="#fff" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH]} />
    </Svg>
  );
}

function HeaderIcon({ complete }: { complete: boolean }) {
  const c = useColors();
  const reduce = useReducedMotion();
  return (
    <View importantForAccessibility="no-hide-descendants" style={{ width: 24, height: 24 }}>
      <LayoutAnimationConfig skipEntering>
        {complete ? (
          <Animated.View key="complete" entering={reduce ? undefined : popIn(0.72)} exiting={reduce ? undefined : popOut(1)} style={{ position: 'absolute', inset: 1 }}>
            <CompleteMark color={c.moss} />
          </Animated.View>
        ) : (
          <Animated.View key="todo" entering={reduce ? undefined : popIn(0.8)} exiting={reduce ? undefined : popOut(0.72)} style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checklist" size={16} color={c.muted} />
          </Animated.View>
        )}
      </LayoutAnimationConfig>
    </View>
  );
}

function StatusIcon({ status }: { status: Todo['status'] }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const active = status === 'in_progress';
  const color = active ? c.text : c.muted;
  const fill = useDraw(status === 'completed', 180);
  const check = useDraw(status === 'completed', 240);
  // The arc grows to 68% on SPRING_LAYOUT and spins 360° per 1.1s while in progress.
  const arc = useSharedValue(active ? 0.68 : 0);
  const turn = useSharedValue(0);
  useEffect(() => {
    arc.set(reduce ? (active ? 0.68 : 0) : withSpring(active ? 0.68 : 0, SPRING_LAYOUT));
    if (active && !reduce) turn.set(withRepeat(withTiming(360, { duration: 1100, easing: Easing.linear }), -1));
    else {
      cancelAnimation(turn);
      turn.set(0);
    }
  }, [active, reduce, arc, turn]);
  const ringProps = useAnimatedProps(() => ({ fillOpacity: fill.get() * 0.06 }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - check.get()), strokeOpacity: check.get() }));
  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: RING * (1 - arc.get()), strokeOpacity: arc.get() > 0.001 ? 1 : 0 }));
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() - 90}deg` }] }));
  return (
    <View style={{ width: 20, height: 20, marginHorizontal: 2 }}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <AnimatedCircle animatedProps={ringProps} cx={12} cy={12} r={9} fill={color} stroke={color} strokeWidth={1.5} strokeDasharray={status === 'pending' ? [2, 3] : undefined} strokeLinecap="round" opacity={active ? 0.2 : 1} />
        <AnimatedPath animatedProps={checkProps} d={CHECK} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH]} />
      </Svg>
      <Animated.View style={[{ position: 'absolute', inset: 0 }, spin]}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <AnimatedCircle animatedProps={arcProps} cx={12} cy={12} r={9} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={[RING, RING]} />
        </Svg>
      </Animated.View>
    </View>
  );
}

function Row({ todo }: { todo: Todo }) {
  const c = useColors();
  const done = todo.status === 'completed';
  const strike = useDraw(done, 280, 60);
  const line = useAnimatedStyle(() => ({ opacity: strike.get(), transform: [{ scaleX: strike.get() }] }));
  const color = todo.status === 'in_progress' ? c.text : c.muted;
  return (
    <View accessible accessibilityLabel={`${label[todo.status]}: ${todo.content}`} style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 4 }}>
      <StatusIcon status={todo.status} />
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.sans, fontSize: fs.sm, lineHeight: 20, color, opacity: todo.status === 'in_progress' ? 1 : 0.8 }}>{todo.content}</Text>
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: color, transformOrigin: 'left' }, line]} />
      </View>
    </View>
  );
}

export function TodoList({ todos }: { todos: Todo[] }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const viewport = useRef<ScrollView>(null);
  const completed = todos.filter(t => t.status === 'completed').length;
  const allComplete = todos.length > 0 && completed === todos.length;
  const [open, setOpen] = useState(true);
  const [wasComplete, setWasComplete] = useState(false);
  if (wasComplete !== allComplete) {
    setWasComplete(allComplete);
    setOpen(!allComplete);
  }

  useEffect(() => {
    viewport.current?.scrollToEnd({ animated: !reduce });
  }, [todos.length, reduce]);

  return (
    <View accessibilityLabel="Agent task list" style={{ width: '100%', overflow: 'hidden', borderRadius: 16, borderWidth: 1, borderColor: c.border }}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={`To-dos, ${completed} of ${todos.length} tasks completed`}
        accessibilityState={{ expanded: open }}
        style={{ height: TAP, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}
      >
        <HeaderIcon complete={allComplete} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.medium, fontSize: fs.sm, color: c.text }}>To-dos</Text>
        <View style={{ flexDirection: 'row' }}>
          <RollText value={String(completed)} style={{ fontFamily: font.medium, fontSize: fs.xs, fontVariant: ['tabular-nums'], color: allComplete ? c.sage : c.muted }}>{completed}</RollText>
          <Text style={{ fontFamily: font.medium, fontSize: fs.xs, fontVariant: ['tabular-nums'], color: allComplete ? c.sage : c.muted }}>/{todos.length}</Text>
        </View>
        <DisclosureChevron open={open} color={c.muted} />
      </Pressable>

      <AgentDisclosure open={open}>
        <ScrollView ref={viewport} nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: 248 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}>
          {todos.length ? (
            <LayoutAnimationConfig skipEntering>
              {todos.map(todo => (
                <Animated.View key={todo.content} entering={reduce ? undefined : rowIn} exiting={reduce ? undefined : rowOut} layout={reduce ? undefined : rowLayout}>
                  <Row todo={todo} />
                </Animated.View>
              ))}
            </LayoutAnimationConfig>
          ) : (
            <Text style={{ paddingHorizontal: 6, paddingVertical: 8, fontFamily: font.sans, fontSize: fs.sm, color: c.muted }}>No tasks yet</Text>
          )}
        </ScrollView>
      </AgentDisclosure>
    </View>
  );
}
