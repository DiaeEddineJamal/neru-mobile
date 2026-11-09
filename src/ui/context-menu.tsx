// Port of beui.dev/components/motion/context-menu
// Long press (520ms, 10px tolerance) opens the menu at the press point, clamped 8px
// inside the screen. Styled like Claude's app: a 22px rounded card on c.surface2 with outline icons, fading in and
// scaling up from the press point (0.3s EASE_OUT), folding back the same way on close.
// Additions for touch: a long-press haptic on open, a light one on each item, and the trigger lifting to 1.03 on
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
import { t as tx } from '@/i18n';

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
    haptic.long();
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
  // The press point inside the menu: the menu grows out of it.
  const ox = point ? clamp(point.x - left, 0, w) : 0;
  const oy = point ? clamp(point.y - top, 0, h) : 0;

  const liftStyle = useAnimatedStyle(() => ({ transform: [{ scale: lift.get() }] }));
  const menuStyle = useAnimatedStyle(() => {
    const p = reduce ? 1 : t.get();
    return { opacity: t.get(), transform: [{ scale: 0.86 + 0.14 * p }] };
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
          {item.icon ? <Icon name={item.icon} size={20} color={tone} strokeWidth={1.7} /> : null}
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
          accessibilityActions={disabled ? undefined : [{ name: 'longpress', label: tx('Show menu') }]}
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
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={tx('Close menu')} />
          {size ? (
            <View style={[s.portal, { left, top }]}>
              <Animated.View
                accessibilityRole="menu"
                accessibilityViewIsModal
                style={[s.menu, s.shadow, { width: size.w, height: size.h, backgroundColor: c.surface2, borderColor: c.border, transformOrigin: [ox, oy, 0] }, menuStyle]}
              >
                {rows}
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
  shadow: { boxShadow: '0 18px 36px rgba(0,0,0,0.32)' },
  menu: { position: 'absolute', left: 0, top: 0, minWidth: 232, padding: 6, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  item: { minHeight: TAP + 4, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, borderRadius: 16 },
  label: { flexShrink: 1, fontFamily: font.medium, fontSize: fs.base },
});
