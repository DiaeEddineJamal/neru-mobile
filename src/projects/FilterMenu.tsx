// The Projects page's filter popover (Yours / Archived), opened from the header's filter button.
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { haptic } from '@/haptics';
import { font, fs, TAP, useColors } from '@/theme';

export type Option<T extends string> = { value: T; label: string; icon: IconName };

export function FilterMenu<T extends string>({ open, onClose, options, value, onChange }: { open: boolean; onClose: () => void; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[s.menu, { top: insets.top + 56, backgroundColor: c.surface2, borderColor: c.border }]}>
        {options.map(o => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => (haptic.select(), onChange(o.value), onClose())}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: on }}
              android_ripple={{ color: c.surface3 }}
              style={s.item}
            >
              <Icon name={o.icon} size={22} color={on ? c.sage : c.secondary} />
              <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: fs.md, color: on ? c.sage : c.text }}>{o.label}</Text>
              {on ? <Icon name="check" size={20} color={c.sage} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  menu: { position: 'absolute', right: 12, minWidth: 220, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingVertical: 6, elevation: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: TAP + 8, paddingHorizontal: 18 },
});
