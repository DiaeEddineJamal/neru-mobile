// Port of beui.dev/components/motion/select (option list), presented in BottomSheet
// Option rows, the muted fill and trailing check on the selected row, and the
// staggered entrance (35ms apart after 50ms, each fading in from 6px above) are
// beUI's. Not ported: the gooey trigger/panel morph (the sheet replaces the
// inline dropdown), the rows' 3px blur and hover fill. Rows are 48 tall instead of
// ~32 for touch, and an optional description line is a Neru addition.
import { haptic } from '@/haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { type EntryExitAnimationFunction, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { font, fs, TAP, useColors } from '@/theme';
import { BottomSheet } from '@/ui/bottom-sheet';

// Motion's defaults for a variant without its own transition: 0.3s tween for
// opacity, its stiff spring (500/25) for y.
const rowIn = (index: number): EntryExitAnimationFunction => () => {
  'worklet';
  const delay = 50 + index * 35;
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -6 }] },
    animations: {
      opacity: withDelay(delay, withTiming(1, { duration: 300 })),
      transform: [{ translateY: withDelay(delay, withSpring(0, { stiffness: 500, damping: 25, mass: 1 })) }],
    },
  };
};

type Option = { value: string; label: string; description?: string };
type Props = { open: boolean; onClose: () => void; title: string; options: Option[]; value: string; onChange: (value: string) => void };

export function SelectSheet({ open, onClose, title, options, value, onChange }: Props) {
  const c = useColors();
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <View accessibilityRole="radiogroup" style={s.list}>
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <Animated.View key={o.value} entering={rowIn(i)}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={o.description ? `${o.label}, ${o.description}` : o.label}
                onPress={() => {
                  haptic.select();
                  onChange(o.value);
                  onClose();
                }}
                style={({ pressed }) => [s.row, (selected || pressed) && { backgroundColor: c.surface3 }]}
              >
                <View style={s.text}>
                  <Text numberOfLines={1} style={[s.label, { color: selected ? c.text : c.muted }]}>
                    {o.label}
                  </Text>
                  {o.description ? (
                    <Text numberOfLines={2} style={[s.description, { color: c.muted }]}>
                      {o.description}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Icon name="check" size={14} color={c.text} /> : null}
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  list: { padding: 4 },
  row: { minHeight: TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  text: { flex: 1 },
  label: { fontFamily: font.sans, fontSize: fs.sm },
  description: { marginTop: 2, fontFamily: font.sans, fontSize: fs.xs },
});
