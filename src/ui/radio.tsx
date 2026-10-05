// Port of beui.dev/components/motion/radio
// The indicator and its dot follow beUI (2px ring, inset dot on SPRING_LAYOUT, 0.92 press on SPRING_PRESS).
// Each item is a full card here so the whole row is the touch target. beUI's shared-layout dot that
// glides between items has no RN equivalent; the dot scales in on the newly selected item instead.
import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';
import { SPRING_LAYOUT, SPRING_PRESS } from '@/ui/motion';

export type RadioOption = { value: string; title: string; description?: string; icon?: IconName; badge?: string };

function RadioCard({ option, selected, onPress }: { option: RadioOption; selected: boolean; onPress: () => void }) {
  const c = useColors();
  const reduce = useReducedMotion();
  const dot = useSharedValue(selected ? 1 : 0);
  const press = useSharedValue(1);
  const ring = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    dot.set(reduce ? (selected ? 1 : 0) : withSpring(selected ? 1 : 0, SPRING_LAYOUT));
    ring.set(reduce ? (selected ? 1 : 0) : withTiming(selected ? 1 : 0, { duration: 200 }));
  }, [selected, reduce, dot, ring]);

  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: dot.get() }], opacity: dot.get() }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.get() }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.get() }));

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      onPressIn={() => !reduce && press.set(withSpring(0.98, SPRING_PRESS))}
      onPressOut={() => press.set(withSpring(1, SPRING_PRESS))}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={option.description ? `${option.title}. ${option.description}` : option.title}
    >
      <Animated.View style={[s.card, { backgroundColor: c.surface2, borderColor: c.border }, cardStyle]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.selectedRing, { borderColor: c.mossAction }, ringStyle]} />
        {option.icon ? (
          <View style={[s.iconWrap, { backgroundColor: c.surface3 }]}>
            <Icon name={option.icon} size={22} color={selected ? c.moss : c.secondary} />
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: fs.base, color: c.text }}>{option.title}</Text>
            {option.badge ? (
              <Text style={[s.badge, { color: c.moss, backgroundColor: c.mossDeep }]}>{option.badge}</Text>
            ) : null}
          </View>
          {option.description ? <Text style={{ fontFamily: font.sans, fontSize: fs.sm, color: c.secondary, lineHeight: 20 }}>{option.description}</Text> : null}
        </View>
        <View style={[s.indicator, { borderColor: selected ? c.mossAction : c.muted }]}>
          <Animated.View style={[s.dot, { backgroundColor: c.mossAction }, dotStyle]} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function RadioGroup({ options, value, onChange, children }: { options: RadioOption[]; value: string; onChange: (value: string) => void; children?: ReactNode }) {
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
      {options.map(o => (
        <RadioCard key={o.value} option={o} selected={o.value === value} onPress={() => onChange(o.value)} />
      ))}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: TAP + 24, padding: 16, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  selectedRing: { borderRadius: 18, borderWidth: 2 },
  iconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  indicator: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, borderRadius: 8 },
  badge: { fontFamily: font.medium, fontSize: fs.xs, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
});
