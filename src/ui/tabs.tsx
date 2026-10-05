// Port of beui.dev/components/motion/tabs (pill variant)
// The shared-layout pill glides on the component's own spring (245/36/1.2, no
// overshoot), and the active-colour labels are clipped to the pill as it moves,
// as beUI does with clip-path: a copy of the labels rides inside the pill,
// counter-translated so it lines up with the labels underneath.
// Not ported: hover colour, the overflow scroll arrows and edge fades (a
// segmented control holds a few short items), TabsContent (callers render panes).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptic } from '@/haptics';
import { font, fs, useColors } from '@/theme';

const TAB_SPRING = { stiffness: 245, damping: 36, mass: 1.2 };

/** With `icon`, the tab shows only the glyph (drawn in the given colour); `label` becomes its accessibility name. */
type Item = { value: string; label: string; icon?: (color: string) => ReactNode };
type Box = { x: number; w: number };

export function SegmentedTabs({ items, value, onChange }: { items: Item[]; value: string; onChange: (value: string) => void }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  const tx = boxes[value]?.x;
  const tw = boxes[value]?.w;

  useEffect(() => {
    if (tx === undefined || tw === undefined) return;
    if (!placed.current || reduce) {
      x.set(tx);
      w.set(tw);
      placed.current = true;
    } else {
      x.set(withSpring(tx, TAB_SPRING));
      w.set(withSpring(tw, TAB_SPRING));
    }
  }, [tx, tw, reduce, x, w]);

  const pillStyle = useAnimatedStyle(() => ({ width: w.get(), transform: [{ translateX: x.get() }] }));
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -x.get() }] }));

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
