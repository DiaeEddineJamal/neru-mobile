import { Pressable, Text, useWindowDimensions } from 'react-native';

import { Icon } from '@/components/Icon';
import { modelLabel, setModelSheet, useStore } from '@/store';
import { font, fs, TAP, useColors } from '@/theme';

export function ModelButton() {
  const c = useColors();
  const { width } = useWindowDimensions();
  const label = useStore(s => modelLabel(s.settings));
  return (
    <Pressable
      onPress={() => setModelSheet(true)}
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}. Change model`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TAP, paddingHorizontal: 8 }}
    >
      <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: fs.md, color: c.text, maxWidth: Math.max(100, width - 160) }}>{label}</Text>
      <Icon name="chevronDown" size={18} color={c.muted} />
    </Pressable>
  );
}
