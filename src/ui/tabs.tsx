// Port of beui.dev/components/motion/tabs (pill variant)
// The pill moves edge by edge: the edge leading the way springs ahead and the
// trailing edge follows a beat later, so the pill stretches toward the new tab
// and settles back to its width (the liquid tab switch of iOS and Telegram).
// The active-colour labels are clipped to the pill as it moves,
// as beUI does with clip-path: a copy of the labels rides inside the pill,
// counter-translated so it lines up with the labels underneath.
// Not ported: hover colour, the overflow scroll arrows and edge fades (a
// segmented control holds a few short items), TabsContent (callers render panes).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptic } from '@/haptics';
import { font, fs, useColors } from '@/theme';

const LEAD = { stiffness: 420, damping: 34, mass: 0.9 };
const TRAIL = { stiffness: 190, damping: 26, mass: 1 };

/** With `icon`, the tab shows only the glyph (drawn in the given colour); `label` becomes its accessibility name. */
type Item = { value: string; label: string; icon?: (color: string) => ReactNode };
type Box = { x: number; w: number };

export function SegmentedTabs({ items, value, onChange }: { items: Item[]; value: string; onChange: (value: string) => void }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const placed = useRef(false);
  const tx = boxes[value]?.x;
  const tw = boxes[value]?.w;

  useEffect(() => {
    if (tx === undefined || tw === undefined) return;
    if (!placed.current || reduce) {
      left.set(tx);
      right.set(tx + tw);
      placed.current = true;
    } else {
      const forward = tx > left.get();
      left.set(withSpring(tx, forward ? TRAIL : LEAD));
      right.set(withSpring(tx + tw, forward ? LEAD : TRAIL));
    }
  }, [tx, tw, reduce, left, right]);

  const pillStyle = useAnimatedStyle(() => ({ width: Math.max(0, right.get() - left.get()), transform: [{ translateX: left.get() }] }));
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -left.get() }] }));

  return (
    <View accessibilityRole="tablist" style={[s.list, { backgroundColor: c.surface2 }]}>
      <Animated.View style={[s.pill, { backgroundColor: c.mossAction }, pillStyle]} />
      {items.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="tab"
          accessibilityState={{ selected: item.value === value }}
          accessibilityLabel={item.label}
          hitSlop={{ top: 4, bottom: 4 }}
          onPress={() => {
            if (item.value !== value) haptic.select();
            onChange(item.value);
          }}
          onLayout={(e) => {
            const { x: bx, width } = e.nativeEvent.layout;
            setBoxes((prev) => (prev[item.value]?.x === bx && prev[item.value]?.w === width ? prev : { ...prev, [item.value]: { x: bx, w: width } }));
          }}
          style={[s.tab, item.icon && s.iconTab]}
        >
          {item.icon ? item.icon(c.muted) : (
            <Text numberOfLines={1} style={[s.label, { color: c.muted }]}>
              {item.label}
            </Text>
          )}
        </Pressable>
      ))}
      {/* Active-colour labels clipped to the pill, above the muted ones (beUI's clip-path labels). */}
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[s.pill, s.clip, pillStyle]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, counterStyle]}>
          {items.map((item) => {
            const b = boxes[item.value];
            return b ? (
              <View key={item.value} style={[s.ghost, { left: b.x, width: b.w }]}>
                {item.icon ? item.icon(c.onAction) : (
                  <Text numberOfLines={1} style={[s.label, { color: c.onAction }]}>
                    {item.label}
                  </Text>
                )}
              </View>
            ) : null;
          })}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const PAD = 4;

const s = StyleSheet.create({
  list: { flexDirection: 'row', alignSelf: 'flex-start', gap: 4, padding: PAD, borderRadius: 9999 },
  pill: { position: 'absolute', top: PAD, bottom: PAD, left: 0, borderRadius: 9999, overflow: 'hidden' },
  clip: { pointerEvents: 'none' },
  ghost: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tab: { minHeight: 40, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 9999 },
  iconTab: { minHeight: 30, minWidth: 44, paddingHorizontal: 12 },
  label: { fontFamily: font.medium, fontSize: fs.sm },
});
