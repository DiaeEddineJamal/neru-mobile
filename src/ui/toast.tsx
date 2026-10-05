// Port of beui.dev/components/motion/animated-toast-stack (bottom-center, neutral status)
// Up to 4 visible toasts, oldest at the bottom, re-stacking on beUI's stack spring
// (420/34/0.75). Each enters from 22px below at 96% scale on that spring, leaves
// 32px to the right in 0.18s EASE_OUT, auto-dismisses after 4.2s, and swipes away
// sideways (elastic 0.18; past 72px or 520px/s). Not ported: blur on enter/exit
// and the surface's backdrop blur, other statuses/positions, renderToast. Toasts
// render in the app window, so they sit under an open RN Modal.
import * as Haptics from 'expo-haptics';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type EntryExitAnimationFunction,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '@/components/Icon';
import { font, fs, useColors } from '@/theme';
import { EASE_OUT } from '@/ui/motion';

const STACK_SPRING = { stiffness: 420, damping: 34, mass: 0.75 };
const SNAP_BACK = { stiffness: 200, damping: 40, mass: 1 };
const DEFAULT_DURATION = 4200;
const MAX_VISIBLE = 4;

const toastIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 22 }, { scale: 0.96 }] },
    animations: {
      opacity: withSpring(1, STACK_SPRING),
      transform: [{ translateY: withSpring(0, STACK_SPRING) }, { scale: withSpring(1, STACK_SPRING) }],
    },
  };
};
const toastOut: EntryExitAnimationFunction = () => {
  'worklet';
  const t = { duration: 180, easing: EASE_OUT };
  return {
    initialValues: { opacity: 1, transform: [{ translateX: 0 }, { scale: 1 }] },
    animations: { opacity: withTiming(0, t), transform: [{ translateX: withTiming(32, t) }, { scale: withTiming(0.96, t) }] },
  };
};
const restack = LinearTransition.springify().stiffness(STACK_SPRING.stiffness).damping(STACK_SPRING.damping).mass(STACK_SPRING.mass);

type ToastInput = { title: string; description?: string; action?: { label: string; onPress: () => void }; duration?: number };
type Toast = ToastInput & { id: number };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return { show };
}

let seed = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    setToasts((all) => [...all, { ...toast, id: seed++ }]);
    AccessibilityInfo.announceForAccessibility(toast.description ? `${toast.title}. ${toast.description}` : toast.title);
  }, []);
  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <ToastContext.Provider value={show}>
      <View style={s.fill}>
        {children}
        <View style={[s.stack, { bottom: insets.bottom + 24 }]}>
          {visible.map((t, i) => (
            <ToastItem key={t.id} toast={t} index={i} onDismiss={dismiss} />
          ))}
        </View>
      </View>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, index, onDismiss }: { toast: Toast; index: number; onDismiss: (id: number) => void }) {
  const c = useColors();
  const x = useSharedValue(0);
  const { id, duration = DEFAULT_DURATION } = toast;
  const hasDetails = !!(toast.description || toast.action);

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  const swipe = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onChange((e) => x.set(e.translationX * 0.18))
    .onEnd((e) => {
      if (Math.abs(e.translationX) > 72 || Math.abs(e.velocityX) > 520) scheduleOnRN(onDismiss, id);
      else x.set(withSpring(0, SNAP_BACK));
    });
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <Animated.View entering={toastIn} exiting={toastOut} layout={restack} style={[s.item, { zIndex: 20 - index }]}>
      <GestureDetector gesture={swipe}>
        <Animated.View
          accessibilityActions={[{ name: 'dismiss', label: 'Dismiss toast' }]}
          onAccessibilityAction={() => onDismiss(id)}
          style={[s.surface, { backgroundColor: `${c.surface2}F2`, borderColor: c.border }, dragStyle]}
        >
          <View style={[s.row, { alignItems: hasDetails ? 'flex-start' : 'center' }]}>
            <View style={[s.iconWrap, hasDetails && s.nudge, { backgroundColor: `${c.surface3}99` }]}>
              <Icon name="bell" size={14} color={c.muted} />
            </View>
            <View style={s.content}>
              <Text numberOfLines={1} style={[s.title, { color: c.text }]}>
                {toast.title}
              </Text>
              {toast.description ? (
                <Text numberOfLines={2} style={[s.description, { color: c.muted }]}>
                  {toast.description}
                </Text>
              ) : null}
              {toast.action ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    toast.action?.onPress();
                  }}
                  style={({ pressed }) => [s.action, { backgroundColor: pressed ? c.surface3 : `${c.surface3}CC` }]}
                >
                  <Text style={[s.actionLabel, { color: c.text }]}>{toast.action.label}</Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss toast" hitSlop={10} onPress={() => onDismiss(id)} style={s.close}>
              <Icon name="close" size={14} color={c.muted} />
            </Pressable>
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  // beUI's flex-col-reverse: the oldest toast sits lowest, newer ones stack above it.
  stack: { position: 'absolute', left: 16, right: 16, flexDirection: 'column-reverse', alignItems: 'center', gap: 8, pointerEvents: 'box-none' },
  item: { width: '100%', maxWidth: 384 },
  surface: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  },
  row: { flexDirection: 'row', gap: 12 },
  iconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  nudge: { marginTop: 2 },
  content: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.medium, fontSize: fs.sm, lineHeight: 20 },
  description: { marginTop: 2, fontFamily: font.sans, fontSize: fs.xs, lineHeight: 16 },
  action: { marginTop: 8, alignSelf: 'flex-start', height: 28, borderRadius: 14, paddingHorizontal: 12, justifyContent: 'center' },
  actionLabel: { fontFamily: font.medium, fontSize: fs.xs },
  close: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
