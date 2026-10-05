// Port of beui.dev/components/motion/context-menu
// Long press (520ms, 10px tolerance) opens the menu at the press point, clamped 8px
// inside the screen, and it unfolds with beUI's clip morph: a 16px rounded square
// at the press point grows to the full menu (radius 10 to 12) with opacity, 0.3s
// EASE_OUT, and folds back the same way on close. Clip-path is emulated with an
// overflow-hidden frame and a counter-translated menu.
// Additions for touch: a haptic on open and the trigger lifting to 1.03 on
// SPRING_PANEL while the menu is up (beUI leaves the trigger alone). Not ported:
// right-click and keyboard opening, arrow-key/typeahead focus and the gliding
// hover highlight (rows show a pressed fill instead), checkbox/radio/label/
// separator/shortcut parts.
import { haptic } from '@/haptics';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon, type IconName } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';
import { EASE_OUT, SPRING_PANEL } from '@/ui/motion';

const VIEWPORT_PADDING = 8;
const LONG_PRESS_DELAY = 520;
const LONG_PRESS_TOLERANCE = 10;
const MORPH = { duration: 300, easing: EASE_OUT };
const MORPH_REDUCED = { duration: 100, easing: EASE_OUT };

type Item = { label: string; icon?: IconName; destructive?: boolean; onPress: () => void };
type Point = { x: number; y: number };

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function ContextMenu({ items, children, disabled = false }: { items: Item[]; children: ReactNode; disabled?: boolean }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const win = useWindowDimensions();
  const anchor = useRef<View>(null);
  const [point, setPoint] = useState<Point | null>(null); // menu mounted while set
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const t = useSharedValue(0);
  const lift = useSharedValue(1);

  const openAt = (p: Point) => {
    haptic.medium();
    setSize(null);
    setPoint(p);
    setOpen(true);
  };
  const close = () => setOpen(false);

  useEffect(() => {
    lift.set(reduce ? 1 : withSpring(open ? 1.03 : 1, SPRING_PANEL));
  }, [open, reduce, lift]);

  useEffect(() => {
    if (!point) return;
    const timing = reduce ? MORPH_REDUCED : MORPH;
    if (open) {
      if (size) t.set(withTiming(1, timing));
    } else {
      t.set(withTiming(0, timing, (done) => {
        if (done) scheduleOnRN(setPoint, null);
      }));
    }
  }, [open, size, point, reduce, t]);

  const longPress = Gesture.LongPress()
    .enabled(!disabled)
    .minDuration(LONG_PRESS_DELAY)
    .maxDistance(LONG_PRESS_TOLERANCE)
    .onStart((e) => scheduleOnRN(openAt, { x: e.absoluteX, y: e.absoluteY }));

  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const left = point ? Math.max(VIEWPORT_PADDING, Math.min(Math.max(point.x, VIEWPORT_PADDING), win.width - w - VIEWPORT_PADDING)) : 0;
  const top = point ? Math.max(VIEWPORT_PADDING, Math.min(Math.max(point.y, VIEWPORT_PADDING), win.height - h - VIEWPORT_PADDING)) : 0;
  // Top-left of the collapsed 16px square, centred on the press point.
  const ox = point ? clamp(point.x - left, 12, Math.max(12, w - 12)) - 8 : 0;
  const oy = point ? clamp(point.y - top, 12, Math.max(12, h - 12)) - 8 : 0;

  const liftStyle = useAnimatedStyle(() => ({ transform: [{ scale: lift.get() }] }));
  const clipStyle = useAnimatedStyle(() => {
    const p = reduce ? 1 : t.get();
    return { left: ox * (1 - p), top: oy * (1 - p), width: 16 + (w - 16) * p, height: 16 + (h - 16) * p, borderRadius: 10 + 2 * p, opacity: t.get() };
  });
  const menuStyle = useAnimatedStyle(() => {
    const p = reduce ? 1 : t.get();
    return { transform: [{ translateX: -ox * (1 - p) }, { translateY: -oy * (1 - p) }] };
  });

  const rows = items.map((item) => {
      const tone = item.destructive ? c.danger : c.text;
      return (
        <Pressable
          key={item.label}
          accessibilityRole="menuitem"
          onPress={() => {
            haptic.light();
            item.onPress();
            close();
          }}
          style={({ pressed }) => [s.item, pressed && { backgroundColor: item.destructive ? `${c.danger}1A` : `${c.text}11` }]}
        >
          {item.icon ? <Icon name={item.icon} size={16} color={tone} /> : null}
          <Text numberOfLines={1} style={[s.label, { color: tone }]}>
            {item.label}
          </Text>
        </Pressable>
      );
    });

  return (
    <>
      <GestureDetector gesture={longPress}>
        <Animated.View
          ref={anchor}
          accessibilityActions={disabled ? undefined : [{ name: 'longpress', label: 'Show menu' }]}
          onAccessibilityAction={() =>
            anchor.current?.measureInWindow((x, y, aw, ah) => openAt({ x: x + Math.min(24, aw / 2), y: y + ah / 2 }))
          }
          style={liftStyle}
        >
          {children}
        </Animated.View>
      </GestureDetector>
      {point ? (
        <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close menu" />
          {size ? (
            <View style={[s.portal, { left, top }]}>
              <Animated.View style={[s.clip, clipStyle]}>
                <Animated.View
                  accessibilityRole="menu"
                  accessibilityViewIsModal
                  style={[s.menu, { width: size.w, height: size.h, backgroundColor: c.surface2, borderColor: c.border }, menuStyle]}
                >
                  {rows}
                </Animated.View>
              </Animated.View>
            </View>
          ) : (
            // Measuring pass: lay the menu out unclipped and invisible, then morph it open.
            <View
              onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
              style={[s.menu, s.measure, { borderColor: c.border }]}
            >
              {rows}
            </View>
          )}
        </Modal>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  portal: { position: 'absolute' },
  measure: { alignSelf: 'flex-start', opacity: 0 },
  clip: { position: 'absolute', overflow: 'hidden', boxShadow: '0 18px 28px rgba(0,0,0,0.2)' },
  menu: { position: 'absolute', left: 0, top: 0, minWidth: 224, padding: 6, borderRadius: 12, borderWidth: 1 },
  item: { minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 8 },
  label: { flexShrink: 1, fontFamily: font.sans, fontSize: fs.sm },
});
